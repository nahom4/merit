-- Who is signed in, and which organisation profile is theirs.
--
-- The point of this table is the organization_id: without it the app has no idea which
-- profile a visitor means, and the id has to be carried in the URL by hand.
--
-- Sessions are rows rather than a signed cookie so that signing out actually revokes.

CREATE TABLE users (
  email           TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  organization_id TEXT REFERENCES organizations (id),
  created_at      TEXT NOT NULL
);

CREATE TABLE user_sessions (
  id         TEXT PRIMARY KEY,
  email      TEXT NOT NULL REFERENCES users (email),
  created_at TEXT NOT NULL
);
