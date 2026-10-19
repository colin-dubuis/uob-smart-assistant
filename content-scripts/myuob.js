(() => {
  if (window.__myuobCrawlerLoaded) return;
  window.__myuobCrawlerLoaded = true;

  const clean = text => (text || "").replace(/\s+/g, " ").trim();
  const pad = n => String(n).padStart(2, "0");

  function to24(h, m, ap) {
    h = parseInt(h, 10);
    m = m == null || m === "" ? 0 : parseInt(m, 10);
    if (ap) {
      ap = ap.toLowerCase().replace(/\./g, "");
      if (ap === "pm" && h < 12) h += 12;
      if (ap === "am" && h === 12) h = 0;
    }
    if (h < 0 || h > 23 || m < 0 || m > 59) return "";
    return pad(h) + ":" + pad(m);
  }

  // Parse time expressions like "7-9pm", "19:00", "7:30pm"
  function parseTimes(str) {
    if (!str) return null;
    const time = String.raw`(\d{1,2})(?:[:.:](\d{2}))?`;
    const shared = new RegExp(
      String.raw`\b${time}\s*(?:-|–|—|to|until|till)\s*${time}\s*(a\.?m\.?|p\.?m\.?)\b`,
      "i"
    ).exec(str);

    if (shared) {
      const endAp = shared[7].replace(/\./g, "").toLowerCase();
      const startHour = parseInt(shared[1], 10);
      const endHour = parseInt(shared[4], 10);
      const startAp = endAp === "pm" && startHour % 12 > endHour % 12 ? "am" : endAp;
      const start = to24(shared[1], shared[2], startAp);
      const end = to24(shared[4], shared[5], endAp);
      return start && end ? { start, end } : null;
    }

    const re = new RegExp(
      String.raw`\b(\d{1,2})(?:[:.:](\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b|\b([01]?\d|2[0-3]):([0-5]\d)\b`,
      "gi"
    );
    let m = re.exec(str);
    if (m) {
      const t = m[3] ? to24(m[1], m[2], m[3].replace(/\./g, "")) : to24(m[4], m[5]);
      return t ? { start: t, end: null } : null;
    }
    return null;
  }

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

  // ── 1. Try MyDay REST APIs (when logged in to MyUoB) ──
  async function tryMyDayAPI() {
    const endpoints = [
      { url: "https://api.myday.cloud/timetable/v1/timetable", type: "event" },
      { url: "https://api.myday.cloud/todo/v1/tasks", type: "task" },
      { url: "https://api.myday.cloud/notification/v1/notifications", type: "announcement" }
    ];

    const results = [];
    for (const ep of endpoints) {
      try {
        const resp = await fetch(ep.url, {
          credentials: "include",
          headers: { Accept: "application/json" }
        });
        if (!resp.ok) continue;
        const data = await resp.json();
        const items = Array.isArray(data)
          ? data
          : data.items || data.activities || data.tasks || data.notifications || [];

        // FIX: tag with correct source depending on which URL the script runs on.
        // When injected into myuob.bham.ac.uk → source "myuob"
        // When injected into guildofstudents.com → source "society"
        const sourceTag = window.location.hostname.includes("guildofstudents") ? "society" : "myuob";

        items.forEach((item, idx) => {
          results.push({
            id: `myuob-api-${item.id || idx}`,
            title: item.name || item.title || item.subject || item.message || "MyUoB Notice",
            source: sourceTag,
            dueDate: item.startDateTime || item.start || item.dueDate || item.date || null,
            snippet: `${item.location || item.room || ""} ${item.description || item.body || ""}`.trim(),
            // FIX: use "url" (not "link") to be consistent with popup.js rendering
            url: item.url || (sourceTag === "society"
              ? "https://www.guildofstudents.com/events"
              : "https://myuob.bham.ac.uk/dashboard/student-home")
          });
        });

        if (results.length > 0) break;
      } catch (e) {
        // Continue to DOM scraping
      }
    }
    return results;
  }

  // ── 2. DOM Scrape for Guild of Students and MyUoB tiles ──
  function extractSocietyDOMItems() {
    // FIX: tag source correctly based on actual page hostname
    const isGuild = window.location.hostname.includes("guildofstudents");
    const isLibrary = window.location.hostname.includes("intranet.birmingham") ||
                      window.location.href.includes("librari");
    let sourceTag = "myuob";
    if (isGuild) sourceTag = "society";
    if (isLibrary) sourceTag = "library";

    const items = [];
    const cards = document.querySelectorAll(
      '.event-item, .ms-event-card, .event_item, article, [class*="event-card"], [class*="EventCard"], .content-item, [class*="tile" i]'
    );

    cards.forEach((card, idx) => {
      if (idx > 25) return;
      const fullText = clean(card.innerText);
      if (!fullText || fullText.length < 8) return;

      const titleEl = card.querySelector('h1, h2, h3, h4, .title, [class*="title" i], strong');
      const title = clean(titleEl?.innerText) || fullText.split("\n")[0];
      if (!title || title.length < 3) return;

      const dateEl = card.querySelector('time, [class*="date" i], [datetime]');
      const dateText = clean(dateEl?.getAttribute("datetime") || dateEl?.innerText) || fullText;
      const dueDate = parseEventDate(dateText);

      const timing = parseTimes(fullText);
      const timeInfo = timing?.start ? ` (Starts ${timing.start}${timing.end ? " - " + timing.end : ""})` : "";

      // FIX: use "url" (not "link") to be consistent with popup.js rendering
      const url = card.querySelector("a")?.href || (isGuild
        ? "https://www.guildofstudents.com/events"
        : "https://myuob.bham.ac.uk/dashboard/student-home");

      items.push({
        id: `${sourceTag}-dom-${idx + 1}`,
        title: title + timeInfo,
        source: sourceTag,
        dueDate: dueDate,
        snippet: fullText.slice(0, 160),
        url: url
      });
    });

    return items;
  }

  async function crawlSocietyData() {
    try {
      const apiResults = await tryMyDayAPI();
      if (apiResults && apiResults.length > 0) {
        console.log(`[Society Scraper] Retrieved ${apiResults.length} items from MyDay API`);
        return apiResults;
      }
    } catch (e) {
      // Fallback
    }
    const domResults = extractSocietyDOMItems();
    console.log(`[Society Scraper] Retrieved ${domResults.length} items from DOM`);
    return domResults;
  }

  window.crawlSocietyData = crawlSocietyData;

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "extract_society") {
      crawlSocietyData().then(data => sendResponse({ data }));
      return true;
    }
  });
})();
