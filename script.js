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
// 🕒 Parse ICS time → UTC (sin DST, multiplataforma)
// ==============================================
function parseICSTime(value, block = "", label = "") {
  if (!value) return null;

  // 1️⃣ Detectar TZID (IANA o Windows)
  const tzMatch = block.match(/TZID=([^:;]+)/);
  let tzid = tzMatch ? tzMatch[1].trim() : null;
  if (tzid) tzid = convertWindowsToIANA(tzid);

  // 2️⃣ Solo fecha sin hora → medianoche UTC
  if (/^\d{8}$/.test(value)) {
    return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T00:00:00Z`;
  }

  // 3️⃣ Fecha con hora en UTC explícita
  if (/^\d{8}T\d{6}Z$/.test(value)) {
    return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(9, 11)}:${value.slice(11, 13)}:${value.slice(13, 15)}Z`;
  }

  // 4️⃣ Fecha local (con o sin TZID)
  if (/^\d{8}T\d{6}$/.test(value)) {
    const localISO = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(9, 11)}:${value.slice(11, 13)}:${value.slice(13, 15)}`;

    // Si hay TZID → convertir a UTC fijo usando offset estándar (sin DST)
    if (tzid) {
      try {
        const date = new Date(localISO);

        // Obtener offset fijo en minutos SIN considerar horario de verano
        const offsetMinutes = getStandardOffsetMinutes(tzid);
        const utcTime = date.getTime() - offsetMinutes * 60 * 1000;

        const utcISO = new Date(utcTime).toISOString();
        console.log(`🕒 [${label}] ${value} | TZID: ${tzid} → UTC: ${utcISO}`);
        return utcISO;
      } catch (e) {
        console.warn(`⚠️ TZID '${tzid}' no reconocido — usando hora local (${label}).`);
        return new Date(localISO + "Z").toISOString();
      }
    }

    // Sin TZID → tratar como hora local del navegador, convertir a UTC
    return new Date(localISO).toISOString();
  }

  return null;
}

// ==============================================
// 🧭 Convierte zonas Windows → IANA
// ==============================================
function convertWindowsToIANA(tzid) {
  const map = {
    // 🌍 Europa
    "GMT Standard Time": "Europe/London",
    "Greenwich Standard Time": "Atlantic/Reykjavik",
    "W. Europe Standard Time": "Europe/Berlin",
    "Romance Standard Time": "Europe/Paris",
    "Central Europe Standard Time": "Europe/Prague",
    "Central European Standard Time": "Europe/Warsaw",
    "E. Europe Standard Time": "Europe/Bucharest",
    "FLE Standard Time": "Europe/Helsinki",
    "GTB Standard Time": "Europe/Athens",
    "Russian Standard Time": "Europe/Moscow",
    "Turkey Standard Time": "Europe/Istanbul",
    "Israel Standard Time": "Asia/Jerusalem",
    "Arab Standard Time": "Asia/Riyadh",
    "Arabian Standard Time": "Asia/Dubai",
    "South Africa Standard Time": "Africa/Johannesburg",
    "Morocco Standard Time": "Africa/Casablanca",
    "Egypt Standard Time": "Africa/Cairo",
    "Namibia Standard Time": "Africa/Windhoek",

    // 🇺🇸 América
    "Pacific Standard Time": "America/Los_Angeles",
    "US Mountain Standard Time": "America/Phoenix",
    "Mountain Standard Time": "America/Denver",
    "Central Standard Time": "America/Chicago",
    "Eastern Standard Time": "America/New_York",
    "Atlantic Standard Time": "America/Halifax",
    "SA Pacific Standard Time": "America/Bogota",
    "Argentina Standard Time": "America/Argentina/Buenos_Aires",
    "E. South America Standard Time": "America/Sao_Paulo",
    "Greenland Standard Time": "America/Godthab",
    "Newfoundland Standard Time": "America/St_Johns",

    // 🇨🇦 Canadá
    "Canada Central Standard Time": "America/Regina",
    "Atlantic Standard Time (Canada)": "America/Halifax",

    // 🇲🇽 México y Centroamérica
    "Central America Standard Time": "America/Guatemala",
    "Mexico Standard Time": "America/Mexico_City",
    "Mountain Standard Time (Mexico)": "America/Chihuahua",
    "Pacific Standard Time (Mexico)": "America/Tijuana",

    // 🇦🇸 América del Sur
    "Venezuela Standard Time": "America/Caracas",
    "Paraguay Standard Time": "America/Asuncion",
    "SA Eastern Standard Time": "America/Cayenne",
    "Uruguay Standard Time": "America/Montevideo",

    // 🌏 Asia y Oceanía
    "West Asia Standard Time": "Asia/Tashkent",
    "Pakistan Standard Time": "Asia/Karachi",
    "India Standard Time": "Asia/Kolkata",
    "Nepal Standard Time": "Asia/Kathmandu",
    "Bangladesh Standard Time": "Asia/Dhaka",
    "Myanmar Standard Time": "Asia/Yangon",
    "SE Asia Standard Time": "Asia/Bangkok",
    "China Standard Time": "Asia/Shanghai",
    "Singapore Standard Time": "Asia/Singapore",
    "Taipei Standard Time": "Asia/Taipei",
    "Tokyo Standard Time": "Asia/Tokyo",
    "Korea Standard Time": "Asia/Seoul",
    "AUS Central Standard Time": "Australia/Adelaide",
    "AUS Eastern Standard Time": "Australia/Sydney",
    "E. Australia Standard Time": "Australia/Brisbane",
    "West Pacific Standard Time": "Pacific/Port_Moresby",
    "Central Pacific Standard Time": "Pacific/Guadalcanal",
    "New Zealand Standard Time": "Pacific/Auckland",
    "Tonga Standard Time": "Pacific/Tongatapu",
    "Fiji Standard Time": "Pacific/Fiji",

    // 🧊 Ártico / Islas
    "Azores Standard Time": "Atlantic/Azores",
    "Cape Verde Standard Time": "Atlantic/Cape_Verde",
    "UTC": "Etc/UTC",
    "UTC+12": "Etc/GMT-12",
    "UTC+11": "Etc/GMT-11",
    "UTC+10": "Etc/GMT-10",
    "UTC+09": "Etc/GMT-9",
    "UTC+08": "Etc/GMT-8",
    "UTC+07": "Etc/GMT-7",
    "UTC+06": "Etc/GMT-6",
    "UTC+05": "Etc/GMT-5",
    "UTC+04": "Etc/GMT-4",
    "UTC+03": "Etc/GMT-3",
    "UTC+02": "Etc/GMT-2",
    "UTC+01": "Etc/GMT-1",
    "UTC-01": "Etc/GMT+1",
    "UTC-02": "Etc/GMT+2",
    "UTC-03": "Etc/GMT+3",
    "UTC-04": "Etc/GMT+4",
    "UTC-05": "Etc/GMT+5",
    "UTC-06": "Etc/GMT+6",
    "UTC-07": "Etc/GMT+7",
    "UTC-08": "Etc/GMT+8",
    "UTC-09": "Etc/GMT+9",
    "UTC-10": "Etc/GMT+10",
    "UTC-11": "Etc/GMT+11"
  };

  return map[tzid] || tzid;
}

// ==============================================
// ⏳ Calcula offset estándar (sin DST)
// ==============================================
function getStandardOffsetMinutes(tzid) {
  // Tomamos una fecha en enero (invierno) para evitar horario de verano
  const jan = new Date(Date.UTC(2025, 0, 1, 0, 0, 0));
  const janLocale = new Intl.DateTimeFormat("en-US", {
    timeZone: tzid,
    hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit"
  }).formatToParts(jan);

  const parts = Object.fromEntries(janLocale.map(p => [p.type, p.value]));
  const localTime = Date.UTC(
    parseInt(parts.year), parseInt(parts.month) - 1, parseInt(parts.day),
    parseInt(parts.hour), parseInt(parts.minute), parseInt(parts.second)
  );

  const diffMs = localTime - jan.getTime();
  return diffMs / (60 * 1000); // offset en minutos
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





