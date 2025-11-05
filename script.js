// ==============================================
// ⚙️ CONFIGURATION
// ==============================================
const SHOW_LOCATION = true;       // Mostrar ubicación si existe
const SHOW_DESCRIPTION = true;    // Mostrar descripción si existe
const MAIN_EVENTS_TO_SHOW = 3;
const SECONDARY_EVENTS_TO_SHOW = 4;
const HEIGHT_RATIO = 0.92;
const GAP_CARD_RATIO = 0.2;
const GAP_CATEGORY_RATIO = 0.0;

// ==============================================
// 🧠 LOAD EVENTS
// ==============================================
async function loadEvents() {
  const mainContainer = document.getElementById("main-events");
  const secondaryContainer = document.getElementById("secondary-events");
  const tertiaryContainer = document.getElementById("tertiary-events");

  try {
    const configResp = await fetch("calendars.json");
    const ICS_SOURCES = await configResp.json();

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

    const [mainEvents, secondaryEvents, tertiaryEvents] = await Promise.all([
      fetchICS(ICS_SOURCES.main || [], "main"),
      fetchICS(ICS_SOURCES.secondary || [], "secondary"),
      fetchICS(ICS_SOURCES.tertiary || [], "tertiary"),
    ]);

    const now = Date.now();
    [mainContainer, secondaryContainer, tertiaryContainer].forEach(c => c.innerHTML = "");

    const renderCategory = (events, container, limit, category) => {
      const upcoming = events.filter(e => new Date(e.end) > now).slice(0, limit);

      for (let i = 0; i < limit; i++) {
        const ev = upcoming[i];
        if (ev) {
          const card = createEventCard(ev);
          container.appendChild(card);
          updateCountdown(ev, card);
          setInterval(() => updateCountdown(ev, card), 1000);
        } else {
          const placeholder = document.createElement("div");
          placeholder.className = `event-card placeholder ${category}`;
          placeholder.style.opacity = "0.15";
          container.appendChild(placeholder);
        }
      }
    };

    renderCategory(mainEvents, mainContainer, MAIN_EVENTS_TO_SHOW, "main");
    renderCategory(secondaryEvents, secondaryContainer, SECONDARY_EVENTS_TO_SHOW, "secondary");
    renderCategory(tertiaryEvents, tertiaryContainer, 1, "tertiary");

    scaleAllSections();
  } catch (err) {
    console.error("Error loading events:", err);
    mainContainer.innerHTML = "Error loading ICS events.";
  }
}

// ==============================================
// 🕒 Robust ICS Time Parsing (Windows + IANA → UTC)
// ==============================================
function parseICSTime(value, block = "", label = "") {
  if (!value) return null;

  // Detectar zona horaria (TZID)
  const tzMatch = block.match(/TZID=([^:;]+)/);
  let tzid = tzMatch ? tzMatch[1].trim() : null;
  if (tzid) tzid = convertWindowsToIANA(tzid);

  // 🗓️ Fecha sin hora → tratar como medianoche UTC
  if (/^\d{8}$/.test(value)) {
    return `${value.slice(0,4)}-${value.slice(4,6)}-${value.slice(6,8)}T00:00:00Z`;
  }

  // 🕘 Hora UTC explícita (termina en "Z")
  if (/^\d{8}T\d{6}Z$/.test(value)) {
    return `${value.slice(0,4)}-${value.slice(4,6)}-${value.slice(6,8)}T${value.slice(9,11)}:${value.slice(11,13)}:${value.slice(13,15)}Z`;
  }

  // 🕒 Hora local con o sin TZID
  if (/^\d{8}T\d{6}$/.test(value)) {
    const y = parseInt(value.slice(0, 4));
    const m = parseInt(value.slice(4, 6)) - 1;
    const d = parseInt(value.slice(6, 8));
    const hh = parseInt(value.slice(9, 11));
    const mm = parseInt(value.slice(11, 13));
    const ss = parseInt(value.slice(13, 15));

    // Crear fecha base "naiva" (sin zona horaria)
    const localTimeMs = Date.UTC(y, m, d, hh, mm, ss);

    if (tzid) {
      try {
        const offsetMinutes = getStandardOffsetMinutes(tzid);
        const utcTime = localTimeMs - offsetMinutes * 60 * 1000;
        const utcISO = new Date(utcTime).toISOString();
        console.log(`🕒 [${label}] ${value} | TZID: ${tzid} → UTC: ${utcISO}`);
        return utcISO;
      } catch (e) {
        console.warn(`⚠️ TZID '${tzid}' no reconocido — usando hora local (${label}).`);
        return new Date(localTimeMs).toISOString();
      }
    }

    // Sin TZID: se asume local del navegador → convertir a UTC
    return new Date(localTimeMs).toISOString();
  }

  return null;
}

// ==============================================
// 🔁 Conversión de zonas horarias Windows → IANA
// ==============================================
function convertWindowsToIANA(windowsTz) {
  const map = {
    "Romance Standard Time": "Europe/Paris",
    "W. Europe Standard Time": "Europe/Berlin",
    "Central Europe Standard Time": "Europe/Budapest",
    "E. Europe Standard Time": "Europe/Bucharest",
    "GMT Standard Time": "Europe/London",
    "GMT Daylight Time": "Europe/London",
    "UTC": "Etc/UTC",
    "Central European Standard Time": "Europe/Warsaw",
    "SA Eastern Standard Time": "America/Buenos_Aires",
    "Pacific Standard Time": "America/Los_Angeles",
    "Pacific Standard Time (Mexico)": "America/Tijuana",
    "Mountain Standard Time": "America/Denver",
    "US Mountain Standard Time": "America/Phoenix",
    "Central Standard Time": "America/Chicago",
    "Eastern Standard Time": "America/New_York",
    "China Standard Time": "Asia/Shanghai",
    "Tokyo Standard Time": "Asia/Tokyo",
    "India Standard Time": "Asia/Kolkata",
    "Arab Standard Time": "Asia/Riyadh",
    "AUS Eastern Standard Time": "Australia/Sydney",
    "New Zealand Standard Time": "Pacific/Auckland",
    "Greenwich Standard Time": "Atlantic/Reykjavik",
    "Russian Standard Time": "Europe/Moscow",
  };
  return map[windowsTz] || windowsTz; // Devuelve el mismo si ya es IANA
}

// ==============================================
// 🧮 Obtener offset horario fijo (sin DST)
// ==============================================
function getStandardOffsetMinutes(tzid) {
  const refDate = new Date(Date.UTC(2025, 0, 1)); // referencia fija (enero = sin DST)
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tzid,
    hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit"
  });
  const parts = dtf.formatToParts(refDate);
  const vals = Object.fromEntries(parts.map(p => [p.type, p.value]));
  const local = Date.UTC(vals.year, vals.month - 1, vals.day, vals.hour, vals.minute, vals.second);
  const diffMinutes = (local - refDate.getTime()) / 60000;
  return diffMinutes;
}



// ==============================================
// 🧩 CREATE EVENT CARD
// ==============================================
function createEventCard(ev) {
  const card = document.createElement("div");
  card.classList.add("event-card", ev.category);

  const parts = [];
  parts.push(`${formatTime(ev.start)} — ${formatTime(ev.end)}`);
  if (SHOW_DESCRIPTION && ev.description) parts.push(`[ ${ev.description}]`);
  if (SHOW_LOCATION && ev.location) parts.push(`📍 ${ev.location}`);

  const infoLine = parts.join(" • ");

  card.innerHTML = `
    <div class="info">
      <div class="title">${ev.title}</div>
      <div class="details-line">${infoLine}</div>
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
    card.classList.add("active");
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
// 🧱 SCALING + SPACING
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

  // ✅ Responsive: si es móvil, desactiva el escalado dinámico
  const isMobile = window.innerWidth <= 600;
  if (isMobile) {
    document.querySelectorAll(".event-card").forEach((c) => {
      c.style.height = "auto";
      c.style.fontSize = "1em";
      c.style.margin = "8px 0";
      c.style.padding = "12px";
    });
    return; // no aplicamos escalado dinámico en móviles
  }

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
setInterval(() => {
  console.log("🔄 Auto-refreshing events...");
  loadEvents();
}, 5 * 60 * 1000);






