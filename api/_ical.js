// Analyseur ICS (RFC 5545) minimal, pensé pour un agenda Google Calendar
// d'équipe simple (réunions, rappels, quelques récurrences classiques).
// Volontairement pas exhaustif — pas de dépendance tierce pour un usage
// aussi ciblé : voir expandOccurrences() pour les limites de récurrence.

function unfoldLines(text) {
  // Une ligne qui commence par une espace/tabulation continue la précédente.
  const lines = text.split(/\r\n|\n|\r/);
  const out = [];
  for (const line of lines) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && out.length) {
      out[out.length - 1] += line.slice(1);
    } else {
      out.push(line);
    }
  }
  return out;
}

function parseLine(line) {
  const colonIndex = line.indexOf(':');
  if (colonIndex === -1) return null;
  const left = line.slice(0, colonIndex);
  const value = line.slice(colonIndex + 1);
  const [name, ...paramParts] = left.split(';');
  const params = {};
  for (const p of paramParts) {
    const eq = p.indexOf('=');
    if (eq === -1) continue;
    params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1);
  }
  return { name: name.toUpperCase(), params, value };
}

function unescapeText(value) {
  return value.replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
}

// Les dates avec TZID sont traitées comme si elles étaient déjà en UTC :
// approximation volontaire (pas de base de fuseaux horaires ici) qui ne
// décale l'affichage que d'1-2h près de minuit — acceptable pour un agenda
// d'équipe consulté en France, pas pour un moteur de planification.
function parseDateValue(field) {
  const { params, value } = field;
  if (!value) return null;
  if (params.VALUE === 'DATE' || /^\d{8}$/.test(value)) {
    const y = Number(value.slice(0, 4));
    const m = Number(value.slice(4, 6));
    const d = Number(value.slice(6, 8));
    return { date: new Date(Date.UTC(y, m - 1, d)), allDay: true };
  }
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(value);
  if (!match) return null;
  const [, y, m, d, h, min, s] = match;
  return { date: new Date(Date.UTC(+y, +m - 1, +d, +h, +min, +s)), allDay: false };
}

function parseRRuleValue(value) {
  const parts = Object.fromEntries(value.split(';').map((p) => p.split('=')));
  return {
    freq: parts.FREQ,
    interval: Math.max(1, Number(parts.INTERVAL) || 1),
    count: parts.COUNT ? Number(parts.COUNT) : null,
    until: parts.UNTIL ? parseDateValue({ params: {}, value: parts.UNTIL })?.date || null : null,
    byday: parts.BYDAY ? parts.BYDAY.split(',') : null,
  };
}

// Analyse le texte ICS brut en une liste de VEVENT (sans expansion des
// récurrences — voir expandEvents()).
export function parseIcs(text) {
  const lines = unfoldLines(text);
  const events = [];
  let current = null;
  for (const raw of lines) {
    if (!raw) continue;
    if (raw === 'BEGIN:VEVENT') {
      current = {};
      continue;
    }
    if (raw === 'END:VEVENT') {
      if (current) events.push(current);
      current = null;
      continue;
    }
    if (!current) continue;
    const field = parseLine(raw);
    if (!field) continue;
    switch (field.name) {
      case 'UID':
        current.uid = field.value;
        break;
      case 'SUMMARY':
        current.title = unescapeText(field.value);
        break;
      case 'LOCATION':
        current.location = unescapeText(field.value);
        break;
      case 'DTSTART':
        current.dtstart = parseDateValue(field);
        break;
      case 'DTEND':
        current.dtend = parseDateValue(field);
        break;
      case 'RRULE':
        current.rrule = parseRRuleValue(field.value);
        break;
      case 'EXDATE': {
        const parsed = parseDateValue(field);
        if (parsed) (current.exdates = current.exdates || []).push(parsed.date.getTime());
        break;
      }
      case 'RECURRENCE-ID': {
        const parsed = parseDateValue(field);
        if (parsed) current.recurrenceId = parsed.date.getTime();
        break;
      }
    }
  }
  return events;
}

const DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
// Garde-fou anti-boucle infinie (ex: INTERVAL mal formé) — largement
// suffisant pour n'importe quelle fenêtre d'affichage raisonnable (quelques
// mois) même sur une récurrence quotidienne.
const MAX_OCCURRENCES = 1000;

function addInterval(date, freq, interval) {
  const d = new Date(date);
  if (freq === 'DAILY') d.setUTCDate(d.getUTCDate() + interval);
  else if (freq === 'MONTHLY') d.setUTCMonth(d.getUTCMonth() + interval);
  else if (freq === 'YEARLY') d.setUTCFullYear(d.getUTCFullYear() + interval);
  else d.setUTCDate(d.getUTCDate() + 7 * interval); // WEEKLY (sans BYDAY) et défaut
  return d;
}

// Génère les dates d'occurrence dans l'ordre chronologique, sans limite —
// c'est à l'appelant de s'arrêter (borne de fenêtre + MAX_OCCURRENCES).
// Ne couvre que les récurrences courantes d'un agenda d'équipe : FREQ
// quotidien/hebdo(+BYDAY simple)/mensuel(même jour du mois)/annuel, avec
// INTERVAL. Les règles plus fines (ex: "le 2e mardi du mois", BYMONTHDAY,
// BYSETPOS...) ne sont pas supportées et retombent sur le jour de DTSTART.
function* occurrenceDates(dtstart, rrule) {
  const { freq, interval, byday } = rrule;
  const codes = freq === 'WEEKLY' && byday?.length ? byday.map((c) => DAY_CODES.indexOf(c)).filter((i) => i !== -1).sort((a, b) => a - b) : null;

  if (codes && codes.length) {
    let weekStart = new Date(dtstart);
    weekStart.setUTCDate(weekStart.getUTCDate() - weekStart.getUTCDay());
    while (true) {
      for (const dayIndex of codes) {
        const occ = new Date(weekStart);
        occ.setUTCDate(occ.getUTCDate() + dayIndex);
        occ.setUTCHours(dtstart.getUTCHours(), dtstart.getUTCMinutes(), dtstart.getUTCSeconds(), 0);
        if (occ < dtstart) continue;
        yield occ;
      }
      weekStart = addInterval(weekStart, 'WEEKLY', interval);
    }
  } else {
    let cursor = new Date(dtstart);
    while (true) {
      yield new Date(cursor);
      cursor = addInterval(cursor, freq, interval);
    }
  }
}

function expandOccurrences(event, rangeStart, rangeEnd) {
  const { rrule, dtstart } = event;
  if (!rrule || !dtstart) return [];
  const exSet = new Set(event.exdates || []);
  const results = [];
  let count = 0;
  for (const occ of occurrenceDates(dtstart.date, rrule)) {
    if (count >= MAX_OCCURRENCES) break;
    if (rrule.until && occ > rrule.until) break;
    if (occ > rangeEnd) break; // les occurrences sortent en ordre croissant
    count++;
    if (rrule.count && count > rrule.count) break;
    if (occ >= rangeStart && !exSet.has(occ.getTime())) results.push(occ);
  }
  return results;
}

function inRange(e, rangeStart, rangeEnd) {
  const start = e.dtstart.date;
  const end = e.dtend?.date || start;
  return start <= rangeEnd && end >= rangeStart;
}

function toOutput(e, occStart) {
  const duration = e.dtend?.date && e.dtstart?.date ? e.dtend.date.getTime() - e.dtstart.date.getTime() : null;
  const end = duration != null ? new Date(occStart.getTime() + duration) : null;
  return {
    uid: e.uid || null,
    title: e.title || '(Sans titre)',
    location: e.location || null,
    allDay: !!e.dtstart.allDay,
    start: occStart.toISOString(),
    end: end ? end.toISOString() : null,
  };
}

// Prend la liste brute de parseIcs() et renvoie les occurrences (événements
// simples + récurrences expansées, hors exceptions) qui tombent dans
// [rangeStart, rangeEnd], triées chronologiquement.
export function expandEvents(rawEvents, rangeStart, rangeEnd) {
  const overridesByUid = new Map();
  for (const e of rawEvents) {
    if (e.recurrenceId && e.uid) {
      if (!overridesByUid.has(e.uid)) overridesByUid.set(e.uid, new Set());
      overridesByUid.get(e.uid).add(e.recurrenceId);
    }
  }

  const results = [];
  for (const e of rawEvents) {
    if (!e.dtstart) continue;
    if (e.recurrenceId) {
      // Occurrence d'une série récurrente déplacée/modifiée individuellement
      // (Google l'émet comme un VEVENT à part, avec son propre DTSTART).
      if (inRange(e, rangeStart, rangeEnd)) results.push(toOutput(e, e.dtstart.date));
      continue;
    }
    if (e.rrule) {
      const overrides = overridesByUid.get(e.uid);
      for (const occ of expandOccurrences(e, rangeStart, rangeEnd)) {
        if (overrides && overrides.has(occ.getTime())) continue;
        results.push(toOutput(e, occ));
      }
    } else if (inRange(e, rangeStart, rangeEnd)) {
      results.push(toOutput(e, e.dtstart.date));
    }
  }
  results.sort((a, b) => new Date(a.start) - new Date(b.start));
  return results;
}
