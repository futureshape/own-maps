PRAGMA foreign_keys = ON;

CREATE TABLE users (
    id TEXT PRIMARY KEY,
    google_sub TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL,
    display_name TEXT,
    avatar_url TEXT,
    created_at INTEGER NOT NULL,
    last_login_at INTEGER NOT NULL
);

CREATE INDEX users_by_email ON users(email);

CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX sessions_by_user ON sessions(user_id);
CREATE INDEX sessions_by_expiry ON sessions(expires_at);

CREATE TABLE maps (
    id TEXT PRIMARY KEY,
    owner_user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private')),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (owner_user_id) REFERENCES users(id)
);

CREATE INDEX maps_by_owner ON maps(owner_user_id, updated_at DESC);

CREATE TABLE map_members (
    map_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('editor', 'viewer')),
    PRIMARY KEY (map_id, user_id),
    FOREIGN KEY (map_id) REFERENCES maps(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX map_members_by_user ON map_members(user_id, map_id);

CREATE TABLE map_invites (
    id TEXT PRIMARY KEY,
    map_id TEXT NOT NULL,
    email TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('editor', 'viewer')),
    invited_by_user_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    accepted_at INTEGER,
    FOREIGN KEY (map_id) REFERENCES maps(id) ON DELETE CASCADE,
    FOREIGN KEY (invited_by_user_id) REFERENCES users(id)
);

CREATE INDEX pending_invites_by_email ON map_invites(email, accepted_at);
CREATE UNIQUE INDEX pending_invite_unique
ON map_invites(map_id, email)
WHERE accepted_at IS NULL;

CREATE TABLE categories (
    id TEXT PRIMARY KEY,
    map_id TEXT NOT NULL,
    name TEXT NOT NULL,
    marker_style TEXT,
    FOREIGN KEY (map_id) REFERENCES maps(id) ON DELETE CASCADE
);

CREATE INDEX categories_by_map ON categories(map_id);
CREATE UNIQUE INDEX category_name_unique ON categories(map_id, name);

CREATE TABLE map_places (
    id TEXT PRIMARY KEY,
    map_id TEXT NOT NULL,
    place_id TEXT NOT NULL,
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    category_id TEXT,
    note TEXT,
    sort_order INTEGER,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (map_id) REFERENCES maps(id) ON DELETE CASCADE,
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX map_place_unique ON map_places(map_id, place_id);
CREATE INDEX map_places_by_map ON map_places(map_id, sort_order, created_at);
