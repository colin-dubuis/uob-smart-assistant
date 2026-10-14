const CRAWL_TARGETS = [
  {
    name: "Canvas LMS",
    source: "canvas",
    url: "https://canvas.bham.ac.uk",
    script: "content-scripts/canvas.js",
    funcName: "crawlCanvasData"
  },
  {
    name: "Outlook Web",
    source: "outlook",
    url: "https://outlook.cloud.microsoft",
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

async function crawlTab(target) {
  let tab = null;
  try {
    tab = await chrome.tabs.create({ url: target.url, active: false });

    await new Promise((resolve) => {
      const timeout = setTimeout(resolve, 8000); // 8s max wait per tab
      function listener(tabId, changeInfo) {
        if (tabId === tab.id && changeInfo.status === "complete") {
          clearTimeout(timeout);
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      }
      chrome.tabs.onUpdated.addListener(listener);
    });

    await wait(1500);

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: [target.script]
    });

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (fnName, sourceName) => {
        if (typeof window[fnName] === "function") {
          const res = window[fnName]();
          if (Array.isArray(res)) {
            return res.map(item => ({ ...item, source: item.source || sourceName }));
          }
          return res;
        }
        return [];
      },
      args: [target.funcName, target.source]
    });

    return results?.[0]?.result || [];
  } catch (err) {
    console.warn(`[Crawler] Failed crawling ${target.name}:`, err.message);
    return [];
  } finally {
    if (tab && tab.id) {
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
    const key = `${item.source}:${item.title}:${item.dueDate || ""}`;
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
