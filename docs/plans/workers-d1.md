# Plan: ApniHealth on Cloudflare Workers + SQLite Durable Objects (EU), keeping Node self-hosting

Status (Oct 18, 2026): **decision D1 taken: SQLite in a Durable Object** (the maintainer chose it over D1). PR 0 spike done
locally (findings in section 8). PRs 1+ in progress. No Cloudflare resources created, nothing deployed.
Base: `main` at `42d361e`. Built with Grok only (no claude/codex/claude-glm CLIs).
(The file name still says d1 because this plan started as a D1 plan; D1 is no longer the target.)

Goal: add a second runtime target, Cloudflare Workers with **SQLite in a Durable Object** (decision D1)
in the EU jurisdiction, and R2 for uploads, exports and backups. The Node + `node:sqlite` path stays the reference
runtime: self-hosted instances with real data keep running on Node, and every PR keeps `npm test` green and unchanged
in behaviour.

---

## 1. Inventory: Node-specific dependencies

Runtime facts this inventory relies on (Cloudflare docs, checked Oct 18, 2026):
- With `nodejs_compat` (on by default from compatibility date 2026-08-04), `node:crypto` is fully supported apart
  from DSA/DH key generation, argon2, randomUUIDv7 and ed448/x448; `createECDH` and `hkdfSync` are included.
  https://developers.cloudflare.com/workers/runtime-apis/nodejs/crypto/
- `node:zlib` is supported ("full node:zlib API"). https://developers.cloudflare.com/workers/runtime-apis/nodejs/zlib/
  `zlib.crc32` specifically must be verified in `wrangler dev` (PR 0 spike).
- `node:http` `createServer` works through `httpServerHandler` from `cloudflare:node` (compat date >= 2025-09-01),
  and HTTP client methods (`https.request/get`) are enabled from 2025-08-15.
  https://developers.cloudflare.com/workers/runtime-apis/nodejs/http/
- **Not available:** `node:sqlite`, a persistent filesystem, `node:net`/`node:tls` raw sockets (use
  `cloudflare:sockets` or HTTP APIs), long-lived `setInterval` loops, files like `/etc/ssl/cert.pem`.

| Dependency | Where it is used | Workers status | Plan |
|---|---|---|---|
| `node:sqlite` `DatabaseSync` (sync API, `BEGIN IMMEDIATE` transactions, WAL, `chmod`) | `db.mjs` (open, migrate, `transaction`); all SQL goes through `db()`/`system()`/`forMember()`: `accounts.mjs` (~44 `prepare` calls), `store.mjs` (14), `ingest.mjs` (8), `datarights.mjs` (7), `push.mjs` (6), `settings.mjs` (5), `importer.mjs` (4), `consent.mjs` (3), `auth.mjs`, `household.mjs`, `labs.mjs`, `log.mjs`, `events.mjs` via `store.docs()`. 21 transaction call sites (`transaction(`/`.tx(`). | Missing. D1 is **async** with no interactive transactions (only `batch()`); SQLite Durable Objects are **sync** with `transactionSync`. | Storage adapter (section 2.1). This is the core of the port. |
| `node:fs` persistent files | `events.mjs` (uploads: `writeFileSync`/`unlinkSync`/`statSync`/`createReadStream` under `private/profiles/<id>/uploads/`); `store.mjs` `profileDir()` + `rmSync` in `removeMember`; `datarights.mjs` (`readdirSync`/`readFileSync` to export files, `rmSync` on account delete); `push.mjs` (`private/vapid.json` read/write); `labs.mjs` (`config/markers.default.json` + optional `private/markers.json`); `ingest.mjs` (legacy `private/ingest-token.txt`); `importer.mjs` (one-time JSON import); `db.mjs` (mkdir/chmod DB file); `server.mjs` static files. | Only a non-persistent virtual fs. | Blob adapter (fs vs R2) for uploads/exports; config JSON bundled as a module import; VAPID keys from secrets; legacy token + importer stay Node-only. |
| `node:crypto` | `accounts.mjs` (tokens `randomBytes`, `createHash`), `webauthn.mjs` (`createPublicKey`, `verify`, `timingSafeEqual`), `push.mjs` (VAPID `sign`, `createECDH`, `createCipheriv`, `hkdfSync`, `generateKeyPairSync`), `access.mjs` (JWT verify), `ingest.mjs`, `randomUUID` everywhere. | Supported under `nodejs_compat`. | Keep as is; cover with a Workers smoke test (passkey verify, push encrypt). No WebCrypto rewrite unless the spike fails. |
| Raw SMTP mailer (`node:net`, `node:tls`, reads CA bundle from `/etc/ssl/...`) | `mailer.mjs`, called from `auth.mjs` (sign-in links) and `household.mjs` (invites). | No `node:net`/`node:tls`. | Mail adapter: SMTP (Node) or Resend HTTP API (`fetch`, works on both). `cloudflare:sockets` SMTP is possible but adds STARTTLS work; not recommended. |
| ZIP export (`node:zlib` `deflateRawSync`, `crc32`) | `zip.mjs`, `datarights.mjs` `writeZip` streams to `res`; route `/api/export` in `server.mjs`. | zlib supported; CPU is the issue (10 ms/request on Workers Free). | Keep `zip.mjs`; store already-compressed files (JPG/PNG/HEIC/PDF) with method 0 (no deflate); stream the response; optional copy to R2 for "export ready" download. |
| Apple Health ingest | `/api/ingest` in `server.mjs` + `ingest.mjs` (bearer keys hashed in DB; `migrateLegacy()` reads `private/ingest-token.txt` at startup). Parsing of export files is client-side (`public/ahparse.js`, `ahimport.js`). | Fine except the legacy file. | `migrateLegacy` runs only on Node. |
| Uploads (record inbox) | `events.mjs` `addInbox` (base64 JSON body, 8 MB file, 12 MB body), `inboxFile`, `deleteInbox`; served at `/api/inbox/<id>/file`. | Body size fine (100 MB on Free zone plan). | Blob adapter, R2 key `profiles/<memberId>/uploads/<uuid>.<ext>`. |
| Background timers | `server.mjs` `setInterval(A.purgeExpired, 1h)`; `push.mjs` `start()` = 30 s `setInterval` reminder tick (Web Push via `node:https` `request` with `ca: readFileSync('/etc/ssl/cert.pem')`). | No resident process. | Cron Trigger `scheduled()` every minute calls the same `tick()` and hourly `purgeExpired()`; push sender switches to `fetch` (works on Node 22 too). |
| In-memory rate limiter | `http.mjs` `limited()` (22 call sites). | Works per isolate only (weaker, resets). | Accept per-isolate limits for the demo, or later a D1/DO-backed or Workers Rate Limiting binding implementation behind the same function. |
| `AsyncLocalStorage` (actor + time zone context) | `store.mjs` `runAs`, `env.mjs` `inZone`. | Supported under `nodejs_compat`. | Keep. |
| Static file serving | `server.mjs` `serveStatic` (path check, `statSync`, `createReadStream`, injects `DEMO_NOTICE` into HTML, security headers, `/records/` frame headers). `public/index.html`, `reports-data.js`, `data-child.js` are **generated** by `build.py` (Python) from `private/` and git-ignored. | Use Workers Static Assets. | `assets.run_worker_first = true` so auth gating, headers and the demo notice still run in the Worker; `build.py` runs in the deploy step with an empty `private/` (generic shell, no `/records/`). |
| Process/env | `env.mjs` reads `process.env` at import; `server.listen(127.0.0.1)`; `allowedHosts` includes `127.0.0.1:PORT`. | `process.env` is populated from bindings under `nodejs_compat` (verify in spike); no listen. | Config read lazily from an injected `env`; Host check uses `APP_HOST`. |
| CA bundle files | `mailer.mjs`, `access.mjs`, `push.mjs`. | No `/etc/ssl`. | Only pass `ca` when the file exists (Node), otherwise default trust. |
| Cloudflare Access JWT (trusted-proxy mode) | `access.mjs` (`https.get` certs). | Would work, but not needed. | Workers target supports `AUTH_MODE=builtin` only at first. |

Not affected: client code in `public/` (vanilla JS), passkeys' CBOR/COSE parsing (pure JS + `Buffer`, available
under `nodejs_compat`), tests (stay on Node).

---

## 2. Architecture

```
            Node (self-host)                          Cloudflare Workers
 server.mjs ── http.createServer ──┐       worker.mjs ── fetch() / scheduled()
                                   ├── app core (routes, auth, data modules) ──┐
 adapters: node:sqlite | fs | SMTP ┘                                            └ adapters: D1 or DO-SQLite | R2 | Resend
```

The route code in `server.mjs` already works on `(req,res)`. Two ways to run it on Workers:
(a) wrap the existing `http.createServer` handler with `httpServerHandler` (smallest change, verified in the spike), or
(b) later, move to a `Request -> Response` core. Plan: (a) first; (b) only if (a) misbehaves (streaming, headers).

### 2.1 Storage adapter

One small interface that both backends implement, used only by `db.mjs`/`store.mjs` (modules keep calling
`forMember`, `docs()`, `system()` as today):

```
db.get(sql, params) / db.all(sql, params) / db.run(sql, params) -> {changes}
db.exec(sql)                 // migrations
db.tx(fn)                    // atomic unit
```

**The hard part is sync vs async.** All data modules are synchronous today (`node:sqlite`).

- **Option A, D1 (not chosen):** D1 is async-only. Every exported data function and every caller
  becomes `async` (roughly 15 modules, ~120 SQL call sites, `server.mjs`, `auth.mjs`, `household.mjs`, scripts and
  ~20 test files). D1 has no `BEGIN`/`COMMIT` from a Worker; the 21 transaction sites must become
  `db.batch([...])` (atomic, but no reads in between), so read-then-write checks (e.g. "a household needs at least
  one profile", "last owner can't leave", `docs().replace`) are rewritten as guarded SQL
  (`DELETE ... WHERE (SELECT COUNT(*) ...) > 1`) or as a batch preceded by a read with a known race window.
  Node keeps `node:sqlite` behind an async wrapper (results are awaited but still synchronous inside).
- **Option B, SQLite in a Durable Object (CHOSEN, Oct 18):** `ctx.storage.sql.exec()` is
  **synchronous** and `ctx.storage.transactionSync(fn)` gives real transactions, so the current sync code runs
  almost unchanged inside one Durable Object ("instance DO") that owns the database; the Worker forwards each
  request to it. EU residency via `env.APP.jurisdiction("eu")`. SQLite-backed DOs are available on Workers Free
  and Paid. Throughput is the same shape as D1 (one D1 database is itself backed by a single Durable Object).
  Trade-offs: no `wrangler d1 execute` console, backups via our own export (and DO point-in-time recovery, to be
  confirmed), and the app logic runs in the DO, not at the edge.
  https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/
  https://developers.cloudflare.com/durable-objects/reference/data-location/

Spike result (section 8): DO SQLite does **not** accept named `$name` parameter objects; it silently binds the
object as the text `[object Object]`. The adapter must translate `$name` placeholders to numbered `?N` parameters
(which DO SQLite binds correctly) and refuse object arguments, with a test that catches a silent mis-bind.
`BEGIN`/`COMMIT` and `PRAGMA journal_mode` are refused inside a DO: `tx()` maps to `ctx.storage.transactionSync`,
and the Node-only PRAGMAs stay in the Node adapter.

Both keep the `forMember` scoping rule (`$member` bound by the store; unscoped SQL refused).
Named parameters: `node:sqlite` binds `$name` objects; D1 binds positional `?NNN`; DO `exec` binds positional `?`.
The adapter translates `$name` placeholders to positional bindings once per statement (cached), so module SQL stays
unchanged. D1 limit to respect: 100 bound parameters per query (fine for current queries).

### 2.2 Migrations

- `migrations.mjs` stays the single source of truth. The schema uses `json_valid()` CHECKs and `ON DELETE CASCADE`;
  no PRAGMAs inside migrations. D1 enforces foreign keys (to verify for cascades in the spike).
- **D1:** a script `scripts/d1-migrations.mjs` writes `migrations/NNNN_<name>.sql` from `MIGRATIONS` (checked in;
  CI fails if out of sync). Apply with `wrangler d1 migrations apply <db> --remote` as an explicit deploy step,
  never on request. The Worker reads `schema_migrations` on first request and **fails closed** (503) if the
  database is behind the code. Each migration also inserts its `schema_migrations` row so both runtimes agree.
- **DO-SQLite:** the DO runs the existing `migrate()` in its constructor inside `blockConcurrencyWhile`, using
  `transactionSync` instead of `BEGIN IMMEDIATE`.
- Released migrations are never edited (AGENTS.md rule 6).

### 2.3 Mail adapter

`mailer.mjs` exposes `mailConfigured()` and `sendMail({to,subject,text})` as today, choosing a transport:
- `RESEND_API_KEY` set: POST `https://api.resend.com/emails` with `fetch` (works on Node 22 and Workers).
- else `SMTP_URL`: current SMTP client (Node only).
- else: log the link (dev), as today. On Workers without mail the sign-in link must **not** be logged in
  production; refuse sign-up instead.
On Workers, sends run in `ctx.waitUntil()` so the response is not delayed. The demo already sends through Resend
SMTP from a verified domain; the Workers deploy reuses that domain with an API key stored as a
secret.

### 2.4 Blob adapter

```
blobs.put(key, bytes, {contentType}) / get(key) -> {body(stream), size, contentType} | null
blobs.delete(key) / deletePrefix(prefix) / list(prefix)
```
- Node: files under `private/profiles/<id>/...` (same paths as today, mode 0600, `wx`), so existing data needs no
  migration.
- Workers: R2 bucket (EU jurisdiction), keys `profiles/<memberId>/uploads/<uuid>.<ext>`; export snapshots under
  `exports/<userId>/<date>.zip` with a lifecycle rule (e.g. delete after 7 days); DB backups under `backups/`.
- Profile/account deletion deletes the prefix after the DB transaction commits (as `rmSync` does today).

### 2.5 Static assets and HTML

- `wrangler.jsonc`: `assets: { directory: "./public", binding: "ASSETS", run_worker_first: true }`. The Worker
  keeps the current order: host check, CSRF, auth, `PUBLIC_PATHS`, consent, then `env.ASSETS.fetch()`, and adds the
  security headers (CSP, no-store) and the `DEMO_NOTICE` HTML injection (HTMLRewriter or string replace).
- Deploy step: `python3 build.py` with an empty `private/` produces the generic `index.html`; `public/records/`,
  `notes.js` and other data files must not exist in the uploaded asset folder (a check fails the deploy if they do).
- Static asset requests are free and unlimited (pricing page), but with `run_worker_first` they invoke the Worker.

### 2.6 Scheduler

`wrangler.jsonc` `triggers.crons: ["* * * * *"]`: `scheduled()` runs `push.tick()` (minute granularity instead of
30 s) and `purgeExpired()` once an hour. Push sending moves from `node:https` to `fetch` in both runtimes.
Workers Free allows 5 Cron Triggers per account, Paid 250; one is enough.

### 2.7 Configuration, secrets and EU jurisdiction

- Plain vars in `wrangler.jsonc`: `APP_HOST`, `APP_NAME`, `APP_TIME_ZONE`, `AUTH_MODE=builtin`, `SIGNUP_MODE`,
  `DEMO_NOTICE`, `MAIL_FROM`.
- Secrets via `wrangler secret put` (never in the repo, never printed): `RESEND_API_KEY`, `VAPID_PRIVATE_JWK`
  (replaces `private/vapid.json`), optional `VAPID_SUBJECT`.
- D1: created with `--jurisdiction=eu` (can only be set at creation). R2: bucket created in jurisdiction `eu`, and
  the binding must name `"jurisdiction": "eu"`. Durable Objects (option B): `env.APP.jurisdiction("eu")`.
  These constrain where data is stored and processed; Workers code itself still runs at the nearest location
  (Cloudflare Regional Services could restrict that; availability and price not checked, not planned).
- Separate environments: `demo` (public demo) now; `prod` later only after the GDPR items in section 5.

---

## 3. Cloudflare account check

A read-only check of the maintainer's Cloudflare account was done on Oct 18, 2026 (nothing created or changed).
The account details are kept out of this public repo. Relevant results: Workers, R2 and Durable Objects are
available; the plan tier (Free vs Paid) could not be read with the API token used (decision D2); no
EU-jurisdiction resources exist yet; the demo hostname is currently served from a self-hosted Node instance through
a Cloudflare Tunnel.

---

## 4. PR series

Every PR: small, CI green on Node 22.13, `npm test` unchanged, `MergeJudge-Actor: agent` in the body, merge only
with the maintainer's OK. Sizes: S < 150 lines, M 150-400, L > 400 (changed lines incl. tests).

**PR 0, spike (DONE Oct 18, local only, see section 8):** run the current server under `wrangler dev` with
`httpServerHandler` and an in-memory stub DB to confirm `nodejs_compat` covers `zlib.crc32`, `createECDH`/`hkdfSync`,
`createPublicKey`/`verify` for passkeys, `AsyncLocalStorage`, `process.env`, streaming responses. Needs wrangler
locally (decision D4). Output: notes appended to this plan. Risk: findings change PR 6.

| # | PR | Size | Node impact | Risk |
|---|---|---|---|---|
| 1 | **Mail adapter + Resend HTTP transport.** (opened)  `mailer.mjs` picks Resend (`RESEND_API_KEY`) or SMTP; tests with a local fake HTTP server. Optional: switch the self-hosted demo from SMTP to the API key. | S | New optional env var; SMTP unchanged | Low |
| 2 | **Blob adapter (fs implementation).** (opened)  `blobs.mjs`; `events.mjs`, `store.mjs` `removeMember`, `datarights.mjs` use it; same on-disk paths. ZIP: store pre-compressed types without deflate. | M | Same files, same paths | Medium (deletion paths; export) |
| 3 | **No-fs config + secrets + Workers-safe crypto calls.** Spike: `sign`/`verify` with a `KeyObject` inside an options object (`{key,dsaEncoding}`) fails on Workers; pass the key as JWK/PEM/DER with `format` instead (works on both). Affects `push.mjs` VAPID signing and `webauthn.mjs` ES256 verify. Marker catalog imported as a module (`private/markers.json` still read on Node); VAPID from `VAPID_PRIVATE_JWK` or `private/vapid.json`; CA bundle optional; push sends via `fetch`; `migrateLegacy`/importer flagged Node-only. | M | None (fallbacks keep today's behaviour) | Low-Medium (push crypto) |
| 4 | **Scheduler + lazy config.** `tick()`/`purgeExpired()` callable from a scheduler; `env.mjs` reads config lazily from an injectable env; Host allow-list from `APP_HOST`. | S | None | Low |
| 5a | **Storage adapter interface (Node impl).** `db.mjs` exposes `get/all/run/exec/tx` with `$name` translation; `store.mjs` and modules use it. Still sync. | M | Refactor only | Medium (touches every query; tests cover it) |
| 5b (option A only, dropped) | **Async data layer.** All data functions `async`, callers `await`, transactions rewritten to batch-safe form; Node adapter wraps `node:sqlite`. Split per module group (accounts/auth; store/docs/events/meds/appts; labs/log/settings/consent; push/datarights/household) | 4 x M-L | Behaviour must stay identical; big diff | **High** (largest PR group, race windows without interactive transactions) |
| 6 | **Workers entry + backend.** `worker.mjs` (`fetch`, `scheduled`), `wrangler.jsonc` (no account ids/secrets), D1 adapter (A) or `ApniDO` class (B), R2 blob adapter, Resend default, assets with `run_worker_first`, DEMO_NOTICE injection; Miniflare/`wrangler dev` test job in CI. | L | None (new files) | Medium-High |
| 7 | **Migrations for the Workers target.** (A) generated `migrations/*.sql` + sync check in CI + fail-closed version check; (B) `migrate()` in the DO constructor. | S-M | None | Medium |
| 8 | **Backups + export to R2.** Daily cron: dump of all tables to `backups/YYYY-MM-DD.json.gz` (EU R2) with retention; export can stream or land in R2. Documented restore drill. | M | None (Workers only) | Medium |
| 9 | **Docs + CI deploy job (manual trigger).** `docs/workers.md` (setup, secrets, migrations, restore); optional GitHub Actions job deploying the demo with a scoped API token. `.github` change = protected, needs the maintainer. | S-M | None | Low |

Approximate effort: option B (chosen) about 8 PRs. PR 5b is not needed.

### Cloudflare resources (created only after the maintainer's OK, after PR 6/7 merge)

- The DO class migration (`new_sqlite_classes`) in `wrangler.jsonc`, instance DO obtained via
  `env.APP.jurisdiction("eu")` (option B, chosen). No D1 database.
- R2 bucket `apnihealth-demo` in jurisdiction `eu`, with a lifecycle rule for `exports/`.
- Worker `apnihealth-demo`, secrets `RESEND_API_KEY` (new, send-only, domain-limited Resend key) and
  `VAPID_PRIVATE_JWK` (new key pair; demo push subscriptions would need re-subscribing).

### Moving the public demo

1. Deploy to `apnihealth-demo.<workers.dev subdomain>` or a new staging hostname (e.g.
   a separate staging subdomain, which is a new DNS record: needs OK) and test sign-up, passkeys, magic-link
   email, uploads, export, reminders at 390x844.
2. Cut-over (needs the maintainer's OK, it is a DNS + tunnel change): replace the proxied tunnel CNAME of the demo
   hostname with a Workers Custom Domain, then remove the demo's tunnel ingress rule (backup first) and stop
   the Node demo.
   The demo database is not migrated (demo data, fictional placeholder household); it starts empty.
   Rollback = restore the CNAME and the ingress backup.
3. Later `apni.health`: after the maintainer adds the zone to this account, add it as a second Custom Domain, verify it in
   Resend (new DKIM/SPF records = DNS change, needs OK) and switch `APP_HOST`. Passkeys are bound to the hostname
   (RP ID), so passkeys made on the current demo hostname will not work on `apni.health`; users sign in by email once and
   add a new passkey.

Self-hosted instances with real data (Node, trusted-proxy) are not moved by this plan.

---

## 5. Cost at small scale (from Cloudflare's pricing pages, Oct 18, 2026)

Sources: https://developers.cloudflare.com/workers/platform/pricing/ ,
https://developers.cloudflare.com/d1/platform/pricing/ , https://developers.cloudflare.com/r2/pricing/ ,
limits: https://developers.cloudflare.com/workers/platform/limits/ , https://developers.cloudflare.com/d1/platform/limits/

- **Workers Free:** 100,000 requests/day, **10 ms CPU per request**, 50 subrequests per request; D1 Free: 5 million
  rows read/day, 100,000 rows written/day, 5 GB total, 500 MB max per database, 50 queries per invocation,
  Time Travel 7 days. SQLite Durable Objects are available on Free.
- **Workers Paid:** minimum **$5 USD/month** per account, includes 10 million requests/month and 30 million CPU ms,
  CPU up to 5 min per request; D1 includes 25 billion rows read and 50 million rows written per month and 5 GB,
  10 GB max per database, 1000 queries per invocation, Time Travel 30 days.
- **R2:** free tier 10 GB-month storage, 1 million Class A and 10 million Class B operations per month, no egress
  fees; above that $0.015/GB-month (Standard).
- Static asset requests are free and unlimited.

Assessment: a demo with a handful of users fits the free allowances on request and row counts. The risk on
Workers Free is the **10 ms CPU limit**: passkey signature checks, Web Push encryption and ZIP export of photos can
exceed it, so the realistic budget is the **$5/month Workers Paid plan** (which the account may already have, see
section 3). Resend is billed separately by Resend (already set up; its plan and price were not checked here).

---

## 6. Open decisions for the maintainer

- **D1. Storage engine: DECIDED Oct 18: SQLite in a Durable Object.**
- **D2. Workers plan:** confirm whether the account is on Workers Paid ($5/month minimum); Free's 10 ms CPU limit is
  likely too tight.
- **D3. Hostnames:** staging hostname for testing, and when to cut the demo hostname over from the
  self-hosted tunnel to Workers (DNS + tunnel change). `apni.health` after the zone is added.
- **D4. Tooling dependency:** AGENTS.md requires a maintainer decision for npm dependencies. Wrangler (and Miniflare
  for tests) as a pinned devDependency with a lockfile, or invoked as `npx wrangler@<exact version>` only in
  deploy/CI scripts. The spike used `npx wrangler@4.151.1` (not added to package.json). Needed by PR 6 at the latest.
- **D5. Real users on Workers:** the demo stays "no real health data". Before real users: privacy notice naming
  Cloudflare and Resend as processors, Cloudflare DPA, data retention, and a tested restore. Not part of this series.
- **D6. Reminders:** OK that push reminders move from 30-second to 1-minute granularity on Workers.
- **D7. Deploy path:** manual `wrangler deploy` from the box vs a GitHub Actions job with a scoped token
  (`.github` change, protected).

## 7. Blockers and unknowns

- Plan tier cannot be read with the current API token (see D2).
- Not verified: whether the current token can create D1/R2/Workers resources or Custom Domains (a write test was out
  of scope).
- ~~`nodejs_compat` coverage~~: proven in the spike (section 8), with two code changes needed (crypto key options,
  `$name` binding).
- Wrangler is not pinned in the repo yet (D4).
- `apni.health` is not yet in the Cloudflare account.

---

## 8. PR 0 spike findings (Oct 18, 2026, local `wrangler dev` only)

Setup: throwaway worker outside the repo (not committed), `npx wrangler@4.151.1 dev`
(workerd local runtime, Node 22.14 host), `compatibility_date` 2026-10-01, `nodejs_compat`, one SQLite-backed Durable
Object class (`new_sqlite_classes`). It imported the repo's real `zip.mjs`, `webauthn.mjs` and `migrations.mjs`
and copied the test passkey authenticator from `testlib.mjs`. Nothing deployed, no Cloudflare account used.

| Check | Result |
|---|---|
| `node:http` `createServer` via `httpServerHandler` (`cloudflare:node`) | Works. Streamed response with `res.write` (chunked, 1.08 MB ZIP of 50 entries; valid per Python `zipfile`), request body streamed with `for await` (300 KB), several `Set-Cookie` headers kept, `Host` header passed. Status text shows as `unknown` (cosmetic). |
| `process.env` from `vars` | Populated (`process.env.APP_NAME` read the var). `env.mjs` can keep reading `process.env`, but values are only there per request/isolate; read lazily (PR 4). |
| `zlib.crc32`, `deflateRawSync`/`inflateRawSync`, `zip.mjs` | Work unchanged. |
| `randomUUID`, `randomBytes`, `createHash`, `timingSafeEqual` | Work. |
| Push crypto: `generateKeyPairSync('ec')` + JWK export, `createECDH`, `hkdfSync`, `aes-128-gcm` | Work. |
| `sign('sha256', data, {key: KeyObject, dsaEncoding:'ieee-p1363'})` (push.mjs VAPID) | **Fails**: "options.key must be ... string, Buffer ... or Object. Received PrivateKeyObject". Passing `{key: jwk, format:'jwk', dsaEncoding}` or `{key: pem, dsaEncoding}` works (64-byte signature). |
| `webauthn.mjs` passkeys: EdDSA (-8) and RS256 (-257) | Register + assert work unchanged. |
| `webauthn.mjs` ES256 (-7), `verify('sha256', data, {key: KeyObject, dsaEncoding:'der'}, sig)` | **Fails** (same KeyObject-in-options error). `verify` with the KeyObject directly (DER is the default) or with `{key: spkiDer, format:'der', type:'spki', dsaEncoding:'der'}` works. Fix in PR 3: no KeyObject inside options objects. |
| `AsyncLocalStorage` across `await`/`setTimeout` | Works (`runAs`, `inZone` can stay). |
| `node:sqlite` | The import resolves, but `new DatabaseSync()` throws "Illegal constructor". `db.mjs` must not open it on Workers; the DO adapter replaces it. |
| `node:fs` | In-memory virtual fs: `/tmp` read/write works but is not persistent; repo files (`config/markers.default.json`) are not there. Bundle config as module imports (PR 3), blobs to R2 (PR 2 + 6). |
| `node:net` | Module loads (`connect` exists); a real SMTP connection was not tried. Resend over `fetch` is the Workers path (PR 1); `mailer.mjs` now imports `node:net`/`node:tls` lazily, only when SMTP is used. |
| `fetch` | Available (outbound requests not exercised). |
| `import.meta.url` in the bundle | **`undefined`.** Every module that builds a path at import time with `new URL(..., import.meta.url)` fails to load with "Invalid URL string": `store.mjs` (profiles root) and, through it, `members`, `events`, `medicines`, `settings`, `appointments`, `push`; also `labs.mjs`, `ingest.mjs`, `server.mjs`. `env.mjs`, `consent.mjs` and `db.mjs` (lazy) load fine. Fix: compute file paths lazily (Node-only code paths) in a follow-up PR before PR 6. |
| JSON module import (`with {type:'json'}`) | Works (the marker catalog bundles; PR 3 uses it). |
| Re-run with PR 3's code | ES256 passkeys pass; `createECDH().setPrivateKey` works (used to validate `VAPID_PRIVATE_JWK`). |
| DO SQLite: the 9 existing migrations | **All apply unchanged** inside `ctx.storage.transactionSync` (25 tables, 252 KB). |
| DO SQLite: foreign keys | On by default (`PRAGMA foreign_keys` = 1); `ON DELETE CASCADE` works; violations rejected. |
| DO SQLite: `CHECK(json_valid(data))` | Enforced. |
| DO SQLite: `transactionSync` rollback on throw | Works (row gone). |
| DO SQLite: `BEGIN IMMEDIATE` (as in `db.mjs`) | **Refused** ("use state.storage.transactionSync()"). Adapter maps `tx()` to `transactionSync`; nested calls join the outer one as today. |
| DO SQLite: `PRAGMA journal_mode=WAL` | **Refused** (SQLITE_AUTH). Node-only. |
| DO SQLite: parameters | Positional `?` and numbered `?1` work. **Named `{$a:1}` objects are not supported and bind silently as the string `[object Object]`.** Every query in the app uses `$name` today, so PR 5a must translate `$name` to `?N` and refuse objects. |

Not tested in the spike: CPU time against real limits, deployed behaviour, R2, Cron Triggers, outbound Web Push,
a real SMTP connection over `node:net`, and the full `server.mjs` (it needs the storage adapter first).

Effect on the plan: no blocker for option B. PR 3 gains the crypto option fix; PR 5a must include the `$name`
translation; a new small PR (4b) makes module-level file paths lazy (`import.meta.url` is undefined on Workers);
PR 6 can use approach (a), `httpServerHandler` around the existing handler.

## 9. Progress (Oct 18, 2026)

| PR | Branch | State |
|---|---|---|
| 1 mail adapter (+ this plan) | `feat/mail-resend` | open (#22) |
| 2 blob interface, fs backend | `feat/blob-storage` | open (#23) |
| 3 VAPID from env, push via fetch, Workers-safe crypto, bundled catalog | `feat/workers-config-push` | open (#24) |
| 4 scheduler entry point | `feat/scheduler` | open (#25) |

PRs 1-4 are independent and were checked to merge cleanly together in that order, with the full test suite green
on the combination. After they merge, one small follow-up: add `test-blobs`/`test-scheduler` to the `npm test`
list in `package.json` and update the AGENTS.md structure notes (mailer, scheduler). These were held back to avoid
same-line merge conflicts between the PRs; CI already runs both tests from `ci.yml`.
Next: 4b (lazy file paths), 5a (storage adapter with `$name` -> `?N`), then 6 (Workers entry, DO, R2).
