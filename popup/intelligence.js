const LM_STUDIO_URL = "http://localhost:1234/v1/chat/completions";
const MODEL_NAME = "prism-ml/bonsai-27b";

const SYSTEM_PROMPT = `You are an elite academic AI assistant for University of Birmingham students.
Analyze the provided student items (Canvas deadlines, Outlook emails, Guild society events).
Output ONLY valid JSON containing:
1) "crunch_summary": A concise 2-sentence overview of the busiest days and workload pressure.
2) "top_priorities": An array of the top 3 most critical items needing immediate attention. Each must have { "id", "title", "reason", "source" }.
3) "society_highlights": A fun 1-sentence recommendation for upcoming social events to maintain work-life balance.`;

function calculateUrgencyScore(item, customKeywords = []) {
  let score = 0;
  const now = new Date().getTime();
  const title = (item.title || "").toLowerCase();
  const snippet = (item.snippet || "").toLowerCase();

  // Due date scoring
  if (item.dueDate) {
    const due = new Date(item.dueDate).getTime();
    const diffHours = (due - now) / (1000 * 60 * 60);

    if (diffHours < 0) {
      score += 5; // Past / today
    } else if (diffHours <= 24) {
      score += 100; // Immediate 24h
    } else if (diffHours <= 72) {
      score += 70; // Next 3 days
    } else if (diffHours <= 168) {
      score += 40; // This week
    } else {
      score += 15;
    }
  }

  // Base urgency keywords + custom user search keywords
  const urgentKeywords = [
    "urgent", "deadline", "due", "submission", "exam", "test", "quiz",
    "coursework", "mandatory", "required", "action required", "important",
    ...customKeywords.map(k => k.toLowerCase())
  ];

  for (const kw of urgentKeywords) {
    if (!kw) continue;
    if (title.includes(kw) || snippet.includes(kw)) {
      score += 40;
      break;
    }
  }

  if (item.source === "canvas") score += 20;
  if (item.source === "outlook" && (title.includes("grade") || title.includes("meeting") || item.isUrgent)) score += 25;

  return score;
}

function cleanJsonResponse(rawText) {
  if (!rawText) throw new Error("Empty response from AI");
  let text = String(rawText).trim();

  // Strip markdown code fences if present
  text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();

  // Find first { and last }
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    text = text.substring(firstBrace, lastBrace + 1);
  }

  return JSON.parse(text);
}

function generateAlgorithmicDigest(items, customKeywords = []) {
  if (!items || items.length === 0) {
    return {
      engine: "Built-in Intelligence",
      model: "Heuristic Engine",
      crunch_summary: "No pending deadlines or notifications found. Your schedule is clear!",
      top_priorities: [],
      society_highlights: "Explore student societies on the Guild website to get involved!"
    };
  }

  const scoredItems = items.map(item => ({
    ...item,
    score: calculateUrgencyScore(item, customKeywords)
  })).sort((a, b) => b.score - a.score);

  const canvasDeadlines = items.filter(i => i.source === "canvas" && i.dueDate);
  const societyEvents = items.filter(i => i.source === "society");

  let crunch = "";
  if (canvasDeadlines.length > 0) {
    crunch = `You have ${canvasDeadlines.length} upcoming academic deadline${canvasDeadlines.length > 1 ? "s" : ""} on Canvas.`;
    const nextDue = canvasDeadlines[0];
    const dueDateStr = new Date(nextDue.dueDate).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
    crunch += ` The most immediate is "${nextDue.title}" on ${dueDateStr}.`;
  } else {
    crunch = "You have no immediate coursework deadlines pending this week. Great job staying ahead!";
  }

  const topPriorities = scoredItems.slice(0, 3).map(item => {
    let reason = "Academic deadline requiring preparation.";
    if (item.source === "outlook") reason = "Important university notice/email.";
    if (item.dueDate) {
      const diffHours = Math.round((new Date(item.dueDate).getTime() - Date.now()) / (1000 * 60 * 60));
      if (diffHours <= 24 && diffHours >= 0) reason = `Due in ~${diffHours} hours!`;
      else if (diffHours > 24) reason = `Due in ~${Math.round(diffHours / 24)} days.`;
    }
    return {
      id: item.id,
      title: item.title,
      source: item.source,
      reason: reason
    };
  });

  let societyHighlight = "Take a break this week to check out society meetups at the Guild!";
  if (societyEvents.length > 0) {
    societyHighlight = `Upcoming social break: Don't miss "${societyEvents[0].title}" to recharge with fellow students!`;
  }

  return {
    engine: "Built-in Intelligence",
    model: "Heuristic Engine",
    crunch_summary: crunch,
    top_priorities: topPriorities,
    society_highlights: societyHighlight
  };
}

async function analyzeWithLMStudio(items) {
  const topItems = items.slice(0, 8).map(({ id, title, source, dueDate, snippet }) => ({
    id, title, source, dueDate, snippet
  }));

  const controller = new AbortController();
  // Allow up to 25s for local 27B model inference
  const timeoutId = setTimeout(() => controller.abort(), 25000);

  const response = await fetch(LM_STUDIO_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL_NAME,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `Here is the current student JSON data: ${JSON.stringify(topItems)}. Return the JSON digest.` }
      ],
      temperature: 0.2
    }),
    signal: controller.signal
  });

  clearTimeout(timeoutId);

  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const result = await response.json();
  const rawContent = result?.choices?.[0]?.message?.content;
  const parsed = cleanJsonResponse(rawContent);

  return {
    engine: "Local AI (LM Studio)",
    model: result.model || MODEL_NAME,
    ...parsed
  };
}

async function generateSmartDigest(items, customKeywords = []) {
  try {
    return await analyzeWithLMStudio(items);
  } catch (err) {
    console.info("[Intelligence] Local model error or timeout, falling back to heuristics:", err.message);
    return generateAlgorithmicDigest(items, customKeywords);
  }
}

// Sample fallback dataset for instant hackathon presentation demo
const SAMPLE_UOB_DATA = [
  {
    id: "canvas-1",
    title: "Software Engineering Project - Sprint 2 Milestone",
    source: "canvas",
    dueDate: new Date(Date.now() + 18 * 60 * 60 * 1000).toISOString(),
    snippet: "Submit your group GitHub repository link and architecture diagram before 12:00."
  },
  {
    id: "canvas-2",
    title: "Machine Learning: Coursework 1 (Neural Networks)",
    source: "canvas",
    dueDate: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
    snippet: "Implement backpropagation from scratch in PyTorch. 40% of module grade."
  },
  {
    id: "outlook-1",
    title: "URGENT: Room Change for CS302 Lecture Tomorrow",
    source: "outlook",
    dueDate: null,
    snippet: "Please note that tomorrow's 10am lecture is moved to Poynting Building Room 102.",
    sender: "Prof. Alan Turing",
    isUrgent: true
  },
  {
    id: "outlook-2",
    title: "Feedback on your Lab Exercise 3",
    source: "outlook",
    dueDate: null,
    snippet: "Your lab submission has been reviewed. Good work on modularity.",
    sender: "Teaching Assistant"
  },
  {
    id: "society-1",
    title: "UoB Hackathon 2026: Pizza & Team Pitch Night",
    source: "society",
    dueDate: new Date(Date.now() + 28 * 60 * 60 * 1000).toISOString(),
    snippet: "Join us at the Guild Underground for free Domino's and live project demos!"
  },
  {
    id: "society-2",
    title: "AI Society: Guest Talk with DeepMind Engineer",
    source: "society",
    dueDate: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
    snippet: "Tech talk on LLM agents followed by networking drinks in Joes Bar."
  }
];

if (typeof window !== "undefined") {
  window.generateSmartDigest = generateSmartDigest;
  window.SAMPLE_UOB_DATA = SAMPLE_UOB_DATA;
}
