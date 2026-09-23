import { randomUUID } from 'node:crypto';
import { verifyRegistrationResponse } from '@simplewebauthn/server';
import { db } from '../_db.js';
import { requireAuth } from '../_auth.js';
import { getRpConfig } from './_rp.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await requireAuth(req, res);
  if (!user) return;

  const { deviceName, ...attestationResponse } = req.body || {};

  const challengeRow = await db.execute({
    sql: `SELECT id, challenge FROM webauthn_challenges WHERE user_id = ? AND expires_at > datetime('now') ORDER BY expires_at DESC LIMIT 1`,
    args: [user.id],
  });
  const stored = challengeRow.rows[0];
  if (!stored) {
    return res.status(400).json({ error: 'Aucune demande d\'inscription en cours ou expirée, réessaie.' });
  }

  const { rpID, origin } = getRpConfig(req);

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: attestationResponse,
      expectedChallenge: stored.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
    });
  } catch (error) {
    console.error('WebAuthn register-verify error:', error);
    return res.status(400).json({ error: 'Vérification impossible, réessaie.' });
  }

  await db.execute({ sql: `DELETE FROM webauthn_challenges WHERE id = ?`, args: [stored.id] });

  if (!verification.verified || !verification.registrationInfo) {
    return res.status(400).json({ error: 'Vérification échouée, réessaie.' });
  }

  const { credential } = verification.registrationInfo;

  await db.execute({
    sql: `INSERT INTO webauthn_credentials (id, user_id, credential_id, public_key, counter, transports, device_name)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [
      randomUUID(),
      user.id,
      credential.id,
      Buffer.from(credential.publicKey).toString('base64'),
      credential.counter,
      JSON.stringify(credential.transports || []),
      deviceName || null,
    ],
  });

  return res.json({ ok: true });
}
