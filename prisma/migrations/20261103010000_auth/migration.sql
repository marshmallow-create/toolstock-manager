ALTER TABLE users ADD COLUMN password_hash TEXT;
CREATE TABLE sessions (
 token_hash TEXT PRIMARY KEY,
 user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 last_seen_at TIMESTAMPTZ(3) NOT NULL,
 expires_at TIMESTAMPTZ(3) NOT NULL,
 CONSTRAINT session_dates_valid CHECK (last_seen_at >= created_at AND expires_at > created_at)
);
CREATE INDEX sessions_user_id_idx ON sessions(user_id);
CREATE INDEX sessions_expires_at_idx ON sessions(expires_at);
CREATE TABLE login_attempts (
 key TEXT PRIMARY KEY,
 attempts INTEGER NOT NULL CHECK (attempts > 0),
 started_at TIMESTAMPTZ(3) NOT NULL
);
