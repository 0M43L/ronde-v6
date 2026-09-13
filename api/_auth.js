import { db } from './_db.js';

// Vérifie le Bearer token d'une requête et renvoie l'utilisateur associé,
// ou null si le token est absent/invalide/expiré.
export async function authenticate(req) {
  const token = req.headers.authorization?.split('Bearer ')[1];
  if (!token) return null;

  const result = await db.execute({
    sql: `SELECT u.id, u.email, u.nom, u.prenom, s.expires_at
          FROM user_sessions s
          JOIN users u ON s.user_id = u.id
          WHERE s.token = ?`,
    args: [token],
  });

  const row = result.rows[0];
  if (!row) return null;
  if (new Date(row.expires_at) < new Date()) return null;

  return { id: row.id, email: row.email, nom: row.nom, prenom: row.prenom };
}

export async function requireAuth(req, res) {
  const user = await authenticate(req);
  if (!user) {
    res.status(401).json({ error: 'Non authentifié' });
    return null;
  }
  return user;
}
