// Backfill ponctuel : les sites créés en tapant juste un nom pendant une
// ronde (avant le correctif qui capture la position GPS à la création,
// voir resolveOrCreateSubstation() dans js/app.js) n'ont pas de position.
// Certains sont en fait le MÊME site physique qu'un site déjà positionné,
// juste renommé/retapé légèrement différemment (ex: "Bouvet 1" vs "bouvet
// 1 et 2"). Ce script leur donne la position du site correspondant et
// marque needs_review=1 sur les deux (à vérifier/fusionner sur le terrain —
// voir le "voyant bleu" ajouté dans la liste des sites et la fiche site).
// Les sites sans aucune correspondance fiable par le nom sont aussi marqués
// needs_review=1 (ils restent sans position, mais apparaissent avec le même
// voyant pour qu'on sache qu'il reste à les positionner au prochain passage).
//
// Usage: node scripts/backfill-gps-correlation.mjs
import { createClient } from '@libsql/client';
import { getTursoConfig } from './_turso.mjs';

const db = createClient(getTursoConfig());

// [site sans position, site déjà positionné dont il reprend la position]
// Les deux derniers couples sont approximatifs (même bâtiment/secteur mais
// pas l'adresse exacte) — needs_review les signale comme tous les autres.
const MATCHED_PAIRS = [
  ['Arcas 2', 'Arcas 1'],
  ['Bouvet 1', 'bouvet 1 et 2'],
  ['Bouvet 2', 'bouvet 1 et 2'],
  ['Fosse bouvet', 'fosse boulevard des bouvet'],
  ['De lalande', 'de Lalande ampère watt'],
  ['MB 11 12', 'MB 11 et 12'],
  ['Mb1', 'MB1 wp2'],
  ['PB17', 'PB17-18-19'],
  ['PB26', 'pb26 ph22'],
  ['Ph28', 'PH28 PB28'],
  ['UGC', 'uGC colline de la défense/ De l’auto'],
  ['Valmy chambre 2', 'Valmy-renaissance'],
  ['Valmy chambre 3', 'Valmy-renaissance'],
  ['Jules vernes habitation', 'Jules verne habitations'],
  ['GS hanriot', 'Hanriot Station D’échange'], // approximatif
  ['CB 22 Alsace centre', 'Alsace Ouest'], // approximatif
];

const { rows } = await db.execute(
  `SELECT id, name, lat, lon FROM substations`
);
const byName = new Map(rows.map((r) => [r.name, r]));

let backfilled = 0;
let flaggedTargets = 0;
let flaggedUnmatched = 0;

for (const [srcName, tgtName] of MATCHED_PAIRS) {
  const src = byName.get(srcName);
  const tgt = byName.get(tgtName);
  if (!src || !tgt) {
    console.warn(`Introuvable, ignoré : "${srcName}" <- "${tgtName}"`);
    continue;
  }
  await db.execute({
    sql: `UPDATE substations SET lat = ?, lon = ?, needs_review = 1, updated_at = datetime('now') WHERE id = ?`,
    args: [tgt.lat, tgt.lon, src.id],
  });
  backfilled++;
  if (!tgt.needs_review) {
    await db.execute({
      sql: `UPDATE substations SET needs_review = 1, updated_at = datetime('now') WHERE id = ?`,
      args: [tgt.id],
    });
    flaggedTargets++;
  }
}

const matchedSourceNames = new Set(MATCHED_PAIRS.map(([src]) => src));
for (const r of rows) {
  if (r.lat != null && r.lon != null) continue;
  if (matchedSourceNames.has(r.name)) continue; // déjà traité ci-dessus
  await db.execute({
    sql: `UPDATE substations SET needs_review = 1, updated_at = datetime('now') WHERE id = ?`,
    args: [r.id],
  });
  flaggedUnmatched++;
}

console.log(`${backfilled} sites repositionnés par corrélation de nom.`);
console.log(`${flaggedTargets} sites "jumeaux" marqués à vérifier.`);
console.log(`${flaggedUnmatched} sites sans correspondance, marqués à vérifier (restent sans position).`);
