import { randomUUID, randomBytes } from 'node:crypto';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import { db } from './_db.js';
import { requireAuth } from './_auth.js';

// Les 5 routes WebAuthn (register-options/verify, login-options/verify,
// credentials) sont regroupées dans un seul fichier — pas par choix
// d'architecture mais pour rester sous la limite de fonctions serverless du
// plan Vercel Hobby (12) : 5 fichiers séparés faisaient passer ce projet à
// 15 fonctions au total et cassaient le déploiement.

// rpID/origin dérivés de la requête plutôt que codés en dur : l'appli est
// servie à la fois sur le domaine de prod et sur des previews Vercel
// (*.vercel.app), et WebAuthn exige que rpID corresponde exactement au
// domaine réellement utilisé par le navigateur.
function getRpConfig(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const rpID = host.split(':')[0];
  const origin = `${proto}://${host}`;
  return { rpID, origin };
}

// Purge opportuniste des challenges expirés (pas de cron séparé pour une
// table aussi petite) : appelée à chaque génération d'un nouveau challenge.
async function cleanupExpiredChallenges() {
  await db.execute(`DELETE FROM webauthn_challenges WHERE expires_at < datetime('now')`);
}

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

async function handleRegisterOptions(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const user = await requireAuth(req, res);
  if (!user) return;

  const { rpID } = getRpConfig(req);

  const existing = await db.execute({
    sql: `SELECT credential_id, transports FROM webauthn_credentials WHERE user_id = ?`,
    args: [user.id],
  });

  const options = await generateRegistrationOptions({
    rpName: 'Ronde V6',
    rpID,
    userName: user.email,
    userID: Buffer.from(user.id, 'utf8'),
    userDisplayName: `${user.prenom} ${user.nom}`.trim(),
    attestationType: 'none',
    excludeCredentials: existing.rows.map((r) => ({
      id: r.credential_id,
      transports: r.transports ? JSON.parse(r.transports) : undefined,
    })),
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred',
      authenticatorAttachment: 'platform',
    },
  });

  await cleanupExpiredChallenges();
  await db.execute({
    sql: `INSERT INTO webauthn_challenges (id, user_id, challenge, expires_at) VALUES (?, ?, ?, ?)`,
    args: [randomUUID(), user.id, options.challenge, new Date(Date.now() + CHALLENGE_TTL_MS).toISOString()],
  });

  return res.json(options);
}

async function handleRegisterVerify(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

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

// Flux "discoverable credential" (passkey) : pas besoin de demander l'email
// avant de proposer Face ID/Touch ID — le navigateur propose directement les
// identifiants disponibles pour ce site sur cet appareil, et la réponse
// signée contient elle-même l'identifiant du compte (userHandle), lu par
// handleLoginVerify. Pas d'utilisateur connu à cette étape : le challenge
// est donc rattaché à un id d'essai aléatoire plutôt qu'à un compte.
async function handleLoginOptions(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { rpID } = getRpConfig(req);

  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: 'preferred',
  });

  const challengeId = randomUUID();
  await cleanupExpiredChallenges();
  await db.execute({
    sql: `INSERT INTO webauthn_challenges (id, user_id, challenge, expires_at) VALUES (?, NULL, ?, ?)`,
    args: [challengeId, options.challenge, new Date(Date.now() + CHALLENGE_TTL_MS).toISOString()],
  });

  return res.json({ ...options, challengeId });
}

async function handleLoginVerify(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

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
  // handleRegisterOptions : userID = l'id du compte) — c'est ce qui permet
  // de retrouver le compte sans avoir demandé d'email au préalable.
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

// Liste ou révoque les appareils Face ID/Touch ID du compte connecté — pour
// pouvoir retirer un ancien téléphone perdu ou remplacé sans devoir changer
// le mot de passe.
async function handleCredentials(req, res) {
  const user = await requireAuth(req, res);
  if (!user) return;

  if (req.method === 'GET') {
    const result = await db.execute({
      sql: `SELECT id, device_name, created_at FROM webauthn_credentials WHERE user_id = ? ORDER BY created_at DESC`,
      args: [user.id],
    });
    return res.json({ ok: true, credentials: result.rows });
  }

  if (req.method === 'DELETE') {
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ error: 'id requis' });
    await db.execute({
      sql: `DELETE FROM webauthn_credentials WHERE id = ? AND user_id = ?`,
      args: [id, user.id],
    });
    return res.json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

export default async function handler(req, res) {
  const action = req.query?.action;
  switch (action) {
    case 'register-options':
      return handleRegisterOptions(req, res);
    case 'register-verify':
      return handleRegisterVerify(req, res);
    case 'login-options':
      return handleLoginOptions(req, res);
    case 'login-verify':
      return handleLoginVerify(req, res);
    case 'credentials':
      return handleCredentials(req, res);
    default:
      return res.status(404).json({ error: 'Action inconnue' });
  }
}
