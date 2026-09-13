# Ronde V6 — IDEX

PWA de ronde d'inspection pour les sous-stations d'échange de chauffage urbain (IDEX, secteur La Défense).

## Fonctionnalités

- **Ronde** : sélection de la sous-station (carte + liste, 140 points importés du KML Google Earth), 8 contrôles (OK / Dégradé / Défaillant / N/A), observations, export PDF.
- **Fiches techniques**, **Actions à faire**, **Mise en service (MES)**.
- **Bilan & Diagnostic** : résumé de complétude + diagnostic IA (Claude) des anomalies détectées (cause probable, action recommandée, urgence, escalade).
- **Historique** des rondes.
- **Offline-first** : IndexedDB en local, synchronisation automatique vers le serveur dès que la connexion revient. Fonctionne installée en PWA (manifest + service worker).
- **Thème clair/sombre**.
- Authentification par compte (pas d'inscription publique : les notes d'accès des sous-stations contiennent des codes/mots de passe sensibles).

## Architecture

```
index.html, style.css, js/*     → frontend (aucune dépendance de build, ES modules natifs)
api/*.js                        → fonctions serverless Vercel (Node)
schema.sql                      → schéma Turso (libSQL)
data/substations.seed.json      → 140 sous-stations extraites du KML
scripts/*.mjs                   → migration, seed, création de comptes
```

## Mise en place

1. Créer une base [Turso](https://turso.tech) et une clé [Anthropic](https://console.anthropic.com/) pour le diagnostic IA.
2. Variables d'environnement (local `.env` ou Vercel) :
   ```
   TURSO_CONNECTION_URL=
   TURSO_AUTH_TOKEN=
   ANTHROPIC_API_KEY=
   ANTHROPIC_MODEL=claude-sonnet-5   # optionnel
   ```
3. Installer les dépendances puis appliquer le schéma et importer les sous-stations :
   ```
   npm install
   npm run migrate
   npm run seed:substations
   ```
4. Créer un compte technicien (pas d'inscription publique) :
   ```
   npm run create-user -- technicien@idex.fr motdepasse Jean Dupont
   ```
5. Déployer sur Vercel (le dossier `api/` est détecté automatiquement comme fonctions serverless).

## Points d'attention

- 12 sous-stations du KML partagent les mêmes coordonnées (pin jamais déplacé sur Google Earth) : elles sont marquées `needs_review` et affichées avec un badge « position à vérifier » dans l'app.
- Les notes d'accès importées contiennent des codes de portail/armoire en clair : l'endpoint `/api/substations` exige une authentification, à garder en tête si l'app est un jour ouverte à plus d'utilisateurs.
