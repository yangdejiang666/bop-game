-- bop/database/001_init.sql
-- Initial schema for:
-- - Auth / account identities
-- - User profile / progression
-- - Inventory / skins
-- - Matchmaking tickets
-- - Rooms / room members
-- - Basic social + ranking snapshots
--
-- PostgreSQL 14+ recommended.

BEGIN;

-- =========================================================
-- Extensions
-- =========================================================
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =========================================================
-- Enums
-- =========================================================
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'account_status') THEN
        CREATE TYPE account_status AS ENUM ('active', 'banned', 'deleted');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'provider_type') THEN
        CREATE TYPE provider_type AS ENUM ('password', 'guest', 'phone', 'apple', 'wechat', 'platform');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'device_platform') THEN
        CREATE TYPE device_platform AS ENUM ('web', 'android', 'ios', 'windows', 'macos', 'linux', 'unknown');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ticket_stage') THEN
        CREATE TYPE ticket_stage AS ENUM ('idle', 'searching', 'confirming', 'matched', 'cancelled', 'failed');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'room_visibility') THEN
        CREATE TYPE room_visibility AS ENUM ('public', 'private');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'room_status') THEN
        CREATE TYPE room_status AS ENUM ('idle', 'matching', 'in_game', 'closed');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'room_member_role') THEN
        CREATE TYPE room_member_role AS ENUM ('owner', 'member');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'team_mode') THEN
        CREATE TYPE team_mode AS ENUM ('solo', 'team');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'friend_status') THEN
        CREATE TYPE friend_status AS ENUM ('pending', 'accepted', 'blocked', 'removed');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'season_rank_scope') THEN
        CREATE TYPE season_rank_scope AS ENUM ('global', 'region');
    END IF;
END$$;

-- =========================================================
-- Utility trigger for updated_at
-- =========================================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- =========================================================
-- Core user / auth tables
-- =========================================================
CREATE TABLE IF NOT EXISTS users (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    status              account_status NOT NULL DEFAULT 'active',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_login_at       TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS user_identities (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    provider            provider_type NOT NULL,
    provider_uid        VARCHAR(191) NOT NULL,

    -- password provider fields
    account             VARCHAR(64),
    password_hash       TEXT,
    password_algo       VARCHAR(32),

    -- optional contact channels
    email               VARCHAR(191),
    phone               VARCHAR(32),
    email_verified      BOOLEAN NOT NULL DEFAULT FALSE,
    phone_verified      BOOLEAN NOT NULL DEFAULT FALSE,

    bound_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_user_identities_provider_uid UNIQUE (provider, provider_uid),
    CONSTRAINT uq_user_identities_account UNIQUE (account),
    CONSTRAINT uq_user_identities_email UNIQUE (email),
    CONSTRAINT uq_user_identities_phone UNIQUE (phone),
    CONSTRAINT chk_password_identity_fields
        CHECK (
            (provider <> 'password')
            OR (account IS NOT NULL AND password_hash IS NOT NULL)
        )
);

CREATE INDEX IF NOT EXISTS idx_user_identities_user_id ON user_identities(user_id);
CREATE INDEX IF NOT EXISTS idx_user_identities_provider ON user_identities(provider);

CREATE TABLE IF NOT EXISTS user_bans (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    is_banned           BOOLEAN NOT NULL DEFAULT FALSE,
    reason              TEXT,
    banned_until        TIMESTAMPTZ,
    operator_note       TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_user_bans_user_id UNIQUE (user_id)
);

-- =========================================================
-- Session / token / device login tracking
-- =========================================================
CREATE TABLE IF NOT EXISTS auth_sessions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    device_id           VARCHAR(128) NOT NULL,
    device_name         VARCHAR(128),
    platform            device_platform NOT NULL DEFAULT 'unknown',
    app_version         VARCHAR(32),
    ip                  INET,
    user_agent          TEXT,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at          TIMESTAMPTZ,

    CONSTRAINT uq_auth_sessions_user_device UNIQUE (user_id, device_id)
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_id ON auth_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_last_seen_at ON auth_sessions(last_seen_at);

CREATE TABLE IF NOT EXISTS auth_refresh_tokens (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id          UUID NOT NULL REFERENCES auth_sessions(id) ON DELETE CASCADE,
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    refresh_token_hash  TEXT NOT NULL,
    issued_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at          TIMESTAMPTZ NOT NULL,
    revoked_at          TIMESTAMPTZ,

    CONSTRAINT uq_auth_refresh_tokens_hash UNIQUE (refresh_token_hash)
);

CREATE INDEX IF NOT EXISTS idx_auth_refresh_tokens_user_id ON auth_refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_refresh_tokens_session_id ON auth_refresh_tokens(session_id);
CREATE INDEX IF NOT EXISTS idx_auth_refresh_tokens_expires_at ON auth_refresh_tokens(expires_at);

-- =========================================================
-- User profile / progression / cosmetics / inventory
-- =========================================================
CREATE TABLE IF NOT EXISTS user_profiles (
    user_id             UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,

    nickname            VARCHAR(24) NOT NULL,
    avatar_url          TEXT,
    bootstrapped_from_local_at TIMESTAMPTZ,

    level               INTEGER NOT NULL DEFAULT 1 CHECK (level >= 1),
    current_xp          INTEGER NOT NULL DEFAULT 0 CHECK (current_xp >= 0),
    total_xp            BIGINT NOT NULL DEFAULT 0 CHECK (total_xp >= 0),
    coins               BIGINT NOT NULL DEFAULT 0 CHECK (coins >= 0),

    season_score        INTEGER NOT NULL DEFAULT 0 CHECK (season_score >= 0),
    best_mass           INTEGER NOT NULL DEFAULT 0 CHECK (best_mass >= 0),
    total_matches       INTEGER NOT NULL DEFAULT 0 CHECK (total_matches >= 0),
    total_wins          INTEGER NOT NULL DEFAULT 0 CHECK (total_wins >= 0),

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_profiles_season_score ON user_profiles(season_score DESC);
CREATE INDEX IF NOT EXISTS idx_user_profiles_best_mass ON user_profiles(best_mass DESC);

CREATE TABLE IF NOT EXISTS user_skins (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    skin_id             VARCHAR(64) NOT NULL,
    owned               BOOLEAN NOT NULL DEFAULT TRUE,
    equipped            BOOLEAN NOT NULL DEFAULT FALSE,
    acquired_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_user_skins_user_skin UNIQUE (user_id, skin_id)
);

CREATE INDEX IF NOT EXISTS idx_user_skins_user_id ON user_skins(user_id);
CREATE INDEX IF NOT EXISTS idx_user_skins_equipped ON user_skins(user_id, equipped);

CREATE TABLE IF NOT EXISTS user_inventory_items (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item_id             VARCHAR(64) NOT NULL,
    quantity            INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    expires_at          TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_user_inventory_user_item UNIQUE (user_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_user_inventory_user_id ON user_inventory_items(user_id);

CREATE TABLE IF NOT EXISTS user_match_results (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    client_match_id     VARCHAR(128) NOT NULL,
    mode_id             VARCHAR(32) NOT NULL,
    player_rank         INTEGER NOT NULL CHECK (player_rank >= 1),
    player_mass         INTEGER NOT NULL CHECK (player_mass >= 0),
    player_won          BOOLEAN NOT NULL DEFAULT FALSE,
    is_new_record       BOOLEAN NOT NULL DEFAULT FALSE,
    xp_gained           INTEGER NOT NULL DEFAULT 0 CHECK (xp_gained >= 0),
    coins_gained        INTEGER NOT NULL DEFAULT 0 CHECK (coins_gained >= 0),
    finished_at         TIMESTAMPTZ NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_user_match_results_user_client_match UNIQUE (user_id, client_match_id)
);

CREATE INDEX IF NOT EXISTS idx_user_match_results_user_id ON user_match_results(user_id);
CREATE INDEX IF NOT EXISTS idx_user_match_results_created_at ON user_match_results(created_at DESC);

-- =========================================================
-- Matchmaking tickets
-- =========================================================
CREATE TABLE IF NOT EXISTS matchmaking_tickets (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id           VARCHAR(64) NOT NULL UNIQUE,

    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    mode_id             VARCHAR(32) NOT NULL,
    stage               ticket_stage NOT NULL DEFAULT 'searching',

    region              VARCHAR(32),
    estimated_wait_sec  INTEGER NOT NULL DEFAULT 0 CHECK (estimated_wait_sec >= 0),
    current_players     INTEGER NOT NULL DEFAULT 0 CHECK (current_players >= 0),
    target_players      INTEGER NOT NULL DEFAULT 0 CHECK (target_players >= 0),
    min_start_players   INTEGER NOT NULL DEFAULT 0 CHECK (min_start_players >= 0),

    match_id            VARCHAR(64),
    room_id             VARCHAR(64),

    failure_code        VARCHAR(64),
    failure_message     TEXT,

    queued_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    cancelled_at        TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_matchmaking_tickets_user_id ON matchmaking_tickets(user_id);
CREATE INDEX IF NOT EXISTS idx_matchmaking_tickets_stage ON matchmaking_tickets(stage);
CREATE INDEX IF NOT EXISTS idx_matchmaking_tickets_mode_stage ON matchmaking_tickets(mode_id, stage);
CREATE INDEX IF NOT EXISTS idx_matchmaking_tickets_queued_at ON matchmaking_tickets(queued_at);

-- Optional guard: one active ticket per user
CREATE UNIQUE INDEX IF NOT EXISTS uq_matchmaking_active_ticket_per_user
ON matchmaking_tickets(user_id)
WHERE stage IN ('searching', 'confirming', 'matched');

-- =========================================================
-- Room lifecycle
-- =========================================================
CREATE TABLE IF NOT EXISTS rooms (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id             VARCHAR(64) NOT NULL UNIQUE,

    mode_id             VARCHAR(32) NOT NULL,
    visibility          room_visibility NOT NULL DEFAULT 'private',
    invite_code         VARCHAR(16) UNIQUE,

    owner_user_id       UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    status              room_status NOT NULL DEFAULT 'idle',
    team_mode           team_mode NOT NULL DEFAULT 'solo',

    max_members         INTEGER NOT NULL DEFAULT 4 CHECK (max_members >= 2 AND max_members <= 50),
    min_start_members   INTEGER NOT NULL DEFAULT 2 CHECK (min_start_members >= 2),

    version             BIGINT NOT NULL DEFAULT 1,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_rooms_min_start_members CHECK (min_start_members <= max_members)
);

CREATE INDEX IF NOT EXISTS idx_rooms_owner_user_id ON rooms(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_rooms_status ON rooms(status);
CREATE INDEX IF NOT EXISTS idx_rooms_mode_status ON rooms(mode_id, status);

CREATE TABLE IF NOT EXISTS room_members (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id             UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    nickname_snapshot   VARCHAR(24) NOT NULL,
    avatar_url_snapshot TEXT,

    ready               BOOLEAN NOT NULL DEFAULT FALSE,
    role                room_member_role NOT NULL DEFAULT 'member',
    team_id             INTEGER,
    is_online           BOOLEAN NOT NULL DEFAULT TRUE,

    joined_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_room_members_room_user UNIQUE (room_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_room_members_room_id ON room_members(room_id);
CREATE INDEX IF NOT EXISTS idx_room_members_user_id ON room_members(user_id);
CREATE INDEX IF NOT EXISTS idx_room_members_room_role ON room_members(room_id, role);

-- Optional helper view for quick room snapshots
CREATE OR REPLACE VIEW v_room_member_count AS
SELECT
    r.room_id,
    r.status,
    r.mode_id,
    COUNT(m.id)::INT AS member_count
FROM rooms r
LEFT JOIN room_members m ON m.room_id = r.id
GROUP BY r.room_id, r.status, r.mode_id;

-- =========================================================
-- Social skeleton
-- =========================================================
CREATE TABLE IF NOT EXISTS user_friendships (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status              friend_status NOT NULL DEFAULT 'pending',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_user_friendships_pair UNIQUE (user_id, target_user_id),
    CONSTRAINT chk_user_friendships_no_self CHECK (user_id <> target_user_id)
);

CREATE INDEX IF NOT EXISTS idx_user_friendships_user_id ON user_friendships(user_id);
CREATE INDEX IF NOT EXISTS idx_user_friendships_target_user_id ON user_friendships(target_user_id);
CREATE INDEX IF NOT EXISTS idx_user_friendships_status ON user_friendships(status);

-- =========================================================
-- Ranking snapshot skeleton
-- =========================================================
CREATE TABLE IF NOT EXISTS season_rank_snapshots (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    season_id           VARCHAR(32) NOT NULL,
    scope               season_rank_scope NOT NULL DEFAULT 'global',
    region              VARCHAR(32),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    rank_position       INTEGER NOT NULL CHECK (rank_position >= 1),
    score               INTEGER NOT NULL DEFAULT 0 CHECK (score >= 0),
    level_snapshot      INTEGER NOT NULL DEFAULT 1 CHECK (level_snapshot >= 1),
    best_mass_snapshot  INTEGER NOT NULL DEFAULT 0 CHECK (best_mass_snapshot >= 0),

    snapshot_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_season_rank_snapshots_lookup
ON season_rank_snapshots(season_id, scope, region, rank_position);
CREATE UNIQUE INDEX IF NOT EXISTS uq_season_rank_user_scope
ON season_rank_snapshots(season_id, scope, COALESCE(region, ''), user_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_season_rank_position
ON season_rank_snapshots(season_id, scope, COALESCE(region, ''), rank_position);

-- =========================================================
-- Triggers for updated_at
-- =========================================================
DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
CREATE TRIGGER trg_users_updated_at
BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_user_identities_updated_at ON user_identities;
CREATE TRIGGER trg_user_identities_updated_at
BEFORE UPDATE ON user_identities
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_user_bans_updated_at ON user_bans;
CREATE TRIGGER trg_user_bans_updated_at
BEFORE UPDATE ON user_bans
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_user_profiles_updated_at ON user_profiles;
CREATE TRIGGER trg_user_profiles_updated_at
BEFORE UPDATE ON user_profiles
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_user_skins_updated_at ON user_skins;
CREATE TRIGGER trg_user_skins_updated_at
BEFORE UPDATE ON user_skins
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_user_inventory_items_updated_at ON user_inventory_items;
CREATE TRIGGER trg_user_inventory_items_updated_at
BEFORE UPDATE ON user_inventory_items
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_matchmaking_tickets_updated_at ON matchmaking_tickets;
CREATE TRIGGER trg_matchmaking_tickets_updated_at
BEFORE UPDATE ON matchmaking_tickets
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_rooms_updated_at ON rooms;
CREATE TRIGGER trg_rooms_updated_at
BEFORE UPDATE ON rooms
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_room_members_updated_at ON room_members;
CREATE TRIGGER trg_room_members_updated_at
BEFORE UPDATE ON room_members
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_user_friendships_updated_at ON user_friendships;
CREATE TRIGGER trg_user_friendships_updated_at
BEFORE UPDATE ON user_friendships
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
