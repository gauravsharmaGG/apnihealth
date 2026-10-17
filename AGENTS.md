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
- `auth.mjs`: who is asking (`AUTH_MODE` builtin sessions or trusted-proxy), sign-in routes and pages.
  `accounts.mjs`: users, memberships, sessions, sign-in links. `mailer.mjs`: outgoing email through the Resend HTTP API (`RESEND_API_KEY`, works on Workers) or SMTP (`SMTP_URL`); `RESEND_API_KEY` wins when both are set. `webauthn.mjs`: passkey verification (CBOR/COSE, no deps). `household.mjs`: households, people, invites, profiles API. `http.mjs`: shared HTTP helpers. `consent.mjs` + `consent-page.mjs`: health data notice, versioned consent records and the /consent page (bump `CONSENT_VERSION` when the notice text changes materially). `settings.mjs`: per-household tracked measurements, time zone and units; `env.mjs` `zone()`/`inZone()` give the zone of the household being served. `public/onboarding.js` + `welcome.html`: first-run setup at /welcome. `datarights.mjs` + `zip.mjs`: export (streamed ZIP, no deps) and account deletion. `blobs.mjs`: uploaded files behind a small async interface (keys `profiles/<id>/...`; the fs backend keeps them under `private/profiles/<id>/`); never touch profile files with `node:fs` directly.
  `access.mjs`: verifies the Cloudflare Access JWT for trusted-proxy mode. `/api/ingest` uses per-profile bearer keys (`ingest.mjs`).
- Every request runs with an actor (`store.runAs`): the user and their active household, a sync token, or
  `SYSTEM` (scripts, scheduler). `forMember` refuses access without one; never use `enterAs(SYSTEM)` in request code.
- `scheduler.mjs`: all periodic jobs in one place (hourly purge of expired sessions, sign-in links and passkey
  challenges; medicine and appointment reminders via `push.tick`). Node calls `startScheduler()`; a Workers Cron
  Trigger calls `runScheduled(scheduledTime)`. Add new periodic work here, never as another `setInterval`.
- `db.mjs` (SQLite connection, migrations runner, transactions), `migrations.mjs` (schema versions),
  `store.mjs` (the member access check `forMember`, document tables, households and members),
  `importer.mjs` + `scripts/import-json.mjs` (one-time JSON `private/` to SQLite import, counts only).
- `log.mjs`, `events.mjs` (episodes, entries, record inbox), `medicines.mjs`, `appointments.mjs`, `push.mjs`
  (Web Push with built-in crypto, reminder `tick` run by `scheduler.mjs`): data modules on top of `store.mjs`
  (uploaded files go through `blobs.mjs`, on disk under `private/profiles/<id>/uploads/`).
- `labs.mjs`: lab reports per member, the marker catalog (`config/markers.default.json` + `private/markers.json`)
  and the explorer series served by `/api/labs`; `public/labs.js` is the "Add results" form.
- `redesign.py` (`build.py`): generates `public/reports-data.js`,
  `public/data-child.js` and `public/index.html` from `templates/index.template.html` and `private/`.
- `public/`: the PWA (vanilla JS/CSS, service worker, manifest, icons). Views declare which members they are
  for with `data-for` (`all`, `adult`, `child`, `labs` = the adult with the report library, `starter` = other adults); `profiles.js` builds each member's tabs.
- Look and feel: design tokens at the top of the Phase 4 section of `public/style.css` (`--bg`, `--surface`, `--ink`,
  `--muted`, `--accent`, card tints...). Use tokens, not new hex colours; text colours must stay WCAG AA
  (`test-theme.mjs`). Glass is decoration only: `html.lite` (set by `splash.js`) and reduced transparency turn it off.
- `config/`: example and default configuration. `scripts/preview/`: fictional-data preview mode.
- `test-*`: unit, end-to-end and browser smoke tests, all on fictional data.

When a change affects cached assets, bump the cache version `V` in `public/sw.js`; add new client files to its
`SHELL` list.

## Pull requests

- Keep PRs small and focused. Describe behaviour in generic terms.
- Run the tests listed in `README.md` and say which you ran. CI runs them plus gitleaks.
- UI changes: check at 390x844 first (preview mode, `docs/preview.md`).
