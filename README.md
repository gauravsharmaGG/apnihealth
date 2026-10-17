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
- **Daily log**: weight, steps, resting heart rate, blood pressure, sleep and body fat, by hand or from Apple Health
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
- An authenticating reverse proxy. For now the server only accepts requests carrying a valid
  [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/applications/) JWT for one of the allowed
  identities, and rejects everything else (fail closed). See "Roadmap".

## Set up

```bash
mkdir -p private/profiles public/records
cp config/members.example.json private/members.json      # your household: ids, names, adult/child, colours
node scripts/import-json.mjs                             # creates private/apnihealth.db with these members
cp .env.example .env                                     # then edit; export these variables for the server
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
CF_ACCESS_ISSUER=https://<team>.cloudflareaccess.com CF_ACCESS_AUD=<aud> CF_ACCESS_EMAIL=you@example.com \
node server.mjs
```

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
node test-db.mjs && node test-import.mjs && node test-labs.mjs
NO_PUSH=1 node test-members.mjs && node test-medicines.mjs && node test-push.mjs && node test-appointments.mjs
node test-access.mjs && node test-ahparse.mjs && node test-preview.mjs
python3 test-build-index.py
node test-server.mjs                 # end to end on preview data
node test-browser-smoke.mjs          # needs Chrome (CHROME_BIN)
# or: npm test && npm run test:browser
```

All tests use fictional data. Never add real health data to code, tests, fixtures, issues or screenshots.

## Roadmap

- Built-in accounts (passkeys, email links), sign-up, households and invites, roles.
- SQLite storage with per-member isolation enforced in one place (in progress); export and account deletion.
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
