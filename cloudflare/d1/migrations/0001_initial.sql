CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  game_id TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_login_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_users_game_id ON users(game_id);

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

CREATE TABLE IF NOT EXISTS social_friend_requests (
  id TEXT PRIMARY KEY,
  requester_user_id TEXT NOT NULL,
  target_user_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  responded_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_social_friend_requests_requester
ON social_friend_requests(requester_user_id);

CREATE INDEX IF NOT EXISTS idx_social_friend_requests_target
ON social_friend_requests(target_user_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_social_friend_requests_pending_pair
ON social_friend_requests(requester_user_id, target_user_id)
WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS social_friendships (
  id TEXT PRIMARY KEY,
  user_low TEXT NOT NULL,
  user_high TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by_user_id TEXT,
  UNIQUE(user_low, user_high)
);

CREATE INDEX IF NOT EXISTS idx_social_friendships_low
ON social_friendships(user_low);

CREATE INDEX IF NOT EXISTS idx_social_friendships_high
ON social_friendships(user_high);

CREATE TABLE IF NOT EXISTS social_blocks (
  id TEXT PRIMARY KEY,
  blocker_user_id TEXT NOT NULL,
  blocked_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(blocker_user_id, blocked_user_id)
);

CREATE INDEX IF NOT EXISTS idx_social_blocks_blocker
ON social_blocks(blocker_user_id);

CREATE INDEX IF NOT EXISTS idx_social_blocks_blocked
ON social_blocks(blocked_user_id);

CREATE TABLE IF NOT EXISTS room_live_sessions (
  room_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  mode_id TEXT NOT NULL,
  phase TEXT NOT NULL DEFAULT 'running',
  version INTEGER NOT NULL DEFAULT 1,
  state_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  last_simulated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_room_live_sessions_session_id
ON room_live_sessions(session_id);
