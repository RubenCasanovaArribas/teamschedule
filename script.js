// ==============================================
// ⚙️ CONFIGURATION
// ==============================================
const SHOW_DESCRIPTION = false;
const MAIN_EVENTS_TO_SHOW = 6;
const SECONDARY_EVENTS_TO_SHOW = 8;
const HEIGHT_RATIO = 0.9; // Use 90% of available height
const GAP_CARD_RATIO = 0.2; // Gap between cards in same category
const GAP_CATEGORY_RATIO = 0.0; // Gap between categories

// ==============================================
// 🧠 LOAD EVENTS
// ==============================================
async function loadEvents() {
  const mainContainer = document.getElementById("main-events");
  const secondaryContainer = document.getElementById("secondary-events");
  const tertiaryContainer = document.getElementById("tertiary-events");

  try {
    const resp = await fetch("https://corsproxy.io/?" + encodeURIComponent("https://outlook.office365.com/owa/calendar/46dbe62f2a1b4a81bfe272e8ef89baee@ironlynx.it/955ed78282564a95838e1cf67a4b834812868820346018730469/calendar.ics"));
    const icsText = await resp.text();
    const events = parseICS(icsText);
    events.sort((a, b) => new Date(a.start) - new Date(b.start));

    mainContainer.innerHTML = "";
    secondaryContainer.innerHTML = "";
    tertiaryContainer.innerHTML = "";

    const now = Date.now();

    const mainEvents = events.filter(e => e.category === "main" && new Date(e.end) > now).slice(0, MAIN_EVENTS_TO_SHOW);
    const secondaryEvents = events.filter(e => e.category === "secondary" && new Date(e.end) > now).slice(0, SECONDARY_EVENTS_TO_SHOW);
    const tertiaryEvents = events.filter(e => e.category === "tertiary" && new Date(e.end) > now).slice(0, 1);

    // --- Render main ---
    mainEvents.forEach(ev => {
      const card = createEventCard(ev);
      card.classList.add("main");
      mainContainer.appendChild(card);
      updateCountdown(ev, card);
      setInterval(() => updateCountdown(ev, card), 1000);
    });

    // --- Render secondary ---
    secondaryEvents.forEach(ev => {
      const card = createEventCard(ev);
      card.classList.add("secondary");
      secondaryContainer.appendChild(card);
      updateCountdown(ev, card);
      setInterval(() => updateCountdown(ev, card), 1000);
    });

    // --- Render tertiary ---
    if (tertiaryEvents.length > 0) {
      const card = createEventCard(tertiaryEvents[0], true);
      card.classList.add("tertiary");
      tertiaryContainer.appendChild(card);
      updateCountdown(tertiaryEvents[0], card);
      setInterval(() => updateCountdown(tertiaryEvents[0], card), 1000);
    }

    scaleAllSections();
  } catch (err) {
    console.error(err);
    mainContainer.innerHTML = "Error loading ICS events.";
  }
}

// ==============================================
// 📅 ICS PARSER (robust version for Google/Airbnb/Outlook)
// ==============================================
function parseICS(text) {
  const events = [];
  
  // Normalize line breaks and unfold folded lines
  const normalized = text
    .replace(/\r\n/g, "\n")
    .replace(/\n /g, ""); // unfold lines split by ICS format
  
  const blocks = normalized.split("BEGIN:VEVENT").slice(1);

  for (const block of blocks) {
    const endBlock = block.split("END:VEVENT")[0];

    // Extract fields safely
    const summary = matchField(endBlock, "SUMMARY") || "Untitled";
    const description = matchField(endBlock, "DESCRIPTION") || "";
    const start = matchField(endBlock, "DTSTART");
    const end = matchField(endBlock, "DTEND");
    const category = (matchField(endBlock, "CATEGORIES") || "secondary").toLowerCase();

    const startISO = parseICSTime(start);
    const endISO = parseICSTime(end);

    events.push({ title: summary, description, start: startISO, end: endISO, category });
  }
  return events;
}

// Helper to extract ICS fields
function matchField(block, key) {
  const regex = new RegExp(`${key}(?:;[^:]+)?:([^\n\r]+)`);
  const match = block.match(regex);
  if (!match) return null;
  return match[1].trim().replace(/\\n/g, "\n").replace(/\\\\/g, "\\");
}

// Parse different ICS date/time formats
function parseICSTime(value) {
  if (!value) return null;
  
  // DATE ONLY (e.g. 20251019)
  if (/^\d{8}$/.test(value)) {
    return `${value.slice(0,4)}-${value.slice(4,6)}-${value.slice(6,8)}T00:00:00Z`;
  }

  // DATETIME in UTC (e.g. 20251019T120000Z)
  if (/^\d{8}T\d{6}Z$/.test(value)) {
    return `${value.slice(0,4)}-${value.slice(4,6)}-${value.slice(6,8)}T${value.slice(9,11)}:${value.slice(11,13)}:${value.slice(13,15)}Z`;
  }

  // DATETIME without Z (local time)
  if (/^\d{8}T\d{6}$/.test(value)) {
    return `${value.slice(0,4)}-${value.slice(4,6)}-${value.slice(6,8)}T${value.slice(9,11)}:${value.slice(11,13)}:${value.slice(13,15)}`;
  }

  return null;
}


// ==============================================
// 🧩 CREATE EVENT CARD (Clean version — unified padding)
// ==============================================
function createEventCard(ev, isTertiary = false) {
  const card = document.createElement("div");
  card.className = "event-card";
  if (ev.category === "secondary") card.classList.add("secondary");
  if (isTertiary) card.classList.add("tertiary");

  const descriptionHTML = SHOW_DESCRIPTION ? `<div class="description">${ev.description}</div>` : "";

  card.innerHTML = `
    <div class="info">
      <div class="title">${ev.title}</div>
      ${descriptionHTML}
      <div class="datetime">${formatTime(ev.start)} — ${formatTime(ev.end)}</div>
    </div>
    <div class="countdown pending">
      <div class="label">Loading…</div>
      <div class="time">--:--:--</div>
    </div>
    <div class="progress-bar"></div>
  `;
  return card;
}


// ==============================================
// ⏱️ COUNTDOWN
// ==============================================
function updateCountdown(ev, card) {
  const now = Date.now();
  const start = new Date(ev.start).getTime();
  const end = new Date(ev.end).getTime();
  const cd = card.querySelector(".countdown");
  const label = cd.querySelector(".label");
  const timeEl = cd.querySelector(".time");
  const progress = card.querySelector(".progress-bar");

  if (now < start) {
    // Event not started yet
    const diff = start - now;
    cd.className = "countdown pending";
    label.textContent = "Starts in:";

    // If more than 24 hours left → show only days
    if (diff >= 24 * 3600000) {
      const days = Math.ceil(diff / (24 * 3600000));
      timeEl.textContent = days + (days === 1 ? " day" : " days");
    } else {
      // Otherwise show hours/minutes/seconds
      timeEl.textContent = formatTimeSpan(diff);
    }

    progress.style.width = "0%";
    card.classList.remove("active");

  } else if (now >= start && now < end) {
    // Event currently in progress
    const diff = end - now;
    const total = end - start;
    const elapsed = now - start;
    const percent = (elapsed / total) * 100;

    cd.className = "countdown in-progress";
    label.textContent = "Ends in:";

    // Same logic for long events → show only days if >24h
    if (diff >= 24 * 3600000) {
      const days = Math.ceil(diff / (24 * 3600000));
      timeEl.textContent = days + (days === 1 ? " day" : " days");
    } else {
      timeEl.textContent = formatTimeSpan(diff);
    }

    progress.style.width = percent + "%";

    // ✅ Apply active visual style for tertiary events
    if (card.classList.contains("tertiary")) {
      card.classList.add("active");
    }

  } else {
    // Event finished
    card.classList.add("hidden");
    card.classList.remove("active");
  }
}



// ==============================================
// 🧮 UTILITIES
// ==============================================
function formatTimeSpan(ms) {
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${String(hours).padStart(2, "0")}h ${String(minutes).padStart(2, "0")}m ${String(seconds).padStart(2, "0")}s`;
}

function formatTime(dtStr) {
  const d = new Date(dtStr);
  return d.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

// ==============================================
// 🧱 SCALING + SPACING LOGIC
// ==============================================
function scaleAllSections() {
  const headerHeight = document.querySelector("header").offsetHeight;
  const totalHeight = window.innerHeight - headerHeight;
  const usableHeight = totalHeight * HEIGHT_RATIO;

  const mainCards = document.querySelectorAll("#main-events .event-card:not(.hidden)");
  const secondaryCards = document.querySelectorAll("#secondary-events .event-card:not(.hidden)");
  const tertiaryCards = document.querySelectorAll("#tertiary-events .event-card:not(.hidden)");

  const mainCount = mainCards.length;
  const secondaryCount = secondaryCards.length;
  const tertiaryCount = tertiaryCards.length;
  const totalCards = mainCount + secondaryCount + tertiaryCount;
  if (totalCards === 0) return;

  const mainRatio = 1.0;
  const secondaryRatio = 0.85;
  const tertiaryRatio = 0.7;

  const totalRatio =
    mainCount * mainRatio +
    secondaryCount * secondaryRatio +
    tertiaryCount * tertiaryRatio +
    (mainCount - 1 + secondaryCount - 1 + tertiaryCount - 1) * GAP_CARD_RATIO +
    2 * GAP_CATEGORY_RATIO;

  const unitHeight = usableHeight / totalRatio;

  const applyScale = (cards, ratio) => {
    cards.forEach(c => {
      c.style.height = `${unitHeight * ratio}px`;
      c.style.fontSize = `${unitHeight * 0.25 * ratio}px`;
      c.style.margin = `${unitHeight * GAP_CARD_RATIO / 2}px 0`;
      c.style.padding = "0 2em";
    });
  };

  applyScale(mainCards, mainRatio);
  applyScale(secondaryCards, secondaryRatio);
  applyScale(tertiaryCards, tertiaryRatio);

  document.getElementById("main-events").style.marginBottom = `${unitHeight * GAP_CATEGORY_RATIO}px`;
  document.getElementById("secondary-events").style.marginBottom = `${unitHeight * GAP_CATEGORY_RATIO}px`;
}

// ==============================================
// 🕒 HEADER CLOCK
// ==============================================
function updateCurrentDateTime() {
  const now = new Date();
  document.querySelector("#current-datetime .date-line").textContent = now.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
  document.querySelector("#current-datetime .time-line").textContent = now.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

// ==============================================
// 🚀 INIT
// ==============================================
setInterval(updateCurrentDateTime, 1000);
window.addEventListener("resize", scaleAllSections);
updateCurrentDateTime();
loadEvents();


// Refresh events automatically every 5 minutes
setInterval(() => {
  console.log("🔄 Auto-refreshing events...");
  loadEvents();
}, 1 * 60 * 1000); // 1 minute
