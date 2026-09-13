import { randomUUID, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { db } from './_db.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email et mot de passe requis' });
    }

    const result = await db.execute({
      sql: `SELECT * FROM users WHERE email = ?`,
      args: [email],
    });

    const user = result.rows[0];

    if (!user) {
      return res.status(401).json({ error: 'Email ou mot de passe invalide' });
    }

    const candidateHash = scryptSync(password, user.password_salt, 64);
    const storedHash = Buffer.from(user.password_hash, 'hex');

    if (
      candidateHash.length !== storedHash.length ||
      !timingSafeEqual(candidateHash, storedHash)
    ) {
      return res.status(401).json({ error: 'Email ou mot de passe invalide' });
    }

    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await db.execute({
      sql: `INSERT INTO user_sessions (id, user_id, token, expires_at)
            VALUES (?, ?, ?, ?)`,
      args: [randomUUID(), user.id, token, expiresAt.toISOString()],
    });

    await db.execute({
      sql: `UPDATE users SET last_login = datetime('now') WHERE id = ?`,
      args: [user.id],
    });

    return res.json({
      ok: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        nom: user.nom,
        prenom: user.prenom,
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
}
