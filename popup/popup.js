document.addEventListener("DOMContentLoaded", async () => {
  const DEFAULT_KEYWORDS = [
    "deadline", "due", "submission", "assignment", "exam",
    "compulsory", "urgent", "important", "cancelled", "rescheduled",
    "reminder", "assessment", "coursework", "pizza"
  ];

  const PRESETS = {
    deadlines: ["deadline", "submission", "due", "coursework", "milestone"],
    exams: ["exam", "quiz", "test", "assessment", "midterm"],
    socials: ["pizza", "hackathon", "social", "free food", "meetup", "games"],
    careers: ["careers", "internship", "job", "worklink", "graduate", "fair"]
  };

  // ── Elements ──
  const statusBadge = document.getElementById("statusBadge");
  const statusBar = document.getElementById("statusBar");
  const btnSync = document.getElementById("btnSync");
  const btnClear = document.getElementById("btnClear");
  const themeToggle = document.getElementById("themeToggle");
  const themeIcon = document.getElementById("themeIcon");
  const settingsBtn = document.getElementById("settingsBtn");
  const settingsPanel = document.getElementById("settingsPanel");
  const closeSettingsBtn = document.getElementById("closeSettingsBtn");
  const keywordChipsContainer = document.getElementById("keywordChipsContainer");
  const newKeywordInput = document.getElementById("newKeywordInput");
  const addKeywordBtn = document.getElementById("addKeywordBtn");
  const presetButtons = document.querySelectorAll(".preset-pill");

  const keywordSearch = document.getElementById("keywordSearch");
  const clearSearch = document.getElementById("clearSearch");
  const tabButtons = document.querySelectorAll(".tab-btn");
  const filterPills = document.querySelectorAll(".filter-pill");
  const itemCount = document.getElementById("itemCount");
  const countAll = document.getElementById("countAll");

  const engineTag = document.getElementById("engineTag");
  const crunchSummary = document.getElementById("crunchSummary");
  const topPrioritiesList = document.getElementById("topPrioritiesList");
  const societyHighlights = document.getElementById("societyHighlights");
  const itemsContainer = document.getElementById("itemsContainer");
  const lastUpdated = document.getElementById("lastUpdated");

  // Custom Sites elements
  const customSiteInput = document.getElementById("customSiteInput");
  const customSiteLabelInput = document.getElementById("customSiteLabelInput");
  const addCustomSiteBtn = document.getElementById("addCustomSiteBtn");
  const customSitesList = document.getElementById("customSitesList");

  let currentItems = [];
  let activeFilter = "all";
  let searchQuery = "";
  let currentKeywords = [...DEFAULT_KEYWORDS];
  let customSites = [];

  // ── Falter Theme Mode Setup (Dark is primary) ──
  const storedData = await chrome.storage.local.get([
    "darkMode", "keywords", "scrapedItems", "lastDigest", "lastCrawlTime", "customSites"
  ]);

  // Default to dark mode (Falter Inferno style)
  const isDarkMode = storedData.darkMode !== false;
  if (isDarkMode) {
    document.body.classList.add("dark-mode");
    themeIcon.innerText = "☀️";
  } else {
    document.body.classList.remove("dark-mode");
    themeIcon.innerText = "🌙";
  }

  themeToggle.addEventListener("click", async () => {
    const isDark = document.body.classList.toggle("dark-mode");
    themeIcon.innerText = isDark ? "☀️" : "🌙";
    await chrome.storage.local.set({ darkMode: isDark });
  });

  // ── Keyword Settings & Help Drawer ──
  if (Array.isArray(storedData.keywords) && storedData.keywords.length > 0) {
    currentKeywords = storedData.keywords;
  }
  renderKeywordChips();

  settingsBtn.addEventListener("click", () => {
    settingsPanel.classList.toggle("hidden");
  });

  closeSettingsBtn.addEventListener("click", () => {
    settingsPanel.classList.add("hidden");
  });

  function renderKeywordChips() {
    keywordChipsContainer.innerHTML = "";
    currentKeywords.forEach((kw, idx) => {
      const chip = document.createElement("span");
      chip.className = "kw-chip";
      chip.innerHTML = `${escapeHtml(kw)} <button aria-label="Remove ${escapeHtml(kw)}" title="Remove keyword">✕</button>`;
      chip.querySelector("button").addEventListener("click", async () => {
        currentKeywords.splice(idx, 1);
        renderKeywordChips();
        await chrome.storage.local.set({ keywords: currentKeywords });
        renderItems();
      });
      keywordChipsContainer.appendChild(chip);
    });
  }

  async function addCustomKeyword(word) {
    const cleanWord = (word || "").trim().toLowerCase();
    if (cleanWord && !currentKeywords.includes(cleanWord)) {
      currentKeywords.push(cleanWord);
      renderKeywordChips();
      await chrome.storage.local.set({ keywords: currentKeywords });
      renderItems();
    }
  }

  addKeywordBtn.addEventListener("click", () => {
    addCustomKeyword(newKeywordInput.value);
    newKeywordInput.value = "";
  });

  newKeywordInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      addCustomKeyword(newKeywordInput.value);
      newKeywordInput.value = "";
    }
  });

  presetButtons.forEach(btn => {
    btn.addEventListener("click", async () => {
      const presetName = btn.dataset.preset;
      const words = PRESETS[presetName] || [];
      words.forEach(w => {
        if (!currentKeywords.includes(w)) currentKeywords.push(w);
      });
      renderKeywordChips();
      await chrome.storage.local.set({ keywords: currentKeywords });
      renderItems();
      showStatus(`PRESET APPLIED: ${presetName.toUpperCase()}`);
      setTimeout(hideStatus, 2000);
    });
  });

  // ── Custom Sites Management ──
  if (Array.isArray(storedData.customSites)) {
    customSites = storedData.customSites;
  }
  renderCustomSites();

  function normalizeUrl(raw) {
    raw = (raw || "").trim();
    if (!raw) return null;
    if (!/^https?:\/\//i.test(raw)) raw = "https://" + raw;
    try {
      return new URL(raw).href;
    } catch {
      return null;
    }
  }

  async function addCustomSite() {
    const url = normalizeUrl(customSiteInput.value);
    if (!url) {
      showStatus("INVALID URL. PLEASE ENTER A VALID WEB ADDRESS", true);
      return;
    }
    const label = (customSiteLabelInput.value || "").trim() ||
                  new URL(url).hostname;

    if (customSites.some(s => s.url === url)) {
      showStatus("WEBSITE ALREADY REGISTERED IN CUSTOM SITES", true);
      return;
    }

    customSites.push({ url, label });
    await chrome.storage.local.set({ customSites });
    customSiteInput.value = "";
    customSiteLabelInput.value = "";
    renderCustomSites();
    showStatus(`REGISTERED SITE: ${label.toUpperCase()}`);
    setTimeout(hideStatus, 2500);
  }

  addCustomSiteBtn.addEventListener("click", addCustomSite);

  customSiteInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") addCustomSite();
  });

  function renderCustomSites() {
    customSitesList.innerHTML = "";
    if (customSites.length === 0) {
      customSitesList.innerHTML = `<div class="custom-site-empty">NO CUSTOM TARGETS CONFIGURED.</div>`;
      return;
    }
    customSites.forEach((site, idx) => {
      const row = document.createElement("div");
      row.className = "custom-site-row";
      row.innerHTML = `
        <span class="custom-site-label" title="${escapeHtml(site.url)}">${escapeHtml(site.label)}</span>
        <span class="custom-site-url">${escapeHtml(new URL(site.url).hostname)}</span>
        <button class="custom-site-remove" title="Remove site" data-idx="${idx}">✕</button>
      `;
      row.querySelector(".custom-site-remove").addEventListener("click", async () => {
        customSites.splice(idx, 1);
        await chrome.storage.local.set({ customSites });
        renderCustomSites();
      });
      customSitesList.appendChild(row);
    });
  }

  // ── Keyword Search ──
  keywordSearch.addEventListener("input", (e) => {
    searchQuery = (e.target.value || "").trim().toLowerCase();
    if (searchQuery) {
      clearSearch.classList.remove("hidden");
    } else {
      clearSearch.classList.add("hidden");
    }
    renderItems();
  });

  clearSearch.addEventListener("click", () => {
    keywordSearch.value = "";
    searchQuery = "";
    clearSearch.classList.add("hidden");
    renderItems();
  });

  // ── Tab switching ──
  tabButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      tabButtons.forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".tab-pane").forEach(p => p.classList.remove("active"));
      btn.classList.add("active");
      const targetId = `tab-${btn.dataset.tab}`;
      document.getElementById(targetId)?.classList.add("active");
    });
  });

  // ── Source Filter pills ──
  filterPills.forEach(pill => {
    pill.addEventListener("click", () => {
      filterPills.forEach(p => p.classList.remove("active"));
      pill.classList.add("active");
      activeFilter = pill.dataset.filter;
      renderItems();
    });
  });

  // ── Robust Source Proof URL Resolver ──
  function resolveItemUrl(item) {
    if (!item) return "https://canvas.bham.ac.uk";

    const portalDefaults = {
      canvas: "https://canvas.bham.ac.uk",
      outlook: "https://outlook.office.com/mail/inbox",
      society: "https://www.guildofstudents.com/events",
      library: "https://intranet.birmingham.ac.uk/student/libraries/index.aspx",
      careers: "https://careersconnect.bham.ac.uk",
      myuob: "https://myuob.bham.ac.uk/dashboard/student-home"
    };

    let baseOrigin = portalDefaults[item.source] || "https://canvas.bham.ac.uk";
    if (item.source === "custom" && item.customSite) {
      baseOrigin = /^https?:\/\//i.test(item.customSite)
        ? item.customSite
        : `https://${item.customSite}`;
    }

    const rawUrl = item.url || item.link || null;
    if (!rawUrl || typeof rawUrl !== "string") {
      return baseOrigin;
    }

    let trimmed = rawUrl.trim();

    // Strip any invalid chrome-extension://<id>/ prefix if stored from earlier bug
    const extMatch = trimmed.match(/^chrome-extension:\/\/[a-z0-9]+\/(.*)$/i);
    if (extMatch) {
      trimmed = extMatch[1];
    }

    if (/^https?:\/\//i.test(trimmed)) {
      return trimmed;
    }

    try {
      const base = new URL(baseOrigin);
      const cleanPath = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
      return new URL(cleanPath, base.origin).href;
    } catch {
      return `${baseOrigin.replace(/\/+$/, "")}/${trimmed.replace(/^\/+/, "")}`;
    }
  }

  // ── Load Initial Stored State ──
  if (storedData.scrapedItems && storedData.scrapedItems.length > 0) {
    let modified = false;
    currentItems = storedData.scrapedItems.map(item => {
      const resolved = resolveItemUrl(item);
      if (item.url !== resolved) {
        modified = true;
        return { ...item, url: resolved };
      }
      return item;
    });

    if (modified) {
      chrome.storage.local.set({ scrapedItems: currentItems });
    }

    itemCount.innerText = currentItems.length;
    countAll.innerText = currentItems.length;
    renderItems();
  }
  if (storedData.lastDigest) {
    renderDigest(storedData.lastDigest);
  }
  if (storedData.lastCrawlTime) {
    const d = new Date(storedData.lastCrawlTime);
    lastUpdated.innerText = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }).toUpperCase();
  }

  // ── Due Date Formatter ──
  function formatDue(dateStr) {
    if (!dateStr) return null;
    const due = new Date(dateStr);
    if (isNaN(due.getTime())) return { label: dateStr.toUpperCase(), cls: "due-upcoming" };

    const now = Date.now();
    const diff = due.getTime() - now;
    const absDiff = Math.abs(diff);
    const hours = Math.floor(absDiff / (1000 * 60 * 60));
    const days = Math.floor(hours / 24);

    if (diff < 0) {
      return { label: `OVERDUE ${days > 0 ? days + "D" : hours + "H"}`, cls: "due-overdue" };
    }
    if (diff <= 48 * 60 * 60 * 1000) {
      return { label: `IN ${hours}H`, cls: "due-soon" };
    }
    return {
      label: due.toLocaleDateString("en-GB", { day: "numeric", month: "short" }).toUpperCase(),
      cls: "due-upcoming"
    };
  }

  function renderDigest(digest) {
    if (!digest) return;
    engineTag.innerText = `ENGINE: ${(digest.engine || "LOCAL AI").toUpperCase()}`;
    crunchSummary.innerText = digest.crunch_summary || "No active workload crunch detected.";

    topPrioritiesList.innerHTML = "";
    if (digest.top_priorities && digest.top_priorities.length > 0) {
      digest.top_priorities.forEach((item, idx) => {
        const div = document.createElement("div");
        div.className = "priority-item";

        // Find matching item in currentItems to get verified proof URL
        const matchedItem = currentItems.find(ci =>
          (ci.id && item.id && ci.id === item.id) ||
          (ci.title && item.title && ci.title.trim().toLowerCase() === item.title.trim().toLowerCase())
        );
        const priorityUrl = resolveItemUrl(matchedItem || item);

        div.innerHTML = `
          <div class="priority-header">
            <span class="priority-index">0${idx + 1}</span>
            <span class="priority-title">${escapeHtml(item.title)}</span>
            <span class="item-badge badge-${item.source || 'canvas'}">${(item.source || 'CANVAS').toUpperCase()}</span>
            <a class="priority-proof-btn" href="${escapeHtml(priorityUrl)}" title="Verify evidence: open source link" target="_blank" rel="noopener">
              PROOF ↗
            </a>
          </div>
          <div class="priority-reason">${escapeHtml(item.reason || "High urgency item requiring attention.")}</div>
        `;

        div.style.cursor = "pointer";
        div.title = `Verify evidence: click to open ${priorityUrl}`;
        div.addEventListener("click", (e) => {
          if (e.target.closest("button") || e.target.closest("a")) return;
          chrome.tabs.create({ url: priorityUrl });
        });

        const proofBtn = div.querySelector(".priority-proof-btn");
        if (proofBtn) {
          proofBtn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            chrome.tabs.create({ url: priorityUrl });
          });
        }

        topPrioritiesList.appendChild(div);
      });
    } else {
      topPrioritiesList.innerHTML = `<div class="empty-state">No immediate critical priorities identified.</div>`;
    }

    societyHighlights.innerText = digest.society_highlights || "Campus societies schedule is clear.";
  }

  // ── Render Items ──
  function renderItems() {
    itemsContainer.innerHTML = "";

    const filtered = currentItems.filter(item => {
      // Source filter
      if (activeFilter !== "all") {
        if (activeFilter === "library") {
          if (item.source !== "library" && item.source !== "careers") return false;
        } else if (activeFilter === "custom") {
          if (item.source !== "custom") return false;
        } else if (item.source !== activeFilter) {
          return false;
        }
      }

      // Keyword search
      if (searchQuery) {
        const title = (item.title || "").toLowerCase();
        const snippet = (item.snippet || "").toLowerCase();
        const sender = (item.sender || "").toLowerCase();
        const course = (item.course || "").toLowerCase();
        const site = (item.customSite || "").toLowerCase();
        return title.includes(searchQuery) ||
               snippet.includes(searchQuery) ||
               sender.includes(searchQuery) ||
               course.includes(searchQuery) ||
               site.includes(searchQuery);
      }
      return true;
    });

    itemCount.innerText = currentItems.length;
    countAll.innerText = currentItems.length;

    if (filtered.length === 0) {
      const msg = searchQuery
        ? `NO PORTAL ITEMS MATCHING "${escapeHtml(searchQuery).toUpperCase()}"`
        : `NO RECORDS FOUND IN CATEGORY: ${activeFilter.toUpperCase()}`;
      itemsContainer.innerHTML = `<div class="empty-state">${msg}</div>`;
      return;
    }

    filtered.forEach((item, idx) => {
      const card = document.createElement("div");
      card.className = "item-card";

      const targetUrl = resolveItemUrl(item);
      card.title = `Verify evidence: click to open ${targetUrl}`;
      card.style.cursor = "pointer";

      card.addEventListener("click", (e) => {
        if (e.target.closest("button") || e.target.closest("a")) return;
        chrome.tabs.create({ url: targetUrl });
      });

      // Urgency Pill
      let dueHtml = "";
      if (item.dueDate) {
        const dueInfo = formatDue(item.dueDate);
        if (dueInfo) {
          dueHtml = `<span class="due-tag ${dueInfo.cls}">${dueInfo.label}</span>`;
        }
      }

      // Course or Sender Meta
      const metaText = item.course || item.sender || item.customSite || "";

      // Matched Keywords chips
      const fullTextLower = `${item.title} ${item.snippet}`.toLowerCase();
      const matched = currentKeywords.filter(k => fullTextLower.includes(k.toLowerCase()));
      let kwChipsHtml = "";
      if (matched.length > 0) {
        const pills = matched.slice(0, 3).map(m => `<span class="kw-pill">#${escapeHtml(m.toUpperCase())}</span>`).join("");
        kwChipsHtml = `<div class="keywords-row">${pills}</div>`;
      }

      const badgeSource = item.source === "custom" ? "custom" : item.source;
      const badgeLabel = item.source === "custom"
        ? (item.customSite || "CUSTOM").toUpperCase()
        : (item.source || "").toUpperCase();

      card.innerHTML = `
        <div class="item-header">
          <span class="item-title">${escapeHtml(item.title)}</span>
          <div class="item-badges-group">
            ${dueHtml}
            <span class="item-badge badge-${badgeSource}">${badgeLabel}</span>
          </div>
        </div>
        ${metaText ? `<div class="item-meta-row"><span class="meta-course">${escapeHtml(metaText.toUpperCase())}</span></div>` : ""}
        <div class="item-snippet">${escapeHtml(item.snippet || "No additional excerpt available.")}</div>
        <div class="item-footer-row">
          ${kwChipsHtml || '<div></div>'}
          <a class="proof-link" href="${escapeHtml(targetUrl)}" title="Open original link to proof this record" target="_blank" rel="noopener">
            PROOF ↗
          </a>
        </div>
      `;

      const proofBtn = card.querySelector(".proof-link");
      if (proofBtn) {
        proofBtn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          chrome.tabs.create({ url: targetUrl });
        });
      }

      itemsContainer.appendChild(card);
    });
  }

  function showStatus(text, isError = false) {
    statusBar.classList.remove("hidden");
    statusBar.innerText = text;
    statusBar.style.background = isError ? "rgba(225, 29, 72, 0.15)" : "rgba(255, 255, 255, 0.08)";
    statusBar.style.color = isError ? "#f87171" : "#e5e5e5";
    statusBar.style.borderColor = isError ? "rgba(225, 29, 72, 0.4)" : "rgba(255, 255, 255, 0.2)";
  }

  function hideStatus() {
    statusBar.classList.add("hidden");
  }

  // ── Handle Sync & Crawl Across All Portals ──
  btnSync.addEventListener("click", async () => {
    btnSync.disabled = true;
    statusBadge.className = "status-badge crawling";
    statusBadge.innerText = "CRAWLING";
    const siteCount = customSites.length > 0 ? ` + ${customSites.length} CUSTOM TARGETS` : "";
    showStatus(`SCANNING CANVAS, OUTLOOK, MYUOB, GUILD${siteCount}...`);

    try {
      chrome.runtime.sendMessage({ action: "start_crawl" }, async (response) => {
        if (chrome.runtime.lastError) {
          showStatus(`SCAN FAULT: ${chrome.runtime.lastError.message.toUpperCase()}`, true);
          statusBadge.className = "status-badge ready";
          statusBadge.innerText = "READY";
          btnSync.disabled = false;
          return;
        }

        if (!response || !response.success) {
          showStatus("SCAN COMPLETED WITH WARNINGS. CHECK TAB LOGS.", true);
          statusBadge.className = "status-badge ready";
          statusBadge.innerText = "READY";
          btnSync.disabled = false;
          return;
        }

        const rawItems = response.items || [];
        const items = rawItems.map(item => ({
          ...item,
          url: resolveItemUrl(item)
        }));
        currentItems = items;
        renderItems();

        showStatus(`SYNTHESIZING ${items.length} ITEMS VIA LOCAL GEMMA 4...`);
        const digest = await window.generateSmartDigest(items, currentKeywords);
        renderDigest(digest);

        await chrome.storage.local.set({
          scrapedItems: currentItems,
          lastDigest: digest,
          lastCrawlTime: new Date().toISOString()
        });

        lastUpdated.innerText = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }).toUpperCase();
        showStatus(`COMPLETE / ${items.length} ITEMS PROCESSED BY ${digest.model || "GEMMA 4"}`);
        setTimeout(hideStatus, 4000);

        statusBadge.className = "status-badge ready";
        statusBadge.innerText = "READY";
        btnSync.disabled = false;
      });
    } catch (err) {
      showStatus(`ORCHESTRATOR ERROR: ${err.message.toUpperCase()}`, true);
      btnSync.disabled = false;
      statusBadge.className = "status-badge ready";
    }
  });

  // ── Handle Clear All Data (Purge) ──
  btnClear.addEventListener("click", async () => {
    if (confirm("Purge all stored portal data and start completely fresh?")) {
      await chrome.storage.local.remove(["scrapedItems", "lastDigest", "lastCrawlTime"]);
      currentItems = [];
      itemCount.innerText = "0";
      countAll.innerText = "0";
      lastUpdated.innerText = "NEVER UPDATED";
      engineTag.innerText = "ENGINE: CLEARED";
      crunchSummary.innerText = "Data purged. Click 'SYNC & ANALYZE ALL PORTALS' to initiate fresh extraction.";
      topPrioritiesList.innerHTML = `<div class="empty-state">No priorities yet. Run Sync to analyze.</div>`;
      societyHighlights.innerText = "Campus highlights will appear after synchronization.";
      renderItems();
      showStatus("ALL LOCAL CACHE PURGED");
      setTimeout(hideStatus, 3000);
    }
  });

  chrome.runtime.onMessage.addListener((request) => {
    if (request.action === "crawl_status") {
      showStatus(request.message.toUpperCase());
    }
  });

  function escapeHtml(str) {
    if (!str) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
});
