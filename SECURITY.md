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

- The server binds to `127.0.0.1` and rejects requests without a valid identity token (fail closed). Do not
  expose it without an authenticating proxy.
- Only the hostname in `APP_HOST` (and localhost) is accepted. Writes require a same-origin request.
- Data is kept in a SQLite database and upload files under `private/`, with owner-only permissions. Encrypt the
  disk and back it up. All member data access goes through one access check (`store.mjs`).
- The Apple Health ingest key only allows adding measurements. Treat it like a password and rotate it by
  deleting `private/ingest-token.txt` if it leaks.
- Responses send a strict Content-Security-Policy, `no-store` caching and `noindex` headers.
