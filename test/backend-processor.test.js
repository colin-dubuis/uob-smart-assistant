const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { loadAndMergeData, generateSmartDigest } = require("../backend-processor");

test("loads and normalizes source files, removes past items, and sorts dates", async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "uni-scraper-data-"));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));

  await fs.writeFile(path.join(dataDir, "outlook.json"), JSON.stringify({
    subject: "Email subject",
    body: "Email body",
    receivedDateTime: "2026-10-14T16:05:16.672Z"
  }));
  await fs.writeFile(path.join(dataDir, "canvas.json"), JSON.stringify([
    { id: 42, title: "Past deadline", dueDate: "2020-01-01" },
    { title: "Soon", due_date: "2026-10-15", description: "Assignment details" }
  ]));
  await fs.writeFile(path.join(dataDir, "societies.json"), JSON.stringify({
    events: [{ name: "Society event", date: "2026-10-16" }]
  }));

  const items = await loadAndMergeData(dataDir, new Date(2026, 9, 14, 12));
  assert.deepEqual(items.map(item => [item.title, item.source]), [
    ["Soon", "canvas"],
    ["Society event", "society"],
    ["Email subject", "outlook"]
  ]);
  assert.equal(items[2].dueDate, null);
  assert.equal(items[2].snippet, "Email body");
  assert.equal(items[0].dueDate, new Date(2026, 9, 15).toISOString());
  assert.equal(items[1].id, "society-1");
});

test("reports malformed JSON with its source path", async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "uni-scraper-data-"));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  await fs.writeFile(path.join(dataDir, "outlook.json"), "{");

  await assert.rejects(loadAndMergeData(dataDir), /Could not parse .*outlook\.json/);
});

test("sends at most 12 upcoming normalized items and parses the digest response", async () => {
  let requestUrl;
  let requestOptions;
  const items = Array.from({ length: 14 }, (_, index) => ({
    id: String(index),
    title: `Item ${index}`,
    source: index === 0 ? "society" : "canvas",
    dueDate: new Date(Date.now() + (index + 1) * 60_000).toISOString(),
    snippet: ""
  }));
  const digest = {
    crunch_summary: "Two busy days. Plan ahead.",
    top_priorities: ["Item 0"],
    society_highlights: "A fun event is coming."
  };

  const result = await generateSmartDigest(items, async (url, options) => {
    requestUrl = url;
    requestOptions = options;
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: JSON.stringify(digest) } }] })
    };
  });

  assert.deepEqual(result, digest);
  assert.equal(requestUrl, "http://localhost:1234/v1/chat/completions");
  assert.equal(requestOptions.headers.Authorization, "Bearer not-needed");
  const sentPayload = JSON.parse(requestOptions.body);
  assert.equal(JSON.parse(sentPayload.messages[1].content).length, 12);
  assert.match(sentPayload.messages[0].content, /crunch_summary/);
});
