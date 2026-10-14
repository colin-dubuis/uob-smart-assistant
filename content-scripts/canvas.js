(() => {
  const clean = text => (text || "").replace(/\s+/g, " ").trim();

  function parseDate(text) {
    if (!text) return null;
    const cleanText = clean(text);
    const parsed = Date.parse(cleanText);
    if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();

    // Check for "Due Oct 18 at 11:59pm" or "Tomorrow at 5:00pm"
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

  function extractCanvasItems() {
    const items = [];

    // Selectors covering Canvas dashboard To-Do list, planner, and calendar cards
    const candidates = document.querySelectorAll(
      '.todo-list-item, [data-testid*="todo"], ul.right-side-list li, .PlannerApp li, .ig-row, div[class*="Assignment"]'
    );

    candidates.forEach((el, idx) => {
      if (idx > 25) return;
      const fullText = clean(el.innerText);
      if (!fullText) return;

      const titleEl = el.querySelector('a, h3, h4, [class*="title"], [class*="Title"]');
      const title = clean(titleEl?.innerText) || fullText.split("\n")[0];

      // Extract date/time from badges or text
      const dateEl = el.querySelector('time, [class*="due"], [class*="date"], [class*="Date"]');
      const dateRaw = clean(dateEl?.innerText) || fullText;
      const dueDate = parseDate(dateRaw);

      const link = el.querySelector("a")?.href || "https://canvas.bham.ac.uk";

      items.push({
        id: `canvas-${idx + 1}`,
        title: title || `Canvas Task ${idx + 1}`,
        source: "canvas",
        dueDate: dueDate,
        snippet: fullText.slice(0, 160),
        link: link
      });
    });

    return items;
  }

  window.crawlCanvasData = extractCanvasItems;

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "extract_canvas") {
      sendResponse({ data: extractCanvasItems() });
    }
    return true;
  });
})();
