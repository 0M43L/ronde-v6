import { db } from './_db.js';
import { requireAuth } from './_auth.js';

// Ajoute compteur_volume/compteur_energie à `rondes` si elles n'existent pas
// encore (idempotent — vérifie avant d'altérer). Déclenché automatiquement
// et silencieusement à la connexion d'Axel (voir enterApp() côté client),
// réservé à lui comme les autres actions de ce genre dans l'appli.
async function addMeterValueColumns() {
  const existing = await db.execute(`PRAGMA table_info(rondes)`);
  const existingNames = new Set(existing.rows.map((r) => String(r.name).toLowerCase()));
  let added = 0;
  if (!existingNames.has('compteur_volume')) {
    await db.execute(`ALTER TABLE rondes ADD COLUMN compteur_volume REAL`);
    added++;
  }
  if (!existingNames.has('compteur_energie')) {
    await db.execute(`ALTER TABLE rondes ADD COLUMN compteur_energie REAL`);
    added++;
  }
  return added;
}

// Les rondes sont partagées entre tous les techniciens (visibilité d'équipe
// sur l'activité), pas cantonnées à l'appareil qui les a créées.
export default async function handler(req, res) {
  const user = await requireAuth(req, res);
  if (!user) return;

  if (req.method === 'POST' && req.query.action === 'add-meter-value-columns') {
    if ((user?.prenom || '').toLowerCase() !== 'axel') {
      return res.status(403).json({ error: 'Réservé à Axel' });
    }
    try {
      const added = await addMeterValueColumns();
      return res.json({ ok: true, added });
    } catch (error) {
      console.error('Migration error:', error);
      return res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // ?since= (optionnel) : ne renvoie que les rondes créées après cette date.
    // Le client s'en sert pour les rechargements courants une fois qu'il a
    // déjà toute l'historique en cache local (voir loadAppData côté client) —
    // sans ça, chaque ouverture de l'appli retélécharge l'intégralité de
    // l'historique de toute l'équipe depuis le début, un poids qui ne fait
    // que grossir au fil des mois. datetime(?) normalise le format reçu
    // (ISO 8601 avec 'T'/'Z') vers celui stocké en base avant comparaison.
    const { since } = req.query;
    const baseColumns = `id, substation_id, user_id, date, heure, tech, controls_json, observations, statut, type, compteur_puissance_photo, compteur_energie_photo`;
    // compteur_volume/compteur_energie peuvent ne pas encore exister (voir
    // addMeterValueColumns() ci-dessus, pas encore lancée) : on retombe sur
    // l'ancienne liste de colonnes plutôt que de casser le chargement des
    // rondes pour tout le monde en attendant que ça arrive.
    let result;
    try {
      result = await db.execute(
        since
          ? {
              sql: `SELECT ${baseColumns}, compteur_volume, compteur_energie, created_at
                    FROM rondes WHERE created_at >= datetime(?) ORDER BY created_at DESC`,
              args: [since],
            }
          : `SELECT ${baseColumns}, compteur_volume, compteur_energie, created_at
             FROM rondes ORDER BY created_at DESC`
      );
    } catch (error) {
      if (!/no such column/i.test(error?.message || '')) throw error;
      result = await db.execute(
        since
          ? { sql: `SELECT ${baseColumns}, created_at FROM rondes WHERE created_at >= datetime(?) ORDER BY created_at DESC`, args: [since] }
          : `SELECT ${baseColumns}, created_at FROM rondes ORDER BY created_at DESC`
      );
    }

    return res.json({
      ok: true,
      rondes: result.rows.map((r) => ({
        id: r.id,
        substation_id: r.substation_id,
        user_id: r.user_id,
        date: r.date,
        heure: r.heure,
        tech: r.tech,
        controls: JSON.parse(r.controls_json || '[]'),
        observations: r.observations,
        statut: r.statut || 'operationnel',
        type: r.type || 'ronde',
        compteurPuissancePhoto: r.compteur_puissance_photo || null,
        compteurEnergiePhoto: r.compteur_energie_photo || null,
        compteurVolume: r.compteur_volume ?? null,
        compteurEnergie: r.compteur_energie ?? null,
        ts: Date.parse(`${r.created_at}Z`) || 0,
      })),
    });
  } catch (error) {
    console.error('Rondes error:', error);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
}
