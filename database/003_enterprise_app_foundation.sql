-- bop/database/003_enterprise_app_foundation.sql
-- Phase 1-2 enterprise app foundation:
-- - cloud user preferences
-- - social requests / edges / blocks
-- - ranked seasons / queues / ratings / history / snapshots

BEGIN;

CREATE TABLE IF NOT EXISTS user_preferences (
    user_id             UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    schema_version      INTEGER NOT NULL DEFAULT 1,
    controls            JSONB NOT NULL DEFAULT '{}'::jsonb,
    graphics            JSONB NOT NULL DEFAULT '{}'::jsonb,
    keybinds            JSONB NOT NULL DEFAULT '{}'::jsonb,
    ui                  JSONB NOT NULL DEFAULT '{}'::jsonb,
    accessibility       JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS social_friend_requests (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id          VARCHAR(64) NOT NULL UNIQUE,
    sender_user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    receiver_user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status              VARCHAR(16) NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'accepted', 'rejected', 'cancelled')),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    handled_at          TIMESTAMPTZ,
    CONSTRAINT chk_social_friend_requests_no_self CHECK (sender_user_id <> receiver_user_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_social_friend_requests_pending_pair
ON social_friend_requests(sender_user_id, receiver_user_id)
WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_social_friend_requests_sender
ON social_friend_requests(sender_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_social_friend_requests_receiver
ON social_friend_requests(receiver_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS social_friend_edges (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    friend_user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_social_friend_edges UNIQUE (user_id, friend_user_id),
    CONSTRAINT chk_social_friend_edges_no_self CHECK (user_id <> friend_user_id)
);

CREATE INDEX IF NOT EXISTS idx_social_friend_edges_user
ON social_friend_edges(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS social_blocks (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    blocked_user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_social_blocks UNIQUE (user_id, blocked_user_id),
    CONSTRAINT chk_social_blocks_no_self CHECK (user_id <> blocked_user_id)
);

CREATE INDEX IF NOT EXISTS idx_social_blocks_user
ON social_blocks(user_id, created_at DESC);

ALTER TABLE matchmaking_tickets
ADD COLUMN IF NOT EXISTS client_version VARCHAR(32);

CREATE TABLE IF NOT EXISTS room_live_sessions (
    room_id             VARCHAR(64) PRIMARY KEY REFERENCES rooms(room_id) ON DELETE CASCADE,
    session_id          VARCHAR(128) NOT NULL UNIQUE,
    mode_id             VARCHAR(32) NOT NULL,
    phase               VARCHAR(16) NOT NULL
                            CHECK (phase IN ('running', 'finished')),
    version             BIGINT NOT NULL DEFAULT 1,
    state_json          JSONB NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at          TIMESTAMPTZ NOT NULL,
    finished_at         TIMESTAMPTZ,
    last_simulated_at   TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS rank_seasons (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    season_id           VARCHAR(32) NOT NULL UNIQUE,
    name                VARCHAR(64) NOT NULL,
    status              VARCHAR(16) NOT NULL DEFAULT 'active'
                            CHECK (status IN ('upcoming', 'active', 'ended')),
    starts_at           TIMESTAMPTZ NOT NULL,
    ends_at             TIMESTAMPTZ NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rank_queues (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    queue_id            VARCHAR(32) NOT NULL UNIQUE,
    display_name        VARCHAR(64) NOT NULL,
    mode_id             VARCHAR(32) NOT NULL,
    visible             BOOLEAN NOT NULL DEFAULT TRUE,
    placement_matches   INTEGER NOT NULL DEFAULT 5,
    default_mmr         INTEGER NOT NULL DEFAULT 1000,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rank_player_ratings (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    season_id           VARCHAR(32) NOT NULL REFERENCES rank_seasons(season_id) ON DELETE CASCADE,
    queue_id            VARCHAR(32) NOT NULL REFERENCES rank_queues(queue_id) ON DELETE CASCADE,
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    mmr                 INTEGER NOT NULL DEFAULT 1000,
    rank_score          INTEGER NOT NULL DEFAULT 1000,
    tier                VARCHAR(32) NOT NULL DEFAULT 'Bronze',
    division            INTEGER NOT NULL DEFAULT 3,
    wins                INTEGER NOT NULL DEFAULT 0,
    losses              INTEGER NOT NULL DEFAULT 0,
    matches_played      INTEGER NOT NULL DEFAULT 0,
    peak_rank_score     INTEGER NOT NULL DEFAULT 1000,
    best_leaderboard_position INTEGER,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_rank_player_ratings UNIQUE (season_id, queue_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_rank_player_ratings_board
ON rank_player_ratings(season_id, queue_id, rank_score DESC, mmr DESC, updated_at ASC);

CREATE TABLE IF NOT EXISTS rank_match_results (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rating_match_id     VARCHAR(64) NOT NULL UNIQUE,
    season_id           VARCHAR(32) NOT NULL REFERENCES rank_seasons(season_id) ON DELETE CASCADE,
    queue_id            VARCHAR(32) NOT NULL REFERENCES rank_queues(queue_id) ON DELETE CASCADE,
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    match_id            VARCHAR(128) NOT NULL,
    placement           INTEGER NOT NULL CHECK (placement >= 1),
    result              VARCHAR(8) NOT NULL CHECK (result IN ('win', 'loss')),
    delta_mmr           INTEGER NOT NULL DEFAULT 0,
    delta_score         INTEGER NOT NULL DEFAULT 0,
    rank_score_after    INTEGER NOT NULL,
    mmr_after           INTEGER NOT NULL,
    tier_after          VARCHAR(32) NOT NULL,
    division_after      INTEGER NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rank_match_results_user
ON rank_match_results(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS rank_leaderboard_snapshots (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    season_id           VARCHAR(32) NOT NULL REFERENCES rank_seasons(season_id) ON DELETE CASCADE,
    queue_id            VARCHAR(32) NOT NULL REFERENCES rank_queues(queue_id) ON DELETE CASCADE,
    rank_position       INTEGER NOT NULL CHECK (rank_position >= 1),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    rank_score          INTEGER NOT NULL,
    tier                VARCHAR(32) NOT NULL,
    division            INTEGER NOT NULL,
    wins                INTEGER NOT NULL DEFAULT 0,
    losses              INTEGER NOT NULL DEFAULT 0,
    matches_played      INTEGER NOT NULL DEFAULT 0,
    best_mass           INTEGER NOT NULL DEFAULT 0,
    snapshot_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_rank_leaderboard_snapshots UNIQUE (season_id, queue_id, rank_position)
);

DROP TRIGGER IF EXISTS trg_user_preferences_updated_at ON user_preferences;
CREATE TRIGGER trg_user_preferences_updated_at
BEFORE UPDATE ON user_preferences
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_social_friend_requests_updated_at ON social_friend_requests;
CREATE TRIGGER trg_social_friend_requests_updated_at
BEFORE UPDATE ON social_friend_requests
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_social_friend_edges_updated_at ON social_friend_edges;
CREATE TRIGGER trg_social_friend_edges_updated_at
BEFORE UPDATE ON social_friend_edges
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_social_blocks_updated_at ON social_blocks;
CREATE TRIGGER trg_social_blocks_updated_at
BEFORE UPDATE ON social_blocks
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_room_live_sessions_updated_at ON room_live_sessions;
CREATE TRIGGER trg_room_live_sessions_updated_at
BEFORE UPDATE ON room_live_sessions
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_rank_seasons_updated_at ON rank_seasons;
CREATE TRIGGER trg_rank_seasons_updated_at
BEFORE UPDATE ON rank_seasons
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_rank_queues_updated_at ON rank_queues;
CREATE TRIGGER trg_rank_queues_updated_at
BEFORE UPDATE ON rank_queues
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_rank_player_ratings_updated_at ON rank_player_ratings;
CREATE TRIGGER trg_rank_player_ratings_updated_at
BEFORE UPDATE ON rank_player_ratings
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO rank_seasons (
    season_id,
    name,
    status,
    starts_at,
    ends_at
)
VALUES (
    'season-2026-alpha',
    'Alpha Preseason',
    'active',
    NOW() - INTERVAL '7 days',
    NOW() + INTERVAL '83 days'
)
ON CONFLICT (season_id) DO UPDATE
SET
    name = EXCLUDED.name,
    status = EXCLUDED.status,
    starts_at = EXCLUDED.starts_at,
    ends_at = EXCLUDED.ends_at,
    updated_at = NOW();

INSERT INTO rank_queues (queue_id, display_name, mode_id, visible, placement_matches, default_mmr)
VALUES
    ('ranked', '排位赛', 'ranked', TRUE, 5, 1000),
    ('peak', '巅峰赛', 'peak', TRUE, 5, 1200),
    ('classic', '经典天梯', 'classic', TRUE, 3, 1000),
    ('battleRoyale', '大逃杀天梯', 'battleRoyale', TRUE, 3, 1000),
    ('team', '团队竞技', 'team', TRUE, 3, 1000)
ON CONFLICT (queue_id) DO UPDATE
SET
    display_name = EXCLUDED.display_name,
    mode_id = EXCLUDED.mode_id,
    visible = EXCLUDED.visible,
    placement_matches = EXCLUDED.placement_matches,
    default_mmr = EXCLUDED.default_mmr,
    updated_at = NOW();

COMMIT;
