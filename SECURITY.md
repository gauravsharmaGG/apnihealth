# Security policy

ApniHealth stores health records, so security reports are very welcome.

## Reporting a vulnerability

Please **do not open a public issue** for a security problem. Use GitHub's private vulnerability reporting
("Security" tab → "Report a vulnerability") on this repository. Include steps to reproduce and the affected
version or commit. Please do not include real health data in a report.

You should get a first answer within a week. Fixes are released as soon as practical, and reporters are
credited unless they prefer otherwise.

## Supported versions

The project is in an early stage; only the latest commit on `main` is supported.

## Design notes for self-hosters

- The server binds to `127.0.0.1` and rejects requests without a valid session (`AUTH_MODE=builtin`) or identity
  token (`AUTH_MODE=trusted-proxy`), failing closed. Serve it only through TLS.
- Sessions and sign-in links are random 256-bit tokens; the database stores only their SHA-256 hashes. Session
  cookies are `HttpOnly` and `SameSite=Lax` (`Secure`, `__Host-` behind TLS). Sign-in links are single use and
  expire after 15 minutes; the endpoints are rate limited and do not reveal whether an address has an account.
- Passkeys (WebAuthn) are verified in `webauthn.mjs` without third-party code: origin, RP ID hash, user presence,
  single-use server-side challenges (5 minutes), signature (ES256, Ed25519, RS256 >= 2048 bits) and the signature
  counter. Attestation is not requested or checked ("none"), so the server makes no claims about the device model.
- Access to member data is decided in one place (`store.mjs` `forMember`) from the signed-in user's role in the
  member's household (owner/editor: read and write, viewer: read only). Members of other households look unknown.
  Household administration (profiles, invites, roles) is owner-only and also checked on the server.
- Invite tokens are random 256-bit values stored as SHA-256 hashes, single use, valid 7 days, optionally bound to
  one email address. With `SIGNUP_MODE=invite`, built-in sign-in never creates
  accounts without a valid invite; with `open` (default), only after the email link is used. The sign-in form answers
  the same for known and unknown addresses.
- Nothing health-related is readable or writable until the signed-in person has accepted the current version of
  the health data notice (`consent.mjs`): the server answers 403 for every API and sends pages to `/consent`, and
  the store refuses writes by users without consent as a second check. Acceptance is stored with its time and
  version. Apple Health keys keep working, since an editor who already consented created them.
- Export (`/api/export`) runs as the signed-in user through the same access check as the app, needs consent, and
  leaves out secrets (session and key hashes, passkey public keys). Account deletion needs the account's email
  typed again plus a same-origin request; it deletes sole-owned households in one transaction and then their files.
- Only the hostname in `APP_HOST` (and localhost) is accepted. Every state-changing request must be same-origin.
- Data is kept in a SQLite database and upload files under `private/`, with owner-only permissions. Encrypt the
  disk and back it up. All member data access goes through one access check (`store.mjs`).
- Apple Health ingest keys are per profile: each only adds measurements to its own profile, is shown once and
  stored as a SHA-256 hash. Revoke a leaked key in the app (Log → Sync from Apple Health). The single shared key of
  older versions (`private/ingest-token.txt`) is registered once as a household-wide key and keeps working until
  revoked; a revoked key is never registered again.
- Push notification devices belong to the user who turned them on. Others cannot see or change them, and reminders
  stop for profiles the device's user can no longer access.
- Responses send a strict Content-Security-Policy, `no-store` caching and `noindex` headers.
