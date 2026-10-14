const LM_STUDIO_URL = "http://localhost:1234/v1/chat/completions";
const MODEL_NAME = "prism-ml/bonsai-27b";

const SYSTEM_PROMPT = `You are an elite academic AI assistant for University of Birmingham students.
Analyze the provided student items from Canvas, Outlook, MyUoB, Societies, Library, and Careers.
Output ONLY valid JSON containing:
1) "crunch_summary": A concise 2-sentence overview of the busiest days and workload pressure across academic and campus life.
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
      score += 10; // Overdue / today
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

  if (item.source === "canvas") score += 25;
  if (item.source === "library" && item.dueDate) score += 30; // Fines on overdue books!
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
      crunch_summary: "No pending deadlines or notifications found across your portals. Schedule is clear!",
      top_priorities: [],
      society_highlights: "Explore student societies on the Guild website to get involved!"
    };
  }

  const scoredItems = items.map(item => ({
    ...item,
    score: calculateUrgencyScore(item, customKeywords)
  })).sort((a, b) => b.score - a.score);

  const deadlines = items.filter(i => (i.source === "canvas" || i.source === "library") && i.dueDate);
  const societyEvents = items.filter(i => i.source === "society");

  let crunch = "";
  if (deadlines.length > 0) {
    crunch = `You have ${deadlines.length} upcoming deadlines across Canvas and Library services.`;
    const nextDue = deadlines[0];
    const dueDateStr = new Date(nextDue.dueDate).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
    crunch += ` The most immediate is "${nextDue.title}" on ${dueDateStr}.`;
  } else {
    crunch = "You have no immediate coursework deadlines pending this week. Great job staying ahead!";
  }

  const topPriorities = scoredItems.slice(0, 3).map(item => {
    let reason = "Academic deadline requiring preparation.";
    if (item.source === "outlook") reason = "Important university communication.";
    if (item.source === "library") reason = "Library book loan return to avoid fines.";
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
  const topItems = items.slice(0, 10).map(({ id, title, source, course, dueDate, snippet }) => ({
    id, title, source, course, dueDate, snippet
  }));

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 25000);

  const response = await fetch(LM_STUDIO_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL_NAME,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `Student portal items: ${JSON.stringify(topItems)}. Return the JSON digest.` }
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

// ── Rich Multi-Portal Dataset for Birmingham Students (14 Items) ──
const SAMPLE_UOB_DATA = [
  // ── Canvas LMS Deadlines ──
  {
    id: "canvas-1",
    title: "Software Engineering Project - Sprint 2 Milestone Submission",
    source: "canvas",
    course: "CS302: Software Engineering",
    dueDate: new Date(Date.now() + 14 * 60 * 60 * 1000).toISOString(),
    snippet: "Submit group architecture diagram, sprint retrospective and GitHub repo link. 25% of module marks.",
    url: "https://canvas.bham.ac.uk/courses/CS302/assignments/sprint2",
    type: "assignment"
  },
  {
    id: "canvas-2",
    title: "Machine Learning: Coursework 1 - Neural Networks from Scratch",
    source: "canvas",
    course: "CS310: Machine Learning",
    dueDate: new Date(Date.now() + 44 * 60 * 60 * 1000).toISOString(),
    snippet: "Implement backpropagation and convolutional layers in PyTorch. Automated test suite included.",
    url: "https://canvas.bham.ac.uk/courses/CS310/assignments/cw1",
    type: "assignment"
  },
  {
    id: "canvas-3",
    title: "Computer Networks: Mid-Term Online Quiz",
    source: "canvas",
    course: "CS201: Systems & Networks",
    dueDate: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
    snippet: "Timed 45-minute quiz covering TCP/IP protocol stack, DNS routing, and socket programming.",
    url: "https://canvas.bham.ac.uk/courses/CS201/quizzes/midterm",
    type: "quiz"
  },
  {
    id: "canvas-4",
    title: "Database Systems: Relational Algebra Exercise",
    source: "canvas",
    course: "CS204: Database Systems",
    dueDate: new Date(Date.now() + 120 * 60 * 60 * 1000).toISOString(),
    snippet: "Complete problem set 4 on SQL queries and normalization forms.",
    url: "https://canvas.bham.ac.uk/courses/CS204/assignments/ps4",
    type: "assignment"
  },

  // ── Outlook Web Emails ──
  {
    id: "outlook-1",
    title: "URGENT: Lecture Hall Change for CS302 Tomorrow Morning",
    source: "outlook",
    dueDate: null,
    date: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    snippet: "Please note tomorrow's 10:00 lecture is moved to Poynting Building Room 102 due to AV maintenance.",
    sender: "Prof. Alan Turing (CS Dept)",
    url: "https://outlook.cloud.microsoft",
    isUrgent: true,
    matchedKeywords: ["urgent", "rescheduled", "lecture"]
  },
  {
    id: "outlook-2",
    title: "Grading Feedback Released: Systems Programming Lab 2",
    source: "outlook",
    dueDate: null,
    date: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
    snippet: "Your lab marks and inline code comments have been published to Canvas. Overall average: 74%.",
    sender: "Teaching Team (Dr. Ada Lovelace)",
    url: "https://outlook.cloud.microsoft",
    matchedKeywords: ["feedback", "lab", "assessment"]
  },
  {
    id: "outlook-3",
    title: "Final Reminder: Register for Autumn Term Exam Arrangements",
    source: "outlook",
    dueDate: new Date(Date.now() + 36 * 60 * 60 * 1000).toISOString(),
    date: new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString(),
    snippet: "Students requiring reasonable adjustments or specific software for exams must apply by Friday 17:00.",
    sender: "Academic Services Registrar",
    url: "https://outlook.cloud.microsoft",
    isUrgent: true,
    matchedKeywords: ["exam", "reminder", "deadline"]
  },

  // ── MyUoB Student Portal & Timetable ──
  {
    id: "myuob-1",
    title: "CS302 Advanced Software Design: Workshop & Code Review",
    source: "myuob",
    course: "Timetable Event",
    dueDate: new Date(Date.now() + 16 * 60 * 60 * 1000).toISOString(),
    snippet: "Aston Webb B-Block Lab 4. Bring your laptops with Docker and Git installed.",
    url: "https://myuob.bham.ac.uk/dashboard/student-home",
    type: "event"
  },
  {
    id: "myuob-2",
    title: "Campus Notice: Old Library Square Construction Access",
    source: "myuob",
    course: "University Notice",
    dueDate: null,
    snippet: "Pedestrian detour in place between Aston Webb and the Guild of Students until Monday.",
    url: "https://myuob.bham.ac.uk/dashboard/student-home",
    type: "announcement"
  },

  // ── Guild Societies & Campus Life ──
  {
    id: "society-1",
    title: "UoB Hackathon 2026: Team Pitch & Domino's Pizza Night",
    source: "society",
    course: "HackSoc Birmingham",
    dueDate: new Date(Date.now() + 26 * 60 * 60 * 1000).toISOString(),
    snippet: "Guild Underground. Free pizza, sponsor mentors from DeepMind, and 24h project hacking. (Starts 18:30 - 22:00)",
    url: "https://www.guildofstudents.com/events/hackathon2026",
    type: "event",
    matchedKeywords: ["pizza", "hackathon", "social"]
  },
  {
    id: "society-2",
    title: "AI Society: Deep Learning Agents Guest Lecture & Pub Social",
    source: "society",
    course: "Artificial Intelligence Society",
    dueDate: new Date(Date.now() + 68 * 60 * 60 * 1000).toISOString(),
    snippet: "Tech talk on LLM tool-calling in Biosciences Tower Rm 101, followed by social drinks at Joes Bar. (Starts 19:00 - 21:30)",
    url: "https://www.guildofstudents.com/events/ai-talk",
    type: "event"
  },
  {
    id: "society-3",
    title: "Guild of Students: Autumn Term Board Games Evening",
    source: "society",
    course: "Tabletop Gaming Society",
    dueDate: new Date(Date.now() + 94 * 60 * 60 * 1000).toISOString(),
    snippet: "Amos Room (Guild 1st Floor). 150+ games, snacks provided, beginner friendly.",
    url: "https://www.guildofstudents.com/events/games",
    type: "event"
  },

  // ── Library Services (FindIt@Bham) ──
  {
    id: "library-1",
    title: "Main Library Loan Due: 'Designing Data-Intensive Applications'",
    source: "library",
    course: "FindIt@Bham Loan",
    dueDate: new Date(Date.now() + 20 * 60 * 60 * 1000).toISOString(),
    snippet: "Book barcode #839219. Return to Main Library ground-floor drop box or renew online before midnight to avoid fines.",
    url: "https://findit.bham.ac.uk",
    type: "loan"
  },

  // ── Careers Network & Worklink ──
  {
    id: "library-2",
    title: "Careers Connect: Summer Tech Internship Application Deadline",
    source: "library",
    course: "Careers Network UoB",
    dueDate: new Date(Date.now() + 110 * 60 * 60 * 1000).toISOString(),
    snippet: "Birmingham Technology Graduate Scheme & Summer 2027 Software Internships. Applications close Friday.",
    url: "https://careersconnect.bham.ac.uk",
    type: "careers",
    matchedKeywords: ["careers", "deadline"]
  }
];

if (typeof window !== "undefined") {
  window.generateSmartDigest = generateSmartDigest;
  window.SAMPLE_UOB_DATA = SAMPLE_UOB_DATA;
}
