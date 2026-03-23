import { Pool, types, type PoolClient, type QueryResult, type QueryResultRow } from "pg";
import { apiServerConfig } from "./config.js";

types.setTypeParser(20, (value) => Number(value));

export interface DbExecutor {
  query<TResult extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<QueryResult<TResult>>;
}

const pool = new Pool({
  connectionString: apiServerConfig.database.url,
});

pool.on("error", (error) => {
  console.error("[api-server] postgres pool error", error);
});

export function getDbPool(): Pool {
  return pool;
}

export async function query<TResult extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<QueryResult<TResult>> {
  return pool.query<TResult>(text, params);
}

export async function withTransaction<T>(
  callback: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function closeDbPool(): Promise<void> {
  await pool.end();
}
