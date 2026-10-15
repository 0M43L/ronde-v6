import { requireAuth } from './_auth.js';
import { parseIcs, expandEvents } from './_ical.js';

// Agenda d'équipe (Google Calendar) affiché dans la page Actions. Basé sur
// l'adresse secrète iCal du calendrier (Google Calendar > Paramètres du
// calendrier partagé > "Intégrer l'agenda" > "Adresse secrète au format
// iCal"), jamais exposée au client : tout passe par ce endpoint, qui la lit
// depuis une variable d'environnement serveur et ne renvoie que les
// événements déjà extraits. Pas d'écriture possible depuis l'appli (lecture
// seule, comme n'importe quel abonnement iCal).
const DEFAULT_WINDOW_DAYS = 30;
const MAX_WINDOW_DAYS = 90;
const FETCH_TIMEOUT_MS = 8000;

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await requireAuth(req, res);
  if (!user) return;

  const icalUrl = process.env.TEAM_CALENDAR_ICAL_URL;
  if (!icalUrl) {
    // Pas encore configurée : pas une erreur, juste "rien à afficher" — le
    // client distingue ce cas pour expliquer comment l'activer plutôt que
    // d'afficher une erreur.
    return res.json({ ok: true, configured: false, events: [] });
  }

  try {
    const days = Math.min(MAX_WINDOW_DAYS, Math.max(1, Number(req.query.days) || DEFAULT_WINDOW_DAYS));
    const rangeStart = new Date();
    rangeStart.setUTCHours(0, 0, 0, 0);
    const rangeEnd = new Date(rangeStart);
    rangeEnd.setUTCDate(rangeEnd.getUTCDate() + days);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let text;
    try {
      const response = await fetch(icalUrl, { signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      text = await response.text();
    } finally {
      clearTimeout(timeout);
    }

    const events = expandEvents(parseIcs(text), rangeStart, rangeEnd);
    return res.json({ ok: true, configured: true, events });
  } catch (error) {
    // Le calendrier d'équipe n'est qu'un enrichissement de la page Actions :
    // une erreur ici (flux inaccessible, timeout...) ne doit jamais empêcher
    // le reste de la page de fonctionner. On répond 200 avec un tableau vide
    // plutôt que de faire échouer l'appel côté client.
    console.error('Team calendar error:', error);
    return res.json({ ok: true, configured: true, events: [], error: 'fetch_failed' });
  }
}
