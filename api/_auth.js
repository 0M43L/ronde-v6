import { db } from './_db.js';

// Vérifie le Bearer token d'une requête et renvoie l'utilisateur associé,
// ou null si le token est absent/invalide/expiré.
export async function authenticate(req) {
  const token = req.headers.authorization?.split('Bearer ')[1];
  if (!token) return null;

  // allowed_tabs peut ne pas encore exister (migration pas encore passée, ou
  // pas encore déployée) : cette requête s'exécute à CHAQUE appel API, donc
  // un "no such column" ici casserait toute l'appli pour tout le monde tant
  // qu'Axel ne s'est pas reconnecté — on retombe sur l'ancienne requête.
  let result;
  try {
    result = await db.execute({
      sql: `SELECT u.id, u.email, u.nom, u.prenom, u.allowed_tabs, s.expires_at
            FROM user_sessions s
            JOIN users u ON s.user_id = u.id
            WHERE s.token = ?`,
      args: [token],
    });
  } catch (error) {
    if (!/no such column/i.test(error?.message || '')) throw error;
    result = await db.execute({
      sql: `SELECT u.id, u.email, u.nom, u.prenom, s.expires_at
            FROM user_sessions s
            JOIN users u ON s.user_id = u.id
            WHERE s.token = ?`,
      args: [token],
    });
  }

  const row = result.rows[0];
  if (!row) return null;
  if (new Date(row.expires_at) < new Date()) return null;

  // null = accès complet (comportement historique, inchangé pour tout
  // compte jamais restreint). Une valeur corrompue/illisible retombe sur
  // null plutôt que de bloquer la connexion : cette restriction est pensée
  // comme un confort d'organisation d'équipe, pas un verrou de sécurité dur
  // (voir VALID_TABS dans api/verify.js) — mieux vaut un accès complet
  // inattendu qu'un compte bloqué par une donnée mal formée.
  let allowedTabs = null;
  if (row.allowed_tabs) {
    try {
      allowedTabs = JSON.parse(row.allowed_tabs);
    } catch {
      allowedTabs = null;
    }
  }

  return { id: row.id, email: row.email, nom: row.nom, prenom: row.prenom, allowedTabs };
}

export async function requireAuth(req, res) {
  const user = await authenticate(req);
  if (!user) {
    res.status(401).json({ error: 'Non authentifié' });
    return null;
  }
  return user;
}
