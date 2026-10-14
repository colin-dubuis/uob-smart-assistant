(() => {
  const clean = text => (text || "").replace(/\s+/g, " ").trim();

  function parseEventDate(text) {
    if (!text) return null;
    const cleanText = clean(text);
    const parsed = Date.parse(cleanText);
    if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();

    const now = new Date();
    if (/tomorrow/i.test(cleanText)) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 19, 0);
      return d.toISOString();
    }
    if (/tonight|today/i.test(cleanText)) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 19, 0);
      return d.toISOString();
    }
    return null;
  }

  function extractSocietyItems() {
    const items = [];

    // Selectors covering Guild of students event lists, cards, and news items
    const cards = document.querySelectorAll(
      '.event-item, .ms-event-card, .event_item, article, [class*="event-card"], [class*="EventCard"], .content-item'
    );

    cards.forEach((card, idx) => {
      if (idx > 20) return;
      const fullText = clean(card.innerText);
      if (!fullText) return;

      const titleEl = card.querySelector('h2, h3, h4, .title, [class*="title"], a');
      const title = clean(titleEl?.innerText) || fullText.split("\n")[0];

      const dateEl = card.querySelector('time, [class*="date"], [class*="Date"]');
      const dateText = clean(dateEl?.getAttribute("datetime") || dateEl?.innerText) || fullText;
      const dueDate = parseEventDate(dateText);

      const link = card.querySelector("a")?.href || "https://www.guildofstudents.com/events";

      items.push({
        id: `society-${idx + 1}`,
        title: title || `Society Event ${idx + 1}`,
        source: "society",
        dueDate: dueDate,
        snippet: fullText.slice(0, 160),
        link: link
      });
    });

    return items;
  }

  window.crawlSocietyData = extractSocietyItems;

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "extract_society") {
      sendResponse({ data: extractSocietyItems() });
    }
    return true;
  });
})();
