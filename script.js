// ==============================================
// ⚙️ CONFIGURATION
// ==============================================
const SHOW_LOCATION = true;  // Shows the location if available
const MAIN_EVENTS_TO_SHOW = 3; // Number of slots for Main events
const SECONDARY_EVENTS_TO_SHOW = 4; // Number of slots for Secondary events
const HEIGHT_RATIO = 0.95; // Use 95% of available height
const GAP_CARD_RATIO = 0.2; // Gap between cards in same category
const GAP_CATEGORY_RATIO = 0.0; // Gap between categories

// ==============================================
// 🧠 LOAD EVENTS (from calendars.json)
// ==============================================
async function loadEvents() {
  const mainContainer = document.getElementById("main-events");
  const secondaryContainer = document.getElementById("secondary-events");
  const tertiaryContainer = document.getElementById("tertiary-events");

  try {
    // Load JSON configuration with calendar URLs
    const configResp = await fetch("calendars.json");
    const ICS_SOURCES = await configResp.json();

    // Helper: fetch multiple ICS files in parallel and tag category
    const fetchICS = async (urls, category) => {
      const all = await Promise.all(
        urls.map(async (u) => {
          const proxied = "https://corsproxy.io/?" + encodeURIComponent(u);
          const resp = await fetch(proxied);
          const text = await resp.text();
          return parseICS(text).map((e) => ({ ...e, category }));
        })
      );
      return all.flat();
    };

    // Fetch all categories in parallel
    const [mainEvents, secondaryEvents, tertiaryEvents] = await Promise.all([
      fetchICS(ICS_SOURCES.main || [], "main"),
      fetchICS(ICS_SOURCES.secondary || [], "secondary"),
      fetchICS(ICS_SOURCES.tertiary || [], "tertiary"),
    ]);

    const allEvents = [...mainEvents, ...secondaryEvents, ...tertiaryEvents];
    allEvents.sort((a, b) => new Date(a.start) - new Date(b.start));

    // Reset containers
    mainContainer.innerHTML = "";
    secondaryContainer.innerHTML = "";
    tertiaryContainer.innerHTML = "";

    const now = Date.now();

    const renderCategory = (events, container, limit, isTertiary = false) => {
      const upcoming = events.filter(e => new Date(e.end) > now).slice(0, limit);

      // Preserve visual balance: create placeholder cards if fewer events
      for (let i = 0; i < limit; i++) {
        const ev = upcoming[i];
        if (ev) {
          const card = createEventCard(ev, isTertiary);
          container.appendChild(card);
          updateCountdown(ev, card);
          setInterval(() => updateCountdown(ev, card), 1000);
        } else {
          const placeholder = document.createElement("div");
          placeholder.className = "event-card placeholder";
          placeholder.style.opacity = "0.15";
          container.appendChild(placeholder);
        }
      }
    };

    renderCategory(mainEvents, mainContainer, MAIN_EVENTS_TO_SHOW);
    renderCategory(secondaryEvents, secondaryContainer, SECONDARY_EVENTS_TO_SHOW);
    renderCategory(tertiaryEvents, tertiaryContainer, 1, true);

    scaleAllSections();
  } catch (err) {
    console.error("Error loading events:", err);
    mainContainer.innerHTML = "Error loading ICS events.";
  }
}

// ==============================================
// 📅 ICS PARSER (robust for Google/Airbnb/Outlook)
// ==============================================
function parseICS(text) {
  const events = [];
  const normalized = text.replace(/\r\n/g, "\n").replace(/\n /g, "");
  const blocks = normalized.split("BEGIN:VEVENT").slice(1);

  for (const block of blocks) {
    const endBlock = block.split("END:VEVENT")[0];
    const summary = matchField(endBlock, "SUMMARY") || "Untitled";
    const description = matchField(endBlock, "DESCRIPTION") || "";
    const location = matchField(endBlock, "LOCATION") || ""; 
    const start = matchField(endBlock, "DTSTART");
    const end = matchField(endBlock, "DTEND");

    const startISO = parseICSTime(start, endBlock);
    const endISO = parseICSTime(end, endBlock);

    events.push({ title: summary, description, location, start: startISO, end: endISO });
  }
  return events;
}

// Extract field value safely
function matchField(block, key) {
  const regex = new RegExp(`${key}(?:;[^:]+)?:([^\n\r]+)`);
  const match = block.match(regex);
  if (!match) return null;
  return match[1].trim().replace(/\\n/g, "\n").replace(/\\\\/g, "\\");
}

// Parse dates robustly (handles time zones)
function parseICSTime(value, block = "") {
  if (!value) return null;

  // If timezone specified (e.g., DTSTART;TZID=Romance Standard Time)
  const tzMatch = block.match(/TZID=([^:;]+)/);
  const tzName = tzMatch ? tzMatch[1] : null;

  // DATE ONLY
  if (/^\d{8}$/.test(value))
    return `${value.slice(0,4)}-${value.slice(4,6)}-${value.slice(6,8)}T00:00:00Z`;

  // DATETIME UTC (ends with Z)
  if (/^\d{8}T\d{6}Z$/.test(value))
    return `${value.slice(0,4)}-${value.slice(4,6)}-${value.slice(6,8)}T${value.slice(9,11)}:${value.slice(11,13)}:${value.slice(13,15)}Z`;

  // Local time → adjust to local timezone (approx)
  if (/^\d{8}T\d{6}$/.test(value)) {
    const local = `${value.slice(0,4)}-${value.slice(4,6)}-${value.slice(6,8)}T${value.slice(9,11)}:${value.slice(11,13)}:${value.slice(13,15)}`;
    return local;
  }

  return null;
}

// ==============================================
// 🧩 CREATE EVENT CARD (with optional LOCATION)
// ==============================================
function createEventCard(ev, isTertiary = false) {
  const card = document.createElement("div");
  card.className = "event-card";
  if (ev.category === "secondary") card.classList.add("secondary");
  if (isTertiary) card.classList.add("tertiary");

  // 🔹 Si hay ubicación y está activado SHOW_LOCATION
  const locationHTML = SHOW_LOCATION && ev.location
    ? `<span class="location">📍 ${ev.location}</span>`
    : "";

  card.innerHTML = `
    <div class="info">
      <div class="title">${ev.title}</div>
      <div class="datetime">
        ${formatTime(ev.start)} — ${formatTime(ev.end)}
        ${locationHTML}
      </div>
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
// ⏱️ COUNTDOWN + PROGRESS
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
    const diff = start - now;
    cd.className = "countdown pending";
    label.textContent = "Starts in:";

    if (diff >= 24 * 3600000) {
      const days = Math.ceil(diff / (24 * 3600000));
      timeEl.textContent = days + (days === 1 ? " day" : " days");
    } else {
      timeEl.textContent = formatTimeSpan(diff);
    }

    progress.style.width = "0%";
    card.classList.remove("active");

  } else if (now >= start && now < end) {
    const diff = end - now;
    const total = end - start;
    const elapsed = now - start;
    const percent = (elapsed / total) * 100;

    cd.className = "countdown in-progress";
    label.textContent = "Ends in:";

    if (diff >= 24 * 3600000) {
      const days = Math.ceil(diff / (24 * 3600000));
      timeEl.textContent = days + (days === 1 ? " day" : " days");
    } else {
      timeEl.textContent = formatTimeSpan(diff);
    }

    progress.style.width = percent + "%";
    if (card.classList.contains("tertiary")) card.classList.add("active");
  } else {
    card.classList.add("hidden");
  }
}

// ==============================================
// 🧮 UTILITIES
// ==============================================
function formatTimeSpan(ms) {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${String(h).padStart(2, "0")}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
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

  const mainRatio = 1.0;
  const secondaryRatio = 0.85;
  const tertiaryRatio = 0.7;

  const totalRatio =
    mainCount * mainRatio +
    secondaryCount * secondaryRatio +
    tertiaryCount * tertiaryRatio +
    (mainCount + secondaryCount + tertiaryCount - 3) * GAP_CARD_RATIO +
    2 * GAP_CATEGORY_RATIO;

  const unitHeight = usableHeight / totalRatio;

  const applyScale = (cards, ratio) => {
    cards.forEach((c) => {
      c.style.height = `${unitHeight * ratio}px`;
      c.style.fontSize = `${unitHeight * 0.25 * ratio}px`;
      c.style.margin = `${unitHeight * GAP_CARD_RATIO / 2}px 0`;
      c.style.padding = "0 2em";
    });
  };

  applyScale(mainCards, mainRatio);
  applyScale(secondaryCards, secondaryRatio);
  applyScale(tertiaryCards, tertiaryRatio);
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

// Auto-refresh every 5 min
setInterval(() => {
  console.log("🔄 Auto-refreshing events...");
  loadEvents();
}, 5 * 60 * 1000);
