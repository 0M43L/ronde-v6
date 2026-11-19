import { randomUUID, randomBytes, scryptSync } from 'node:crypto';
import { authenticate, requireAuth } from './_auth.js';
import { db } from './_db.js';

// Gestion des comptes (créer un technicien, choisir à quels onglets il a
// accès) est regroupée ici plutôt que dans un fichier `api/users.js` séparé
// — pas par choix d'architecture mais pour rester sous la limite de
// fonctions serverless du plan Vercel Hobby (12), déjà atteinte (voir la
// même remarque dans api/webauthn.js).

// Onglets qu'on peut cocher/décocher par compte. "aujourdhui" (page
// d'accueil) n'y figure pas : elle reste toujours accessible, impossible à
// retirer (sans ça un compte restreint se connecterait sur un écran vide).
// "admin" (cette page elle-même) n'y figure pas non plus : elle reste
// réservée à Axel uniquement, via isAxel() côté client et la vérification
// de prénom ci-dessous côté serveur — jamais octroyable à un autre compte.
export const VALID_TABS = ['ronde', 'sites', 'actions', 'historique', 'fiches', 'bilan', 'diagnostic', 'mes', 'reseau'];

function isAxelUser(user) {
  return (user?.prenom || '').toLowerCase() === 'axel';
}

// Ajoute la colonne allowed_tabs à `users` si elle n'existe pas encore —
// même mécanisme idempotent que addClosureColumns()/addMeterValueColumns()
// (voir api/actions.js, api/rondes.js), déclenché automatiquement à la
// connexion d'Axel (voir enterApp() côté client).
async function addAllowedTabsColumn() {
  const existing = await db.execute(`PRAGMA table_info(users)`);
  const existingNames = new Set(existing.rows.map((r) => String(r.name).toLowerCase()));
  if (existingNames.has('allowed_tabs')) return 0;
  await db.execute(`ALTER TABLE users ADD COLUMN allowed_tabs TEXT`);
  return 1;
}

async function handleAddPermissionColumn(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const user = await requireAuth(req, res);
  if (!user) return;
  if (!isAxelUser(user)) return res.status(403).json({ error: 'Réservé à Axel' });
  try {
    const added = await addAllowedTabsColumn();
    return res.json({ ok: true, added });
  } catch (error) {
    console.error('Migration allowed_tabs error:', error);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
}

async function handleListUsers(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const user = await requireAuth(req, res);
  if (!user) return;
  if (!isAxelUser(user)) return res.status(403).json({ error: 'Réservé à Axel' });

  try {
    // allowed_tabs peut ne pas encore exister (migration pas encore passée) :
    // on retombe sur la liste sans cette colonne plutôt que de casser la
    // page admin en attendant — même filet que partout ailleurs dans l'appli.
    let result;
    try {
      result = await db.execute(`SELECT id, email, prenom, nom, allowed_tabs FROM users ORDER BY prenom, nom`);
    } catch (error) {
      if (!/no such column/i.test(error?.message || '')) throw error;
      result = await db.execute(`SELECT id, email, prenom, nom FROM users ORDER BY prenom, nom`);
    }
    return res.json({
      ok: true,
      users: result.rows.map((r) => {
        let allowedTabs = null;
        if (r.allowed_tabs) {
          try {
            allowedTabs = JSON.parse(r.allowed_tabs);
          } catch {
            allowedTabs = null;
          }
        }
        return { id: r.id, email: r.email, prenom: r.prenom, nom: r.nom, allowedTabs };
      }),
    });
  } catch (error) {
    console.error('List users error:', error);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
}

async function handleCreateUser(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const user = await requireAuth(req, res);
  if (!user) return;
  if (!isAxelUser(user)) return res.status(403).json({ error: 'Réservé à Axel' });

  try {
    const { email, password, prenom, nom } = req.body || {};
    // Seuls email + mot de passe sont bloquants : sans eux le compte ne
    // pourrait jamais se connecter. Prénom/nom sont de simples libellés —
    // pas la peine de bloquer la création pour ça, ils se complètent après
    // coup (voir handleUpdateUser ci-dessous), remonté par Axel.
    if (!email || !password) {
      return res.status(400).json({ error: 'Email et mot de passe requis' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Le mot de passe doit faire au moins 8 caractères' });
    }

    const existing = await db.execute({ sql: `SELECT id FROM users WHERE email = ?`, args: [email] });
    if (existing.rows.length) {
      return res.status(409).json({ error: 'Un compte existe déjà avec cet email' });
    }

    const salt = randomBytes(16).toString('hex');
    const passwordHash = scryptSync(password, salt, 64).toString('hex');
    const id = randomUUID();

    await db.execute({
      sql: `INSERT INTO users (id, email, password_hash, password_salt, nom, prenom) VALUES (?, ?, ?, ?, ?, ?)`,
      args: [id, email, passwordHash, salt, nom || '', prenom || ''],
    });

    return res.json({ ok: true, user: { id, email, prenom: prenom || '', nom: nom || '', allowedTabs: null } });
  } catch (error) {
    console.error('Create user error:', error);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
}

// Corrige/complète un compte après coup (prénom, nom, email, mot de passe) —
// pour ne jamais bloquer la création sur un champ manquant ou une faute de
// frappe : Axel édite plutôt que de devoir tout ressaisir correctement du
// premier coup. Chaque champ est optionnel et seuls ceux fournis changent.
async function handleUpdateUser(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const user = await requireAuth(req, res);
  if (!user) return;
  if (!isAxelUser(user)) return res.status(403).json({ error: 'Réservé à Axel' });

  try {
    const { userId, prenom, nom, email, password } = req.body || {};
    if (!userId) return res.status(400).json({ error: 'userId requis' });

    const sets = [];
    const args = [];

    if (prenom !== undefined) {
      sets.push('prenom = ?');
      args.push(prenom || '');
    }
    if (nom !== undefined) {
      sets.push('nom = ?');
      args.push(nom || '');
    }
    if (email !== undefined) {
      if (!email) return res.status(400).json({ error: "L'email ne peut pas être vide" });
      const existing = await db.execute({ sql: `SELECT id FROM users WHERE email = ? AND id != ?`, args: [email, userId] });
      if (existing.rows.length) return res.status(409).json({ error: 'Un autre compte existe déjà avec cet email' });
      sets.push('email = ?');
      args.push(email);
    }
    if (password) {
      if (password.length < 8) return res.status(400).json({ error: 'Le mot de passe doit faire au moins 8 caractères' });
      const salt = randomBytes(16).toString('hex');
      const passwordHash = scryptSync(password, salt, 64).toString('hex');
      sets.push('password_hash = ?', 'password_salt = ?');
      args.push(passwordHash, salt);
    }

    if (!sets.length) return res.json({ ok: true });

    args.push(userId);
    await db.execute({ sql: `UPDATE users SET ${sets.join(', ')} WHERE id = ?`, args });
    return res.json({ ok: true });
  } catch (error) {
    console.error('Update user error:', error);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
}

async function handleSetAllowedTabs(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const user = await requireAuth(req, res);
  if (!user) return;
  if (!isAxelUser(user)) return res.status(403).json({ error: 'Réservé à Axel' });

  try {
    const { userId, allowedTabs } = req.body || {};
    if (!userId) return res.status(400).json({ error: 'userId requis' });
    // Axel ne peut pas se restreindre lui-même : son compte est le seul à
    // pouvoir redonner l'accès à tout le monde (lui y compris), un
    // verrouillage accidentel de son propre compte n'aurait pas de retour
    // en arrière possible depuis l'appli.
    if (userId === user.id) {
      return res.status(400).json({ error: 'Impossible de restreindre ton propre compte' });
    }
    if (allowedTabs !== null) {
      if (!Array.isArray(allowedTabs) || allowedTabs.some((t) => !VALID_TABS.includes(t))) {
        return res.status(400).json({ error: 'Liste d\'onglets invalide' });
      }
    }

    await db.execute({
      sql: `UPDATE users SET allowed_tabs = ? WHERE id = ?`,
      args: [allowedTabs === null ? null : JSON.stringify(allowedTabs), userId],
    });
    return res.json({ ok: true });
  } catch (error) {
    console.error('Set allowed tabs error:', error);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
}

async function handleVerify(req, res) {
  try {
    const user = await authenticate(req);
    if (!user) {
      return res.status(401).json({ error: 'Token invalide ou expiré' });
    }
    return res.json({ ok: true, user });
  } catch (error) {
    console.error('Verify error:', error);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
}

export default async function handler(req, res) {
  const action = req.query?.action;
  switch (action) {
    case 'list-users':
      return handleListUsers(req, res);
    case 'create-user':
      return handleCreateUser(req, res);
    case 'update-user':
      return handleUpdateUser(req, res);
    case 'set-allowed-tabs':
      return handleSetAllowedTabs(req, res);
    case 'add-permission-column':
      return handleAddPermissionColumn(req, res);
    default:
      return handleVerify(req, res);
  }
}
