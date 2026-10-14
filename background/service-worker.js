const CRAWL_TARGETS = [
  {
    name: "Canvas",
    source: "canvas",
    url: "https://canvas.bham.ac.uk",
    script: "content-scripts/canvas.js",
    funcName: "crawlCanvasData"
  },
  {
    name: "Outlook",
    source: "outlook",
    url: "https://outlook.cloud.microsoft",
    script: "content-scripts/outlook.js",
    funcName: "crawlOutlookData"
  },
  {
    name: "Societies",
    source: "society",
    url: "https://www.guildofstudents.com/events",
    script: "content-scripts/myuob.js",
    funcName: "crawlSocietyData"
  }
];

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function crawlTab(target) {
  let tab = null;
  try {
    // Open in background
    tab = await chrome.tabs.create({ url: target.url, active: false });

    // Wait for page load or timeout
    await new Promise((resolve) => {
      const timeout = setTimeout(resolve, 8000); // 8 sec max wait
      function listener(tabId, changeInfo) {
        if (tabId === tab.id && changeInfo.status === "complete") {
          clearTimeout(timeout);
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      }
      chrome.tabs.onUpdated.addListener(listener);
    });

    // Small delay for client-side hydration
    await wait(1500);

    // Inject content script if not already loaded, then execute function
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: [target.script]
    });

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (fnName) => {
        if (typeof window[fnName] === "function") {
          return window[fnName]();
        }
        return [];
      },
      args: [target.funcName]
    });

    return results?.[0]?.result || [];
  } catch (err) {
    console.warn(`[Crawler] Failed crawling ${target.name}:`, err);
    return [];
  } finally {
    if (tab && tab.id) {
      try {
        await chrome.tabs.remove(tab.id);
      } catch (e) {
        // Tab might already be closed
      }
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
    allItems.push(...items);
  }

  // Deduplicate and save to storage
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
    const key = `${item.source}:${item.title}`;
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
    return true; // Keep sendResponse open for async
  }
});
