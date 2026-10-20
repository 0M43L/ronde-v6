import { db } from './_db.js';
import { requireAuth } from './_auth.js';

// Les notes d'accès (codes portail, mots de passe d'armoire...) sont sensibles :
// cet endpoint exige une authentification.
//
// Les photos (potentiellement nombreuses/lourdes en base64) ne sont PAS
// incluses dans la liste globale : avec 140 sites et des galeries qui
// grossissent au fil des mois, les embarquer à chaque chargement de l'appli
// ferait gonfler la charge réseau pour tout le monde alors qu'un technicien
// ne regarde en général que le site sur lequel il se trouve. Le détail d'un
// site (avec ses photos) se récupère à la demande via ?id=.
// Corrélation ponctuelle des sites sans position GPS (créés en tapant un nom
// pendant une ronde, voir resolveOrCreateSubstation() côté client) avec un
// site déjà positionné dont ils sont en réalité le même site physique
// (nom retapé légèrement différemment). Déclenchée depuis l'app par le
// bouton "Corriger les positions GPS" (réservé à Axel, voir gpsBackfillBtn
// dans js/app.js). Les deux sites de chaque paire, plus ceux sans aucune
// correspondance fiable, sont marqués needs_review=1 (voyant bleu "Position
// à vérifier") pour une confirmation/fusion sur le terrain.
const GPS_MATCHED_PAIRS = [
  ['Arcas 2', 'Arcas 1'],
  ['Bouvet 1', 'bouvet 1 et 2'],
  ['Bouvet 2', 'bouvet 1 et 2'],
  ['Fosse bouvet', 'fosse boulevard des bouvet'],
  ['De lalande', 'de Lalande ampère watt'],
  ['MB 11 12', 'MB 11 et 12'],
  ['Mb1', 'MB1 wp2'],
  ['PB17', 'PB17-18-19'],
  ['PB26', 'pb26 ph22'],
  ['Ph28', 'PH28 PB28'],
  ['UGC', 'uGC colline de la défense/ De l’auto'],
  ['Valmy chambre 2', 'Valmy-renaissance'],
  ['Valmy chambre 3', 'Valmy-renaissance'],
  ['Jules vernes habitation', 'Jules verne habitations'],
  ['GS hanriot', 'Hanriot Station D’échange'], // approximatif
  ['CB 22 Alsace centre', 'Alsace Ouest'], // approximatif
];

async function runGpsBackfill() {
  const { rows } = await db.execute(`SELECT id, name, lat, lon, needs_review FROM substations`);
  const byName = new Map(rows.map((r) => [r.name, r]));

  let backfilled = 0;
  let flaggedTargets = 0;
  let flaggedUnmatched = 0;

  for (const [srcName, tgtName] of GPS_MATCHED_PAIRS) {
    const src = byName.get(srcName);
    const tgt = byName.get(tgtName);
    if (!src || !tgt) continue;
    await db.execute({
      sql: `UPDATE substations SET lat = ?, lon = ?, needs_review = 1, updated_at = datetime('now') WHERE id = ?`,
      args: [tgt.lat, tgt.lon, src.id],
    });
    backfilled++;
    if (!tgt.needs_review) {
      await db.execute({
        sql: `UPDATE substations SET needs_review = 1, updated_at = datetime('now') WHERE id = ?`,
        args: [tgt.id],
      });
      flaggedTargets++;
    }
  }

  const matchedSourceNames = new Set(GPS_MATCHED_PAIRS.map(([src]) => src));
  for (const r of rows) {
    if (r.lat != null && r.lon != null) continue;
    if (matchedSourceNames.has(r.name)) continue;
    await db.execute({
      sql: `UPDATE substations SET needs_review = 1, updated_at = datetime('now') WHERE id = ?`,
      args: [r.id],
    });
    flaggedUnmatched++;
  }

  return { backfilled, flaggedTargets, flaggedUnmatched };
}

export default async function handler(req, res) {
  const user = await requireAuth(req, res);
  if (!user) return;

  if (req.method === 'POST' && req.query.action === 'backfill-gps-correlation') {
    if ((user?.prenom || '').toLowerCase() !== 'axel') {
      return res.status(403).json({ error: 'Réservé à Axel' });
    }
    try {
      const result = await runGpsBackfill();
      return res.json({ ok: true, ...result });
    } catch (error) {
      console.error('GPS backfill error:', error);
      return res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { id } = req.query;

    if (id) {
      const result = await db.execute({
        sql: `SELECT id, name, lat, lon, notes_acces, needs_review, photos_json, comments_json FROM substations WHERE id = ?`,
        args: [id],
      });
      const r = result.rows[0];
      if (!r) return res.status(404).json({ error: 'Site introuvable' });
      return res.json({
        ok: true,
        substation: {
          id: r.id,
          name: r.name,
          lat: r.lat,
          lon: r.lon,
          notes_acces: r.notes_acces,
          needs_review: !!r.needs_review,
          photos: JSON.parse(r.photos_json || '[]'),
          comments: JSON.parse(r.comments_json || '[]'),
        },
      });
    }

    const result = await db.execute(`SELECT id, name, lat, lon, notes_acces, needs_review FROM substations ORDER BY name`);

    return res.json({
      ok: true,
      substations: result.rows.map((r) => ({
        id: r.id,
        name: r.name,
        lat: r.lat,
        lon: r.lon,
        notes_acces: r.notes_acces,
        needs_review: !!r.needs_review,
      })),
    });
  } catch (error) {
    console.error('Substations error:', error);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
}
