const byId = id => document.getElementById(id);

function setText(id, value, fallback = "—") {
  byId(id).textContent = value || fallback;
}

function render(result) {
  byId("empty").hidden = Boolean(result);
  byId("result").hidden = !result;
  if (!result) return;

  setText("subject", result.subject);
  setText("received", result.receivedDateTime);
  setText("sender", [
    result.sender?.displayName,
    result.sender?.emailAddress,
    result.sender?.visibleText
  ].filter(Boolean).join(" · "));
  setText("cc", (result.cc || []).map(person =>
    [person.displayName, ...(person.emailAddresses || []), person.visibleText]
      .filter(Boolean)
      .join(" · ")
  ).join("\n"));
  setText("body", result.body, "No message body was confidently identified.");
  setText(
    "extracted-at",
    result.extractedAt ? new Date(result.extractedAt).toLocaleString() : ""
  );

  const pageLink = byId("page-link");
  pageLink.href = result.pageUrl || "https://outlook.cloud.microsoft";

  const attachments = result.attachments || [];
  byId("attachment-count").textContent = String(attachments.length);
  byId("no-attachments").hidden = attachments.length > 0;
  const list = byId("attachments");
  list.replaceChildren(...attachments.map(attachment => {
    const item = document.createElement("li");
    item.className = "attachment";
    const name = document.createElement("span");
    name.className = "attachment-name";
    name.textContent = attachment.name || "Unnamed attachment";
    item.append(name);
    if (attachment.metadata && attachment.metadata !== attachment.name) {
      const metadata = document.createElement("span");
      metadata.className = "attachment-meta";
      metadata.textContent = attachment.metadata;
      item.append(metadata);
    }
    return item;
  }));

  byId("diagnostics").textContent = JSON.stringify({
    otherVisibleMetadata: result.otherVisibleMetadata,
    selectorsUsed: result.diagnostics?.selectorsUsed,
    bodyCandidates: result.diagnostics?.bodyCandidates,
    visibleText: result.diagnostics?.visibleText
  }, null, 2);
}

async function loadLatest() {
  try {
    const { latestExtraction } = await chrome.storage.local.get("latestExtraction");
    render(latestExtraction || null);
  } catch (error) {
    console.error("Could not load the latest extraction", error);
    byId("empty").hidden = false;
    byId("empty").querySelector("p").textContent =
      "Could not read saved extraction data. Check the extension's storage permission.";
  }
}

byId("refresh").addEventListener("click", loadLatest);
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes.latestExtraction) {
    render(changes.latestExtraction.newValue || null);
  }
});

loadLatest();
