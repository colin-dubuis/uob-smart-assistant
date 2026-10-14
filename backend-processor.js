const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const DATA_DIR = path.join(os.homedir(), "Downloads", "uni-scraper-data");
const LM_STUDIO_URL = "http://localhost:1234/v1/chat/completions";
const SOURCE_FILES = [
  ["outlook", "outlook.json"],
  ["canvas", "canvas.json"],
  ["society", "societies.json"]
];

const SYSTEM_PROMPT =
  "You are an elite academic assistant. Analyze the provided student JSON data (Canvas deadlines, Outlook emails, society events) for the upcoming week. Output a concise JSON response containing: 1) 'crunch_summary': A 2-sentence overview of the busiest days, 2) 'top_priorities': An array of the top 3 critical items needing immediate attention, 3) 'society_highlights': A fun 1-sentence summary of upcoming social events.";

function recordsFrom(data) {
  if (Array.isArray(data)) {
    return data.flatMap(recordsFrom);
  }

  if (!data || typeof data !== "object") {
    return [];
  }

  for (const key of ["items", "data", "messages", "events", "assignments", "announcements"]) {
    if (Array.isArray(data[key])) {
      return data[key].flatMap(recordsFrom);
    }
  }

  return [data];
}

function textValue(...values) {
  const value = values.find(candidate => typeof candidate === "string" && candidate.trim());
  return value ? value.trim() : "";
}

function parseDate(value) {
  if (typeof value !== "string" && typeof value !== "number" && !(value instanceof Date)) {
    return null;
  }

  const dateText = String(value).trim();
  if (!dateText) return null;

  let date;
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateText);
  if (dateOnly) {
    date = new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]));
    if (
      date.getFullYear() !== Number(dateOnly[1]) ||
      date.getMonth() !== Number(dateOnly[2]) - 1 ||
      date.getDate() !== Number(dateOnly[3])
    ) {
      return null;
    }
  } else {
    date = new Date(value);
  }

  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function getDueDate(item) {
  return parseDate(
    item.dueDate ??
    item.due_date ??
    item.deadline ??
    item.date ??
    item.startDate ??
    item.start_date
  );
}

function normalizeItem(item, source, index) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;

  const rawId = item.id ?? item._id;
  return {
    id: typeof rawId === "string" || typeof rawId === "number"
      ? String(rawId)
      : `${source}-${index + 1}`,
    title: textValue(item.title, item.subject, item.name) || "Untitled",
    source,
    dueDate: getDueDate(item),
    snippet: textValue(item.snippet, item.description, item.body, item.content, item.text, item.preview)
  };
}

function startOfLocalDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

async function loadAndMergeData(dataDir = DATA_DIR, now = new Date()) {
  const items = [];

  for (const [source, fileName] of SOURCE_FILES) {
    const filePath = path.join(dataDir, fileName);
    let raw;

    try {
      raw = await fs.readFile(filePath, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw new Error(`Could not read ${filePath}: ${error.message}`, { cause: error });
    }

    let data;
    try {
      data = JSON.parse(raw);
    } catch (error) {
      throw new Error(`Could not parse ${filePath}: ${error.message}`, { cause: error });
    }

    recordsFrom(data).forEach((record, index) => {
      const item = normalizeItem(record, source, index);
      if (item) items.push(item);
    });
  }

  const today = startOfLocalDay(now);
  return items
    .filter(item => !item.dueDate || new Date(item.dueDate).getTime() >= today)
    .sort((a, b) => {
      if (!a.dueDate) return b.dueDate ? 1 : 0;
      if (!b.dueDate) return -1;
      return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
    });
}

async function generateSmartDigest(mergedData, fetchImpl = globalThis.fetch) {
  if (!Array.isArray(mergedData)) {
    throw new TypeError("generateSmartDigest expects an array of normalized items.");
  }
  if (typeof fetchImpl !== "function") {
    throw new Error("This Node.js version does not provide fetch; use Node.js 18 or newer.");
  }

  const today = startOfLocalDay(new Date());
  const urgentItems = mergedData
    .filter(item => item && (!item.dueDate || new Date(item.dueDate).getTime() >= today))
    .slice()
    .sort((a, b) => {
      if (!a.dueDate) return b.dueDate ? 1 : 0;
      if (!b.dueDate) return -1;
      return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
    })
    .slice(0, 12)
    .map(({ id, title, source, dueDate, snippet }) => ({ id, title, source, dueDate, snippet }));

  const payload = {
    model: "local-model",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: JSON.stringify(urgentItems) }
    ],
    temperature: 0.3,
    response_format: { type: "json_object" }
  };

  const response = await fetchImpl(LM_STUDIO_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer not-needed"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(`LM Studio returned HTTP ${response.status}: ${responseText}`);
  }

  const result = await response.json();
  const content = result?.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new Error("LM Studio response did not contain choices[0].message.content.");
  }

  try {
    return JSON.parse(content);
  } catch (error) {
    throw new Error(`LM Studio returned invalid JSON: ${error.message}`, { cause: error });
  }
}

async function run() {
  const items = await loadAndMergeData();
  const digest = await generateSmartDigest(items);
  console.log("AI Student Dashboard Digest:", JSON.stringify(digest, null, 2));
}

if (require.main === module) {
  run().catch(error => {
    console.error("Could not generate the student digest:", error);
    process.exitCode = 1;
  });
}

module.exports = { DATA_DIR, loadAndMergeData, generateSmartDigest };
