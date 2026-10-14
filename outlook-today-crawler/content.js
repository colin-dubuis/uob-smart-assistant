(() => {
  if (window.__outlookTodayCrawlerLoaded) return;
  window.__outlookTodayCrawlerLoaded = true;

  const clean = text => (text || "").replace(/\s+/g, " ").trim();
  const isVisible = element => {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 &&
      getComputedStyle(element).visibility !== "hidden";
  };

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  function formattedTodayValues() {
    const now = new Date();
    const locales = [...new Set([
      document.documentElement.lang,
      navigator.language,
      "en-US",
      "en-GB"
    ].filter(Boolean))];

    return new Set(locales.flatMap(locale => [
      new Intl.DateTimeFormat(locale, {
        dateStyle: "long"
      }).format(now),
      new Intl.DateTimeFormat(locale, {
        dateStyle: "medium"
      }).format(now),
      new Intl.DateTimeFormat(locale, {
        dateStyle: "short"
      }).format(now)
    ]).map(clean).map(value => value.toLocaleLowerCase()));
  }

  function dateIsToday(value, todayValues) {
    const text = clean(value).toLocaleLowerCase();
    if (!text) return false;
    if (/\btoday\b/.test(text)) return true;
    if (/^(?:\d{1,2}:\d{2})(?:\s*[ap]\.?m\.?)?$/.test(text)) {
      return false;
    }

    const now = new Date();
    const parsed = Date.parse(text);
    if (!Number.isNaN(parsed)) {
      const date = new Date(parsed);
      if (date.toDateString() === now.toDateString()) return true;
    }

    return [...todayValues].some(today =>
      text === today || text.includes(today)
    );
  }

  function getVisibleRows() {
    return [...document.querySelectorAll(
      '[role="option"], [role="listitem"]'
    )].filter(element =>
      isVisible(element) && clean(element.innerText)
    );
  }

  function rowHasTodayDate(row, todayValues) {
    const dateElements = [
      row,
      ...row.querySelectorAll("time, [datetime], [title], [aria-label]")
    ];

    return dateElements.some(element => {
      const values = [
        element.getAttribute("datetime"),
        element.getAttribute("title"),
        element.getAttribute("aria-label"),
        element === row ? "" : element.innerText
      ];
      return values.some(value => dateIsToday(value, todayValues));
    });
  }

  function visibleText(element) {
    return clean(element?.innerText);
  }

  function getFieldLines(text, fieldNames) {
    const lines = text.split(/\n+/).map(clean).filter(Boolean);
    const pattern = new RegExp(
      `^(?:${fieldNames.join("|")})\\s*:?\\s*(.*)$`,
      "i"
    );
    return lines.flatMap(line => {
      const match = line.match(pattern);
      return match ? [clean(match[1])] : [];
    }).filter(Boolean);
  }

  function getEmails(text) {
    return [...new Set(
      text.match(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g) || []
    )];
  }

  function findBestBody(main) {
    const selectors = [
      '[data-testid*="message-body" i]',
      '[class*="allowTextSelection"]',
      '[role="document"]',
      '[dir="auto"]'
    ];
    const candidates = selectors.flatMap(selector =>
      [...main.querySelectorAll(selector)]
    ).filter((element, index, elements) =>
      elements.indexOf(element) === index &&
      isVisible(element) &&
      visibleText(element).length > 0 &&
      visibleText(element).length < visibleText(main).length
    );

    const ranked = candidates.map(element => ({
      element,
      text: visibleText(element),
      score:
        (element.matches('[data-testid*="message-body" i]') ? 4 : 0) +
        (element.matches('[role="document"]') ? 3 : 0) +
        (element.matches('[class*="allowTextSelection"]') ? 2 : 0)
    })).sort((a, b) =>
      b.score - a.score || b.text.length - a.text.length
    );

    return {
      text: ranked[0]?.text || "",
      candidates: ranked.slice(0, 30).map(({ element, text }) => ({
        tag: element.tagName,
        role: element.getAttribute("role"),
        testId: element.getAttribute("data-testid"),
        text
      }))
    };
  }

  function extractVisibleMessage() {
    const main = document.querySelector('[role="main"]') || document.body;
    const fullText = main.innerText || "";
    const text = clean(fullText);
    const body = findBestBody(main);
    const emails = getEmails(text);

    const attachmentElements = [
      ...main.querySelectorAll('a, [role="button"], [aria-label]')
    ].filter(element => {
      if (!isVisible(element)) return false;
      const label = [
        element.innerText,
        element.getAttribute("aria-label"),
        element.getAttribute("title")
      ].join(" ");
      return /attachment|download|\.pdf\b|\.docx?\b|\.xlsx?\b|\.pptx?\b|\.png\b|\.jpe?g\b|\.zip\b/i
        .test(label);
    });

    const attachmentCandidates = attachmentElements.map(element => ({
      name: clean(
        element.innerText ||
        element.getAttribute("aria-label") ||
        element.getAttribute("title")
      ),
      metadata: clean([
        element.getAttribute("aria-label"),
        element.getAttribute("title"),
        element.parentElement?.innerText
      ].filter(Boolean).join(" "))
    })).filter((item, index, all) =>
      item.name && all.findIndex(other => other.name === item.name) === index
    );

    const senderLines = getFieldLines(fullText, ["From", "Sender"]);
    const senderText = senderLines[0] || "";
    const senderEmail = getEmails(senderText)[0] || null;
    const senderDisplayName = clean(
      senderText
        .replace(/<[^>]*>/g, "")
        .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "")
    ) || null;
    const ccRecipients = getFieldLines(fullText, ["Cc", "CC"])
      .flatMap(value => value.split(/[;,]/).map(clean))
      .filter(Boolean);
    const subjectHeading = [...main.querySelectorAll("h1, h2, [role=heading]")]
      .find(isVisible);
    const subjectLine = getFieldLines(fullText, ["Subject"])[0] || "";
    const subject = visibleText(subjectHeading) || subjectLine || null;
    const receivedLines = getFieldLines(fullText, [
      "Received", "Date", "Sent"
    ]);
    const receivedElement = [...main.querySelectorAll(
      "time, [datetime], [title], [aria-label]"
    )].find(element => isVisible(element) && (
      element.hasAttribute("datetime") ||
      /received|sent|date/i.test([
        element.getAttribute("aria-label"),
        element.getAttribute("title")
      ].join(" "))
    ));

    return {
      extractedAt: new Date().toISOString(),
      pageUrl: location.href,
      pageTitle: document.title,
      subject,
      sender: {
        displayName: senderDisplayName,
        emailAddress: senderEmail,
        visibleText: senderText || null
      },
      cc: ccRecipients.map(recipient => ({
        visibleText: recipient,
        displayName: clean(
          recipient
            .replace(/<[^>]*>/g, "")
            .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "")
        ) || null,
        emailAddresses: getEmails(recipient)
      })),
      receivedDateTime:
        receivedElement?.getAttribute("datetime") ||
        visibleText(receivedElement) ||
        receivedLines[0] ||
        null,
      otherVisibleMetadata: {
        dateLines: receivedLines,
        emailAddresses: emails
      },
      body: body.text || null,
      attachments: attachmentCandidates,
      diagnostics: {
        visibleText: text,
        bodyCandidates: body.candidates,
        selectorsUsed: {
          messagePane: main.matches('[role="main"]')
            ? '[role="main"]'
            : "document.body"
        }
      }
    };
  }

  function downloadJson(result) {
    const blob = new Blob(
      [JSON.stringify(result, null, 2)],
      { type: "application/json" }
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "outlook-today-email.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  async function run(button) {
    button.disabled = true;
    const initialRows = getVisibleRows();
    const todayValues = formattedTodayValues();
    const candidates = initialRows.filter(row =>
      rowHasTodayDate(row, todayValues)
    );

    console.info("Outlook extractor: visible message rows", initialRows.length);
    console.info("Outlook extractor: rows with a visible today date", candidates);

    if (!candidates.length) {
      alert(
        "No visible message row could be confidently identified as received today. " +
        "Outlook may be showing a date format this prototype cannot recognize. " +
        "No message was opened."
      );
      button.disabled = false;
      return;
    }

    candidates[0].click();
    await sleep(1200);
    const result = extractVisibleMessage();
    console.info("Outlook extractor: extracted data", result);
    await chrome.storage.local.set({ latestExtraction: result });
    downloadJson(result);
    alert(
      "Extraction complete. Click the extension icon to view the dashboard, " +
      "or review outlook-today-email.json. Outlook's live DOM may require " +
      "selector tuning."
    );
    button.disabled = false;
  }

  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Extract today's email";
  button.setAttribute("aria-label", "Extract today's email from Outlook");
  Object.assign(button.style, {
    position: "fixed",
    right: "24px",
    bottom: "24px",
    zIndex: "2147483647",
    padding: "12px 18px",
    background: "#0759b8",
    color: "white",
    border: "0",
    borderRadius: "8px",
    cursor: "pointer",
    boxShadow: "0 2px 8px #0004"
  });

  button.addEventListener("click", () => {
    run(button).catch(error => {
      console.error("Outlook extractor failed", error);
      alert("Extraction failed. See the DevTools console for details.");
      button.disabled = false;
    });
  });

  document.body.appendChild(button);
})();
