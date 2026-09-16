import { randomUUID, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { db } from './_db.js';

// Bloque un compte après plusieurs échecs d'affilée, le temps d'un délai —
// limite le nombre de mots de passe qu'un tiers peut essayer sur un compte
// donné, sans pour autant nécessiter d'infrastructure externe (juste deux
// colonnes sur users, voir schema.sql).
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

// Hash "leurre" utilisé quand l'email n'existe pas, pour que la réponse
// prenne à peu près le même temps que pour un email existant : sans ça, le
// temps de réponse (rapide si l'email est inconnu, plus lent une fois le
// scrypt effectué s'il est connu) permettrait de deviner quels emails sont
// des comptes valides avant même de tester un mot de passe.
const DUMMY_SALT = 'dummy-salt-constant-time-decoy';

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
      scryptSync(password, DUMMY_SALT, 64);
      return res.status(401).json({ error: 'Email ou mot de passe invalide' });
    }

    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      return res.status(429).json({ error: 'Trop de tentatives, réessaie dans quelques minutes' });
    }

    const candidateHash = scryptSync(password, user.password_salt, 64);
    const storedHash = Buffer.from(user.password_hash, 'hex');

    if (
      candidateHash.length !== storedHash.length ||
      !timingSafeEqual(candidateHash, storedHash)
    ) {
      const attempts = (user.failed_login_count || 0) + 1;
      const lockedUntil = attempts >= MAX_ATTEMPTS ? new Date(Date.now() + LOCKOUT_MS).toISOString() : null;
      // Ne doit jamais faire échouer la connexion elle-même : si la migration
      // (colonnes failed_login_count/locked_until) n'a pas encore été
      // appliquée en base, on se contente de ne pas compter cette tentative
      // plutôt que de renvoyer une erreur 500 à la place du simple "mot de
      // passe invalide" habituel.
      try {
        await db.execute({
          sql: `UPDATE users SET failed_login_count = ?, locked_until = ? WHERE id = ?`,
          args: [attempts, lockedUntil, user.id],
        });
      } catch (e) {
        console.error('Login lockout update skipped (migration manquante ?):', e.message);
      }
      return res.status(401).json({ error: 'Email ou mot de passe invalide' });
    }

    if (user.failed_login_count || user.locked_until) {
      try {
        await db.execute({
          sql: `UPDATE users SET failed_login_count = 0, locked_until = NULL WHERE id = ?`,
          args: [user.id],
        });
      } catch (e) {
        console.error('Login lockout reset skipped (migration manquante ?):', e.message);
      }
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
