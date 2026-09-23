import { randomUUID, randomBytes } from 'node:crypto';
import { verifyAuthenticationResponse } from '@simplewebauthn/server';
import { db } from '../_db.js';
import { getRpConfig } from './_rp.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { challengeId, response } = req.body || {};
  if (!challengeId || !response) {
    return res.status(400).json({ error: 'Requête invalide' });
  }

  const challengeRow = await db.execute({
    sql: `SELECT challenge FROM webauthn_challenges WHERE id = ? AND expires_at > datetime('now')`,
    args: [challengeId],
  });
  const stored = challengeRow.rows[0];
  if (!stored) {
    return res.status(400).json({ error: 'Session de connexion expirée, réessaie.' });
  }
  // Utilisable une seule fois, avant même de tenter la vérification —
  // qu'elle réussisse ou échoue, ce challenge ne doit jamais resservir.
  await db.execute({ sql: `DELETE FROM webauthn_challenges WHERE id = ?`, args: [challengeId] });

  // userHandle porte l'id utilisateur choisi à l'inscription (voir
  // register-options.js : userID = l'id du compte) — c'est ce qui permet de
  // retrouver le compte sans avoir demandé d'email au préalable.
  const userHandle = response?.response?.userHandle;
  if (!userHandle) {
    return res.status(400).json({ error: 'Identifiant Face ID/Touch ID introuvable, réessaie.' });
  }

  let userId;
  try {
    userId = Buffer.from(userHandle, 'base64url').toString('utf8');
  } catch {
    return res.status(400).json({ error: 'Requête invalide' });
  }

  const credRow = await db.execute({
    sql: `SELECT wc.id, wc.credential_id, wc.public_key, wc.counter, wc.transports, u.id as uid, u.email, u.nom, u.prenom
          FROM webauthn_credentials wc
          JOIN users u ON u.id = wc.user_id
          WHERE wc.user_id = ? AND wc.credential_id = ?`,
    args: [userId, response.id],
  });
  const cred = credRow.rows[0];
  if (!cred) {
    return res.status(400).json({ error: 'Identifiant Face ID/Touch ID inconnu, connecte-toi avec ton mot de passe.' });
  }

  const { rpID, origin } = getRpConfig(req);

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: stored.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: {
        id: cred.credential_id,
        publicKey: Buffer.from(cred.public_key, 'base64'),
        counter: cred.counter,
        transports: cred.transports ? JSON.parse(cred.transports) : undefined,
      },
    });
  } catch (error) {
    console.error('WebAuthn login-verify error:', error);
    return res.status(400).json({ error: 'Vérification impossible, réessaie.' });
  }

  if (!verification.verified) {
    return res.status(401).json({ error: 'Vérification échouée, connecte-toi avec ton mot de passe.' });
  }

  // Protège contre le rejeu d'une réponse d'authentificateur clonée : un
  // compteur qui n'augmente pas d'une connexion à l'autre est le signe qu'un
  // authentificateur a été dupliqué.
  await db.execute({
    sql: `UPDATE webauthn_credentials SET counter = ? WHERE id = ?`,
    args: [verification.authenticationInfo.newCounter, cred.id],
  });

  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  await db.execute({
    sql: `INSERT INTO user_sessions (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)`,
    args: [randomUUID(), userId, token, expiresAt.toISOString()],
  });

  await db.execute({ sql: `UPDATE users SET last_login = datetime('now') WHERE id = ?`, args: [userId] });

  return res.json({
    ok: true,
    token,
    user: { id: userId, email: cred.email, nom: cred.nom, prenom: cred.prenom },
  });
}
