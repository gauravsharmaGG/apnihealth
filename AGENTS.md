# AGENTS.md

Guidance for people and coding agents changing this repo. Read it before you start.

## What this is

ApniHealth: a self-hosted, mobile-first health record PWA for a household. This repo holds **code only**;
every instance keeps its health data in git-ignored folders on its own server. See `README.md`.

## Hard rules

1. **Never commit health records or personal data**: lab values, reports/PDFs, logs, episodes, medicines,
   appointments, photos, child records, notes, ingest tokens, VAPID keys, push subscriptions, identities or
   secrets. Not even as "examples" in code, tests, fixtures, docs, commit messages, issues or screenshots.
2. Use fictional placeholders only, like the files in `config/` (members Alex, Sam and Mia, `example-*.pdf`,
   `owner@example.com`). Never pair a real person's name with medical details.
3. **Mobile first.** Design for a ~390px-wide Safari/PWA viewport first: keep `viewport-fit=cover` and
   safe-area insets, touch targets of at least 44px, no horizontal scroll, no hover-only interactions.
4. **Do not loosen `.gitignore`.** It ignores `private/`, `public/records/`, generated `public/*data*.js`,
   `public/index.html`, `*.pdf`, `*.json` (apart from listed exceptions), `.env*` and keys. If `git status` shows
   a data-like file, stop. Never force-add it.
5. Keep authentication **fail closed** and writes same-origin only. Keep the strict Content-Security-Policy:
   no inline scripts or `style="..."` attributes (set styles through the CSSOM instead).
6. Dependencies stay minimal. Storage uses Node's built-in `node:sqlite` (Node 22.13+), so there are no npm
   dependencies today. Adding one needs a maintainer decision first; when approved, pin an exact version
   (no `^`/`~`), commit the lockfile and note the reason in the PR. All SQL on member data goes through
   `store.mjs` (`forMember(id)`), which binds `$member` itself and refuses unscoped queries. Schema changes
   are new entries in `migrations.mjs`; never edit a migration that has been released.
7. Members live in the database (`members.mjs` reads them through `store.mjs`); every data module must go
   through `forMember` before touching member data or the filesystem. Never hardcode member ids or names.

## Structure

- `server.mjs`: Node HTTP server on `127.0.0.1:$PORT`: static `public/`, JSON APIs (`/api/...`), `/config.js`
  (instance name, time zone and members for the client), `/members.css` (member colours) and the push loop.
- `env.mjs`: instance settings from the environment. `members.mjs`: the member list.
- `access.mjs`: verifies the Cloudflare Access JWT (issuer, audience, allowed identities) on every request
  except `/api/ingest`, which uses its own bearer token.
- `db.mjs` (SQLite connection, migrations runner, transactions), `migrations.mjs` (schema versions),
  `store.mjs` (the member access check `forMember`, document tables, households and members),
  `importer.mjs` + `scripts/import-json.mjs` (one-time JSON `private/` to SQLite import, counts only).
- `log.mjs`, `events.mjs` (episodes, entries, record inbox), `medicines.mjs`, `appointments.mjs`, `push.mjs`
  (Web Push with built-in crypto, reminder scheduler): data modules on top of `store.mjs`
  (uploaded files stay under `private/profiles/<id>/uploads/`).
- `plain_data.py` + `redesign.py` (`build.py`): generate `public/data.js`, `public/reports-data.js`,
  `public/data-child.js` and `public/index.html` from `templates/index.template.html` and `private/`.
- `public/`: the PWA (vanilla JS/CSS, service worker, manifest, icons). Views declare which members they are
  for with `data-for` (`all`, `adult`, `child`, `labs`, `starter`); `profiles.js` builds each member's tabs.
- `config/`: example and default configuration. `scripts/preview/`: fictional-data preview mode.
- `test-*`: unit, end-to-end and browser smoke tests, all on fictional data.

When a change affects cached assets, bump the cache version `V` in `public/sw.js`; add new client files to its
`SHELL` list.

## Pull requests

- Keep PRs small and focused. Describe behaviour in generic terms.
- Run the tests listed in `README.md` and say which you ran. CI runs them plus gitleaks.
- UI changes: check at 390x844 first (preview mode, `docs/preview.md`).
