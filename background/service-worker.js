// ── Built-in portal targets ──
const BUILTIN_TARGETS = [
  {
    name: "Canvas LMS",
    source: "canvas",
    url: "https://canvas.bham.ac.uk",
    script: "content-scripts/canvas.js",
    funcName: "crawlCanvasData"
  },
  {
    name: "Outlook Web (50 Emails)",
    source: "outlook",
    url: "https://outlook.office.com/mail/inbox",
    fallbackUrl: "https://outlook.cloud.microsoft/mail/",
    script: "content-scripts/outlook.js",
    funcName: "crawlOutlookData"
  },
  {
    name: "MyUoB Portal",
    source: "myuob",
    url: "https://myuob.bham.ac.uk/dashboard/student-home",
    script: "content-scripts/myuob.js",
    funcName: "crawlSocietyData"
  },
  {
    name: "Guild Societies",
    source: "society",
    url: "https://www.guildofstudents.com/events",
    script: "content-scripts/myuob.js",
    funcName: "crawlSocietyData"
  },
  {
    name: "Library Services",
    source: "library",
    url: "https://intranet.birmingham.ac.uk/student/libraries/index.aspx",
    script: "content-scripts/myuob.js",
    funcName: "crawlSocietyData"
  }
];

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function findExistingTab(target) {
  try {
    const host = new URL(target.url).hostname;
    let patterns = [`*://${host}/*`];
    if (target.source === "outlook") {
      patterns = [
        "*://outlook.office.com/*",
        "*://outlook.cloud.microsoft/*",
        "*://outlook.office365.com/*",
        "*://outlook.live.com/*"
      ];
    }
    const tabs = await chrome.tabs.query({ url: patterns });
    return tabs && tabs.length > 0 ? tabs[0] : null;
  } catch (e) {
    return null;
  }
}

async function crawlTab(target) {
  let tab = null;
  let isCreatedByUs = false;

  try {
    // 1. Reuse any open tab matching this portal
    tab = await findExistingTab(target);

    if (tab && tab.id) {
      console.log(`[Crawler] Reusing open tab for ${target.name} (Tab ID: ${tab.id})`);
    } else {
      // 2. Open a background tab
      isCreatedByUs = true;
      tab = await chrome.tabs.create({ url: target.url, active: false });

      await new Promise((resolve) => {
        const timeout = setTimeout(resolve, 12000); // 12s hard cap
        function listener(tabId, changeInfo) {
          if (tabId === tab.id && changeInfo.status === "complete") {
            clearTimeout(timeout);
            chrome.tabs.onUpdated.removeListener(listener);
            resolve();
          }
        }
        chrome.tabs.onUpdated.addListener(listener);
      });

      // Extra hydration delay for SPAs
      const hydrationTime = target.source === "outlook" ? 4000 : 1500;
      await wait(hydrationTime);
    }

    // 3. Inject the content script (idempotent — each script has a loaded guard)
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: [target.script]
    });

    // Small delay to allow the IIFE to fully execute and register window functions
    await wait(200);

    // 4. Execute the extractor function in the page context
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: async (fnName) => {
        if (typeof window[fnName] === "function") {
          try {
            const res = await window[fnName]();
            return Array.isArray(res) ? res : [];
          } catch (err) {
            console.error(`[Scraper Error in ${fnName}]:`, err);
            return [];
          }
        }
        console.warn(`[Scraper] Function "${fnName}" not found on window`);
        return [];
      },
      args: [target.funcName]
    });

    // FIX: Do NOT override item.source here — each content script sets the correct
    // source internally (e.g. "myuob" vs "society" based on actual page hostname).
    // Only stamp source if the item has no source at all (safety net).
    const rawItems = results?.[0]?.result || [];
    const items = rawItems.map(item => ({
      ...item,
      source: item.source || target.source
    }));

    console.log(`[Crawler] ${target.name} returned ${items.length} items`);
    return items;
  } catch (err) {
    console.warn(`[Crawler] Failed crawling ${target.name}:`, err.message);
    return [];
  } finally {
    if (isCreatedByUs && tab && tab.id) {
      try { await chrome.tabs.remove(tab.id); } catch (e) {}
    }
  }
}

// ── Custom site crawl ──
async function crawlCustomSite(customTarget) {
  let tab = null;
  let isCreatedByUs = false;

  try {
    // Check if the user already has this URL open
    const host = new URL(customTarget.url).hostname;
    const tabs = await chrome.tabs.query({ url: [`*://${host}/*`] });
    tab = tabs && tabs.length > 0 ? tabs[0] : null;

    if (tab) {
      console.log(`[Custom Crawler] Reusing open tab for ${customTarget.url}`);
    } else {
      isCreatedByUs = true;
      tab = await chrome.tabs.create({ url: customTarget.url, active: false });

      await new Promise((resolve) => {
        const timeout = setTimeout(resolve, 12000);
        function listener(tabId, changeInfo) {
          if (tabId === tab.id && changeInfo.status === "complete") {
            clearTimeout(timeout);
            chrome.tabs.onUpdated.removeListener(listener);
            resolve();
          }
        }
        chrome.tabs.onUpdated.addListener(listener);
      });

      await wait(2000);
    }

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content-scripts/custom.js"]
    });

    await wait(200);

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: async () => {
        if (typeof window.crawlCustomPage === "function") {
          try {
            return await window.crawlCustomPage();
          } catch (err) {
            return [];
          }
        }
        return [];
      }
    });

    const items = results?.[0]?.result || [];
    console.log(`[Custom Crawler] ${customTarget.url} returned ${items.length} items`);
    return items;
  } catch (err) {
    console.warn(`[Custom Crawler] Failed for ${customTarget.url}:`, err.message);
    return [];
  } finally {
    if (isCreatedByUs && tab && tab.id) {
      try { await chrome.tabs.remove(tab.id); } catch (e) {}
    }
  }
}

async function orchestrateCrawl() {
  const allItems = [];

  // Load user-defined custom sites from storage
  const stored = await chrome.storage.local.get(["customSites"]);
  const customSites = Array.isArray(stored.customSites) ? stored.customSites : [];

  const allTargets = [...BUILTIN_TARGETS];

  // Build crawl targets for custom sites
  const customTargets = customSites.map(site => ({
    name: site.label || new URL(site.url).hostname,
    url: site.url,
    isCustom: true
  }));

  for (const target of allTargets) {
    chrome.runtime.sendMessage({
      action: "crawl_status",
      message: `Crawling ${target.name}...`
    }).catch(() => {});

    const items = await crawlTab(target);
    if (Array.isArray(items)) allItems.push(...items);
  }

  for (const target of customTargets) {
    chrome.runtime.sendMessage({
      action: "crawl_status",
      message: `Crawling custom site: ${target.name}...`
    }).catch(() => {});

    const items = await crawlCustomSite(target);
    if (Array.isArray(items)) allItems.push(...items);
  }

  const finalItems = deduplicateItems(allItems);
  await chrome.storage.local.set({
    scrapedItems: finalItems,
    lastCrawlTime: new Date().toISOString()
  });

  return finalItems;
}

function deduplicateItems(items) {
  const seen = new Set();
  return items.filter(item => {
    const key = `${item.source}:${(item.title || "").trim().toLowerCase()}:${item.dueDate || item.date || ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "start_crawl") {
    orchestrateCrawl()
      .then(items => sendResponse({ success: true, items }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true; // Keep message channel open for async response
  }
});
