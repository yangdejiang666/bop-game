import { authService } from "../network/authService";
import { userService } from "../network/userService";

const HEARTBEAT_INTERVAL_MS = 15_000;

let activePlaySessionId: string | null = null;
let heartbeatTimerId: number | null = null;

function clearHeartbeatTimer() {
  if (heartbeatTimerId !== null) {
    window.clearInterval(heartbeatTimerId);
    heartbeatTimerId = null;
  }
}

async function sendHeartbeat(modeId?: string, matchId?: string) {
  const playSessionId = activePlaySessionId;
  if (!playSessionId || !authService.getSession()) {
    return;
  }

  try {
    const response = await userService.heartbeatPlaytimeSession({
      playSessionId,
      modeId,
      matchId,
    });
    authService.updateSessionAuthorization(
      authService.getSession()?.userId ?? "",
      response.authorization,
    );
  } catch (error) {
    console.error("Failed to heartbeat playtime session:", error);
  }
}

export async function startPlaytimeTracking(params: {
  modeId?: string;
  matchId?: string;
}): Promise<void> {
  clearHeartbeatTimer();
  activePlaySessionId = null;

  const session = authService.getSession();
  if (!session || session.isDeveloper) {
    return;
  }

  try {
    const response = await userService.startPlaytimeSession({
      modeId: params.modeId,
      matchId: params.matchId,
    });
    activePlaySessionId = response.authorization.playtimePolicy.activeSessionId;
    authService.updateSessionAuthorization(session.userId, response.authorization);

    if (activePlaySessionId) {
      heartbeatTimerId = window.setInterval(() => {
        void sendHeartbeat(params.modeId, params.matchId);
      }, HEARTBEAT_INTERVAL_MS);
    }
  } catch (error) {
    console.error("Failed to start playtime session:", error);
  }
}

export async function finishPlaytimeTracking(params?: {
  modeId?: string;
  matchId?: string;
  reason?: "completed" | "user_exit" | "disconnect" | "server_shutdown";
}): Promise<void> {
  clearHeartbeatTimer();

  const playSessionId = activePlaySessionId;
  const session = authService.getSession();
  activePlaySessionId = null;

  if (!playSessionId || !session || session.isDeveloper) {
    return;
  }

  try {
    const response = await userService.finishPlaytimeSession({
      playSessionId,
      modeId: params?.modeId,
      matchId: params?.matchId,
      reason: params?.reason ?? "completed",
    });
    authService.updateSessionAuthorization(session.userId, response.authorization);
  } catch (error) {
    console.error("Failed to finish playtime session:", error);
  }
}
