(() => {
  const clean = text => (text || "").replace(/\s+/g, " ").trim();
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  const DEFAULT_KEYWORDS = [
    "deadline", "due", "submission", "assignment", "exam",
    "compulsory", "urgent", "important", "cancelled", "rescheduled",
    "reminder", "assessment", "coursework", "room", "feedback", "grade",
    "lecture", "seminar", "workshop", "dissertation", "quiz"
  ];

  // ══════════════════════════════════════════════════════════════════════════
  // STRATEGY 1: OWA FindItem API (from codeurjc/outlook-scraper)
  // Calls the internal EWS-over-JSON endpoint used natively by Outlook Web:
  // POST /owa/service.svc?action=FindItem&app=Mail
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
      console.log("[Outlook Scraper] Attempting OWA FindItem API (codeurjc strategy)...");
      const token = findMsalToken();
      const origin = window.location.origin;
      const url = `${origin}/owa/service.svc?action=FindItem&app=Mail`;

      const headers = {
        "Content-Type": "application/json; charset=utf-8",
        "Action": "FindItem",
        "Prefer": 'IdType="ImmutableId", exchange.behavior="IncludeThirdPartyOnlineMeetingProviders"'
      };
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }

      // EWS over JSON request payload from codeurjc/outlook-scraper
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
        body: JSON.stringify(requestPayload)
      });

      if (!resp.ok) {
        console.log(`[Outlook Scraper] OWA API returned HTTP ${resp.status}, falling back to DOM`);
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

          const baseOrigin = window.location.origin?.startsWith("http") ? window.location.origin : "https://outlook.office.com";
          return {
            id: `outlook-api-${idx + 1}-${Math.random().toString(36).slice(2, 6)}`,
            title: subject,
            source: "outlook",
            dueDate: null,
            date: dateStr,
            sender: sender,
            snippet: snippet,
            url: `${baseOrigin}/mail/id/${encodeURIComponent(itemId)}`,
            isUrgent: matched.length > 0,
            matchedKeywords: matched
          };
        });
      }
    } catch (err) {
      console.log("[Outlook Scraper] OWA API error, falling back to DOM:", err.message);
    }
    return null;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // STRATEGY 2: Robust DOM Virtual List Crawler (Fixed)
  // Targets individual message rows without mistakenly capturing list wrappers.
  // ══════════════════════════════════════════════════════════════════════════

  function getMessageRowElements() {
    // Specific item selectors (never match outer feed/list containers)
    const specificSelectors = [
      'div[data-convid]',
      'div[role="option"]',
      'div[role="listitem"]',
      'div[draggable="true"][data-is-focusable="true"]',
      'div[data-selection-index]',
      'div[data-item-index]'
    ];

    const elements = document.querySelectorAll(specificSelectors.join(", "));
    const rows = [];
    const seen = new Set();

    for (const el of elements) {
      // Exclude outer wrappers
      const role = el.getAttribute("role");
      if (role === "feed" || role === "listbox" || role === "region" || role === "treegrid") continue;

      const ariaLabel = el.getAttribute("aria-label") || "";
      if (/^(message list|conversation list|messages|reading pane)$/i.test(ariaLabel)) continue;

      const text = clean(el.innerText || "");
      if (text.length < 5 && ariaLabel.length < 5) continue;

      // Deduplicate by element reference
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
      '[role="feed"]',
      '[role="listbox"]',
      'div[aria-label*="Message list" i]',
      'div[aria-label*="Conversation list" i]',
      'div[class*="customScrollBar" i]'
    ];

    for (const sel of listSelectors) {
      const el = document.querySelector(sel);
      if (el && el.scrollHeight > el.clientHeight) return el;
    }

    // Traverse upwards from first message row
    const rows = getMessageRowElements();
    if (rows.length > 0) {
      let p = rows[0].parentElement;
      while (p && p !== document.body) {
        try {
          const style = window.getComputedStyle(p);
          if ((style.overflowY === "auto" || style.overflowY === "scroll") && p.scrollHeight > p.clientHeight + 10) {
            return p;
          }
        } catch (e) {}
        p = p.parentElement;
      }
    }

    return window;
  }

  function parseAriaLabel(label) {
    if (!label || label.length < 6) return null;

    let sender = "";
    let subject = "";
    let dateStr = "";
    let snippet = "";

    const fromMatch = label.match(/(?:from|sender)[:\s]+([^,;]+)/i);
    const subjectMatch = label.match(/(?:subject)[:\s]+([^,;]+)/i);
    const dateMatch = label.match(/(?:received|date|sent)[:\s]+([^,;]+)/i);
    const previewMatch = label.match(/(?:preview|body|snippet)[:\s]+(.+)/i);

    if (fromMatch) sender = clean(fromMatch[1]);
    if (subjectMatch) subject = clean(subjectMatch[1]);
    if (dateMatch) dateStr = clean(dateMatch[1]);
    if (previewMatch) snippet = clean(previewMatch[1]);

    if (!subject || !sender) {
      const parts = label.split(/[,;]\s*/).map(clean).filter(p => {
        return !/^(unread|read|flagged|pinned|high priority|selected|attachment|has attachment)$/i.test(p);
      });

      if (parts.length >= 2) {
        sender = sender || parts[0];
        subject = subject || parts[1];
        if (parts.length >= 3) {
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

  function parseRowFromDom(row, index) {
    const ariaData = parseAriaLabel(row.getAttribute("aria-label"));

    const rawText = clean(row.innerText || "");
    const lines = row.innerText.split("\n").map(clean).filter(Boolean);
    const noiseWords = /^(selected|pinned|flagged|has attachments|unread|read|high priority)$/i;
    const cleanLines = lines.filter(l => !noiseWords.test(l));

    // Try finding dedicated subject & sender elements
    const subjectEl = row.querySelector(
      '[data-subject], span[style*="font-weight: 600"], span[style*="font-weight: 700"], span[style*="font-weight: bold"], h2, h3'
    );
    const domSubject = clean(subjectEl?.innerText) || cleanLines[1] || cleanLines[0];

    const senderEl = row.querySelector('.ms-Persona-primaryText, [class*="Sender" i], [class*="from" i]');
    const domSender = clean(senderEl?.innerText) || cleanLines[0] || "Outlook Sender";

    const subject = ariaData?.subject || domSubject;
    const sender = ariaData?.sender || domSender;
    const dateStr = ariaData?.date || cleanLines[2] || new Date().toISOString();
    const snippet = ariaData?.snippet || cleanLines.slice(2, 5).join(" - ") || rawText.slice(0, 160);

    if (!subject || subject.length < 2) return null;

    const convid = row.getAttribute("data-convid") ||
                   row.getAttribute("data-item-index") ||
                   row.querySelector("a[href]")?.getAttribute("href");
    const baseOrigin = window.location.origin?.startsWith("http") ? window.location.origin : "https://outlook.office.com";
    const emailUrl = convid && convid.startsWith("http")
      ? convid
      : (convid ? `${baseOrigin}/mail/id/${encodeURIComponent(convid)}` : `${baseOrigin}/mail/inbox`);

    const fullContent = `${subject} ${sender} ${snippet}`.toLowerCase();
    const matched = DEFAULT_KEYWORDS.filter(kw => fullContent.includes(kw));

    return {
      id: `outlook-dom-${index + 1}-${Math.random().toString(36).slice(2, 6)}`,
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

  async function crawlOutlookDOM() {
    console.log("[Outlook Scraper] Running DOM Virtual List Crawler...");
    const emailMap = new Map();
    const scrollContainer = findScrollContainer();
    const TARGET = 50;

    let rows = getMessageRowElements();
    let attempts = 0;
    while (rows.length === 0 && attempts < 15) {
      await sleep(400);
      rows = getMessageRowElements();
      attempts++;
    }

    if (rows.length === 0) {
      console.log("[Outlook Scraper] No rows found via primary selectors, checking reading pane...");
      const openMsg = extractOpenMessage();
      if (openMsg) return [openMsg];
      return [];
    }

    let scrolls = 0;
    while (emailMap.size < TARGET && scrolls < 22) {
      const currentRows = getMessageRowElements();
      for (const row of currentRows) {
        const item = parseRowFromDom(row, emailMap.size);
        if (!item || !item.title) continue;

        const key = `${item.title.trim().toLowerCase()}|${item.sender.trim().toLowerCase()}`;
        if (!emailMap.has(key)) {
          emailMap.set(key, item);
          if (emailMap.size >= TARGET) break;
        }
      }

      if (emailMap.size >= TARGET) break;

      // Scroll and dispatch synthetic DOM events
      if (scrollContainer === window) {
        window.scrollBy(0, 500);
      } else {
        scrollContainer.scrollTop += 500;
        scrollContainer.dispatchEvent(new Event("scroll", { bubbles: true }));
        scrollContainer.dispatchEvent(new WheelEvent("wheel", { deltaY: 500, bubbles: true }));
      }

      await sleep(400);
      scrolls++;
    }

    return Array.from(emailMap.values());
  }

  // ══════════════════════════════════════════════════════════════════════════
  // STRATEGY 3: Open Reading Pane Fallback
  // ══════════════════════════════════════════════════════════════════════════

  function extractOpenMessage() {
    const main = document.querySelector('[role="main"]') || document.body;
    const fullText = clean(main.innerText || "");

    const subjectHeading = [...main.querySelectorAll("h1, h2, [role=heading]")].find(el => el.innerText);
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

  // ══════════════════════════════════════════════════════════════════════════
  // MAIN ENTRY POINT: Orchestrate OWA API + DOM Fallback
  // ══════════════════════════════════════════════════════════════════════════

  async function crawlOutlookData() {
    // 1. Try OWA FindItem API first (fastest & most accurate, codeurjc strategy)
    const apiItems = await tryOwaFindItemApi();
    if (apiItems && apiItems.length > 0) {
      return apiItems;
    }

    // 2. Fall back to DOM Crawler
    const domItems = await crawlOutlookDOM();
    if (domItems && domItems.length > 0) {
      return domItems;
    }

    // 3. Fall back to Reading Pane
    const openMsg = extractOpenMessage();
    if (openMsg) return [openMsg];

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

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "extract_outlook") {
      crawlOutlookData().then(data => sendResponse({ data }));
      return true;
    }
  });
})();
