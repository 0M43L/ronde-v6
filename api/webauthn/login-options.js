import { randomUUID } from 'node:crypto';
import { generateAuthenticationOptions } from '@simplewebauthn/server';
import { db } from '../_db.js';
import { getRpConfig, cleanupExpiredChallenges, CHALLENGE_TTL_MS } from './_rp.js';

// Flux "discoverable credential" (passkey) : pas besoin de demander l'email
// avant de proposer Face ID/Touch ID — le navigateur propose directement les
// identifiants disponibles pour ce site sur cet appareil, et la réponse
// signée contient elle-même l'identifiant du compte (userHandle), lu par
// login-verify.js. Pas d'utilisateur connu à cette étape : le challenge est
// donc rattaché à un id d'essai aléatoire plutôt qu'à un compte.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { rpID } = getRpConfig(req);

  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: 'preferred',
  });

  const challengeId = randomUUID();
  await cleanupExpiredChallenges(db);
  await db.execute({
    sql: `INSERT INTO webauthn_challenges (id, user_id, challenge, expires_at) VALUES (?, NULL, ?, ?)`,
    args: [challengeId, options.challenge, new Date(Date.now() + CHALLENGE_TTL_MS).toISOString()],
  });

  return res.json({ ...options, challengeId });
}
