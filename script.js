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
          console.log("📥 Fetching ICS:", u);
          const proxied = "https://corsproxy.io/?" + encodeURIComponent(u);
          const resp = await fetch(proxied);
          const text = await resp.text();

          const parsed = parseICS(text); //nuevo
          console.log(`✔️ Parsed ${parsed.length} events from`, u); //nuevo

          return parsed.map((e) => ({ ...e, category })); //nuevo
          //return parseICS(text).map((e) => ({ ...e, category }));  //original
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
// 📅 ICS PARSER (con soporte TZID + Windows → IANA + conversión UTC real sin DST)
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

    const startISO = parseICSTime(start, endBlock, "START");
    const endISO = parseICSTime(end, endBlock, "END");

    events.push({ title: summary, description, location, start: startISO, end: endISO });
  }
  return events;
}

// ==============================================
// 🔍 Extrae campos ICS
// ==============================================
function matchField(block, key) {
  const regex = new RegExp(`${key}(?:;[^:]+)?:([^\n\r]+)`);
  const match = block.match(regex);
  if (!match) return null;
  return match[1].trim().replace(/\\n/g, "\n").replace(/\\\\/g, "\\");
}

// ==============================================
// 🕒 Conversión ICS → ISO (sin DST, siempre UTC real)
// ==============================================
function parseICSTime(value, block = "", label = "") {
  if (!value) return null;

  // Detectar zona horaria (TZID)
  const tzMatch = block.match(/TZID=([^:;]+)/);
  let tzid = tzMatch ? tzMatch[1].trim() : null;
  if (tzid) tzid = convertWindowsToIANA(tzid);

  // 📅 Fecha sin hora
  if (/^\d{8}$/.test(value)) {
    return `${value.slice(0,4)}-${value.slice(4,6)}-${value.slice(6,8)}T00:00:00Z`;
  }

  // 🕘 Hora UTC explícita
  if (/^\d{8}T\d{6}Z$/.test(value)) {
    return `${value.slice(0,4)}-${value.slice(4,6)}-${value.slice(6,8)}T${value.slice(9,11)}:${value.slice(11,13)}:${value.slice(13,15)}Z`;
  }

  // 🕒 Hora local (con o sin TZID)
  if (/^\d{8}T\d{6}$/.test(value)) {
    const year = +value.slice(0,4);
    const month = +value.slice(4,6) - 1;
    const day = +value.slice(6,8);
    const hour = +value.slice(9,11);
    const minute = +value.slice(11,13);
    const second = +value.slice(13,15);

    // Crear una fecha base (en milisegundos)
    let baseMs = Date.UTC(year, month, day, hour, minute, second);

    if (tzid) {
      try {
        // Obtener offset estándar de esa zona (sin DST)
        const offsetHours = getStandardOffsetHours(tzid);
        const utcMs = baseMs - offsetHours * 60 * 60 * 1000;
        const utcISO = new Date(utcMs).toISOString();

        console.log(`🕒 [${label}] ${value} | TZID: ${tzid} | Offset: ${offsetHours} h → UTC: ${utcISO}`);
        return utcISO;
      } catch (e) {
        console.warn(`⚠️ TZID '${tzid}' no reconocido — usando hora local (${label}).`);
        return new Date(baseMs).toISOString();
      }
    }

    // Sin TZID → tratar como hora local del navegador
    return new Date(baseMs).toISOString();
  }

  return null;
}

// ==============================================
// 🧮 Obtiene offset estándar (sin DST)
// ==============================================
function getStandardOffsetHours(tzid) {
  const refDate = new Date(Date.UTC(2025, 0, 1)); // enero, sin horario de verano
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tzid,
    hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit"
  });
  const parts = dtf.formatToParts(refDate);
  const vals = Object.fromEntries(parts.map(p => [p.type, p.value]));
  const local = Date.UTC(vals.year, vals.month - 1, vals.day, vals.hour, vals.minute, vals.second);
  const diffHours = (local - refDate.getTime()) / (60*60*1000);
  return diffHours;
}

// ==============================================
// 🌍 Conversión Windows TZ → IANA
// ==============================================
const WINDOWS_TZ_MAP = {
  "Dateline Standard Time": "Etc/GMT+12",
  "Hawaiian Standard Time": "Pacific/Honolulu",
  "Alaskan Standard Time": "America/Anchorage",
  "Pacific Standard Time": "America/Los_Angeles",
  "Mountain Standard Time": "America/Denver",
  "US Mountain Standard Time": "America/Phoenix",
  "Central Standard Time": "America/Chicago",
  "Eastern Standard Time": "America/New_York",
  "Atlantic Standard Time": "America/Halifax",
  "SA Pacific Standard Time": "America/Bogota",
  "Venezuela Standard Time": "America/Caracas",
  "Paraguay Standard Time": "America/Asuncion",
  "Argentina Standard Time": "America/Argentina/Buenos_Aires",
  "Greenland Standard Time": "America/Godthab",
  "E. South America Standard Time": "America/Sao_Paulo",
  "Montevideo Standard Time": "America/Montevideo",
  "Newfoundland Standard Time": "America/St_Johns",
  "Bahia Standard Time": "America/Bahia",
  "Azores Standard Time": "Atlantic/Azores",
  "Cape Verde Standard Time": "Atlantic/Cape_Verde",
  "Morocco Standard Time": "Africa/Casablanca",
  "GMT Standard Time": "Europe/London",
  "Greenwich Standard Time": "Atlantic/Reykjavik",
  "W. Europe Standard Time": "Europe/Berlin",
  "Central Europe Standard Time": "Europe/Budapest",
  "Romance Standard Time": "Europe/Paris",
  "Central European Standard Time": "Europe/Warsaw",
  "W. Central Africa Standard Time": "Africa/Lagos",
  "Namibia Standard Time": "Africa/Windhoek",
  "Jordan Standard Time": "Asia/Amman",
  "GTB Standard Time": "Europe/Bucharest",
  "Middle East Standard Time": "Asia/Beirut",
  "Egypt Standard Time": "Africa/Cairo",
  "Syria Standard Time": "Asia/Damascus",
  "E. Europe Standard Time": "Europe/Chisinau",
  "South Africa Standard Time": "Africa/Johannesburg",
  "FLE Standard Time": "Europe/Kiev",
  "Turkey Standard Time": "Europe/Istanbul",
  "Arab Standard Time": "Asia/Riyadh",
  "Russian Standard Time": "Europe/Moscow",
  "E. Africa Standard Time": "Africa/Nairobi",
  "Iran Standard Time": "Asia/Tehran",
  "Arabian Standard Time": "Asia/Dubai",
  "Azerbaijan Standard Time": "Asia/Baku",
  "Mauritius Standard Time": "Indian/Mauritius",
  "Georgian Standard Time": "Asia/Tbilisi",
  "Caucasus Standard Time": "Asia/Yerevan",
  "Afghanistan Standard Time": "Asia/Kabul",
  "West Asia Standard Time": "Asia/Tashkent",
  "Pakistan Standard Time": "Asia/Karachi",
  "India Standard Time": "Asia/Kolkata",
  "Sri Lanka Standard Time": "Asia/Colombo",
  "Nepal Standard Time": "Asia/Kathmandu",
  "Central Asia Standard Time": "Asia/Almaty",
  "Bangladesh Standard Time": "Asia/Dhaka",
  "Myanmar Standard Time": "Asia/Yangon",
  "SE Asia Standard Time": "Asia/Bangkok",
  "N. Central Asia Standard Time": "Asia/Novosibirsk",
  "China Standard Time": "Asia/Shanghai",
  "North Asia Standard Time": "Asia/Krasnoyarsk",
  "Singapore Standard Time": "Asia/Singapore",
  "W. Australia Standard Time": "Australia/Perth",
  "Taipei Standard Time": "Asia/Taipei",
  "Ulaanbaatar Standard Time": "Asia/Ulaanbaatar",
  "North Asia East Standard Time": "Asia/Irkutsk",
  "Korea Standard Time": "Asia/Seoul",
  "Tokyo Standard Time": "Asia/Tokyo",
  "Yakutsk Standard Time": "Asia/Yakutsk",
  "Cen. Australia Standard Time": "Australia/Adelaide",
  "AUS Central Standard Time": "Australia/Darwin",
  "E. Australia Standard Time": "Australia/Brisbane",
  "AUS Eastern Standard Time": "Australia/Sydney",
  "West Pacific Standard Time": "Pacific/Port_Moresby",
  "Tasmania Standard Time": "Australia/Hobart",
  "Vladivostok Standard Time": "Asia/Vladivostok",
  "Central Pacific Standard Time": "Pacific/Guadalcanal",
  "New Zealand Standard Time": "Pacific/Auckland",
  "Tonga Standard Time": "Pacific/Tongatapu",
  "Samoa Standard Time": "Pacific/Apia",
  "Line Islands Standard Time": "Pacific/Kiritimati",

    "UTC": "Etc/UTC",
    "UTC+12": "Etc/GMT-12",
    "UTC+11": "Etc/GMT-11",
    "UTC+10": "Etc/GMT-10",
    "UTC+9": "Etc/GMT-9",
    "UTC+8": "Etc/GMT-8",
    "UTC+7": "Etc/GMT-7",
    "UTC+6": "Etc/GMT-6",
    "UTC+5": "Etc/GMT-5",
    "UTC+4": "Etc/GMT-4",
    "UTC+3": "Etc/GMT-3",
    "UTC+2": "Etc/GMT-2",
    "UTC+1": "Etc/GMT-1",
    "UTC-1": "Etc/GMT+1",
    "UTC-2": "Etc/GMT+2",
    "UTC-3": "Etc/GMT+3",
    "UTC-4": "Etc/GMT+4",
    "UTC-5": "Etc/GMT+5",
    "UTC-6": "Etc/GMT+6",
    "UTC-7": "Etc/GMT+7",
    "UTC-8": "Etc/GMT+8",
    "UTC-9": "Etc/GMT+9",
    "UTC-10": "Etc/GMT+10",
    "UTC-11": "Etc/GMT+11"
};

function convertWindowsToIANA(tzid) {
  return WINDOWS_TZ_MAP[tzid] || tzid;
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
      const days = Math.floor(diff / (24 * 3600000));
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
      const days = Math.floor(diff / (24 * 3600000));
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

  if(h>=1) {
    return `${String(h).padStart(2, "0")}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
    }
  if(h<1 && m>=1) {
    return `${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
    }
  if(h<1 && m<1) {
    return `${String(s).padStart(2, "0")}s`;
    }
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
}, 1 * 60 * 1000);






















