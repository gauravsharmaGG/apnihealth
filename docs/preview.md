# Preview mode (fictional data)

Preview mode runs the app with clearly fictional data, so UI changes can be checked and screenshotted
without any real health record. Never run it in a directory that holds real data.

- `scripts/preview/seed.mjs` fills a throwaway `private/` with fictional members (from
  `config/members.example.json`), lab reports, episodes, medicines, appointments, a child record and 90 days
  of measurements, through the app's own data modules, and writes a `private/.preview` marker. It refuses to
  run without `PREVIEW_MODE=1` or when `private/` exists without that marker.
- `scripts/preview/loader.mjs` + `auth-shim.mjs`: preview-only login. Started as
  `node --import ./scripts/preview/loader.mjs server.mjs`, the loader swaps `access.mjs` for the shim, which
  accepts only requests carrying an `X-Preview-Auth` header equal to a random per-run `PREVIEW_AUTH_TOKEN`.
  Both refuse to load unless `PREVIEW_MODE=1`, and the loader also requires the `private/.preview` marker.
  `server.mjs` and `access.mjs` are unchanged, and the normal start command never loads these files.

Run it in a scratch clone:

```bash
PREVIEW_MODE=1 node scripts/preview/seed.mjs && python3 build.py
PREVIEW_MODE=1 PREVIEW_AUTH_TOKEN=$(openssl rand -hex 16) NO_PUSH=1 PORT=4180 \
  node --import ./scripts/preview/loader.mjs server.mjs
```

Send the token as the `X-Preview-Auth` header (for example with a browser extension or a local proxy).
