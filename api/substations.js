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
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await requireAuth(req, res);
  if (!user) return;

  try {
    const { id } = req.query;

    if (id) {
      const result = await db.execute({
        sql: `SELECT id, name, lat, lon, notes_acces, needs_review, photos_json FROM substations WHERE id = ?`,
        args: [id],
      });
      const r = result.rows[0];
      if (!r) return res.status(404).json({ error: 'Sous-station introuvable' });
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
