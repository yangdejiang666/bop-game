CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS user_identities (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_uid TEXT NOT NULL,
  account TEXT,
  password_hash TEXT,
  password_algo TEXT,
  email TEXT,
  phone TEXT,
  email_verified INTEGER NOT NULL DEFAULT 0,
  phone_verified INTEGER NOT NULL DEFAULT 0,
  bound_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(provider, provider_uid),
  UNIQUE(account)
);

CREATE INDEX IF NOT EXISTS idx_user_identities_user_id ON user_identities(user_id);
CREATE INDEX IF NOT EXISTS idx_user_identities_provider ON user_identities(provider);

CREATE TABLE IF NOT EXISTS user_profiles (
  user_id TEXT PRIMARY KEY,
  nickname TEXT NOT NULL,
  avatar_url TEXT,
  bootstrapped_from_local_at TEXT,
  level INTEGER NOT NULL DEFAULT 1,
  current_xp INTEGER NOT NULL DEFAULT 0,
  total_xp INTEGER NOT NULL DEFAULT 0,
  coins INTEGER NOT NULL DEFAULT 0,
  season_score INTEGER NOT NULL DEFAULT 0,
  best_mass INTEGER NOT NULL DEFAULT 0,
  total_matches INTEGER NOT NULL DEFAULT 0,
  total_wins INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  session_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'unknown',
  app_version TEXT,
  ip TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  revoked_at TEXT,
  UNIQUE(user_id, device_id)
);

CREATE TABLE IF NOT EXISTS auth_access_tokens (
  access_token_hash TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_refresh_tokens (
  refresh_token_hash TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_match_results (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  client_match_id TEXT NOT NULL,
  mode_id TEXT NOT NULL,
  player_rank INTEGER NOT NULL,
  player_mass INTEGER NOT NULL,
  player_won INTEGER NOT NULL DEFAULT 0,
  is_new_record INTEGER NOT NULL DEFAULT 0,
  xp_gained INTEGER NOT NULL DEFAULT 0,
  coins_gained INTEGER NOT NULL DEFAULT 0,
  finished_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(user_id, client_match_id)
);

CREATE TABLE IF NOT EXISTS rooms (
  room_id TEXT PRIMARY KEY,
  mode_id TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'private',
  invite_code TEXT UNIQUE,
  owner_user_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'idle',
  team_mode TEXT NOT NULL DEFAULT 'solo',
  max_members INTEGER NOT NULL DEFAULT 4,
  min_start_members INTEGER NOT NULL DEFAULT 2,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS room_members (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  nickname_snapshot TEXT NOT NULL,
  avatar_url_snapshot TEXT,
  ready INTEGER NOT NULL DEFAULT 0,
  role TEXT NOT NULL DEFAULT 'member',
  team_id INTEGER,
  is_online INTEGER NOT NULL DEFAULT 1,
  joined_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(room_id, user_id)
);

CREATE TABLE IF NOT EXISTS matchmaking_tickets (
  ticket_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  mode_id TEXT NOT NULL,
  stage TEXT NOT NULL DEFAULT 'searching',
  region TEXT,
  estimated_wait_seconds INTEGER NOT NULL DEFAULT 0,
  current_players INTEGER NOT NULL DEFAULT 0,
  target_players INTEGER NOT NULL DEFAULT 0,
  min_start_players INTEGER NOT NULL DEFAULT 0,
  match_id TEXT,
  room_id TEXT,
  failure_code TEXT,
  failure_message TEXT,
  queued_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  cancelled_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_matchmaking_active_ticket_per_user
ON matchmaking_tickets(user_id)
WHERE stage IN ('searching', 'confirming', 'matched');
