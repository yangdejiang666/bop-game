-- Seed demo data for local/dev environments
-- File: bop/database/002_seed_demo.sql

BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

INSERT INTO users (
    id,
    status,
    created_at,
    updated_at,
    last_login_at
)
VALUES (
    '00000000-0000-0000-0000-000000000001',
    'active',
    NOW(),
    NOW(),
    NOW()
)
ON CONFLICT (id) DO UPDATE
SET
    status = EXCLUDED.status,
    updated_at = NOW(),
    last_login_at = NOW();

INSERT INTO user_profiles (
    user_id,
    nickname,
    avatar_url,
    bootstrapped_from_local_at,
    level,
    current_xp,
    total_xp,
    coins,
    season_score,
    best_mass,
    total_matches,
    total_wins,
    updated_at
)
VALUES (
    '00000000-0000-0000-0000-000000000001',
    '演示玩家',
    NULL,
    NULL,
    5,
    180,
    1520,
    1888,
    420,
    3200,
    48,
    21,
    NOW()
)
ON CONFLICT (user_id) DO UPDATE
SET
    nickname = EXCLUDED.nickname,
    avatar_url = EXCLUDED.avatar_url,
    bootstrapped_from_local_at = EXCLUDED.bootstrapped_from_local_at,
    level = EXCLUDED.level,
    current_xp = EXCLUDED.current_xp,
    total_xp = EXCLUDED.total_xp,
    coins = EXCLUDED.coins,
    season_score = EXCLUDED.season_score,
    best_mass = EXCLUDED.best_mass,
    total_matches = EXCLUDED.total_matches,
    total_wins = EXCLUDED.total_wins,
    updated_at = NOW();

INSERT INTO user_bans (
    user_id,
    is_banned,
    reason,
    banned_until,
    operator_note,
    created_at,
    updated_at
)
VALUES (
    '00000000-0000-0000-0000-000000000001',
    FALSE,
    NULL,
    NULL,
    NULL,
    NOW(),
    NOW()
)
ON CONFLICT (user_id) DO UPDATE
SET
    is_banned = EXCLUDED.is_banned,
    reason = EXCLUDED.reason,
    banned_until = EXCLUDED.banned_until,
    operator_note = EXCLUDED.operator_note,
    updated_at = NOW();

INSERT INTO user_identities (
    user_id,
    provider,
    provider_uid,
    account,
    password_hash,
    password_algo,
    email,
    phone,
    email_verified,
    phone_verified,
    bound_at,
    created_at,
    updated_at
)
VALUES (
    '00000000-0000-0000-0000-000000000001',
    'password',
    'demo',
    'demo',
    '$2a$10$ue7J2ySFQuvxjNRbOaQd5.38bsAzjhMz0Mo25.CZgihWriMiSYkKC',
    'bcrypt',
    NULL,
    NULL,
    FALSE,
    FALSE,
    NOW(),
    NOW(),
    NOW()
)
ON CONFLICT (provider, provider_uid) DO UPDATE
SET
    account = EXCLUDED.account,
    password_hash = EXCLUDED.password_hash,
    password_algo = EXCLUDED.password_algo,
    updated_at = NOW();

INSERT INTO user_skins (
    user_id,
    skin_id,
    owned,
    equipped,
    acquired_at,
    updated_at
)
VALUES
    ('00000000-0000-0000-0000-000000000001', 'classic_blue', TRUE, TRUE, NOW(), NOW()),
    ('00000000-0000-0000-0000-000000000001', 'mint_pop', TRUE, FALSE, NOW(), NOW()),
    ('00000000-0000-0000-0000-000000000001', 'neon_violet', TRUE, FALSE, NOW(), NOW())
ON CONFLICT (user_id, skin_id) DO UPDATE
SET
    owned = EXCLUDED.owned,
    equipped = EXCLUDED.equipped,
    updated_at = NOW();

INSERT INTO user_inventory_items (
    user_id,
    item_id,
    quantity,
    expires_at,
    created_at,
    updated_at
)
VALUES
    ('00000000-0000-0000-0000-000000000001', 'ticket_ranked', 3, NULL, NOW(), NOW()),
    ('00000000-0000-0000-0000-000000000001', 'xp_booster_1h', 2, NULL, NOW(), NOW()),
    ('00000000-0000-0000-0000-000000000001', 'coin_pack_small', 1, NULL, NOW(), NOW())
ON CONFLICT (user_id, item_id) DO UPDATE
SET
    quantity = EXCLUDED.quantity,
    updated_at = NOW();

COMMIT;
