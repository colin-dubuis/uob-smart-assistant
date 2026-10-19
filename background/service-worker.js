// ── codeurjc/outlook-scraper strategy: intercept real Bearer tokens from live Outlook requests ──
// Mirrors browser.ts from https://github.com/codeurjc/outlook-scraper which uses
// Playwright's page.on("request") to sniff the Authorization header on service.svc calls.
// Here we achieve the same via chrome.webRequest.onBeforeSendHeaders.
let _outlookToken = null;
let _outlookAnchorMailbox = null;
let _outlookServiceBase = null;
let _outlookTokenCapturedAt = null;

const OUTLOOK_SERVICE_SVC_PATTERNS = [
  "*://outlook.office.com/owa/service.svc*",
  "*://outlook.cloud.microsoft/owa/service.svc*",
  "*://outlook.office365.com/owa/service.svc*"
];

chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    try {
      const url = new URL(details.url);
      if (!url.pathname.includes("service.svc")) return;
      const headers = details.requestHeaders || [];
      const authHeader = headers.find(h => h.name.toLowerCase() === "authorization");
      const anchorHeader = headers.find(h => h.name.toLowerCase() === "x-anchormailbox");
      if (authHeader && authHeader.value && authHeader.value.startsWith("Bearer ")) {
        _outlookToken = authHeader.value; // full "Bearer eyJ..." string
        _outlookAnchorMailbox = anchorHeader ? anchorHeader.value : null;
        _outlookServiceBase = `${url.origin}/owa/service.svc`;
        _outlookTokenCapturedAt = Date.now();
        console.log("[SW] Captured Outlook Bearer token from live request to", details.url);
      }
    } catch (e) {}
  },
  { urls: OUTLOOK_SERVICE_SVC_PATTERNS },
  ["requestHeaders"]
);

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

function normalizeTargetUrl(rawUrl, targetBaseUrl, source) {
  let fallback = targetBaseUrl;
  if (!fallback) {
    if (source === "canvas") fallback = "https://canvas.bham.ac.uk";
    else if (source === "outlook") fallback = "https://outlook.office.com/mail/inbox";
    else if (source === "society") fallback = "https://www.guildofstudents.com/events";
    else if (source === "library") fallback = "https://intranet.birmingham.ac.uk/student/libraries/index.aspx";
    else if (source === "myuob") fallback = "https://myuob.bham.ac.uk/dashboard/student-home";
    else fallback = "https://canvas.bham.ac.uk";
  }

  if (!rawUrl || typeof rawUrl !== "string") return fallback;
  let trimmed = rawUrl.trim();
  if (!trimmed) return fallback;

  // Strip extension scheme if present
  const extMatch = trimmed.match(/^chrome-extension:\/\/[a-z0-9]+\/(.*)$/i);
  if (extMatch) {
    trimmed = extMatch[1];
  }

  // Already absolute http/https
  if (/^https?:\/\//i.test(trimmed)) return trimmed;

  try {
    const base = new URL(fallback);
    return new URL(trimmed.startsWith("/") ? trimmed : `/${trimmed}`, base.origin).href;
  } catch {
    return fallback;
  }
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

    // Ensure all URLs are absolute target URLs and not relative or extension URLs
    const rawItems = results?.[0]?.result || [];
    const items = rawItems.map(item => {
      const src = item.source || target.source;
      return {
        ...item,
        source: src,
        url: normalizeTargetUrl(item.url || item.link, target.url, src)
      };
    });

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

    const rawItems = results?.[0]?.result || [];
    const items = rawItems.map(item => ({
      ...item,
      source: "custom",
      customSite: customTarget.name,
      url: normalizeTargetUrl(item.url || item.link, customTarget.url, "custom")
    }));
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

  // ── Expose captured Outlook Bearer token to content scripts ──
  // This is the codeurjc/outlook-scraper approach: the background intercepted
  // the token from a real live service.svc request; now hand it to the content script.
  if (request.action === "get_outlook_token") {
    // Token is valid for ~1 hour; treat as stale after 55 minutes
    const AGE_LIMIT_MS = 55 * 60 * 1000;
    const isStale = _outlookTokenCapturedAt
      ? (Date.now() - _outlookTokenCapturedAt) > AGE_LIMIT_MS
      : true;
    sendResponse({
      token: isStale ? null : _outlookToken,
      anchorMailbox: isStale ? null : _outlookAnchorMailbox,
      serviceBase: isStale ? null : _outlookServiceBase,
      capturedAt: _outlookTokenCapturedAt
    });
    return false;
  }
});
