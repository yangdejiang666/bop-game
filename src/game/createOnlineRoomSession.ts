import type { GameSettings } from "../app/settings";
import type { DebugMatchFinishOptions } from "./createGameSession";
import type { LobbyModeId } from "../ui/LobbyUI";
import type { CompleteMatchProgressionResponse } from "../../shared-protocol/src/progression";
import type {
  RoomMatchSnapshot,
  RoomSnapshot,
} from "../../shared-protocol/src/room";
import { roomService } from "../network/roomService";

type ConnectionState = "connecting" | "online" | "reconnecting" | "error";

interface RenderPlayerState {
  userId: string;
  nickname: string;
  color: string;
  accentColor: string;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  radius: number;
  targetRadius: number;
  mass: number;
  alive: boolean;
  score: number;
  respawnAt: string | null;
}

export interface OnlineRoomSessionSnapshot {
  kind: "online-room";
  isMounted: boolean;
  isRunning: boolean;
  roomId: string;
  roomCode: string | null;
  modeId: LobbyModeId;
  phase: RoomMatchSnapshot["phase"];
  connectionState: ConnectionState;
  syncError: string | null;
  serverTime: string;
  startedAt: string;
  endsAt: string;
  localPlayerId: string | null;
  localPlayer: {
    userId: string;
    nickname: string;
    mass: number;
    score: number;
    alive: boolean;
    respawnAt: string | null;
    x: number;
    y: number;
  } | null;
  leaderboard: RoomMatchSnapshot["leaderboard"];
  players: RoomMatchSnapshot["players"];
  foods: RoomMatchSnapshot["foods"];
}

export interface OnlineRoomSession {
  mount(root: HTMLElement): void;
  startNewGame(): void;
  stop(): void;
  destroy(): void;
  applySettings(settings: GameSettings): void;
  getSnapshot(): OnlineRoomSessionSnapshot;
  advanceTime(ms: number): void;
  debugFinishMatch(options?: DebugMatchFinishOptions): void;
  debugSetBestMassRecord(value: number): void;
  debugSetBattleZone(stage: number): void;
}

interface CreateOnlineRoomSessionOptions {
  settings: GameSettings;
  modeId: LobbyModeId;
  roomId: string;
  initialRoom: RoomSnapshot;
  initialSession: RoomMatchSnapshot;
  onReturnToModeHall: () => void;
  onOpenSettings: () => void;
  onRoomSnapshot?: (room: RoomSnapshot) => void;
  onCompleteMatch?: (payload: {
    clientMatchId: string;
    modeId: LobbyModeId;
    playerRank: number;
    playerMass: number;
    playerWon: boolean;
    finishedAt: string;
  }) => Promise<CompleteMatchProgressionResponse>;
}

interface SessionDomRefs {
  root: HTMLDivElement;
  canvas: HTMLCanvasElement;
  roomLabel: HTMLDivElement;
  timerLabel: HTMLDivElement;
  statusLabel: HTMLDivElement;
  playerLabel: HTMLDivElement;
  leaderboard: HTMLDivElement;
  footerHint: HTMLDivElement;
  resultOverlay: HTMLDivElement;
  resultTitle: HTMLHeadingElement;
  resultMeta: HTMLParagraphElement;
}

function normalizeVector(x: number, y: number) {
  const length = Math.hypot(x, y);
  if (length < 0.0001) {
    return { x: 0, y: 0 };
  }
  return {
    x: x / length,
    y: y / length,
  };
}

function formatRemainingTime(endsAt: string, serverTime: string) {
  const remainMs = Math.max(0, Date.parse(endsAt) - Date.parse(serverTime));
  const remainSec = Math.ceil(remainMs / 1000);
  const minutes = Math.floor(remainSec / 60);
  const seconds = remainSec % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function distanceLerp(current: number, target: number, factor: number) {
  return current + (target - current) * factor;
}

export function createOnlineRoomSession(
  options: CreateOnlineRoomSessionOptions,
): OnlineRoomSession {
  let settings = { ...options.settings };
  let snapshot = structuredClone(options.initialSession) as RoomMatchSnapshot;
  let domRefs: SessionDomRefs | null = null;
  let ctx: CanvasRenderingContext2D | null = null;
  let animationFrameId: number | null = null;
  let syncTimerId: number | null = null;
  let isRunning = false;
  let connectionState: ConnectionState = "connecting";
  let syncError: string | null = null;
  let lastRenderAt = performance.now();
  let hasReportedCompletion = false;
  let pointerActive = false;
  let pointerX = 0;
  let pointerY = 0;
  const pressedKeys = new Set<string>();
  const renderPlayers = new Map<string, RenderPlayerState>();
  let keydownHandler: ((event: KeyboardEvent) => void) | null = null;
  let keyupHandler: ((event: KeyboardEvent) => void) | null = null;
  let resizeHandler: (() => void) | null = null;

  function getLocalPlayer() {
    if (!snapshot.localPlayerId) {
      return null;
    }
    return snapshot.players.find(
      (player) => player.userId === snapshot.localPlayerId,
    ) ?? null;
  }

  function updateRenderTargets(nextSnapshot: RoomMatchSnapshot) {
    const liveIds = new Set<string>();
    for (const player of nextSnapshot.players) {
      liveIds.add(player.userId);
      const existing = renderPlayers.get(player.userId);
      if (existing) {
        existing.nickname = player.nickname;
        existing.color = player.color;
        existing.accentColor = player.accentColor;
        existing.targetX = player.x;
        existing.targetY = player.y;
        existing.targetRadius = player.radius;
        existing.mass = player.mass;
        existing.alive = player.alive;
        existing.score = player.score;
        existing.respawnAt = player.respawnAt;
      } else {
        renderPlayers.set(player.userId, {
          userId: player.userId,
          nickname: player.nickname,
          color: player.color,
          accentColor: player.accentColor,
          x: player.x,
          y: player.y,
          targetX: player.x,
          targetY: player.y,
          radius: player.radius,
          targetRadius: player.radius,
          mass: player.mass,
          alive: player.alive,
          score: player.score,
          respawnAt: player.respawnAt,
        });
      }
    }

    for (const playerId of [...renderPlayers.keys()]) {
      if (!liveIds.has(playerId)) {
        renderPlayers.delete(playerId);
      }
    }
  }

  function updateHud() {
    if (!domRefs) {
      return;
    }

    const localPlayer = getLocalPlayer();
    domRefs.roomLabel.textContent = snapshot.roomCode
      ? `私人房间 ${snapshot.roomCode}`
      : `私人房间 ${snapshot.roomId.slice(-6).toUpperCase()}`;
    domRefs.timerLabel.textContent = formatRemainingTime(
      snapshot.endsAt,
      snapshot.serverTime,
    );
    domRefs.statusLabel.textContent =
      connectionState === "online"
        ? snapshot.phase === "finished"
          ? "对局已结算"
          : `同步在线 · ${snapshot.players.length} 名玩家`
        : connectionState === "error"
          ? syncError || "同步异常"
          : "正在同步房间";
    domRefs.playerLabel.textContent = localPlayer
      ? `${localPlayer.nickname} · ${localPlayer.mass} 质量 · ${localPlayer.alive ? "在线作战" : "等待重生"}`
      : "正在等待你的球体入场";

    domRefs.leaderboard.innerHTML = snapshot.leaderboard
      .slice(0, 6)
      .map(
        (entry, index) => `
          <div class="online-room-leaderboard-row${entry.userId === snapshot.localPlayerId ? " is-self" : ""}">
            <span>#${index + 1}</span>
            <strong>${entry.nickname}</strong>
            <em>${entry.mass}</em>
          </div>
        `,
      )
      .join("");

    const localRespawnAt = localPlayer?.respawnAt
      ? Math.max(0, Math.ceil((Date.parse(localPlayer.respawnAt) - Date.parse(snapshot.serverTime)) / 1000))
      : 0;
    domRefs.footerHint.textContent = localPlayer?.alive
      ? "鼠标或 WASD 控制方向，和房间里的其他玩家同步作战。"
      : `已被吞噬，${localRespawnAt} 秒后重生。`;

    const showResult = snapshot.phase === "finished";
    domRefs.resultOverlay.hidden = !showResult;
    if (showResult) {
      const localRank =
        snapshot.leaderboard.findIndex(
          (entry) => entry.userId === snapshot.localPlayerId,
        ) + 1;
      const localMass = localPlayer?.mass ?? 0;
      const winner =
        snapshot.leaderboard[0]?.nickname ??
        (snapshot.winnerUserId ? "房间冠军" : "无人胜出");
      domRefs.resultTitle.textContent =
        localRank <= 1 ? "你拿下了房间头名" : `${winner} 暂时领先`;
      domRefs.resultMeta.textContent =
        localRank > 0
          ? `你的排名第 ${localRank} · 最终质量 ${localMass}`
          : "本局已结束，返回分厅后可继续开下一局。";
    }
  }

  function ensureCanvasSize() {
    if (!domRefs || !ctx) {
      return;
    }

    const rect = domRefs.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    domRefs.canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    domRefs.canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function getMoveInput() {
    let dx = 0;
    let dy = 0;

    if (pressedKeys.has("KeyW") || pressedKeys.has("ArrowUp")) {
      dy -= 1;
    }
    if (pressedKeys.has("KeyS") || pressedKeys.has("ArrowDown")) {
      dy += 1;
    }
    if (pressedKeys.has("KeyA") || pressedKeys.has("ArrowLeft")) {
      dx -= 1;
    }
    if (pressedKeys.has("KeyD") || pressedKeys.has("ArrowRight")) {
      dx += 1;
    }

    if (pointerActive && domRefs) {
      const rect = domRefs.canvas.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const mouseVector = normalizeVector(pointerX - centerX, pointerY - centerY);
      dx += mouseVector.x;
      dy += mouseVector.y;
    }

    const normalized = normalizeVector(dx, dy);
    return {
      moveX: Number(normalized.x.toFixed(4)),
      moveY: Number(normalized.y.toFixed(4)),
    };
  }

  async function reportCompletionOnce(nextSnapshot: RoomMatchSnapshot) {
    if (hasReportedCompletion || !options.onCompleteMatch || !nextSnapshot.localPlayerId) {
      return;
    }

    if (nextSnapshot.phase !== "finished") {
      return;
    }

    const localRank =
      nextSnapshot.leaderboard.findIndex(
        (entry) => entry.userId === nextSnapshot.localPlayerId,
      ) + 1;
    const localPlayer = nextSnapshot.players.find(
      (entry) => entry.userId === nextSnapshot.localPlayerId,
    );

    if (localRank <= 0 || !localPlayer) {
      return;
    }

    hasReportedCompletion = true;
    try {
      await options.onCompleteMatch({
        clientMatchId: nextSnapshot.sessionId,
        modeId: options.modeId,
        playerRank: localRank,
        playerMass: localPlayer.mass,
        playerWon: localRank === 1,
        finishedAt: nextSnapshot.serverTime,
      });
    } catch (error) {
      console.error("Failed to report online room completion:", error);
    }
  }

  async function performSync() {
    if (!isRunning) {
      return;
    }

    connectionState = connectionState === "online" ? "online" : "reconnecting";
    updateHud();

    try {
      const response = await roomService.syncRoomMatch({
        roomId: options.roomId,
        input: getMoveInput(),
        lastKnownVersion: snapshot.version,
      });

      connectionState = "online";
      syncError = null;
      options.onRoomSnapshot?.(response.room);
      snapshot = response.session;
      updateRenderTargets(snapshot);
      updateHud();
      await reportCompletionOnce(snapshot);
    } catch (error) {
      connectionState = "error";
      syncError =
        error instanceof Error ? error.message : "房间同步失败，请稍后重试。";
      updateHud();
    }
  }

  function renderFrame(now: number) {
    if (!ctx || !domRefs || !isRunning) {
      return;
    }

    const dt = Math.min(0.06, (now - lastRenderAt) / 1000);
    lastRenderAt = now;

    for (const player of renderPlayers.values()) {
      player.x = distanceLerp(player.x, player.targetX, Math.min(1, dt * 10));
      player.y = distanceLerp(player.y, player.targetY, Math.min(1, dt * 10));
      player.radius = distanceLerp(
        player.radius,
        player.targetRadius,
        Math.min(1, dt * 8),
      );
    }

    const canvas = domRefs.canvas;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    ctx.clearRect(0, 0, width, height);

    const background = ctx.createLinearGradient(0, 0, width, height);
    background.addColorStop(0, "#08111d");
    background.addColorStop(0.55, "#11243d");
    background.addColorStop(1, "#162e46");
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);

    const localPlayer = getLocalPlayer();
    const cameraX = localPlayer?.x ?? snapshot.worldSize / 2;
    const cameraY = localPlayer?.y ?? snapshot.worldSize / 2;
    const scale = 0.18;

    ctx.save();
    ctx.translate(width / 2, height / 2);

    ctx.strokeStyle = "rgba(255,255,255,0.07)";
    ctx.lineWidth = 1;
    for (let x = -snapshot.worldSize / 2; x <= snapshot.worldSize / 2; x += 180) {
      const sx = (x + (snapshot.worldSize / 2 - cameraX)) * scale;
      ctx.beginPath();
      ctx.moveTo(sx, -height);
      ctx.lineTo(sx, height);
      ctx.stroke();
    }
    for (let y = -snapshot.worldSize / 2; y <= snapshot.worldSize / 2; y += 180) {
      const sy = (y + (snapshot.worldSize / 2 - cameraY)) * scale;
      ctx.beginPath();
      ctx.moveTo(-width, sy);
      ctx.lineTo(width, sy);
      ctx.stroke();
    }

    for (const food of snapshot.foods) {
      const sx = (food.x - cameraX) * scale;
      const sy = (food.y - cameraY) * scale;
      ctx.fillStyle = "rgba(255, 218, 125, 0.95)";
      ctx.beginPath();
      ctx.arc(sx, sy, 3.6, 0, Math.PI * 2);
      ctx.fill();
    }

    const drawnPlayers = [...renderPlayers.values()].sort(
      (left, right) => left.radius - right.radius,
    );
    for (const player of drawnPlayers) {
      const sx = (player.x - cameraX) * scale;
      const sy = (player.y - cameraY) * scale;
      const radius = Math.max(10, player.radius * scale);

      ctx.globalAlpha = player.alive ? 1 : 0.35;
      ctx.fillStyle = player.color;
      ctx.beginPath();
      ctx.arc(sx, sy, radius, 0, Math.PI * 2);
      ctx.fill();

      ctx.lineWidth = player.userId === snapshot.localPlayerId ? 4 : 2;
      ctx.strokeStyle = player.accentColor;
      ctx.stroke();

      ctx.globalAlpha = 1;
      ctx.fillStyle = "#eff7ff";
      ctx.font = "600 13px 'Segoe UI', 'Microsoft YaHei', sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(player.nickname, sx, sy - radius - 8);
      ctx.font = "500 12px 'Segoe UI', 'Microsoft YaHei', sans-serif";
      ctx.fillStyle = "rgba(255,255,255,0.88)";
      ctx.fillText(String(player.mass), sx, sy + 5);
    }

    ctx.restore();

    if (connectionState !== "online") {
      ctx.fillStyle = "rgba(5,10,16,0.55)";
      ctx.fillRect(18, 18, 210, 40);
      ctx.fillStyle = "#ffe7bf";
      ctx.font = "600 13px 'Segoe UI', 'Microsoft YaHei', sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(
        connectionState === "error" ? "同步重试中" : "正在连接房间同步",
        32,
        44,
      );
    }

    animationFrameId = window.requestAnimationFrame(renderFrame);
  }

  function attachDomEvents() {
    if (!domRefs) {
      return;
    }

    domRefs.canvas.addEventListener("mousemove", (event) => {
      pointerActive = true;
      pointerX = event.clientX;
      pointerY = event.clientY;
    });
    domRefs.canvas.addEventListener("mouseleave", () => {
      pointerActive = false;
    });
    domRefs.canvas.addEventListener("touchstart", (event) => {
      const touch = event.touches[0];
      if (!touch) {
        return;
      }
      pointerActive = true;
      pointerX = touch.clientX;
      pointerY = touch.clientY;
    });
    domRefs.canvas.addEventListener("touchmove", (event) => {
      const touch = event.touches[0];
      if (!touch) {
        return;
      }
      pointerActive = true;
      pointerX = touch.clientX;
      pointerY = touch.clientY;
    });
    domRefs.canvas.addEventListener("touchend", () => {
      pointerActive = false;
    });

    keydownHandler = (event) => {
      if (
        event.code.startsWith("Key") ||
        event.code.startsWith("Arrow")
      ) {
        pressedKeys.add(event.code);
      }
    };
    keyupHandler = (event) => {
      pressedKeys.delete(event.code);
    };
    resizeHandler = () => {
      ensureCanvasSize();
    };

    window.addEventListener("keydown", keydownHandler);
    window.addEventListener("keyup", keyupHandler);
    window.addEventListener("resize", resizeHandler);
  }

  function detachDomEvents() {
    if (keydownHandler) {
      window.removeEventListener("keydown", keydownHandler);
      keydownHandler = null;
    }
    if (keyupHandler) {
      window.removeEventListener("keyup", keyupHandler);
      keyupHandler = null;
    }
    if (resizeHandler) {
      window.removeEventListener("resize", resizeHandler);
      resizeHandler = null;
    }
  }

  function buildDom(): SessionDomRefs {
    const root = document.createElement("div");
    root.className = "online-room-session";
    root.dataset.reducedMotion = String(settings.reducedMotion);
    root.innerHTML = `
      <div class="online-room-session__shell">
        <header class="online-room-session__header">
          <div>
            <div class="online-room-session__kicker">PRIVATE ROOM LIVE</div>
            <div class="online-room-session__room" data-online-room-label>私人房间</div>
          </div>
          <div class="online-room-session__header-actions">
            <button type="button" class="online-room-session__btn" data-online-settings>设置</button>
            <button type="button" class="online-room-session__btn online-room-session__btn--primary" data-online-back>返回分厅</button>
          </div>
        </header>
        <section class="online-room-session__stage">
          <canvas class="online-room-session__canvas" data-online-canvas></canvas>
          <aside class="online-room-session__panel">
            <div class="online-room-session__timer" data-online-timer>00:00</div>
            <div class="online-room-session__status" data-online-status>正在连接房间</div>
            <div class="online-room-session__player" data-online-player>载入玩家信息中</div>
            <div class="online-room-session__leaderboard" data-online-leaderboard></div>
            <div class="online-room-session__hint" data-online-hint>同步中</div>
          </aside>
          <div class="online-room-session__result" data-online-result hidden>
            <div class="online-room-session__result-card">
              <div class="online-room-session__kicker">ROOM RESULT</div>
              <h2 data-online-result-title>房间对局已结束</h2>
              <p data-online-result-meta>返回分厅后可继续下一局。</p>
              <div class="online-room-session__result-actions">
                <button type="button" class="online-room-session__btn online-room-session__btn--primary" data-online-result-back>回到房间</button>
              </div>
            </div>
          </div>
        </section>
      </div>
    `;

    const canvas = root.querySelector<HTMLCanvasElement>("[data-online-canvas]");
    const roomLabel = root.querySelector<HTMLDivElement>("[data-online-room-label]");
    const timerLabel = root.querySelector<HTMLDivElement>("[data-online-timer]");
    const statusLabel = root.querySelector<HTMLDivElement>("[data-online-status]");
    const playerLabel = root.querySelector<HTMLDivElement>("[data-online-player]");
    const leaderboard = root.querySelector<HTMLDivElement>("[data-online-leaderboard]");
    const footerHint = root.querySelector<HTMLDivElement>("[data-online-hint]");
    const resultOverlay = root.querySelector<HTMLDivElement>("[data-online-result]");
    const resultTitle = root.querySelector<HTMLHeadingElement>("[data-online-result-title]");
    const resultMeta = root.querySelector<HTMLParagraphElement>("[data-online-result-meta]");

    if (
      !canvas ||
      !roomLabel ||
      !timerLabel ||
      !statusLabel ||
      !playerLabel ||
      !leaderboard ||
      !footerHint ||
      !resultOverlay ||
      !resultTitle ||
      !resultMeta
    ) {
      throw new Error("Failed to build online room session UI.");
    }

    root
      .querySelector<HTMLElement>("[data-online-settings]")
      ?.addEventListener("click", () => {
        options.onOpenSettings();
      });
    root
      .querySelectorAll<HTMLElement>("[data-online-back], [data-online-result-back]")
      .forEach((button) => {
        button.addEventListener("click", () => {
          options.onReturnToModeHall();
        });
      });

    return {
      root,
      canvas,
      roomLabel,
      timerLabel,
      statusLabel,
      playerLabel,
      leaderboard,
      footerHint,
      resultOverlay,
      resultTitle,
      resultMeta,
    };
  }

  function mount(root: HTMLElement) {
    domRefs = buildDom();
    ctx = domRefs.canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Failed to acquire online room canvas context.");
    }

    root.appendChild(domRefs.root);
    ensureCanvasSize();
    updateRenderTargets(snapshot);
    attachDomEvents();
    updateHud();
  }

  function startNewGame() {
    if (!domRefs || !ctx) {
      throw new Error("Online room session must be mounted before start.");
    }

    stop();
    isRunning = true;
    connectionState = "connecting";
    syncError = null;
    lastRenderAt = performance.now();
    animationFrameId = window.requestAnimationFrame(renderFrame);
    syncTimerId = window.setInterval(() => {
      void performSync();
    }, 140);
    void performSync();
  }

  function stop() {
    isRunning = false;
    if (animationFrameId !== null) {
      window.cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
    if (syncTimerId !== null) {
      window.clearInterval(syncTimerId);
      syncTimerId = null;
    }
  }

  function destroy() {
    stop();
    detachDomEvents();
    domRefs?.root.remove();
    domRefs = null;
    ctx = null;
    renderPlayers.clear();
  }

  function applySettings(nextSettings: GameSettings) {
    settings = { ...nextSettings };
    if (domRefs) {
      domRefs.root.dataset.reducedMotion = String(settings.reducedMotion);
    }
  }

  function getSnapshot(): OnlineRoomSessionSnapshot {
    const localPlayer = getLocalPlayer();
    return {
      kind: "online-room",
      isMounted: domRefs !== null,
      isRunning,
      roomId: snapshot.roomId,
      roomCode: snapshot.roomCode,
      modeId: options.modeId,
      phase: snapshot.phase,
      connectionState,
      syncError,
      serverTime: snapshot.serverTime,
      startedAt: snapshot.startedAt,
      endsAt: snapshot.endsAt,
      localPlayerId: snapshot.localPlayerId,
      localPlayer: localPlayer
        ? {
            userId: localPlayer.userId,
            nickname: localPlayer.nickname,
            mass: localPlayer.mass,
            score: localPlayer.score,
            alive: localPlayer.alive,
            respawnAt: localPlayer.respawnAt,
            x: localPlayer.x,
            y: localPlayer.y,
          }
        : null,
      leaderboard: snapshot.leaderboard.map((entry) => ({ ...entry })),
      players: snapshot.players.map((player) => ({ ...player })),
      foods: snapshot.foods.map((food) => ({ ...food })),
    };
  }

  function advanceTime(ms: number) {
    if (!isRunning) {
      return;
    }

    const syntheticNow = lastRenderAt + ms;
    renderFrame(syntheticNow);
  }

  function debugFinishMatch(_options?: DebugMatchFinishOptions) {
    // Online room sessions are server-driven.
  }

  function debugSetBestMassRecord(_value: number) {
    // noop in online room mode
  }

  function debugSetBattleZone(_stage: number) {
    // noop in online room mode
  }

  return {
    mount,
    startNewGame,
    stop,
    destroy,
    applySettings,
    getSnapshot,
    advanceTime,
    debugFinishMatch,
    debugSetBestMassRecord,
    debugSetBattleZone,
  };
}
