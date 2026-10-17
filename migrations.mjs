// Schema migrations, applied in order inside a transaction each. Never edit a released migration; add a new one.
// Member data tables all carry member_id and are only queried through store.mjs (forMember).
// "Document" tables keep the validated record as JSON in `data`, with the fields used for lookups as columns.
export const MIGRATIONS=[
 {version:1,name:'households, members and member data',sql:`
CREATE TABLE households(
 id TEXT PRIMARY KEY,
 name TEXT NOT NULL,
 created_at TEXT NOT NULL
);
CREATE TABLE members(
 id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 32 AND id NOT GLOB '*[^a-z0-9-]*' AND substr(id,1,1) GLOB '[a-z]'),
 household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
 name TEXT NOT NULL,
 initial TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('adult','child')),
 labs INTEGER NOT NULL DEFAULT 0,
 color TEXT,
 position INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL
);
CREATE INDEX members_household ON members(household_id,position);
CREATE TABLE log_entries(
 id TEXT PRIMARY KEY,
 member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
 metric TEXT NOT NULL,
 date TEXT NOT NULL,
 value REAL NOT NULL,
 source TEXT NOT NULL,
 ts INTEGER NOT NULL
);
CREATE INDEX log_entries_member ON log_entries(member_id,metric,date);
CREATE TABLE episodes(
 member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
 id TEXT NOT NULL,
 pos INTEGER NOT NULL,
 data TEXT NOT NULL CHECK(json_valid(data)),
 PRIMARY KEY(member_id,id)
);
CREATE TABLE episode_entries(
 member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
 id TEXT NOT NULL,
 pos INTEGER NOT NULL,
 episode_id TEXT,
 data TEXT NOT NULL CHECK(json_valid(data)),
 PRIMARY KEY(member_id,id)
);
CREATE INDEX episode_entries_episode ON episode_entries(member_id,episode_id);
CREATE TABLE inbox_items(
 member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
 id TEXT NOT NULL,
 pos INTEGER NOT NULL,
 data TEXT NOT NULL CHECK(json_valid(data)),
 PRIMARY KEY(member_id,id)
);
CREATE TABLE medicine_plans(
 member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
 id TEXT NOT NULL,
 pos INTEGER NOT NULL,
 episode_id TEXT,
 data TEXT NOT NULL CHECK(json_valid(data)),
 PRIMARY KEY(member_id,id)
);
CREATE TABLE appointments(
 member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
 id TEXT NOT NULL,
 pos INTEGER NOT NULL,
 date TEXT,
 status TEXT,
 data TEXT NOT NULL CHECK(json_valid(data)),
 PRIMARY KEY(member_id,id)
);
CREATE INDEX appointments_date ON appointments(member_id,date);
CREATE TABLE push_subscriptions(
 endpoint TEXT PRIMARY KEY,
 p256dh TEXT NOT NULL,
 auth TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 muted TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(muted))
);
CREATE TABLE push_topics(
 endpoint TEXT NOT NULL REFERENCES push_subscriptions(endpoint) ON DELETE CASCADE,
 member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
 topic TEXT NOT NULL CHECK(topic IN ('medicine','appointments')),
 since INTEGER NOT NULL,
 PRIMARY KEY(endpoint,member_id,topic)
);
CREATE TABLE push_sent(
 key TEXT PRIMARY KEY,
 ts INTEGER NOT NULL
);
`},
 {version:2,name:'lab reports entered in the app',sql:`
CREATE TABLE lab_reports(
 member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
 id TEXT NOT NULL,
 date TEXT NOT NULL CHECK(date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
 reported TEXT,
 title TEXT,
 source TEXT,
 screening INTEGER NOT NULL DEFAULT 0,
 preliminary INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL,
 PRIMARY KEY(member_id,id)
);
CREATE INDEX lab_reports_date ON lab_reports(member_id,date);
CREATE TABLE lab_values(
 member_id TEXT NOT NULL,
 report_id TEXT NOT NULL,
 pos INTEGER NOT NULL,
 name TEXT NOT NULL,
 value TEXT NOT NULL,
 num REAL NOT NULL,
 unit TEXT,
 reference TEXT,
 flag TEXT CHECK(flag IN ('high','low')),
 page INTEGER,
 PRIMARY KEY(member_id,report_id,pos),
 FOREIGN KEY(member_id,report_id) REFERENCES lab_reports(member_id,id) ON DELETE CASCADE
);
CREATE TABLE lab_pending(
 member_id TEXT NOT NULL,
 report_id TEXT NOT NULL,
 pos INTEGER NOT NULL,
 name TEXT NOT NULL,
 note TEXT,
 PRIMARY KEY(member_id,report_id,pos),
 FOREIGN KEY(member_id,report_id) REFERENCES lab_reports(member_id,id) ON DELETE CASCADE
);
`},
 {version:3,name:'users, sessions, sign-in links and household memberships',sql:`
CREATE TABLE users(
 id TEXT PRIMARY KEY,
 email TEXT NOT NULL UNIQUE COLLATE NOCASE CHECK(length(email) BETWEEN 3 AND 254 AND email NOT GLOB '*[ <>,;]*' AND email LIKE '%_@_%'),
 name TEXT,
 active_household_id TEXT REFERENCES households(id) ON DELETE SET NULL,
 created_at TEXT NOT NULL,
 last_login_at TEXT
);
CREATE TABLE memberships(
 household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 role TEXT NOT NULL CHECK(role IN ('owner','editor','viewer')),
 created_at TEXT NOT NULL,
 PRIMARY KEY(household_id,user_id)
);
CREATE INDEX memberships_user ON memberships(user_id);
-- Only SHA-256 hashes of session and sign-in tokens are stored; the tokens themselves live in the cookie or email.
CREATE TABLE sessions(
 token_hash TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 created_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL,
 last_seen_at INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE TABLE login_tokens(
 token_hash TEXT PRIMARY KEY,
 email TEXT NOT NULL COLLATE NOCASE,
 created_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL,
 used_at INTEGER
);
`},
 {version:4,name:'passkeys',sql:`
CREATE TABLE passkeys(
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 public_key TEXT NOT NULL,
 alg INTEGER NOT NULL,
 sign_count INTEGER NOT NULL DEFAULT 0,
 transports TEXT NOT NULL DEFAULT '[]',
 name TEXT NOT NULL,
 created_at TEXT NOT NULL,
 last_used_at TEXT
);
CREATE INDEX passkeys_user ON passkeys(user_id);
-- Outstanding WebAuthn challenges (single use, short-lived). user_id is set while adding a passkey.
CREATE TABLE webauthn_challenges(
 challenge_hash TEXT PRIMARY KEY,
 purpose TEXT NOT NULL CHECK(purpose IN ('register','login')),
 user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
 expires_at INTEGER NOT NULL
);
`},
 {version:5,name:'household invites',sql:`
-- Invite links: only the SHA-256 hash of the token is stored. email (optional) limits who may accept.
CREATE TABLE invites(
 token_hash TEXT PRIMARY KEY,
 household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
 role TEXT NOT NULL CHECK(role IN ('owner','editor','viewer')),
 email TEXT COLLATE NOCASE,
 created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
 created_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL,
 used_at INTEGER,
 used_by TEXT REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX invites_household ON invites(household_id);
`}
];
