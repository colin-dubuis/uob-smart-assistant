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

  let currentItems = [];
  let activeFilter = "all";
  let searchQuery = "";
  let currentKeywords = [...DEFAULT_KEYWORDS];

  // ── Black / Dark Mode Theme Setup ──
  const storedData = await chrome.storage.local.get(["darkMode", "keywords", "scrapedItems", "lastDigest", "lastCrawlTime"]);

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

  // ── Joule's Due Date Formatter ──
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

  // ── Render Items (Longer List with Rich Portal Cards) ──
  function renderItems() {
    itemsContainer.innerHTML = "";

    const filtered = currentItems.filter(item => {
      // Source filter
      if (activeFilter !== "all") {
        if (activeFilter === "library") {
          if (item.source !== "library" && item.source !== "careers") return false;
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
        return title.includes(searchQuery) ||
               snippet.includes(searchQuery) ||
               sender.includes(searchQuery) ||
               course.includes(searchQuery);
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
      card.title = item.url ? "Click to open portal item" : "";

      if (item.url) {
        card.addEventListener("click", () => {
          chrome.tabs.create({ url: item.url });
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

      // Course or Sender Meta
      const metaText = item.course || item.sender || "";

      // Matched Keywords chips
      const fullTextLower = `${item.title} ${item.snippet}`.toLowerCase();
      const matched = currentKeywords.filter(k => fullTextLower.includes(k.toLowerCase()));
      let kwChipsHtml = "";
      if (matched.length > 0) {
        const pills = matched.slice(0, 3).map(m => `<span class="kw-pill">#${escapeHtml(m)}</span>`).join("");
        kwChipsHtml = `<div class="keywords-row">${pills}</div>`;
      }

      card.innerHTML = `
        <div class="item-header">
          <span class="item-title">${escapeHtml(item.title)}</span>
          <div class="item-badges-group">
            ${dueHtml}
            <span class="item-badge badge-${item.source}">${item.source}</span>
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
    showStatus("Opening tabs and crawling Canvas, Outlook, MyUoB, Guild & Library...");

    try {
      chrome.runtime.sendMessage({ action: "start_crawl" }, async (response) => {
        if (!response || !response.success) {
          showStatus("Crawl complete with warnings. Tip: Use 'Demo Data' for offline presentation.", true);
          statusBadge.className = "status-badge ready";
          statusBadge.innerText = "Ready";
          btnSync.disabled = false;
          return;
        }

        const items = response.items || [];
        currentItems = items;
        renderItems();

        showStatus("Analyzing with Bonsai-27B AI model...");
        const digest = await window.generateSmartDigest(items, currentKeywords);
        renderDigest(digest);

        await chrome.storage.local.set({
          scrapedItems: currentItems,
          lastDigest: digest,
          lastCrawlTime: new Date().toISOString()
        });

        lastUpdated.innerText = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        showStatus(`Done! Analyzed ${items.length} items across student portals.`);
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

  // ── Handle Demo Mode (14 Multi-Portal Items) ──
  btnDemo.addEventListener("click", async () => {
    showStatus("Loading 14 multi-portal Birmingham items & analyzing with Bonsai-27B...");
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
    showStatus(`Loaded 14 items from Canvas, Outlook, MyUoB, Guild & Library!`);
    setTimeout(hideStatus, 3000);
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
