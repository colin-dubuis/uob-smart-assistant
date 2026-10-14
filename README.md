# UoB Smart Assistant (Builders Club Hackathon)

Unified Student Assistant for University of Birmingham students that crawls **Canvas**, **Outlook**, and **Guild Societies**, aggregates the data locally, and delivers an intelligent daily briefing.

---

## ⚡ Quick Start (Under 1 Minute)

### 1. Load the Chrome Extension
1. Open Google Chrome and go to `chrome://extensions`.
2. Toggle on **Developer mode** in the top right corner.
3. Click **Load unpacked** and select this repository's root directory:
   `/Users/colindubuis/Documents/ZHAW/7th semester (Birmingham)/BuilderSocity`
4. Pin the **UoB Assistant** extension icon.

### 2. Run the MVP / Presentation Demo
Click the extension icon in your Chrome toolbar:
- **🎯 Demo Data**: Instant 1-click presentation mode! Loads a realistic UoB dataset (upcoming CS coursework deadlines, urgent lecture room change notices, and society pizza events) and generates the AI briefing immediately.
- **⚡ Sync & Analyze All**: Programmatically opens background tabs for Canvas (`canvas.bham.ac.uk`), Outlook (`outlook.cloud.microsoft`), and Societies (`guildofstudents.com`), extracts assignments/emails/events, closes the tabs automatically, and stores the unified JSON into `chrome.storage.local`.
- **💾 Export JSON**: Downloads `uob-student-data.json` containing the normalized dataset.

---

## 🧠 Dual Intelligence Engine

The assistant prioritizes and cuts through notification fatigue using a two-tier engine:
1. **Local LLM (LM Studio)**: If LM Studio is running at `http://localhost:1234/v1`, it dispatches the top items to the local model to produce:
   - **Academic Crunch Summary**: A 2-sentence overview of workload bottlenecks.
   - **Top 3 Priorities**: Immediate critical items with clear reasoning.
   - **Campus & Society Pulse**: Work-life balance recommendations.
2. **Built-in Smart Heuristics Fallback**: If LM Studio is offline or times out (after 4s), the extension automatically switches to an algorithmic priority engine scoring deadline proximity and urgency keywords (*exam, submission, due, mandatory, urgent*). **The demo will never crash on stage.**

---

## 📁 Repository Structure

```
.
├── manifest.json                  # Extension Manifest V3
├── background/
│   └── service-worker.js         # Tab orchestrator (opens, crawls, closes tabs)
├── content-scripts/
│   ├── canvas.js                  # Scrapes Canvas LMS deadlines & to-dos
│   ├── outlook.js                 # Scrapes Outlook web emails & notices
│   └── myuob.js                   # Scrapes Guild of Students events
├── popup/
│   ├── popup.html                 # Modern dashboard interface
│   ├── popup.css                  # Styling with Birmingham color theme
│   ├── popup.js                   # Controller for sync, demo, & filters
│   └── intelligence.js            # LM Studio & heuristic intelligence engine
├── backend-processor.js           # Optional Node.js CLI data processor
└── test/
    └── backend-processor.test.js  # Unit tests (run via: node --test)
```

---

## 🧪 Running CLI Tests

```sh
node --test test/backend-processor.test.js
```
