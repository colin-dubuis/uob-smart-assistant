document.addEventListener("DOMContentLoaded", async () => {
  // Elements
  const statusBadge = document.getElementById("statusBadge");
  const statusBar = document.getElementById("statusBar");
  const btnSync = document.getElementById("btnSync");
  const btnDemo = document.getElementById("btnDemo");
  const btnExport = document.getElementById("btnExport");
  const tabButtons = document.querySelectorAll(".tab-btn");
  const filterPills = document.querySelectorAll(".filter-pill");
  const itemCount = document.getElementById("itemCount");
  const engineTag = document.getElementById("engineTag");
  const crunchSummary = document.getElementById("crunchSummary");
  const topPrioritiesList = document.getElementById("topPrioritiesList");
  const societyHighlights = document.getElementById("societyHighlights");
  const itemsContainer = document.getElementById("itemsContainer");
  const lastUpdated = document.getElementById("lastUpdated");

  let currentItems = [];
  let activeFilter = "all";

  // Tab switching
  tabButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      tabButtons.forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".tab-pane").forEach(p => p.classList.remove("active"));
      btn.classList.add("active");
      const targetId = `tab-${btn.dataset.tab}`;
      document.getElementById(targetId)?.classList.add("active");
    });
  });

  // Filter pills
  filterPills.forEach(pill => {
    pill.addEventListener("click", () => {
      filterPills.forEach(p => p.classList.remove("active"));
      pill.classList.add("active");
      activeFilter = pill.dataset.filter;
      renderItems();
    });
  });

  // Load existing data from storage
  await loadStoredData();

  async function loadStoredData() {
    try {
      const data = await chrome.storage.local.get(["scrapedItems", "lastDigest", "lastCrawlTime"]);
      if (data.scrapedItems && data.scrapedItems.length > 0) {
        currentItems = data.scrapedItems;
        itemCount.innerText = currentItems.length;
        renderItems();
      }
      if (data.lastDigest) {
        renderDigest(data.lastDigest);
      }
      if (data.lastCrawlTime) {
        const d = new Date(data.lastCrawlTime);
        lastUpdated.innerText = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      }
    } catch (e) {
      console.warn("Storage load error:", e);
    }
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

  function renderItems() {
    itemsContainer.innerHTML = "";
    const filtered = currentItems.filter(item => {
      if (activeFilter === "all") return true;
      return item.source === activeFilter;
    });

    if (filtered.length === 0) {
      itemsContainer.innerHTML = `<div class="empty-state">No items for source: ${activeFilter}</div>`;
      return;
    }

    filtered.forEach(item => {
      const card = document.createElement("div");
      card.className = "item-card";
      const dueStr = item.dueDate ? `Due: ${new Date(item.dueDate).toLocaleString()}` : (item.date ? `Date: ${item.date}` : "");
      card.innerHTML = `
        <div class="item-header">
          <span class="item-title">${escapeHtml(item.title)}</span>
          <span class="item-badge badge-${item.source}">${item.source}</span>
        </div>
        <div class="item-snippet">${escapeHtml(item.snippet || "No description")}</div>
        ${dueStr ? `<div class="item-meta">🕒 ${escapeHtml(dueStr)}</div>` : ""}
      `;
      itemsContainer.appendChild(card);
    });
  }

  function showStatus(text, isError = false) {
    statusBar.classList.remove("hidden");
    statusBar.innerText = text;
    statusBar.style.background = isError ? "#fee2e2" : "#fef9c3";
    statusBar.style.color = isError ? "#991b1b" : "#713f12";
  }

  function hideStatus() {
    statusBar.classList.add("hidden");
  }

  // Handle Sync & Crawl
  btnSync.addEventListener("click", async () => {
    btnSync.disabled = true;
    statusBadge.className = "status-badge crawling";
    statusBadge.innerText = "Syncing...";
    showStatus("Opening tabs and crawling Canvas, Outlook, and Societies...");

    try {
      chrome.runtime.sendMessage({ action: "start_crawl" }, async (response) => {
        if (!response || !response.success) {
          showStatus("Crawl finished with warnings or empty data. Tip: Use 'Demo Data' for testing.", true);
          statusBadge.className = "status-badge ready";
          statusBadge.innerText = "Ready";
          btnSync.disabled = false;
          return;
        }

        const items = response.items || [];
        currentItems = items;
        itemCount.innerText = currentItems.length;
        renderItems();

        showStatus("Analyzing with AI / Priority Engine...");
        const digest = await window.generateSmartDigest(items);
        renderDigest(digest);

        await chrome.storage.local.set({
          scrapedItems: currentItems,
          lastDigest: digest,
          lastCrawlTime: new Date().toISOString()
        });

        lastUpdated.innerText = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        showStatus(`Done! Analyzed ${items.length} items successfully.`);
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

  // Handle Demo Mode (1-click presentation data)
  btnDemo.addEventListener("click", async () => {
    showStatus("Loading UoB sample data & generating AI digest...");
    currentItems = window.SAMPLE_UOB_DATA;
    itemCount.innerText = currentItems.length;
    renderItems();

    const digest = await window.generateSmartDigest(currentItems);
    renderDigest(digest);

    await chrome.storage.local.set({
      scrapedItems: currentItems,
      lastDigest: digest,
      lastCrawlTime: new Date().toISOString()
    });

    lastUpdated.innerText = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    showStatus("Sample UoB student data loaded and analyzed!");
    setTimeout(hideStatus, 3000);
  });

  // Handle Export JSON
  btnExport.addEventListener("click", () => {
    if (currentItems.length === 0) {
      alert("No data available to export. Click Sync or Demo first!");
      return;
    }
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(currentItems, null, 2));
    const downloadAnchor = document.createElement("a");
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", "uob-student-data.json");
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  });

  // Listen for background progress messages
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
