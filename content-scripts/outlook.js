(() => {
  const clean = text => (text || "").replace(/\s+/g, " ").trim();

  const DEFAULT_KEYWORDS = [
    "deadline", "due", "submission", "assignment", "exam",
    "compulsory", "urgent", "important", "cancelled", "rescheduled",
    "reminder", "assessment", "coursework", "room", "change", "feedback"
  ];

  const isVisible = el => {
    try {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && getComputedStyle(el).visibility !== "hidden";
    } catch { return false; }
  };

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  function findScrollContainer() {
    // Look for Outlook conversation/message list containers
    const candidates = [
      document.querySelector('[data-app-section="ConversationList"]'),
      document.querySelector('[role="listbox"]'),
      document.querySelector('[role="treegrid"]'),
      document.querySelector('div[aria-label*="Message list" i]'),
      document.querySelector('div[aria-label*="Conversation list" i]'),
      ...document.querySelectorAll('div[class*="customScrollBar" i]'),
      ...document.querySelectorAll('div[style*="overflow-y"]')
    ].filter(Boolean);

    for (const c of candidates) {
      if (c.scrollHeight > c.clientHeight && c.querySelectorAll('[role="option"], [role="listitem"]').length > 0) {
        return c;
      }
    }
    // Fallback: search for parent of any visible row
    const firstRow = document.querySelector('[role="option"], [role="listitem"]');
    if (firstRow) {
      let p = firstRow.parentElement;
      while (p && p !== document.body) {
        if (p.scrollHeight > p.clientHeight && (getComputedStyle(p).overflowY === "auto" || getComputedStyle(p).overflowY === "scroll")) {
          return p;
        }
        p = p.parentElement;
      }
    }
    return window;
  }

  function getMessageRows() {
    const selectors = [
      '[role="option"]',
      '[role="listitem"]',
      'div[data-convid]',
      'div[aria-label*="message" i]',
      'div[aria-label*="conversation" i]'
    ];
    const elements = document.querySelectorAll(selectors.join(", "));
    return [...elements].filter(el => isVisible(el) && clean(el.innerText).length > 10);
  }

  function parseRow(row, idx) {
    const fullText = clean(row.innerText);
    if (!fullText) return null;

    // Subject extraction
    const subjectEl = row.querySelector('[title], [aria-label], span[style*="font-weight: 600"], span[style*="font-weight: 700"], span[style*="font-weight: bold"], h2, h3');
    let subject = clean(subjectEl?.getAttribute("title") || subjectEl?.getAttribute("aria-label") || subjectEl?.innerText);

    // Fallback subject from lines
    const lines = fullText.split("\n").map(clean).filter(Boolean);
    if (!subject || subject.length < 3) {
      subject = lines[1] || lines[0] || "University Email";
    }

    // Sender extraction
    let sender = lines[0] || "Outlook";
    const senderEl = row.querySelector('span[title], div[title], [data-item-index] span');
    if (senderEl && clean(senderEl.innerText)) {
      sender = clean(senderEl.innerText);
    }

    // Date extraction
    const timeEl = row.querySelector("time, [datetime]");
    let dateStr = timeEl ? (timeEl.getAttribute("datetime") || timeEl.innerText) : null;
    if (!dateStr) {
      // Find time-like or date-like token (e.g. "10:45", "Mon 14/10", "Yesterday")
      const timeMatch = fullText.match(/\b(\d{1,2}:\d{2}(?:\s*[ap]m)?|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|yesterday|today|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s+\d{1,2})\b/i);
      dateStr = timeMatch ? timeMatch[0] : new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }

    // Snippet
    const snippet = lines.slice(1, 4).join(" - ") || fullText.slice(0, 160);

    // Link
    const linkEl = row.querySelector("a[href]");
    const emailUrl = linkEl?.href || (row.getAttribute("data-convid") ? `https://outlook.office.com/mail/id/${row.getAttribute("data-convid")}` : window.location.href);

    // Check keywords
    const lower = fullText.toLowerCase();
    const matched = DEFAULT_KEYWORDS.filter(kw => lower.includes(kw));

    return {
      id: `outlook-${idx + 1}-${Math.random().toString(36).slice(2, 7)}`,
      title: subject,
      source: "outlook",
      dueDate: null,
      date: dateStr,
      sender: sender,
      snippet: snippet,
      url: emailUrl,
      isUrgent: matched.length > 0,
      matchedKeywords: matched
    };
  }

  // ── Main Extractor (Extracts up to 50 emails using smooth virtual scrolling) ──
  async function crawlOutlookData() {
    console.log("[Outlook Crawler] Starting extraction of last 50 emails...");

    // 1. Wait for rows to appear in DOM (up to 8s)
    let rows = getMessageRows();
    let attempts = 0;
    while (rows.length === 0 && attempts < 16) {
      await sleep(500);
      rows = getMessageRows();
      attempts++;
    }

    if (rows.length === 0) {
      console.warn("[Outlook Crawler] No message rows detected on page:", window.location.href);
      return [];
    }

    const emailMap = new Map();
    const scrollContainer = findScrollContainer();
    console.log("[Outlook Crawler] Found scroll container:", scrollContainer);

    let scrollAttempts = 0;
    const TARGET_COUNT = 50;

    while (emailMap.size < TARGET_COUNT && scrollAttempts < 15) {
      const visibleRows = getMessageRows();

      for (const row of visibleRows) {
        const item = parseRow(row, emailMap.size);
        if (!item || !item.title) continue;

        // Unique key by subject + sender
        const key = `${item.title.trim().toLowerCase()}|${item.sender.trim().toLowerCase()}`;
        if (!emailMap.has(key)) {
          emailMap.set(key, item);
          if (emailMap.size >= TARGET_COUNT) break;
        }
      }

      if (emailMap.size >= TARGET_COUNT) break;

      // Scroll down to load more virtual rows
      const prevSize = emailMap.size;
      if (scrollContainer === window) {
        window.scrollBy(0, 600);
      } else {
        scrollContainer.scrollTop += 600;
      }

      await sleep(350); // Give Outlook time to virtualize new rows
      scrollAttempts++;
    }

    const results = Array.from(emailMap.values());
    console.log(`[Outlook Crawler] Successfully extracted ${results.length} emails!`);
    return results;
  }

  window.crawlOutlookData = crawlOutlookData;

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "extract_outlook") {
      crawlOutlookData().then(emails => sendResponse({ data: emails }));
      return true;
    }
  });
})();
