import { PROTOCOL_ERROR } from "./constants.js";
import { failure } from "./helpers.js";

const REQUIRED_SCHEMA_TABLE = "users";

const INITIAL_SCHEMA_SQL = `
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
`;

let schemaInitPromise = null;
let schemaPatchPromise = null;

const INITIAL_SCHEMA_STATEMENTS = INITIAL_SCHEMA_SQL
  .split(/;\s*\n+/)
  .map((statement) => statement.trim())
  .filter(Boolean)
  .map((statement) => `${statement};`);

function randomGameId() {
  return `${Math.floor(100_000_000 + Math.random() * 900_000_000)}`;
}

export function normalizeGameId(value) {
  if (typeof value !== "string") {
    return "";
  }

  const normalized = value.trim();
  return /^\d{9}$/.test(normalized) ? normalized : "";
}

export async function generateUniqueGameId(db, maxAttempts = 80) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const candidate = randomGameId();
    const existing = await dbFirst(
      db,
      `
        SELECT id
        FROM users
        WHERE game_id = ?
        LIMIT 1
      `,
      [candidate],
    );
    if (!existing?.id) {
      return candidate;
    }
  }

  throw new Error("Failed to allocate a unique 9-digit game_id.");
}

async function ensureUsersGameIdColumn(db) {
  const userColumns = await dbAll(db, "PRAGMA table_info(users)");
  const hasGameIdColumn = userColumns.some(
    (column) => String(column.name) === "game_id",
  );

  if (!hasGameIdColumn) {
    await dbRun(db, "ALTER TABLE users ADD COLUMN game_id TEXT");
  }

  await dbRun(db, "CREATE UNIQUE INDEX IF NOT EXISTS uq_users_game_id ON users(game_id)");
}

async function ensureUsersHaveGameIds(db) {
  const missingRows = await dbAll(
    db,
    `
      SELECT id
      FROM users
      WHERE game_id IS NULL OR TRIM(game_id) = ''
      ORDER BY datetime(created_at) ASC
    `,
  );

  if (!missingRows.length) {
    return;
  }

  for (const row of missingRows) {
    const userId = String(row.id ?? "");
    if (!userId) {
      continue;
    }

    let assigned = false;
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const candidate = await generateUniqueGameId(db);
      try {
        await dbRun(
          db,
          `
            UPDATE users
            SET
              game_id = ?,
              updated_at = ?
            WHERE id = ?
              AND (game_id IS NULL OR TRIM(game_id) = '')
          `,
          [candidate, new Date().toISOString(), userId],
        );
      } catch (error) {
        if (isUniqueConstraintError(error)) {
          continue;
        }
        throw error;
      }

      const verified = await dbFirst(
        db,
        `
          SELECT game_id
          FROM users
          WHERE id = ?
          LIMIT 1
        `,
        [userId],
      );

      if (verified?.game_id) {
        assigned = true;
        break;
      }
    }

    if (!assigned) {
      throw new Error(`Failed to backfill game_id for user ${userId}.`);
    }
  }
}

async function ensureSocialSchema(db) {
  if (typeof db.batch !== "function") {
    throw new Error("D1 batch() is not available for social schema patch.");
  }

  await db.batch(
    [
      `
        CREATE TABLE IF NOT EXISTS social_friend_requests (
          id TEXT PRIMARY KEY,
          requester_user_id TEXT NOT NULL,
          target_user_id TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          responded_at TEXT
        );
      `,
      "CREATE INDEX IF NOT EXISTS idx_social_friend_requests_requester ON social_friend_requests(requester_user_id);",
      "CREATE INDEX IF NOT EXISTS idx_social_friend_requests_target ON social_friend_requests(target_user_id);",
      "CREATE UNIQUE INDEX IF NOT EXISTS uq_social_friend_requests_pending_pair ON social_friend_requests(requester_user_id, target_user_id) WHERE status = 'pending';",
      `
        CREATE TABLE IF NOT EXISTS social_friendships (
          id TEXT PRIMARY KEY,
          user_low TEXT NOT NULL,
          user_high TEXT NOT NULL,
          created_at TEXT NOT NULL,
          created_by_user_id TEXT,
          UNIQUE(user_low, user_high)
        );
      `,
      "CREATE INDEX IF NOT EXISTS idx_social_friendships_low ON social_friendships(user_low);",
      "CREATE INDEX IF NOT EXISTS idx_social_friendships_high ON social_friendships(user_high);",
      `
        CREATE TABLE IF NOT EXISTS social_blocks (
          id TEXT PRIMARY KEY,
          blocker_user_id TEXT NOT NULL,
          blocked_user_id TEXT NOT NULL,
          created_at TEXT NOT NULL,
          UNIQUE(blocker_user_id, blocked_user_id)
        );
      `,
      "CREATE INDEX IF NOT EXISTS idx_social_blocks_blocker ON social_blocks(blocker_user_id);",
      "CREATE INDEX IF NOT EXISTS idx_social_blocks_blocked ON social_blocks(blocked_user_id);",
    ].map((sql) => db.prepare(sql)),
  );
}

async function ensureSchemaPatch(db) {
  if (!schemaPatchPromise) {
    schemaPatchPromise = (async () => {
      await ensureUsersGameIdColumn(db);
      await ensureSocialSchema(db);
      await ensureUsersHaveGameIds(db);
    })().finally(() => {
      schemaPatchPromise = null;
    });
  }

  await schemaPatchPromise;
}

async function ensureSchemaReady(db) {
  const existing = await dbFirst(
    db,
    `
      SELECT name
      FROM sqlite_master
      WHERE type = 'table' AND name = ?
      LIMIT 1
    `,
    [REQUIRED_SCHEMA_TABLE],
  );

  if (!existing?.name) {
    if (!schemaInitPromise) {
      schemaInitPromise = (async () => {
        if (typeof db.batch !== "function") {
          throw new Error("D1 batch() is not available for schema bootstrap.");
        }

        await db.batch(INITIAL_SCHEMA_STATEMENTS.map((sql) => db.prepare(sql)));

        const verified = await dbFirst(
          db,
          `
            SELECT name
            FROM sqlite_master
            WHERE type = 'table' AND name = ?
            LIMIT 1
          `,
          [REQUIRED_SCHEMA_TABLE],
        );

        if (!verified?.name) {
          throw new Error("D1 schema bootstrap did not create the users table.");
        }
      })().finally(() => {
        schemaInitPromise = null;
      });
    }

    await schemaInitPromise;
  }

  await ensureSchemaPatch(db);
}

export async function getDbOrResponse(request, env, requestId) {
  if (env?.DB) {
    try {
      await ensureSchemaReady(env.DB);
      return { db: env.DB, response: null };
    } catch (error) {
      return {
        db: null,
        response: failure(
          request,
          requestId,
          503,
          PROTOCOL_ERROR.SERVICE_UNAVAILABLE,
          error instanceof Error ? error.message : "D1 schema bootstrap failed.",
          { binding: "DB", requiredTable: REQUIRED_SCHEMA_TABLE },
        ),
      };
    }
  }
  return {
    db: null,
    response: failure(
      request,
      requestId,
      503,
      PROTOCOL_ERROR.SERVICE_UNAVAILABLE,
      "Cloudflare D1 binding DB is missing.",
      { binding: "DB" },
    ),
  };
}

function normalizeBindings(params) {
  return params.map((value) => (value === undefined ? null : value));
}

export async function dbFirst(db, sql, params = []) {
  return db.prepare(sql).bind(...normalizeBindings(params)).first();
}

export async function dbAll(db, sql, params = []) {
  const result = await db.prepare(sql).bind(...normalizeBindings(params)).all();
  return Array.isArray(result.results) ? result.results : [];
}

export async function dbRun(db, sql, params = []) {
  return db.prepare(sql).bind(...normalizeBindings(params)).run();
}

export async function dbBatch(db, statements) {
  return db.batch(
    statements.map((statement) =>
      db.prepare(statement.sql).bind(...normalizeBindings(statement.params || [])),
    ),
  );
}

export function isUniqueConstraintError(error) {
  return (
    error instanceof Error &&
    error.message.toLowerCase().includes("unique constraint failed")
  );
}
