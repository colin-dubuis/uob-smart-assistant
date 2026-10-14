(() => {
  const clean = text => (text || "").replace(/\s+/g, " ").trim();

  function parseDate(text) {
    if (!text) return null;
    const cleanText = clean(text);
    const parsed = Date.parse(cleanText);
    if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();

    const now = new Date();
    if (/tomorrow/i.test(cleanText)) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 23, 59);
      return d.toISOString();
    }
    if (/today/i.test(cleanText)) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59);
      return d.toISOString();
    }
    return null;
  }

  async function tryCanvasPlannerAPI() {
    try {
      const now = new Date().toISOString();
      const url = `/api/v1/planner/items?start_date=${now}&per_page=50`;
      const resp = await fetch(url, { credentials: "include" });

      if (resp.ok) {
        const items = await resp.json();
        if (Array.isArray(items) && items.length > 0) {
          return items
            .filter(i => i.plannable_type === "assignment" || i.plannable_type === "quiz" || i.plannable)
            .map(i => ({
              id: `canvas-${i.plannable_id || Math.random().toString(36).slice(2)}`,
              title: i.plannable?.title || i.title || "Canvas Assignment",
              course: i.context_name || "Canvas",
              source: "canvas",
              dueDate: i.plannable_date || i.plannable?.due_at || null,
              snippet: `${i.context_name ? i.context_name + ": " : ""}${i.plannable_type || "Assignment"} due on Canvas`,
              link: i.html_url || "https://canvas.bham.ac.uk/calendar"
            }));
        }
      }
    } catch (e) {
      console.log("[Canvas Scraper] Planner API error, falling back to DOM:", e.message);
    }
    return null;
  }

  function extractCanvasDOMItems() {
    const items = [];
    const candidates = document.querySelectorAll(
      '.todo-list-item, [data-testid*="todo"], ul.right-side-list li, .PlannerApp li, .ig-row, div[class*="Assignment"]'
    );

    candidates.forEach((el, idx) => {
      if (idx > 25) return;
      const fullText = clean(el.innerText);
      if (!fullText) return;

      const titleEl = el.querySelector('a, h3, h4, [class*="title"], [class*="Title"]');
      const title = clean(titleEl?.innerText) || fullText.split("\n")[0];

      const dateEl = el.querySelector('time, [class*="due"], [class*="date"], [class*="Date"]');
      const dateRaw = clean(dateEl?.innerText) || fullText;
      const dueDate = parseDate(dateRaw);

      const link = el.querySelector("a")?.href || "https://canvas.bham.ac.uk";

      items.push({
        id: `canvas-dom-${idx + 1}`,
        title: title || `Canvas Task ${idx + 1}`,
        source: "canvas",
        dueDate: dueDate,
        snippet: fullText.slice(0, 160),
        link: link
      });
    });

    return items;
  }

  async function crawlCanvasData() {
    const apiItems = await tryCanvasPlannerAPI();
    if (apiItems && apiItems.length > 0) {
      console.log(`[Canvas Scraper] Retrieved ${apiItems.length} items from official Planner API`);
      return apiItems;
    }
    const domItems = extractCanvasDOMItems();
    console.log(`[Canvas Scraper] Retrieved ${domItems.length} items from DOM`);
    return domItems;
  }

  window.crawlCanvasData = crawlCanvasData;

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "extract_canvas") {
      crawlCanvasData().then(data => sendResponse({ data }));
      return true;
    }
  });
})();
