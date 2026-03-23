import type { QueryResultRow } from "pg";
import type { DbExecutor } from "../lib/db.js";
import { query } from "../lib/db.js";

type Executor = DbExecutor;

export interface StoredMatchResult {
  userId: string;
  clientMatchId: string;
  modeId: string;
  playerRank: number;
  playerMass: number;
  playerWon: boolean;
  isNewRecord: boolean;
  xpGained: number;
  coinsGained: number;
  finishedAt: string;
  createdAt: string;
}

function getExecutor(executor?: Executor): Executor {
  return (
    executor ?? {
      query: (text, params) => query(text, params),
    }
  );
}

export async function findMatchResultByClientMatchId(
  userId: string,
  clientMatchId: string,
  executor?: Executor,
): Promise<StoredMatchResult | null> {
  const db = getExecutor(executor);
  const result = await db.query<
    StoredMatchResult &
      QueryResultRow & {
        userId: string;
        clientMatchId: string;
        modeId: string;
        playerRank: number;
        playerMass: number;
        playerWon: boolean;
        isNewRecord: boolean;
        xpGained: number;
        coinsGained: number;
        finishedAt: string;
        createdAt: string;
      }
  >(
    `
      SELECT
        user_id AS "userId",
        client_match_id AS "clientMatchId",
        mode_id AS "modeId",
        player_rank AS "playerRank",
        player_mass AS "playerMass",
        player_won AS "playerWon",
        is_new_record AS "isNewRecord",
        xp_gained AS "xpGained",
        coins_gained AS "coinsGained",
        finished_at AS "finishedAt",
        created_at AS "createdAt"
      FROM user_match_results
      WHERE user_id = $1
        AND client_match_id = $2
      LIMIT 1
    `,
    [userId, clientMatchId],
  );

  return result.rows[0] ?? null;
}

export async function insertMatchResult(
  params: StoredMatchResult,
  executor?: Executor,
): Promise<void> {
  const db = getExecutor(executor);
  await db.query(
    `
      INSERT INTO user_match_results (
        user_id,
        client_match_id,
        mode_id,
        player_rank,
        player_mass,
        player_won,
        is_new_record,
        xp_gained,
        coins_gained,
        finished_at,
        created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    `,
    [
      params.userId,
      params.clientMatchId,
      params.modeId,
      params.playerRank,
      params.playerMass,
      params.playerWon,
      params.isNewRecord,
      params.xpGained,
      params.coinsGained,
      params.finishedAt,
      params.createdAt,
    ],
  );
}
