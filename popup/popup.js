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
  const btnDemo = document.getElementById("btnDemo");
  const btnExport = document.getElementById("btnExport");
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

  // ── Black / Dark Mode Theme Setup ──
  const storedData = await chrome.storage.local.get([
    "darkMode", "keywords", "scrapedItems", "lastDigest", "lastCrawlTime", "customSites"
  ]);

  if (storedData.darkMode) {
    document.body.classList.add("dark-mode");
    themeIcon.innerText = "☀️";
  } else {
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
      chip.innerHTML = `${escapeHtml(kw)} <button aria-label="Remove ${escapeHtml(kw)}" title="Remove keyword">×</button>`;
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
      showStatus(`Added ${presetName} keyword preset!`);
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
      showStatus("Invalid URL. Please enter a valid website address (e.g. https://example.com)", true);
      return;
    }
    const label = (customSiteLabelInput.value || "").trim() ||
                  new URL(url).hostname;

    if (customSites.some(s => s.url === url)) {
      showStatus("This website is already in your custom sites list.", true);
      return;
    }

    customSites.push({ url, label });
    await chrome.storage.local.set({ customSites });
    customSiteInput.value = "";
    customSiteLabelInput.value = "";
    renderCustomSites();
    showStatus(`Added "${label}" to custom crawl sites!`);
    setTimeout(hideStatus, 2500);
  }

  addCustomSiteBtn.addEventListener("click", addCustomSite);

  customSiteInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") addCustomSite();
  });

  function renderCustomSites() {
    customSitesList.innerHTML = "";
    if (customSites.length === 0) {
      customSitesList.innerHTML = `<div class="custom-site-empty">No custom sites added yet.</div>`;
      return;
    }
    customSites.forEach((site, idx) => {
      const row = document.createElement("div");
      row.className = "custom-site-row";
      row.innerHTML = `
        <span class="custom-site-label" title="${escapeHtml(site.url)}">${escapeHtml(site.label)}</span>
        <span class="custom-site-url">${escapeHtml(new URL(site.url).hostname)}</span>
        <button class="custom-site-remove" title="Remove site" data-idx="${idx}">×</button>
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

  // ── Load Initial Stored State ──
  if (storedData.scrapedItems && storedData.scrapedItems.length > 0) {
    currentItems = storedData.scrapedItems;
    itemCount.innerText = currentItems.length;
    countAll.innerText = currentItems.length;
    renderItems();
  }
  if (storedData.lastDigest) {
    renderDigest(storedData.lastDigest);
  }
  if (storedData.lastCrawlTime) {
    const d = new Date(storedData.lastCrawlTime);
    lastUpdated.innerText = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  // ── Due Date Formatter ──
  function formatDue(dateStr) {
    if (!dateStr) return null;
    const due = new Date(dateStr);
    if (isNaN(due.getTime())) return { label: dateStr, cls: "due-upcoming" };

    const now = Date.now();
    const diff = due.getTime() - now;
    const absDiff = Math.abs(diff);
    const hours = Math.floor(absDiff / (1000 * 60 * 60));
    const days = Math.floor(hours / 24);

    if (diff < 0) {
      return { label: `Overdue ${days > 0 ? days + "d ago" : hours + "h ago"}`, cls: "due-overdue" };
    }
    if (diff <= 48 * 60 * 60 * 1000) {
      return { label: `Due in ${hours}h`, cls: "due-soon" };
    }
    return {
      label: `Due ${due.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`,
      cls: "due-upcoming"
    };
  }

  function renderDigest(digest) {
    if (!digest) return;
    engineTag.innerText = digest.engine || "AI Analyzed";
    crunchSummary.innerText = digest.crunch_summary || "No crunch summary available.";

    topPrioritiesList.innerHTML = "";
    if (digest.top_priorities && digest.top_priorities.length > 0) {
      digest.top_priorities.forEach((item, idx) => {
        const div = document.createElement("div");
        div.className = "priority-item";
        div.innerHTML = `
          <div class="priority-header">
            <span class="priority-title">#${idx + 1} ${escapeHtml(item.title)}</span>
            <span class="item-badge badge-${item.source || 'canvas'}">${item.source || 'Canvas'}</span>
          </div>
          <div class="priority-reason">${escapeHtml(item.reason || "Urgent task")}</div>
        `;
        topPrioritiesList.appendChild(div);
      });
    } else {
      topPrioritiesList.innerHTML = `<div class="empty-state">No pressing priorities found!</div>`;
    }

    societyHighlights.innerText = digest.society_highlights || "Check out campus society events!";
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
        ? `No portal items found matching "${escapeHtml(searchQuery)}"`
        : `No items found for category: ${activeFilter}`;
      itemsContainer.innerHTML = `<div class="empty-state">${msg}</div>`;
      return;
    }

    filtered.forEach(item => {
      const card = document.createElement("div");
      card.className = "item-card";

      // FIX: use item.url (the canonical field), with item.link as a fallback for old data
      const itemUrl = item.url || item.link || null;
      card.title = itemUrl ? "Click to open in browser" : "";

      if (itemUrl) {
        card.addEventListener("click", () => {
          chrome.tabs.create({ url: itemUrl });
        });
      }

      // Urgency Pill
      let dueHtml = "";
      if (item.dueDate) {
        const dueInfo = formatDue(item.dueDate);
        if (dueInfo) {
          dueHtml = `<span class="due-tag ${dueInfo.cls}">${dueInfo.label}</span>`;
        }
      }

      // Course or Sender Meta — for custom sites show the hostname
      const metaText = item.course || item.sender || item.customSite || "";

      // Matched Keywords chips
      const fullTextLower = `${item.title} ${item.snippet}`.toLowerCase();
      const matched = currentKeywords.filter(k => fullTextLower.includes(k.toLowerCase()));
      let kwChipsHtml = "";
      if (matched.length > 0) {
        const pills = matched.slice(0, 3).map(m => `<span class="kw-pill">#${escapeHtml(m)}</span>`).join("");
        kwChipsHtml = `<div class="keywords-row">${pills}</div>`;
      }

      // Badge label: for custom items show domain
      const badgeSource = item.source === "custom" ? "custom" : item.source;
      const badgeLabel = item.source === "custom"
        ? (item.customSite || "custom")
        : item.source;

      card.innerHTML = `
        <div class="item-header">
          <span class="item-title">${escapeHtml(item.title)}</span>
          <div class="item-badges-group">
            ${dueHtml}
            <span class="item-badge badge-${badgeSource}">${badgeLabel}</span>
          </div>
        </div>
        ${metaText ? `<div class="item-meta-row"><span class="meta-course">${escapeHtml(metaText)}</span></div>` : ""}
        <div class="item-snippet">${escapeHtml(item.snippet || "No description provided.")}</div>
        ${kwChipsHtml}
      `;

      itemsContainer.appendChild(card);
    });
  }

  function showStatus(text, isError = false) {
    statusBar.classList.remove("hidden");
    statusBar.innerText = text;
    statusBar.style.background = isError ? "rgba(239, 68, 68, 0.2)" : "rgba(234, 179, 8, 0.2)";
    statusBar.style.color = isError ? "#f87171" : "#fef08a";
  }

  function hideStatus() {
    statusBar.classList.add("hidden");
  }

  // ── Handle Sync & Crawl Across All Portals ──
  btnSync.addEventListener("click", async () => {
    btnSync.disabled = true;
    statusBadge.className = "status-badge crawling";
    statusBadge.innerText = "Syncing...";
    const siteCount = customSites.length > 0 ? `, ${customSites.length} custom site(s)` : "";
    showStatus(`Crawling Canvas, Outlook, MyUoB, Guild, Library${siteCount}...`);

    try {
      chrome.runtime.sendMessage({ action: "start_crawl" }, async (response) => {
        if (chrome.runtime.lastError) {
          showStatus(`Crawl error: ${chrome.runtime.lastError.message}`, true);
          statusBadge.className = "status-badge ready";
          statusBadge.innerText = "Ready";
          btnSync.disabled = false;
          return;
        }

        if (!response || !response.success) {
          showStatus("Crawl completed with warnings. Use 'Demo Data' for offline preview.", true);
          statusBadge.className = "status-badge ready";
          statusBadge.innerText = "Ready";
          btnSync.disabled = false;
          return;
        }

        const items = response.items || [];
        currentItems = items;
        renderItems();

        showStatus(`Analyzing ${items.length} items with Gemma 4 AI...`);
        const digest = await window.generateSmartDigest(items, currentKeywords);
        renderDigest(digest);

        await chrome.storage.local.set({
          scrapedItems: currentItems,
          lastDigest: digest,
          lastCrawlTime: new Date().toISOString()
        });

        lastUpdated.innerText = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        showStatus(`Done! Analyzed ${items.length} items with ${digest.model || "Gemma 4"}.`);
        setTimeout(hideStatus, 4000);

        statusBadge.className = "status-badge ready";
        statusBadge.innerText = "Ready";
        btnSync.disabled = false;
      });
    } catch (err) {
      showStatus(`Error during crawl: ${err.message}`, true);
      btnSync.disabled = false;
      statusBadge.className = "status-badge ready";
    }
  });

  // ── Handle Demo Mode ──
  btnDemo.addEventListener("click", async () => {
    showStatus("Loading demo items & analyzing with Gemma 4 (12B)...");
    currentItems = window.SAMPLE_UOB_DATA;
    renderItems();

    const digest = await window.generateSmartDigest(currentItems, currentKeywords);
    renderDigest(digest);

    await chrome.storage.local.set({
      scrapedItems: currentItems,
      lastDigest: digest,
      lastCrawlTime: new Date().toISOString()
    });

    lastUpdated.innerText = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    showStatus(`Loaded ${currentItems.length} items and analyzed with ${digest.model || "Gemma 4"}!`);
    setTimeout(hideStatus, 3000);
  });

  // ── Handle Clear All Data ──
  btnClear.addEventListener("click", async () => {
    if (confirm("Delete all stored crawled items and start completely fresh?")) {
      await chrome.storage.local.remove(["scrapedItems", "lastDigest", "lastCrawlTime"]);
      currentItems = [];
      itemCount.innerText = "0";
      countAll.innerText = "0";
      lastUpdated.innerText = "Never";
      engineTag.innerText = "Cleared";
      crunchSummary.innerText = "All data cleared. Click 'Sync & Analyze All Portals' to crawl fresh items from your open tabs.";
      topPrioritiesList.innerHTML = `<div class="empty-state">No priorities yet. Start a fresh crawl!</div>`;
      societyHighlights.innerText = "Social events will appear here after fresh crawl.";
      renderItems();
      showStatus("All stored data cleared! Ready for fresh crawl.");
      setTimeout(hideStatus, 3000);
    }
  });

  // ── Handle Export JSON ──
  btnExport.addEventListener("click", () => {
    if (currentItems.length === 0) {
      alert("No data available to export. Click Sync or Demo first!");
      return;
    }
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(currentItems, null, 2));
    const downloadAnchor = document.createElement("a");
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", "uob-student-portal-data.json");
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  });

  chrome.runtime.onMessage.addListener((request) => {
    if (request.action === "crawl_status") {
      showStatus(request.message);
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
