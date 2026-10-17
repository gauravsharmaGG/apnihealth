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
`}
];
