export type PreferenceSchemaVersion = 1;

export type JoystickHandedness = "left" | "right" | "dynamic";
export type GraphicsQualityPreset = "low" | "medium" | "high" | "ultra";

export interface UserControlsPreferences {
  joystickHandedness: JoystickHandedness;
  joystickSize: number;
  joystickOpacity: number;
  skillButtonsMirrored: boolean;
  splitTapConfirm: boolean;
  ejectTapHold: boolean;
  vibrationEnabled: boolean;
}

export interface UserGraphicsPreferences {
  qualityPreset: GraphicsQualityPreset;
  renderScale: number;
  particlesEnabled: boolean;
  screenShakeEnabled: boolean;
  colorfulVfxEnabled: boolean;
  showFps: boolean;
  showMinimap: boolean;
  showLeaderboard: boolean;
  reducedMotion: boolean;
}

export interface UserKeybindPreferences {
  split: string;
  eject: string;
  boost: string;
  ping: string;
}

export interface UserUiPreferences {
  language: string;
  compactLobby: boolean;
  safeAreaInsetCompensation: boolean;
  preferredModeId: string;
  preferredQueueId: string;
}

export interface UserAccessibilityPreferences {
  highContrast: boolean;
  largerText: boolean;
  colorAssist: boolean;
  subtitleEnabled: boolean;
}

export interface UserPreferences {
  schemaVersion: PreferenceSchemaVersion;
  controls: UserControlsPreferences;
  graphics: UserGraphicsPreferences;
  keybinds: UserKeybindPreferences;
  ui: UserUiPreferences;
  accessibility: UserAccessibilityPreferences;
  updatedAt: string;
}

export interface UserPreferencesPatch {
  controls?: Partial<UserControlsPreferences>;
  graphics?: Partial<UserGraphicsPreferences>;
  keybinds?: Partial<UserKeybindPreferences>;
  ui?: Partial<UserUiPreferences>;
  accessibility?: Partial<UserAccessibilityPreferences>;
}

export interface GetUserPreferencesResponse {
  preferences: UserPreferences;
}

export interface SyncUserPreferencesRequest {
  patch: UserPreferencesPatch;
  clientVersion?: string;
}

export interface SyncUserPreferencesResponse {
  preferences: UserPreferences;
  updated: true;
}

export const DEFAULT_USER_PREFERENCES: UserPreferences = {
  schemaVersion: 1,
  controls: {
    joystickHandedness: "left",
    joystickSize: 1,
    joystickOpacity: 0.85,
    skillButtonsMirrored: false,
    splitTapConfirm: false,
    ejectTapHold: true,
    vibrationEnabled: true,
  },
  graphics: {
    qualityPreset: "high",
    renderScale: 1,
    particlesEnabled: true,
    screenShakeEnabled: true,
    colorfulVfxEnabled: true,
    showFps: true,
    showMinimap: true,
    showLeaderboard: true,
    reducedMotion: false,
  },
  keybinds: {
    split: "Space",
    eject: "KeyW",
    boost: "ShiftLeft",
    ping: "KeyV",
  },
  ui: {
    language: "zh-CN",
    compactLobby: false,
    safeAreaInsetCompensation: true,
    preferredModeId: "ranked",
    preferredQueueId: "ranked",
  },
  accessibility: {
    highContrast: false,
    largerText: false,
    colorAssist: false,
    subtitleEnabled: false,
  },
  updatedAt: new Date(0).toISOString(),
};
