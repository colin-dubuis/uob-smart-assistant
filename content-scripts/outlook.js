(() => {

  const clean = text => (text || "").replace(/\s+/g, " ").trim();
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  const DEFAULT_KEYWORDS = [
    "deadline", "due", "submission", "assignment", "exam",
    "compulsory", "urgent", "important", "cancelled", "rescheduled",
    "reminder", "assessment", "coursework", "room", "feedback", "grade",
    "lecture", "seminar", "workshop", "dissertation", "quiz", "pizza"
  ];

  // ══════════════════════════════════════════════════════════════════════════
  // STRATEGY 1: OWA FindItem JSON API (Fastest if session token is available)
  // ══════════════════════════════════════════════════════════════════════════

  function findMsalToken() {
    for (const storage of [window.sessionStorage, window.localStorage]) {
      try {
        if (!storage) continue;
        for (let i = 0; i < storage.length; i++) {
          const key = storage.key(i);
          if (!key) continue;
          const val = storage.getItem(key);
          if (!val) continue;

          // Check if MSAL token object in JSON
          if (val.includes("secret") || val.includes("accessToken") || val.includes("access_token")) {
            try {
              const parsed = JSON.parse(val);
              const token = parsed.secret || parsed.accessToken || parsed.access_token || parsed.token;
              if (token && typeof token === "string" && token.startsWith("ey") && token.length > 80) {
                return token;
              }
            } catch (e) {}
          }

          // Check if raw JWT string
          if (typeof val === "string" && val.startsWith("ey") && val.length > 150) {
            return val;
          }
        }
      } catch (e) {}
    }
    return null;
  }

  async function tryOwaFindItemApi() {
    try {
      const token = findMsalToken();
      if (!token) {
        // Without an observed token, OWA service.svc rejects unauthenticated JSON requests
        return null;
      }

      console.log("[Outlook Scraper] Attempting OWA FindItem API with detected MSAL token...");
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2500);

      const origin = window.location.origin.startsWith("http") ? window.location.origin : "https://outlook.office.com";
      const url = `${origin}/owa/service.svc?action=FindItem&app=Mail`;

      const headers = {
        "Content-Type": "application/json; charset=utf-8",
        "Action": "FindItem",
        "Authorization": `Bearer ${token}`,
        "Prefer": 'IdType="ImmutableId", exchange.behavior="IncludeThirdPartyOnlineMeetingProviders"'
      };

      const requestPayload = {
        __type: "FindItemJsonRequest:#Exchange",
        Header: {
          __type: "JsonRequestHeaders:#Exchange",
          RequestServerVersion: "V2018_01_08",
          TimeZoneContext: {
            __type: "TimeZoneContext:#Exchange",
            TimeZoneDefinition: {
              __type: "TimeZoneDefinitionType:#Exchange",
              Id: "Romance Standard Time"
            }
          }
        },
        Body: {
          __type: "FindItemRequest:#Exchange",
          ItemShape: {
            __type: "ItemResponseShape:#Exchange",
            BaseShape: "IdOnly",
            AdditionalProperties: [
              { __type: "PropertyUri:#Exchange", FieldURI: "ItemSubject" },
              { __type: "PropertyUri:#Exchange", FieldURI: "ItemDateTimeReceived" },
              { __type: "PropertyUri:#Exchange", FieldURI: "MessageSender" },
              { __type: "PropertyUri:#Exchange", FieldURI: "ItemPreview" }
            ]
          },
          ParentFolderIds: [
            { __type: "DistinguishedFolderId:#Exchange", Id: "inbox" }
          ],
          Traversal: "Shallow",
          Paging: {
            __type: "IndexedPageView:#Exchange",
            BasePoint: "Beginning",
            MaxEntriesReturned: 50,
            Offset: 0
          },
          SortOrder: [
            {
              __type: "SortResults:#Exchange",
              Order: "Descending",
              Path: { __type: "PropertyUri:#Exchange", FieldURI: "ItemDateTimeReceived" }
            }
          ]
        }
      };

      const resp = await fetch(url, {
        method: "POST",
        credentials: "include",
        headers,
        body: JSON.stringify(requestPayload),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!resp.ok) {
        return null;
      }

      const json = await resp.json();
      const itemsContainer = json?.Body?.ResponseMessages?.Items?.[0]?.RootFolder?.Items ||
                             json?.ResponseMessages?.Items?.[0]?.RootFolder?.Items ||
                             [];

      if (Array.isArray(itemsContainer) && itemsContainer.length > 0) {
        console.log(`[Outlook Scraper] OWA FindItem API successfully retrieved ${itemsContainer.length} items!`);

        return itemsContainer.map((item, idx) => {
          const subject = clean(item.Subject || item.ItemSubject || "Outlook Message");
          const senderObj = item.Sender?.Mailbox || item.MessageSender?.Mailbox || {};
          const sender = clean(senderObj.Name || senderObj.EmailAddress || "Outlook Sender");
          const dateStr = item.DateTimeReceived || item.ItemDateTimeReceived || new Date().toISOString();
          const snippet = clean(item.Preview || item.ItemPreview || "").slice(0, 180);
          const itemId = item.ItemId?.Id || `item-${idx}`;

          const fullText = `${subject} ${sender} ${snippet}`.toLowerCase();
          const matched = DEFAULT_KEYWORDS.filter(kw => fullText.includes(kw));

          return {
            id: `outlook-api-${idx + 1}-${Math.random().toString(36).slice(2, 6)}`,
            title: subject,
            source: "outlook",
            dueDate: null,
            date: dateStr,
            sender: sender,
            snippet: snippet,
            url: `${origin}/mail/id/${encodeURIComponent(itemId)}`,
            isUrgent: matched.length > 0,
            matchedKeywords: matched
          };
        });
      }
    } catch (err) {
      console.log("[Outlook Scraper] OWA API skipped or timed out:", err.message);
    }
    return null;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // STRATEGY 2: Multi-Selector DOM Virtual List Crawler (Ultra-Resilient)
  // ══════════════════════════════════════════════════════════════════════════

  function getMessageRowElements() {
    const candidateSelectors = [
      '[data-convid]',
      '[data-item-id]',
      '[data-legacyitemid]',
      '[role="row"]',
      '[role="option"]',
      '[role="listitem"]',
      '[data-testid*="message-list-item"]',
      '[data-testid*="mailListItem"]',
      'div[draggable="true"][aria-label]',
      'div[data-is-focusable="true"][aria-label*=","]',
      'div[data-selection-index]',
      'div[data-item-index]'
    ];

    const elements = document.querySelectorAll(candidateSelectors.join(", "));
    const rows = [];
    const seen = new Set();

    for (const el of elements) {
      // Exclude outer wrappers and containers
      const role = el.getAttribute("role");
      if (role === "feed" || role === "listbox" || role === "region" || role === "treegrid" || role === "grid" || role === "toolbar" || role === "menu" || role === "menubar") continue;

      const ariaLabel = el.getAttribute("aria-label") || "";
      if (/^(message list|conversation list|messages|reading pane|navigation pane|folders)$/i.test(ariaLabel)) continue;

      // Exclude small buttons or toolbar items
      const text = clean(el.innerText || "");
      if (text.length < 5 && ariaLabel.length < 8) continue;

      // Prevent nested duplicate row elements (e.g., inner focusable div inside an outer role="row")
      let isNested = false;
      for (const existing of rows) {
        if (existing.contains(el)) {
          isNested = true;
          break;
        }
      }
      if (isNested) continue;

      if (!seen.has(el)) {
        seen.add(el);
        rows.push(el);
      }
    }

    return rows;
  }

  function findScrollContainer() {
    const listSelectors = [
      '[data-app-section="ConversationList"]',
      '[data-app-section="MailList"]',
      '[role="feed"]',
      '[role="listbox"]',
      '[role="treegrid"]',
      '[role="grid"]',
      'div[aria-label*="Message list" i]',
      'div[aria-label*="Conversation list" i]',
      'div[aria-label*="Messages" i]',
      'div[class*="customScrollBar" i]'
    ];

    for (const sel of listSelectors) {
      const el = document.querySelector(sel);
      if (el && el.scrollHeight > el.clientHeight + 10) return el;
    }

    // Traverse upwards from first message row to find scrollable ancestor
    const rows = getMessageRowElements();
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

  function parseRowFromDom(row, index) {
    if (!row) return null;

    // 1. Check aria-label on the row or its primary child
    const ariaLabel = row.getAttribute("aria-label") ||
                      row.querySelector("[aria-label]")?.getAttribute("aria-label") || "";

    let subject = "";
    let sender = "";
    let dateStr = "";
    let snippet = "";

    // Parse aria-label if present and informative
    if (ariaLabel && ariaLabel.length > 8) {
      // Split on separators: commas, semicolons, middle dots, vertical bars
      const rawParts = ariaLabel.split(/[,;·•|\n]\s*/).map(clean).filter(Boolean);
      const noise = /^(unread|read|flagged|pinned|high priority|low priority|selected|attachment|has attachment|has attachments|replied|forwarded|categorized)$/i;
      const parts = rawParts.filter(p => !noise.test(p));

      if (parts.length >= 2) {
        sender = parts[0];
        subject = parts[1];
        if (parts.length >= 3) {
          // Check if part 2 is a date/time or snippet
          if (/\b(\d{1,2}:\d{2}|\d{1,2}[\/\-\.]\d{1,2}|yesterday|today|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/i.test(parts[2])) {
            dateStr = parts[2];
            snippet = parts.slice(3).join(" - ");
          } else {
            snippet = parts.slice(2).join(" - ");
          }
        }
      }
    }

    // 2. DOM extraction fallback / enrichment
    const rawText = clean(row.innerText || "");
    const lines = (row.innerText || "").split("\n").map(clean).filter(Boolean);
    const noise = /^(unread|read|flagged|pinned|high priority|low priority|selected|attachment|has attachment|has attachments|replied|forwarded)$/i;
    const cleanLines = lines.filter(l => !noise.test(l));

    // Subject
    if (!subject || subject.length < 2) {
      const subjectEl = row.querySelector(
        '[data-subject], [id^="subject_"], [class*="subject" i], [data-testid*="subject" i], h2, h3, span[style*="font-weight"], [class*="bold" i]'
      );
      subject = clean(subjectEl?.innerText) || cleanLines[1] || cleanLines[0];
    }

    // Sender
    if (!sender || sender.length < 2) {
      const senderEl = row.querySelector(
        '.ms-Persona-primaryText, [class*="Persona" i], [class*="Sender" i], [class*="from" i], [data-testid*="sender" i], [data-testid*="from" i]'
      );
      sender = clean(senderEl?.innerText) || cleanLines[0] || "Outlook";
    }

    // Date
    if (!dateStr) {
      const timeEl = row.querySelector("time, [datetime], [class*='date' i], [class*='time' i]");
      dateStr = timeEl ? (timeEl.getAttribute("datetime") || clean(timeEl.innerText)) : null;
      if (!dateStr && cleanLines.length >= 3) {
        const dateMatch = rawText.match(/\b(\d{1,2}:\d{2}(?:\s*[ap]m)?|\d{1,2}[\/\-\.]\d{1,2}(?:[\/\-\.]\d{2,4})?|yesterday|today|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s+\d{1,2})\b/i);
        dateStr = dateMatch ? dateMatch[0] : null;
      }
      if (!dateStr) dateStr = new Date().toISOString();
    }

    // Snippet
    if (!snippet || snippet.length < 5) {
      const snippetEl = row.querySelector('[class*="preview" i], [class*="snippet" i], [data-testid*="preview" i]');
      snippet = clean(snippetEl?.innerText) || cleanLines.slice(2, 5).join(" - ") || rawText.slice(0, 180);
    }

    if (!subject || subject.length < 2) return null;

    // URL resolution
    const origin = window.location.origin.startsWith("http") ? window.location.origin : "https://outlook.office.com";
    const convid = row.getAttribute("data-convid") ||
                   row.getAttribute("data-item-id") ||
                   row.getAttribute("data-legacyitemid") ||
                   row.getAttribute("data-item-index");
    const anchor = row.querySelector("a[href]");
    let emailUrl = `${origin}/mail/inbox`;
    if (convid) {
      emailUrl = `${origin}/mail/id/${encodeURIComponent(convid)}`;
    } else if (anchor && anchor.href && /^https?:\/\//i.test(anchor.href)) {
      emailUrl = anchor.href;
    }

    const fullContent = `${subject} ${sender} ${snippet}`.toLowerCase();
    const matched = DEFAULT_KEYWORDS.filter(kw => fullContent.includes(kw));

    return {
      id: `outlook-dom-${index + 1}-${Math.random().toString(36).slice(2, 6)}`,
      title: subject,
      source: "outlook",
      dueDate: null,
      date: dateStr,
      sender: sender,
      snippet: snippet.slice(0, 200),
      url: emailUrl,
      isUrgent: matched.length > 0,
      matchedKeywords: matched
    };
  }

  async function crawlOutlookDOM() {
    console.log("[Outlook Scraper] Running DOM Virtual List Crawler...");
    const emailMap = new Map();
    const scrollContainer = findScrollContainer();
    const TARGET = 50;

    let rows = getMessageRowElements();
    let attempts = 0;
    while (rows.length === 0 && attempts < 15) {
      await sleep(350);
      rows = getMessageRowElements();
      attempts++;
    }

    if (rows.length === 0) {
      console.log("[Outlook Scraper] No rows found via primary selectors, checking reading pane...");
      const openMsg = extractOpenMessage();
      if (openMsg) return [openMsg];
      return [];
    }

    console.log(`[Outlook Scraper] Detected ${rows.length} visible rows initially`);

    let scrolls = 0;
    while (emailMap.size < TARGET && scrolls < 25) {
      const currentRows = getMessageRowElements();
      for (const row of currentRows) {
        try {
          const item = parseRowFromDom(row, emailMap.size);
          if (!item || !item.title) continue;

          const key = `${item.title.trim().toLowerCase()}|${item.sender.trim().toLowerCase()}`;
          if (!emailMap.has(key)) {
            emailMap.set(key, item);
            if (emailMap.size >= TARGET) break;
          }
        } catch (e) {
          // Skip individual row parse faults
        }
      }

      if (emailMap.size >= TARGET) break;

      // Programmatic scroll + Synthetic DOM Events
      if (scrollContainer === window) {
        window.scrollBy(0, 500);
      } else {
        scrollContainer.scrollTop += 500;
        scrollContainer.dispatchEvent(new Event("scroll", { bubbles: true }));
        scrollContainer.dispatchEvent(new WheelEvent("wheel", { deltaY: 500, bubbles: true }));
      }

      // Also trigger scrollIntoView on the last visible row to notify React virtualizer
      if (currentRows.length > 0) {
        try {
          currentRows[currentRows.length - 1].scrollIntoView({ block: "end", behavior: "auto" });
        } catch (e) {}
      }

      await sleep(350);
      scrolls++;
    }

    console.log(`[Outlook Scraper] DOM scan complete: extracted ${emailMap.size} emails`);
    return Array.from(emailMap.values());
  }

  // ══════════════════════════════════════════════════════════════════════════
  // STRATEGY 3: Open Reading Pane Fallback
  // ══════════════════════════════════════════════════════════════════════════

  function extractOpenMessage() {
    const main = document.querySelector('[role="main"]') || document.body;
    const fullText = clean(main.innerText || "");

    const subjectHeading = [...main.querySelectorAll("h1, h2, [role=heading], [data-subject]")].find(el => clean(el.innerText).length > 2);
    const subject = clean(subjectHeading?.innerText);

    const senderEl = main.querySelector('.ms-Persona-primaryText, [class*="Sender" i], [class*="from" i], [data-testid*="sender" i]');
    const sender = clean(senderEl?.innerText) || "Outlook Sender";

    const timeEl = main.querySelector("time, [datetime]");
    const dateStr = timeEl ? (timeEl.getAttribute("datetime") || clean(timeEl.innerText)) : new Date().toISOString();

    const bodyEl = document.querySelector('[data-testid*="message-body" i], [class*="allowTextSelection"], [role="document"]');
    const bodyText = clean(bodyEl?.innerText) || fullText.slice(0, 250);

    if (subject && subject.length > 2) {
      const origin = window.location.origin.startsWith("http") ? window.location.origin : "https://outlook.office.com";
      return {
        id: `outlook-open-${Math.random().toString(36).slice(2, 6)}`,
        title: subject,
        sender: sender,
        date: dateStr,
        snippet: bodyText.slice(0, 180),
        url: window.location.href.startsWith("http") ? window.location.href : `${origin}/mail/inbox`,
        source: "outlook",
        dueDate: null,
        isUrgent: false,
        matchedKeywords: []
      };
    }
    return null;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // MAIN ENTRY POINT: Orchestrate OWA API + DOM Fallback
  // ══════════════════════════════════════════════════════════════════════════

  async function crawlOutlookData() {
    console.log("[Outlook Scraper] Starting Outlook extraction...");

    // 1. Try OWA FindItem API first (fastest if token available)
    try {
      const apiItems = await tryOwaFindItemApi();
      if (apiItems && apiItems.length > 0) {
        console.log(`[Outlook Scraper] API retrieved ${apiItems.length} emails`);
        return apiItems;
      }
    } catch (e) {
      console.warn("[Outlook Scraper] API attempt skipped:", e.message);
    }

    // 2. DOM Virtual List Crawler (resilient, primary in-browser method)
    try {
      const domItems = await crawlOutlookDOM();
      if (domItems && domItems.length > 0) {
        console.log(`[Outlook Scraper] DOM crawler retrieved ${domItems.length} emails`);
        return domItems;
      }
    } catch (e) {
      console.error("[Outlook Scraper] DOM crawler error:", e);
    }

    // 3. Fall back to Reading Pane (single opened message)
    try {
      const openMsg = extractOpenMessage();
      if (openMsg) {
        console.log("[Outlook Scraper] Extracted open message from reading pane");
        return [openMsg];
      }
    } catch (e) {
      console.warn("[Outlook Scraper] Reading pane fallback error:", e);
    }

    console.warn("[Outlook Scraper] No emails could be found in DOM or API");
    return [];
  }

  window.crawlOutlookData = crawlOutlookData;

  // ── Floating Button ──
  function injectFloatingButton() {
    if (document.getElementById("uob-outlook-extract-btn")) return;

    const btn = document.createElement("button");
    btn.id = "uob-outlook-extract-btn";
    btn.type = "button";
    btn.innerHTML = `<span style="margin-right:6px">⚡</span> EXTRACT 50 EMAILS`;
    btn.title = "Extract last 50 emails directly into UoB Assistant";
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
        if (!emails || emails.length === 0) {
          alert("No emails could be extracted. Please make sure your Outlook inbox is loaded.");
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
        console.error("[Outlook Scraper] Extraction error:", err);
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
  setTimeout(injectFloatingButton, 2000);

  if (!window.__outlookMessageListenerAttached) {
    window.__outlookMessageListenerAttached = true;
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.action === "extract_outlook") {
        crawlOutlookData()
          .then(data => sendResponse({ data }))
          .catch(err => sendResponse({ data: [], error: err.message }));
        return true;
      }
    });
  }
})();
