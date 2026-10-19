(() => {
  if (window.__customCrawlerLoaded) return;
  window.__customCrawlerLoaded = true;

  const clean = text => (text || "").replace(/\s+/g, " ").trim();

  // Generic DOM scraper: extract meaningful text blocks from any webpage
  async function crawlCustomPage() {
    const items = [];
    const hostname = window.location.hostname;

    // Try to extract structured content from common patterns
    const selectors = [
      "article", "section", "main",
      "[class*='post']", "[class*='card']", "[class*='item']",
      "[class*='news']", "[class*='event']", "[class*='announcement']",
      "li", ".entry", ".feed-item"
    ];

    let candidates = [];
    for (const sel of selectors) {
      const found = [...document.querySelectorAll(sel)];
      if (found.length > 0) {
        candidates = found;
        break;
      }
    }

    // Fallback: grab headings and their sibling paragraphs
    if (candidates.length === 0) {
      candidates = [...document.querySelectorAll("h1, h2, h3")];
    }

    candidates.slice(0, 20).forEach((el, idx) => {
      const fullText = clean(el.innerText || "");
      if (!fullText || fullText.length < 10) return;

      const titleEl = el.querySelector("h1, h2, h3, h4, a, strong") || el;
      let title = clean(titleEl?.innerText) || fullText.split("\n")[0];
      if (title.length > 120) title = title.slice(0, 120) + "…";

      const linkEl = el.querySelector("a[href]");
      const url = linkEl?.href || window.location.href;

      // Try to extract a date
      const timeEl = el.querySelector("time, [datetime], [class*='date' i]");
      let dueDate = null;
      if (timeEl) {
        const raw = timeEl.getAttribute("datetime") || timeEl.innerText;
        const parsed = Date.parse(raw);
        if (!Number.isNaN(parsed)) dueDate = new Date(parsed).toISOString();
      }

      items.push({
        id: `custom-${hostname}-${idx}`,
        title: title || `Item from ${hostname}`,
        source: "custom",
        customSite: hostname,
        dueDate: dueDate,
        snippet: fullText.slice(0, 200),
        url: url
      });
    });

    console.log(`[Custom Crawler] ${hostname}: extracted ${items.length} items`);
    return items;
  }

  window.crawlCustomPage = crawlCustomPage;

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "extract_custom") {
      crawlCustomPage().then(data => sendResponse({ data }));
      return true;
    }
  });
})();
