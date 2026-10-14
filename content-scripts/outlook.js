(() => {
  if (window.__outlookUnifiedCrawlerLoaded) return;
  window.__outlookUnifiedCrawlerLoaded = true;

  const DEFAULT_KEYWORDS = [
    "deadline", "due", "submission", "assignment", "exam",
    "compulsory", "urgent", "important", "cancelled", "rescheduled",
    "reminder", "assessment", "coursework"
  ];

  const clean = text => (text || "").replace(/\s+/g, " ").trim();
  const isVisible = el => {
    try {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && getComputedStyle(el).visibility !== "hidden";
    } catch { return false; }
  };

  function extractOutlookItems() {
    const items = [];
    const rows = [...document.querySelectorAll('[role="option"], [role="listitem"], div[aria-label*="message" i]')]
      .filter(el => isVisible(el) && clean(el.innerText));

    rows.forEach((row, idx) => {
      if (idx > 25) return;
      const fullText = clean(row.innerText);
      if (!fullText) return;

      const subjectEl = row.querySelector('[title], [aria-label], span[style*="font-weight"]');
      const subject = clean(subjectEl?.getAttribute("title") || subjectEl?.innerText) || fullText.slice(0, 60);

      const lines = fullText.split("\n").map(clean).filter(Boolean);
      const sender = lines[0] || "Outlook Notification";
      const snippet = lines.slice(1, 4).join(" - ") || fullText.slice(0, 150);

      const timeEl = row.querySelector("time, [datetime]");
      const dateStr = timeEl ? (timeEl.getAttribute("datetime") || timeEl.innerText) : new Date().toISOString();

      // Check if matches academic/urgent keywords
      const lower = fullText.toLowerCase();
      const matchedKw = DEFAULT_KEYWORDS.filter(kw => lower.includes(kw));
      const isUrgent = matchedKw.length > 0;

      items.push({
        id: `outlook-${idx + 1}`,
        title: subject,
        source: "outlook",
        dueDate: null,
        date: dateStr,
        sender: sender,
        snippet: snippet,
        isUrgent: isUrgent,
        keywords: matchedKw
      });
    });

    return items;
  }

  window.crawlOutlookData = extractOutlookItems;

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "extract_outlook") {
      sendResponse({ data: extractOutlookItems() });
    }
    return true;
  });
})();
