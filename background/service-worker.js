const CRAWL_TARGETS = [
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
    // Check main and alternate domains for Outlook
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
    // 1. Check if user already has this portal open in an existing tab
    tab = await findExistingTab(target);

    if (tab && tab.id) {
      console.log(`[Crawler] Using existing open tab for ${target.name} (Tab ID: ${tab.id})`);
    } else {
      // 2. Otherwise open in background
      isCreatedByUs = true;
      tab = await chrome.tabs.create({ url: target.url, active: false });

      await new Promise((resolve) => {
        const timeout = setTimeout(resolve, 10000); // 10s wait
        function listener(tabId, changeInfo) {
          if (tabId === tab.id && changeInfo.status === "complete") {
            clearTimeout(timeout);
            chrome.tabs.onUpdated.removeListener(listener);
            resolve();
          }
        }
        chrome.tabs.onUpdated.addListener(listener);
      });

      // Extra hydration delay for dynamic web apps
      const hydrationTime = target.source === "outlook" ? 4000 : 1500;
      await wait(hydrationTime);
    }

    // 3. Inject content script
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: [target.script]
    });

    // 4. Execute the async extractor function and AWAIT the promise!
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: async (fnName, sourceName) => {
        if (typeof window[fnName] === "function") {
          try {
            const res = await window[fnName]();
            if (Array.isArray(res)) {
              return res.map(item => ({ ...item, source: item.source || sourceName }));
            }
            return res || [];
          } catch (err) {
            console.error(`[Scraper Function Error in ${fnName}]:`, err);
            return [];
          }
        }
        return [];
      },
      args: [target.funcName, target.source]
    });

    const items = results?.[0]?.result || [];
    console.log(`[Crawler] ${target.name} returned ${items.length} items`);
    return items;
  } catch (err) {
    console.warn(`[Crawler] Failed crawling ${target.name}:`, err.message);
    return [];
  } finally {
    // Only close the tab if WE opened it in the background
    if (isCreatedByUs && tab && tab.id) {
      try {
        await chrome.tabs.remove(tab.id);
      } catch (e) {}
    }
  }
}

async function orchestrateCrawl() {
  const allItems = [];

  for (const target of CRAWL_TARGETS) {
    chrome.runtime.sendMessage({
      action: "crawl_status",
      message: `Crawling ${target.name}...`
    }).catch(() => {});

    const items = await crawlTab(target);
    if (Array.isArray(items)) {
      allItems.push(...items);
    }
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
    const key = `${item.source}:${item.title}:${item.dueDate || item.date || ""}`;
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
    return true;
  }
});
