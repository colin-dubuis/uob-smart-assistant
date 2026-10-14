(() => {
  if (window.__outlookUnifiedCrawlerLoaded) return;
  window.__outlookUnifiedCrawlerLoaded = true;

  // ── Proven Utilities from outlook-today-crawler ──
  const clean = text => (text || "").replace(/\s+/g, " ").trim();

  const isVisible = element => {
    try {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && getComputedStyle(element).visibility !== "hidden";
    } catch { return false; }
  };

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  const DEFAULT_KEYWORDS = [
    "deadline", "due", "submission", "assignment", "exam",
    "compulsory", "urgent", "important", "cancelled", "rescheduled",
    "reminder", "assessment", "coursework", "room", "feedback", "grade"
  ];

  function getVisibleRows() {
    return [...document.querySelectorAll(
      '[role="option"], [role="listitem"], div[data-convid], div[aria-label*="message" i]'
    )].filter(element => isVisible(element) && clean(element.innerText).length > 8);
  }

  function getFieldLines(text, fieldNames) {
    const lines = text.split(/\n+/).map(clean).filter(Boolean);
    const pattern = new RegExp(`^(?:${fieldNames.join("|")})\\s*:?\\s*(.*)$`, "i");
    return lines.flatMap(line => {
      const match = line.match(pattern);
      return match ? [clean(match[1])] : [];
    }).filter(Boolean);
  }

  function getEmails(text) {
    return [...new Set(text.match(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g) || [])];
  }

  // ── Scroll container finder for virtualized mail list ──
  function findScrollContainer() {
    const listSelectors = [
      '[data-app-section="ConversationList"]',
      '[role="listbox"]',
      '[role="treegrid"]',
      'div[aria-label*="Message list" i]',
      'div[aria-label*="Conversation list" i]',
      'div[class*="customScrollBar" i]'
    ];

    for (const sel of listSelectors) {
      const el = document.querySelector(sel);
      if (el && el.scrollHeight > el.clientHeight) return el;
    }

    // Fallback: parent container of visible rows
    const first = document.querySelector('[role="option"], [role="listitem"]');
    if (first) {
      let p = first.parentElement;
      while (p && p !== document.body) {
        if (p.scrollHeight > p.clientHeight + 50) return p;
        p = p.parentElement;
      }
    }
    return window;
  }

  // ── Parse single row from message list ──
  function parseRow(row, index) {
    const rawText = clean(row.innerText);
    if (!rawText || rawText.length < 5) return null;

    const lines = row.innerText.split("\n").map(clean).filter(Boolean);
    const noiseWords = /^(selected|pinned|flagged|has attachments|unread|read|high priority)$/i;
    const cleanLines = lines.filter(l => !noiseWords.test(l));

    // In Outlook rows: line 0 = sender, line 1 = subject, line 2 = snippet, line 3 = time/date
    let sender = cleanLines[0] || "Outlook";
    let subject = cleanLines[1] || cleanLines[0] || "University Notification";
    let snippet = cleanLines.slice(2, 5).join(" - ") || rawText.slice(0, 150);

    // If an explicit subject attribute exists, use it
    const subjectEl = row.querySelector('span[style*="font-weight: 600"], span[style*="font-weight: 700"], span[style*="font-weight: bold"], h2, h3, [data-subject]');
    if (subjectEl && clean(subjectEl.innerText)) {
      subject = clean(subjectEl.innerText);
    }

    // Date / Time extraction
    const timeEl = row.querySelector("time, [datetime]");
    let dateStr = timeEl ? (timeEl.getAttribute("datetime") || timeEl.innerText) : null;
    if (!dateStr) {
      const timeMatch = rawText.match(/\b(\d{1,2}:\d{2}(?:\s*[ap]m)?|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|yesterday|today|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s+\d{1,2})\b/i);
      dateStr = timeMatch ? timeMatch[0] : new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }

    // Link
    const convid = row.getAttribute("data-convid");
    const linkEl = row.querySelector("a[href]");
    const emailUrl = linkEl?.href || (convid ? `https://outlook.office.com/mail/id/${convid}` : window.location.href);

    // Keyword match
    const lower = rawText.toLowerCase();
    const matched = DEFAULT_KEYWORDS.filter(kw => lower.includes(kw));

    return {
      id: `outlook-${index + 1}-${Math.random().toString(36).slice(2, 6)}`,
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

  // ── Extract Open Message (proven from outlook-today-crawler) ──
  function extractOpenMessage() {
    const main = document.querySelector('[role="main"]') || document.body;
    const fullText = clean(main.innerText || "");

    const subjectHeading = [...main.querySelectorAll("h1, h2, [role=heading]")].find(isVisible);
    const subjectLine = getFieldLines(fullText, ["Subject"])[0] || "";
    const subject = clean(subjectHeading?.innerText) || subjectLine || null;

    const senderLines = getFieldLines(fullText, ["From", "Sender"]);
    const senderText = senderLines[0] || "";
    const senderEmail = getEmails(senderText)[0] || null;
    const senderDisplayName = clean(
      senderText.replace(/<[^>]*>/g, "").replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "")
    ) || null;

    const receivedLines = getFieldLines(fullText, ["Received", "Date", "Sent"]);
    const receivedEl = [...main.querySelectorAll("time, [datetime]")].find(el => isVisible(el) && el.hasAttribute("datetime"));
    const receivedDate = receivedEl?.getAttribute("datetime") || receivedLines[0] || new Date().toISOString();

    const bodyEl = document.querySelector('[data-testid*="message-body" i], [class*="allowTextSelection"], [role="document"], [dir="auto"]');
    const bodyText = clean(bodyEl?.innerText) || fullText.slice(0, 300);

    return {
      title: subject || "Open Outlook Email",
      sender: senderDisplayName || senderEmail || "Outlook Sender",
      date: receivedDate,
      snippet: bodyText.slice(0, 200),
      url: window.location.href,
      source: "outlook"
    };
  }

  // ── Main crawl function: extracts last 50 emails ──
  async function crawlOutlookData() {
    console.log("[UoB Assistant] Starting crawl for last 50 Outlook emails...");

    // Wait for rows (up to 10s)
    let rows = getVisibleRows();
    let attempts = 0;
    while (rows.length === 0 && attempts < 20) {
      await sleep(500);
      rows = getVisibleRows();
      attempts++;
    }

    if (rows.length === 0) {
      console.warn("[UoB Assistant] No visible rows. Checking if an email is open in reading pane...");
      const openMsg = extractOpenMessage();
      if (openMsg.title) {
        return [openMsg];
      }
      return [];
    }

    const emailMap = new Map();
    const scrollContainer = findScrollContainer();
    const TARGET = 50;
    let scrolls = 0;

    while (emailMap.size < TARGET && scrolls < 18) {
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

      // Programmatic scroll down through virtualized list
      if (scrollContainer === window) {
        window.scrollBy(0, 500);
      } else {
        scrollContainer.scrollTop += 500;
      }

      await sleep(300);
      scrolls++;
    }

    const items = Array.from(emailMap.values());
    console.log(`[UoB Assistant] Outlook extraction complete: found ${items.length} emails!`);
    return items;
  }

  window.crawlOutlookData = crawlOutlookData;

  // ── Inject Floating On-Page Button (from outlook-today-crawler example) ──
  function injectFloatingButton() {
    if (document.getElementById("uob-outlook-extract-btn")) return;

    const btn = document.createElement("button");
    btn.id = "uob-outlook-extract-btn";
    btn.type = "button";
    btn.innerHTML = "📥 Extract 50 Emails to UoB Assistant";
    btn.title = "Extract last 50 emails directly from your Outlook inbox into UoB Assistant";
    Object.assign(btn.style, {
      position: "fixed",
      right: "24px",
      bottom: "24px",
      zIndex: "2147483647",
      padding: "12px 18px",
      background: "#0284c7",
      color: "white",
      border: "none",
      borderRadius: "10px",
      fontWeight: "bold",
      fontSize: "13px",
      cursor: "pointer",
      boxShadow: "0 4px 14px rgba(0, 0, 0, 0.25)",
      transition: "transform 0.15s ease, background 0.15s ease"
    });

    btn.addEventListener("mouseenter", () => {
      btn.style.transform = "scale(1.04)";
      btn.style.background = "#0369a1";
    });
    btn.addEventListener("mouseleave", () => {
      btn.style.transform = "scale(1)";
      btn.style.background = "#0284c7";
    });

    btn.addEventListener("click", async () => {
      btn.disabled = true;
      btn.innerText = "⏳ Extracting 50 emails...";

      try {
        const emails = await crawlOutlookData();
        if (emails.length === 0) {
          alert("No emails could be extracted. Please make sure your Outlook inbox list is visible on the page.");
          btn.disabled = false;
          btn.innerText = "📥 Extract 50 Emails to UoB Assistant";
          return;
        }

        // Save into chrome.storage.local
        const stored = await chrome.storage.local.get(["scrapedItems"]);
        const existing = Array.isArray(stored.scrapedItems) ? stored.scrapedItems : [];
        const nonOutlook = existing.filter(i => i.source !== "outlook");
        const updated = [...nonOutlook, ...emails];

        await chrome.storage.local.set({
          scrapedItems: updated,
          lastCrawlTime: new Date().toISOString()
        });

        btn.innerText = `✅ Extracted ${emails.length} Emails!`;
        btn.style.background = "#16a34a";

        // Download JSON backup (like outlook-today-crawler)
        const blob = new Blob([JSON.stringify(emails, null, 2)], { type: "application/json" });
        const downloadUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = downloadUrl;
        a.download = "outlook-50-emails.json";
        a.click();
        setTimeout(() => URL.revokeObjectURL(downloadUrl), 4000);

        setTimeout(() => {
          btn.disabled = false;
          btn.innerText = "📥 Extract 50 Emails to UoB Assistant";
          btn.style.background = "#0284c7";
        }, 4000);
      } catch (err) {
        console.error("[UoB Assistant] Outlook extraction failed:", err);
        alert(`Extraction failed: ${err.message}`);
        btn.disabled = false;
        btn.innerText = "📥 Extract 50 Emails to UoB Assistant";
      }
    });

    document.body.appendChild(btn);
  }

  // Inject floating button when page loads or DOM is ready
  if (document.readyState === "complete" || document.readyState === "interactive") {
    injectFloatingButton();
  } else {
    window.addEventListener("DOMContentLoaded", injectFloatingButton);
  }

  // Re-check after SPA navigation
  setTimeout(injectFloatingButton, 2500);

  // Message listener from popup/background
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "extract_outlook") {
      crawlOutlookData().then(data => sendResponse({ data }));
      return true;
    }
  });
})();
