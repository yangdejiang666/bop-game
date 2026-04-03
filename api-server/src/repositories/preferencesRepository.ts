import type {
  UserAccessibilityPreferences,
  UserControlsPreferences,
  UserGraphicsPreferences,
  UserKeybindPreferences,
  UserPreferences,
  UserUiPreferences,
} from "@bop/shared-protocol";
import { DEFAULT_USER_PREFERENCES } from "@bop/shared-protocol";
import type { QueryResultRow } from "pg";
import type { DbExecutor } from "../lib/db.js";
import { query } from "../lib/db.js";

interface PreferencesRow extends QueryResultRow {
  user_id: string;
  schema_version: number;
  controls: unknown;
  graphics: unknown;
  keybinds: unknown;
  ui: unknown;
  accessibility: unknown;
  updated_at: string;
}

type Executor = DbExecutor;

function getExecutor(executor?: Executor): Executor {
  return (
    executor ?? {
      query: (text, params) => query(text, params),
    }
  );
}

function mergeBucket<T extends object>(
  value: unknown,
  defaults: T,
): T {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...defaults };
  }

  return {
    ...defaults,
    ...(value as Partial<T>),
  };
}

function mapPreferences(row: PreferencesRow): UserPreferences {
  return {
    schemaVersion: row.schema_version as UserPreferences["schemaVersion"],
    controls: mergeBucket<UserControlsPreferences>(
      row.controls,
      DEFAULT_USER_PREFERENCES.controls,
    ),
    graphics: mergeBucket<UserGraphicsPreferences>(
      row.graphics,
      DEFAULT_USER_PREFERENCES.graphics,
    ),
    keybinds: mergeBucket<UserKeybindPreferences>(
      row.keybinds,
      DEFAULT_USER_PREFERENCES.keybinds,
    ),
    ui: mergeBucket<UserUiPreferences>(row.ui, DEFAULT_USER_PREFERENCES.ui),
    accessibility: mergeBucket<UserAccessibilityPreferences>(
      row.accessibility,
      DEFAULT_USER_PREFERENCES.accessibility,
    ),
    updatedAt: row.updated_at,
  };
}

async function ensurePreferencesRow(
  userId: string,
  executor?: Executor,
): Promise<void> {
  const db = getExecutor(executor);
  await db.query(
    `
      INSERT INTO user_preferences (
        user_id,
        schema_version,
        controls,
        graphics,
        keybinds,
        ui,
        accessibility,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb, NOW(), NOW())
      ON CONFLICT (user_id) DO NOTHING
    `,
    [
      userId,
      DEFAULT_USER_PREFERENCES.schemaVersion,
      DEFAULT_USER_PREFERENCES.controls,
      DEFAULT_USER_PREFERENCES.graphics,
      DEFAULT_USER_PREFERENCES.keybinds,
      DEFAULT_USER_PREFERENCES.ui,
      DEFAULT_USER_PREFERENCES.accessibility,
    ],
  );
}

export async function getOrCreateUserPreferences(
  userId: string,
  executor?: Executor,
): Promise<UserPreferences> {
  const db = getExecutor(executor);
  await ensurePreferencesRow(userId, db);

  const result = await db.query<PreferencesRow>(
    `
      SELECT
        user_id,
        schema_version,
        controls,
        graphics,
        keybinds,
        ui,
        accessibility,
        updated_at
      FROM user_preferences
      WHERE user_id = $1
      LIMIT 1
    `,
    [userId],
  );

  const row = result.rows[0];
  if (!row) {
    return {
      ...DEFAULT_USER_PREFERENCES,
      updatedAt: new Date().toISOString(),
    };
  }

  return mapPreferences(row);
}

export async function saveUserPreferences(
  userId: string,
  preferences: UserPreferences,
  executor?: Executor,
): Promise<UserPreferences> {
  const db = getExecutor(executor);
  const result = await db.query<Pick<PreferencesRow, "updated_at"> & QueryResultRow>(
    `
      INSERT INTO user_preferences (
        user_id,
        schema_version,
        controls,
        graphics,
        keybinds,
        ui,
        accessibility,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb, NOW(), NOW())
      ON CONFLICT (user_id) DO UPDATE
      SET
        schema_version = EXCLUDED.schema_version,
        controls = EXCLUDED.controls,
        graphics = EXCLUDED.graphics,
        keybinds = EXCLUDED.keybinds,
        ui = EXCLUDED.ui,
        accessibility = EXCLUDED.accessibility,
        updated_at = NOW()
      RETURNING updated_at
    `,
    [
      userId,
      preferences.schemaVersion,
      preferences.controls,
      preferences.graphics,
      preferences.keybinds,
      preferences.ui,
      preferences.accessibility,
    ],
  );

  return {
    ...preferences,
    updatedAt: result.rows[0]?.updated_at ?? new Date().toISOString(),
  };
}
