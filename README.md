# ApniHealth

A self-hosted, mobile-first health record for you and your household. Open source under the AGPL-3.0.

> **Status: early.** ApniHealth grew out of a private household app and is being turned into a general
> project. It works for a single household that can run a small Node server behind an authenticating proxy.
> Built-in accounts and sign-up, a database and Docker images are planned, not done. Expect breaking changes.

> **Not medical advice.** ApniHealth helps you keep and read your own records. It does not diagnose, treat or
> recommend doses, and it is not a medical device. Plain-language explanations are general information only.
> Talk to a qualified health professional about your results, and call your local emergency number in an emergency.

## Features

Per household member (adults and children; set up from a `members.json` file, see below):

- **Episodes**: group symptoms, temperatures, medicines, visits and test results of one illness or injury,
  from start to recovery, with attachments.
- **Medicines**: courses with fixed times or intervals, dose check-off, late-dose spacing hints and web-push reminders.
- **Appointments**: a shared calendar with reminders and `.ics` export.
- **Daily log**: weight, steps, resting heart rate, blood pressure, sleep, body fat, blood oxygen, heart rate variability and body temperature, by hand or from Apple Health
  (Health Auto Export app, Apple Shortcuts, or an `export.zip` import).
- **Lab results** (every adult): add a dated report with its values in the app; a results explorer shows
  plain-language meanings and trends.
  Marker names are matched through a generic catalog (`config/markers.default.json`); add your lab's own names,
  in any language, as aliases.
- **Child record**: growth, check-ups and vaccinations.
- **Record inbox**: photograph or upload letters and reports; they are stored for review, never read automatically.
- Installable PWA (works well from the iPhone home screen), offline app shell, no third-party scripts or trackers.

## Requirements

- Node.js 22.13 or newer (uses the built-in `node:sqlite`; no npm dependencies) and Python 3 for the build script.
- A TLS reverse proxy or tunnel in front of the server (it listens on `127.0.0.1` only).
- For built-in sign-in by email: an SMTP account (optional during setup; links are printed to the server log
  until SMTP is configured).

## Set up

```bash
mkdir -p private/profiles public/records
cp config/members.example.json private/members.json      # your household: ids, names, adult/child, colours
node scripts/import-json.mjs                             # creates private/apnihealth.db with these members
cp .env.example .env                                     # then edit; export these variables for the server
node scripts/create-user.mjs --email you@example.com --role owner --link   # first user; prints a sign-in link
# optional:
cp config/overview.example.json private/overview.json    # overview page text (generic defaults otherwise)
cp config/reports.example.json private/reports.json      # report library (PDFs go in public/records/)
cp config/markers.example.json private/markers.json      # extra marker names/aliases (restart the server after changes)
# per child member: private/profiles/<id>/child-record.json (shape: config/child-record.example.json)
python3 build.py                                         # writes the git-ignored public/index.html and data files
```

Member ids are lowercase letters, digits and dashes; they are also folder names under `private/profiles/`.
Every adult gets the Trends and Results views; lab results are entered there ("Add results"). One adult can be
marked `"labs": true`: that member's overview page shows the text from `overview.json` and the PDF report library.
An old `private/lab-values.json` (shape: `config/lab-values.example.json`) is imported into that member by
`scripts/import-json.mjs`.

## Run

```bash
PORT=4174 APP_HOST=health.example.com APP_TIME_ZONE=Europe/Berlin \
SMTP_URL=smtps://user:password@smtp.example.com:465 SMTP_FROM="ApniHealth <health@example.com>" \
node server.mjs
```

### Sign-in (AUTH_MODE)

- `AUTH_MODE=builtin` (default): people sign in with a one-time link sent by email (valid 15 minutes, single use).
  The server keeps the session (30 days, extended while used) and sets an `HttpOnly`, `SameSite=Lax` cookie,
  `Secure` with the `__Host-` prefix when served through `APP_HOST` over TLS. Without `SMTP_URL`, sign-in links
  are printed to the server log instead of emailed (development only). Once signed in, anyone can add a
  **passkey** (Face ID, Touch ID, device PIN) in Settings and sign in with it from then on; passkeys need HTTPS
  (or `localhost`) and are tied to the host name in `APP_HOST`. Sign-up is controlled by `SIGNUP_MODE`:
  `open` (default) lets anyone with a verified email create an account (they start their own household);
  `invite` limits new accounts to people holding an invite. After the first email sign-in, people are offered a
  passkey once. `scripts/create-user.mjs` can still create users from the command line.
- **First-run setup:** someone without a household (for example right after signing up) goes to `/welcome`:
  household name and their own adult profile, other profiles (adults or children, optional), which daily
  measurements to track (weight, body fat, sleep, steps, resting heart rate, blood pressure, blood oxygen, heart
  rate variability, body temperature; illness episodes, medicines, appointments and lab results are always
  included), the household's time zone and units (kg/lb, °C/°F), and an Apple Health key for a profile. Owners can
  return there from Settings → Household. Values are always stored in kg and °C. Each household's time zone is used
  for its medicine schedules, reminders and calendar files; `APP_TIME_ZONE` is the default for households that have
  not chosen one. Households that existed before this version count as set up and keep every measurement.
- **Health data notice and consent:** before anyone can see or enter health data, they read a short notice (not
  medical advice, not a medical device; what is processed and why) and explicitly consent to the processing of
  health data (GDPR Art. 9 style). The app records when and which version they accepted, and asks again when the
  notice version (`CONSENT_VERSION` in `consent.mjs`) changes. Set `PRIVACY_URL` to link your own privacy notice;
  `docs/PRIVACY-TEMPLATE.md` is a starting point for people who host it for others.
- `AUTH_MODE=trusted-proxy`: Cloudflare Access (or a proxy issuing the same signed JWT) signs people in. Set
  `CF_ACCESS_ISSUER`, `CF_ACCESS_AUD` and `CF_ACCESS_EMAIL` (allowed emails). An allowed email becomes a user on
  first visit: the first one owns the household, later ones join as `TRUSTED_PROXY_ROLE` (default `editor`).
  If `CF_ACCESS_ISSUER` is set without `AUTH_MODE`, the server refuses to start, so an existing Cloudflare setup
  never silently switches modes.

### Households, people and profiles

- A **profile** (member) is someone with health records: an adult or a child. Profiles do not need a login.
- **People** sign in and get a role in a household: **owner** (everything, including profiles, invites and who has
  access), **editor** (add and change records of every profile) or **viewer** (read only). A household always keeps
  at least one owner. One login can belong to several households and switch between them in Settings.
- Owners invite from Settings → Household: an invite link (anyone holding it can join once) or an invite for one
  email address (emailed when SMTP is set up). Invites expire after 7 days. With `SIGNUP_MODE=invite` an invite is
  the only way for a new address to get an account.
- **Apple Health sync** uses one key per profile (Integrations → Sync from Apple Health), so a phone can only add numbers to
  its own profile. An existing `private/ingest-token.txt` key keeps working as a shared household key until you
  revoke it there.
- **Notifications** are per device and belong to the person who turned them on.
- Deleting a profile deletes its records from the database and its uploaded files under `private/profiles/<id>/`.
- **Your data** (Settings): anyone signed in can download everything they can see as one ZIP: `data.json` with their
  account, every household they belong to, its profiles and all records, plus every uploaded file. **Delete my
  account** (confirm by typing your email) removes the login, passkeys, sessions and consent records, and every
  household the person is the only owner of, with all its profiles, records, Apple Health keys and files (people
  who shared that household lose access; households with another owner stay). Backups are yours to rotate. With
  `AUTH_MODE=trusted-proxy`, an allowed email gets a fresh account on the next visit, so also remove it from
  `CF_ACCESS_EMAIL`. Every state-changing request must come from the app's own
origin (CSRF protection), and the sign-in endpoints are rate limited.

The server listens on `127.0.0.1` only. Put it behind your proxy or tunnel with TLS, and run it with your
service manager of choice (systemd, launchd, ...). Re-run `python3 build.py` after changing files in `private/`.

All health data lives in git-ignored `private/` and `public/records/`. Back these folders up and keep them
encrypted at rest.

### Storage

Members, the daily log, episodes and their entries, the record inbox, medicines, appointments and push
subscriptions are stored in a SQLite database (`private/apnihealth.db`, or `DB_FILE`). It is created with
owner-only permissions and migrated automatically on start. Uploaded files stay in `private/profiles/<id>/uploads/`.
Every query on member data goes through one access check (`store.mjs`). Back up the database with the server
stopped, or with `sqlite3 private/apnihealth.db ".backup backup.db"`.

Coming from an older version that stored JSON files in `private/`? Stop the server, then:

```bash
node scripts/import-json.mjs --dry-run      # validate and print counts only; writes nothing
node scripts/import-json.mjs                # import; the JSON files and uploads are left untouched
```

The import runs only into an empty database and prints counts, never values. Keep the JSON files as a backup
until you have checked the app.

## Try it with fictional data

See [docs/preview.md](docs/preview.md).

## Tests

```bash
node test-theme.mjs && node test-db.mjs && node test-import.mjs && node test-labs.mjs && node test-mailer.mjs && node test-auth.mjs && node test-signup.mjs && node test-consent.mjs && node test-onboarding.mjs && node test-datarights.mjs && node test-passkeys.mjs && node test-households.mjs && node test-ingest-push.mjs
NO_PUSH=1 node test-members.mjs && node test-medicines.mjs && node test-push.mjs && node test-appointments.mjs
node test-access.mjs && node test-ahparse.mjs && node test-preview.mjs
python3 test-build-index.py
node test-server.mjs                 # end to end on preview data
node test-browser-smoke.mjs && node test-browser-accounts.mjs   # need Chrome (CHROME_BIN)
# or: npm test && npm run test:browser
```

All tests use fictional data. Never add real health data to code, tests, fixtures, issues or screenshots.

## Roadmap

- Export and account deletion.
- Lab results: CSV import, and lab views for children.
- Docker image and self-hosting guide.
- A refreshed dashboard design.

## Privacy

Health data is special-category personal data under the GDPR (Art. 9). If you host ApniHealth for other
people, you are responsible for it as a data controller: get explicit consent, document what you store,
secure the server, and be able to export and delete a person's data. See [SECURITY.md](SECURITY.md) for
reporting vulnerabilities.

## License

[GNU Affero General Public License v3.0](LICENSE). If you run a modified version for others over a network,
you must offer them its source code.
