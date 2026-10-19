(() => {
  // Guard against redundant execution
  if (window.__outlookUnifiedCrawlerRunning) return;

  const clean = text => (text || "").replace(/\s+/g, " ").trim();

  const isVisible = element => {
    try {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && getComputedStyle(element).visibility !== "hidden";
    } catch {
      return false;
    }
  };

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  const DEFAULT_KEYWORDS = [
    "deadline", "due", "submission", "assignment", "exam",
    "compulsory", "urgent", "important", "cancelled", "rescheduled",
    "reminder", "assessment", "coursework", "room", "feedback", "grade",
    "lecture", "seminar", "workshop", "dissertation", "quiz"
  ];

  // ── 1. Multi-Selector Row Detection (Inspired by GitHub Outlook Scrapers) ──
  function getVisibleRows() {
    const selectors = [
      '[data-convid]',
      '[role="option"]',
      '[role="listitem"]',
      '[role="row"]',
      'div[draggable="true"][aria-label]',
      'div[data-is-focusable="true"][aria-label*=","]',
      'div[aria-label*="message" i]',
      'div[aria-label*="conversation" i]',
      'div[data-selection-index]',
      'div[data-item-index]',
      '[data-testid*="message-list-item"]'
    ];

    const elements = document.querySelectorAll(selectors.join(", "));
    const validRows = [];
    const seenElements = new Set();

    for (const el of elements) {
      if (seenElements.has(el)) continue;

      // Filter out root containers or tiny buttons
      const label = el.getAttribute("aria-label") || "";
      const text = clean(el.innerText || "");
      if ((label.length > 10 || text.length > 10) && isVisible(el)) {
        // Ensure this isn't an ancestor or child duplicate
        let hasParentInList = false;
        let parent = el.parentElement;
        while (parent && parent !== document.body) {
          if (seenElements.has(parent)) {
            hasParentInList = true;
            break;
          }
          parent = parent.parentElement;
        }

        if (!hasParentInList) {
          seenElements.add(el);
          validRows.push(el);
        }
      }
    }

    return validRows;
  }

  // ── 2. Scroll Container Discovery ──
  function findScrollContainer() {
    const listSelectors = [
      '[data-app-section="ConversationList"]',
      '[role="feed"]',
      '[role="listbox"]',
      '[role="treegrid"]',
      'div[aria-label*="Message list" i]',
      'div[aria-label*="Conversation list" i]',
      'div[aria-label*="Messages" i]',
      'div[class*="customScrollBar" i]'
    ];

    for (const sel of listSelectors) {
      const el = document.querySelector(sel);
      if (el && el.scrollHeight > el.clientHeight) return el;
    }

    // Traverse upwards from first visible message row to find scrollable ancestor
    const rows = getVisibleRows();
    if (rows.length > 0) {
      let p = rows[0].parentElement;
      while (p && p !== document.body && p !== document.documentElement) {
        try {
          const style = window.getComputedStyle(p);
          const hasScroll = (style.overflowY === "auto" || style.overflowY === "scroll") && p.scrollHeight > p.clientHeight + 20;
          if (hasScroll) return p;
        } catch (e) {}
        p = p.parentElement;
      }
    }

    return window;
  }

  // ── 3. Parse ARIA-Label (Most reliable in OWA React / Fluent UI) ──
  function parseAriaLabel(label) {
    if (!label || label.length < 10) return null;

    // Pattern A: "From <Sender>, Unread, Subject <Subject>, Received <Date>, Preview <Snippet>"
    // Pattern B: "<Sender>; <Subject>; <Date>; <Snippet>"
    // Pattern C: "Unread; <Sender>; <Date>; <Subject>; <Snippet>"

    let sender = "";
    let subject = "";
    let dateStr = "";
    let snippet = "";

    // Check for explicit key-value indicators
    const fromMatch = label.match(/(?:from|sender)[:\s]+([^,;]+)/i);
    const subjectMatch = label.match(/(?:subject)[:\s]+([^,;]+)/i);
    const dateMatch = label.match(/(?:received|date|sent)[:\s]+([^,;]+)/i);
    const previewMatch = label.match(/(?:preview|body|snippet)[:\s]+(.+)/i);

    if (fromMatch) sender = clean(fromMatch[1]);
    if (subjectMatch) subject = clean(subjectMatch[1]);
    if (dateMatch) dateStr = clean(dateMatch[1]);
    if (previewMatch) snippet = clean(previewMatch[1]);

    // If explicit patterns didn't match, split by comma or semicolon
    if (!subject || !sender) {
      const parts = label.split(/[,;]\s*/).map(clean).filter(p => {
        return !/^(unread|read|flagged|pinned|high priority|selected|attachment|has attachment)$/i.test(p);
      });

      if (parts.length >= 2) {
        sender = sender || parts[0];
        subject = subject || parts[1];
        if (parts.length >= 3) {
          // Check if part 2 is a date/time
          if (/\b(\d{1,2}:\d{2}|\d{1,2}\/\d{1,2}|yesterday|today|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/i.test(parts[2])) {
            dateStr = dateStr || parts[2];
            snippet = snippet || parts.slice(3).join(" - ");
          } else {
            snippet = snippet || parts.slice(2).join(" - ");
          }
        }
      }
    }

    if (subject) {
      return { sender: sender || "Outlook", subject, date: dateStr, snippet };
    }
    return null;
  }

  // ── 4. Parse DOM Elements inside Row (Deep Fallback) ──
  function parseRowElements(row) {
    const rawText = clean(row.innerText || "");
    if (!rawText || rawText.length < 5) return null;

    // Try dedicated Outlook sub-selectors
    const subjectEl = row.querySelector(
      '[data-subject], span[style*="font-weight: 600"], span[style*="font-weight: 700"], span[style*="font-weight: bold"], h2, h3, [class*="Subject" i], [class*="subject" i]'
    );
    const subject = clean(subjectEl?.innerText);

    const senderEl = row.querySelector(
      '.ms-Persona-primaryText, [class*="sender" i], [class*="Sender" i], [class*="from" i], [class*="persona" i] strong'
    );
    const sender = clean(senderEl?.innerText);

    const timeEl = row.querySelector("time, [datetime]");
    let dateStr = timeEl ? (timeEl.getAttribute("datetime") || timeEl.innerText) : null;
    if (!dateStr) {
      const timeMatch = rawText.match(/\b(\d{1,2}:\d{2}(?:\s*[ap]m)?|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|yesterday|today|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s+\d{1,2})\b/i);
      dateStr = timeMatch ? timeMatch[0] : new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }

    const lines = row.innerText.split("\n").map(clean).filter(Boolean);
    const noiseWords = /^(selected|pinned|flagged|has attachments|unread|read|high priority)$/i;
    const cleanLines = lines.filter(l => !noiseWords.test(l));

    const finalSender = sender || cleanLines[0] || "Outlook";
    const finalSubject = subject || cleanLines[1] || cleanLines[0] || "University Notification";
    const finalSnippet = cleanLines.slice(2, 5).join(" - ") || rawText.slice(0, 160);

    return {
      sender: finalSender,
      subject: finalSubject,
      date: dateStr,
      snippet: finalSnippet
    };
  }

  // ── 5. Parse single row combining ARIA + DOM inspection ──
  function parseRow(row, index) {
    const ariaData = parseAriaLabel(row.getAttribute("aria-label"));
    const domData = parseRowElements(row);

    const subject = ariaData?.subject || domData?.subject || null;
    const sender = ariaData?.sender || domData?.sender || "Outlook Sender";
    const dateStr = ariaData?.date || domData?.date || new Date().toISOString();
    const snippet = ariaData?.snippet || domData?.snippet || clean(row.innerText || "").slice(0, 160);

    if (!subject || subject.length < 2) return null;

    // URL derivation
    const convid = row.getAttribute("data-convid") ||
                    row.getAttribute("data-item-index") ||
                    row.querySelector("a[href]")?.getAttribute("href");
    const emailUrl = convid && convid.startsWith("http")
      ? convid
      : (convid ? `https://outlook.office.com/mail/id/${encodeURIComponent(convid)}` : "https://outlook.office.com/mail/inbox");

    const fullContent = `${subject} ${sender} ${snippet}`.toLowerCase();
    const matched = DEFAULT_KEYWORDS.filter(kw => fullContent.includes(kw));

    return {
      id: `outlook-${index + 1}-${Math.random().toString(36).slice(2, 6)}`,
      title: subject,
      source: "outlook",
      dueDate: null,
      date: dateStr,
      sender: sender,
      snippet: snippet.slice(0, 180),
      url: emailUrl,
      isUrgent: matched.length > 0,
      matchedKeywords: matched
    };
  }

  // ── 6. Fallback: Extract open message if list is hidden ──
  function extractOpenMessage() {
    const main = document.querySelector('[role="main"]') || document.body;
    const fullText = clean(main.innerText || "");

    const subjectHeading = [...main.querySelectorAll("h1, h2, [role=heading]")].find(isVisible);
    const subject = clean(subjectHeading?.innerText);

    const senderEl = main.querySelector('.ms-Persona-primaryText, [class*="Sender" i], [class*="from" i]');
    const sender = clean(senderEl?.innerText) || "Outlook Sender";

    const timeEl = main.querySelector("time, [datetime]");
    const dateStr = timeEl ? (timeEl.getAttribute("datetime") || timeEl.innerText) : new Date().toISOString();

    const bodyEl = document.querySelector('[data-testid*="message-body" i], [class*="allowTextSelection"], [role="document"]');
    const bodyText = clean(bodyEl?.innerText) || fullText.slice(0, 250);

    if (subject && subject.length > 2) {
      return {
        id: `outlook-open-${Math.random().toString(36).slice(2, 6)}`,
        title: subject,
        sender: sender,
        date: dateStr,
        snippet: bodyText.slice(0, 180),
        url: window.location.href,
        source: "outlook",
        isUrgent: false,
        matchedKeywords: []
      };
    }
    return null;
  }

  // ── 7. Main Crawl Routine with Active Scroll Simulation ──
  async function crawlOutlookData() {
    console.log("[Outlook Crawler] Initializing scan for Outlook Web messages...");

    // Wait for rows (up to 8s, checking every 400ms)
    let rows = getVisibleRows();
    let attempts = 0;
    while (rows.length === 0 && attempts < 20) {
      await sleep(400);
      rows = getVisibleRows();
      attempts++;
    }

    if (rows.length === 0) {
      console.warn("[Outlook Crawler] No message rows visible. Checking reading pane...");
      const openMsg = extractOpenMessage();
      if (openMsg) return [openMsg];
      return [];
    }

    const emailMap = new Map();
    const scrollContainer = findScrollContainer();
    const TARGET = 50;
    let scrolls = 0;

    while (emailMap.size < TARGET && scrolls < 25) {
      const currentRows = getVisibleRows();
      for (const row of currentRows) {
        const item = parseRow(row, emailMap.size);
        if (!item || !item.title) continue;

        const key = `${item.title.trim().toLowerCase()}|${item.sender.trim().toLowerCase()}`;
        if (!emailMap.has(key)) {
          emailMap.set(key, item);
          if (emailMap.size >= TARGET) break;
        }
      }

      if (emailMap.size >= TARGET) break;

      // Programmatic scroll + Synthetic DOM Event Dispatch to trigger React Fluent UI virtualizer
      if (scrollContainer === window) {
        window.scrollBy(0, 500);
      } else {
        scrollContainer.scrollTop += 500;
        scrollContainer.dispatchEvent(new Event("scroll", { bubbles: true }));
        scrollContainer.dispatchEvent(new WheelEvent("wheel", { deltaY: 500, bubbles: true }));
      }

      await sleep(450);
      scrolls++;
    }

    const items = Array.from(emailMap.values());
    console.log(`[Outlook Crawler] Scan complete: extracted ${items.length} emails!`);
    return items;
  }

  window.crawlOutlookData = crawlOutlookData;

  // ── 8. On-Page Floating Extraction Pill (Falter Minimalist Aesthetic) ──
  function injectFloatingButton() {
    if (document.getElementById("uob-outlook-extract-btn")) return;

    const btn = document.createElement("button");
    btn.id = "uob-outlook-extract-btn";
    btn.type = "button";
    btn.innerHTML = `<span style="margin-right:6px">⚡</span> EXTRACT 50 EMAILS`;
    btn.title = "Extract last 50 emails directly from your Outlook inbox into UoB Assistant";
    Object.assign(btn.style, {
      position: "fixed",
      right: "24px",
      bottom: "24px",
      zIndex: "2147483647",
      padding: "10px 16px",
      background: "#0d0d0d",
      color: "#ffffff",
      border: "1px solid rgba(255, 255, 255, 0.25)",
      borderRadius: "4px",
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      fontWeight: "700",
      fontSize: "11px",
      letterSpacing: "0.14em",
      textTransform: "uppercase",
      cursor: "pointer",
      boxShadow: "0 8px 24px rgba(0, 0, 0, 0.4)",
      transition: "all 0.2s cubic-bezier(0.16, 1, 0.3, 1)"
    });

    btn.addEventListener("mouseenter", () => {
      btn.style.background = "#ffffff";
      btn.style.color = "#0d0d0d";
      btn.style.borderColor = "#ffffff";
    });
    btn.addEventListener("mouseleave", () => {
      btn.style.background = "#0d0d0d";
      btn.style.color = "#ffffff";
      btn.style.borderColor = "rgba(255, 255, 255, 0.25)";
    });

    btn.addEventListener("click", async () => {
      btn.disabled = true;
      btn.innerHTML = `<span>⏳</span> EXTRACTING...`;

      try {
        const emails = await crawlOutlookData();
        if (emails.length === 0) {
          alert("No emails could be extracted. Please make sure your Outlook inbox is open and visible.");
          btn.disabled = false;
          btn.innerHTML = `<span style="margin-right:6px">⚡</span> EXTRACT 50 EMAILS`;
          return;
        }

        const stored = await chrome.storage.local.get(["scrapedItems"]);
        const existing = Array.isArray(stored.scrapedItems) ? stored.scrapedItems : [];
        const nonOutlook = existing.filter(i => i.source !== "outlook");
        const updated = [...nonOutlook, ...emails];

        await chrome.storage.local.set({
          scrapedItems: updated,
          lastCrawlTime: new Date().toISOString()
        });

        btn.innerHTML = `<span>✓</span> EXTRACTED ${emails.length} EMAILS`;
        btn.style.background = "#ffffff";
        btn.style.color = "#0d0d0d";

        setTimeout(() => {
          btn.disabled = false;
          btn.innerHTML = `<span style="margin-right:6px">⚡</span> EXTRACT 50 EMAILS`;
          btn.style.background = "#0d0d0d";
          btn.style.color = "#ffffff";
        }, 3500);
      } catch (err) {
        console.error("[Outlook Crawler] Error:", err);
        btn.disabled = false;
        btn.innerHTML = `<span style="margin-right:6px">⚡</span> EXTRACT 50 EMAILS`;
      }
    });

    document.body.appendChild(btn);
  }

  if (document.readyState === "complete" || document.readyState === "interactive") {
    injectFloatingButton();
  } else {
    window.addEventListener("DOMContentLoaded", injectFloatingButton);
  }
  setTimeout(injectFloatingButton, 2500);

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "extract_outlook") {
      crawlOutlookData().then(data => sendResponse({ data }));
      return true;
    }
  });
})();
