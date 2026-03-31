import { create } from "zustand";
import {
  loadGameSettings,
  saveGameSettings,
  type GameSettings,
} from "../../app/settings";
import type { AuthSessionState } from "../../network/authService";
import type { UserPreferences } from "../../../shared-protocol/src/preferences";
import type { RoomMatchSnapshot, RoomSnapshot } from "../../../shared-protocol/src/room";
import type { UserSummary } from "../../../shared-protocol/src/user";
import type { LobbyModeId } from "../../ui/LobbyUI";

export type AppPhase =
  | "auth"
  | "lobby"
  | "mode-hall"
  | "matchmaking"
  | "loading"
  | "battle"
  | "room";

export type SettingsTabId = "graphics" | "controls" | "ui" | "accessibility";

export interface MatchmakingState {
  modeId: LobbyModeId;
  ticketId: string | null;
  useBackend: boolean;
  stage: "connecting" | "searching" | "matched" | "failed";
  etaSeconds: number;
  currentPlayers: number;
  targetPlayers: number;
  error: string | null;
}

export interface LoadingTarget {
  route: "battle" | "room";
  modeId: LobbyModeId;
}

export interface ToastState {
  tone: "info" | "success" | "error";
  message: string;
}

interface AppShellState {
  phase: AppPhase;
  session: AuthSessionState | null;
  summary: UserSummary | null;
  settings: GameSettings;
  preferences: UserPreferences | null;
  selectedModeId: LobbyModeId;
  currentRoom: RoomSnapshot | null;
  currentRoomSession: RoomMatchSnapshot | null;
  matchmaking: MatchmakingState | null;
  loadingTarget: LoadingTarget | null;
  settingsOpen: boolean;
  settingsTab: SettingsTabId;
  friendsPanelOpen: boolean;
  toast: ToastState | null;
  setPhase: (phase: AppPhase) => void;
  setSession: (session: AuthSessionState | null) => void;
  setSummary: (summary: UserSummary | null) => void;
  updateSettings: (updater: GameSettings | ((current: GameSettings) => GameSettings)) => void;
  applyPreferences: (preferences: UserPreferences | null) => void;
  setSelectedModeId: (modeId: LobbyModeId) => void;
  setCurrentRoom: (room: RoomSnapshot | null) => void;
  setCurrentRoomSession: (session: RoomMatchSnapshot | null) => void;
  setMatchmaking: (state: MatchmakingState | null) => void;
  setLoadingTarget: (target: LoadingTarget | null) => void;
  openSettings: (tab?: SettingsTabId) => void;
  closeSettings: () => void;
  setFriendsPanelOpen: (open: boolean) => void;
  pushToast: (toast: ToastState | null) => void;
  clearRoomContext: () => void;
}

const initialSettings = loadGameSettings();

function mergeSettingsFromPreferences(
  current: GameSettings,
  preferences: UserPreferences | null,
): GameSettings {
  if (!preferences) {
    return current;
  }

  return {
    ...current,
    showFps: preferences.graphics.showFps,
    showMinimap: preferences.graphics.showMinimap,
    showLeaderboard: preferences.graphics.showLeaderboard,
    reducedMotion: preferences.graphics.reducedMotion,
  };
}

export const useAppShellStore = create<AppShellState>((set) => ({
  phase: "auth",
  session: null,
  summary: null,
  settings: initialSettings,
  preferences: null,
  selectedModeId: "ranked",
  currentRoom: null,
  currentRoomSession: null,
  matchmaking: null,
  loadingTarget: null,
  settingsOpen: false,
  settingsTab: "graphics",
  friendsPanelOpen: false,
  toast: null,
  setPhase: (phase) => set({ phase }),
  setSession: (session) => set({ session }),
  setSummary: (summary) => set({ summary }),
  updateSettings: (updater) =>
    set((state) => {
      const next =
        typeof updater === "function" ? updater(state.settings) : updater;
      saveGameSettings(next);
      return { settings: next };
    }),
  applyPreferences: (preferences) =>
    set((state) => {
      const nextSettings = mergeSettingsFromPreferences(state.settings, preferences);
      saveGameSettings(nextSettings);
      return {
        preferences,
        settings: nextSettings,
      };
    }),
  setSelectedModeId: (selectedModeId) => set({ selectedModeId }),
  setCurrentRoom: (currentRoom) => set({ currentRoom }),
  setCurrentRoomSession: (currentRoomSession) => set({ currentRoomSession }),
  setMatchmaking: (matchmaking) => set({ matchmaking }),
  setLoadingTarget: (loadingTarget) => set({ loadingTarget }),
  openSettings: (tab = "graphics") =>
    set({
      settingsOpen: true,
      settingsTab: tab,
    }),
  closeSettings: () => set({ settingsOpen: false }),
  setFriendsPanelOpen: (friendsPanelOpen) => set({ friendsPanelOpen }),
  pushToast: (toast) => set({ toast }),
  clearRoomContext: () =>
    set({
      currentRoom: null,
      currentRoomSession: null,
      loadingTarget: null,
    }),
}));
