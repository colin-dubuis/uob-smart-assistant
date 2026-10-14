(() => {
  const clean = text => (text || "").replace(/\s+/g, " ").trim();

  function extractOutlookItems() {
    const items = [];
    const rows = document.querySelectorAll('[role="option"], [role="listitem"], div[aria-label*="message"], div[aria-label*="Message"]');

    rows.forEach((row, idx) => {
      if (idx > 20) return; // Keep top 20 visible messages
      const fullText = clean(row.innerText);
      if (!fullText) return;

      // Extract subject
      const subjectEl = row.querySelector('[title], [aria-label], span[style*="font-weight"]');
      const subject = clean(subjectEl?.getAttribute("title") || subjectEl?.innerText) || fullText.slice(0, 60);

      // Extract sender/preview
      const lines = fullText.split("\n").map(clean).filter(Boolean);
      const sender = lines[0] || "Outlook Notification";
      const snippet = lines.slice(1, 4).join(" - ") || fullText.slice(0, 150);

      // Extract possible date
      const timeEl = row.querySelector("time, [datetime]");
      const dateStr = timeEl ? (timeEl.getAttribute("datetime") || timeEl.innerText) : new Date().toISOString();

      items.push({
        id: `outlook-${idx + 1}`,
        title: subject,
        source: "outlook",
        dueDate: null, // emails are notices, not direct deadlines unless parsed
        date: dateStr,
        sender: sender,
        snippet: snippet
      });
    });

    return items;
  }

  // Export to window for scripting execution
  window.crawlOutlookData = extractOutlookItems;

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "extract_outlook") {
      sendResponse({ data: extractOutlookItems() });
    }
    return true;
  });
})();
