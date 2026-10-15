// Applique schema.sql à la base Turso configurée par les variables d'environnement.
// Usage: node scripts/migrate.mjs
//
// CREATE TABLE IF NOT EXISTS n'a aucun effet sur une table qui existe déjà :
// une colonne ajoutée à schema.sql pour une table déjà en prod ne se
// retrouvait jamais appliquée automatiquement, et devait être recopiée à la
// main sur Turso à chaque fois (oublié ou mal exécuté plusieurs fois en
// pratique). Ce script compare maintenant les colonnes déclarées dans
// schema.sql à celles réellement présentes sur chaque table existante et
// ajoute automatiquement celles qui manquent (ALTER TABLE ... ADD COLUMN) —
// toujours à la main à lancer (`npm run migrate`), mais plus besoin de
// recopier soi-même la bonne instruction SQL ni de savoir laquelle manque.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createClient } from '@libsql/client';
import { getTursoConfig } from './_turso.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

const db = createClient(getTursoConfig());

const sql = readFileSync(join(__dirname, '..', 'schema.sql'), 'utf-8');
const withoutComments = sql
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n');
const statements = withoutComments
  .split(';')
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

for (const statement of statements) {
  await db.execute(statement);
}

// ----- Colonnes manquantes sur des tables déjà existantes -----
const TABLE_CONSTRAINT_STARTS = new Set(['PRIMARY', 'FOREIGN', 'UNIQUE', 'CHECK', 'CONSTRAINT']);

// Découpe la liste de colonnes d'un CREATE TABLE sur les virgules de premier
// niveau seulement (ignore celles à l'intérieur de parenthèses, ex:
// REFERENCES x(id) ou DEFAULT (datetime('now'))).
function splitTopLevel(body) {
  const parts = [];
  let depth = 0;
  let current = '';
  for (const ch of body) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current);
  return parts;
}

function parseCreateTableColumns(statement) {
  const match = /CREATE TABLE IF NOT EXISTS\s+(\w+)\s*\(([\s\S]*)\)\s*$/i.exec(statement);
  if (!match) return null;
  const [, tableName, body] = match;
  const columns = splitTopLevel(body)
    .map((piece) => piece.trim())
    .filter(Boolean)
    .filter((piece) => !TABLE_CONSTRAINT_STARTS.has(piece.split(/\s+/)[0].toUpperCase()))
    .map((piece) => ({ name: piece.split(/\s+/)[0], definition: piece }));
  return { tableName, columns };
}

let addedCount = 0;
for (const statement of statements) {
  const parsed = parseCreateTableColumns(statement);
  if (!parsed) continue;
  const existing = await db.execute(`PRAGMA table_info(${parsed.tableName})`);
  const existingNames = new Set(existing.rows.map((r) => String(r.name).toLowerCase()));
  for (const col of parsed.columns) {
    if (existingNames.has(col.name.toLowerCase())) continue;
    console.log(`Colonne manquante détectée : ${parsed.tableName}.${col.name} — ajout...`);
    await db.execute(`ALTER TABLE ${parsed.tableName} ADD COLUMN ${col.definition}`);
    addedCount++;
  }
}

console.log(`Migration appliquée (${statements.length} instructions, ${addedCount} colonne(s) ajoutée(s) rétroactivement).`);
