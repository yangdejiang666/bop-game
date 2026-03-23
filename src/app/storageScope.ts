export type StorageScope = "anonymous" | `user:${string}`;

const ACTIVE_STORAGE_SCOPE_KEY = "bop:active-storage-scope";

export function getStorageScopeForUser(userId?: string | null): StorageScope {
  const safeUserId = userId?.trim();
  return safeUserId ? `user:${safeUserId}` : "anonymous";
}

export function getActiveStorageScope(): StorageScope {
  try {
    const raw = window.localStorage.getItem(ACTIVE_STORAGE_SCOPE_KEY)?.trim();
    if (raw === "anonymous" || raw?.startsWith("user:")) {
      return raw as StorageScope;
    }
  } catch {
    // ignore storage failures
  }
  return "anonymous";
}

export function setActiveStorageScope(scope: StorageScope): StorageScope {
  try {
    window.localStorage.setItem(ACTIVE_STORAGE_SCOPE_KEY, scope);
  } catch {
    // ignore storage failures
  }
  return scope;
}

export function setActiveStorageScopeForUser(
  userId?: string | null,
): StorageScope {
  return setActiveStorageScope(getStorageScopeForUser(userId));
}

export function buildScopedStorageKey(
  baseKey: string,
  scope: StorageScope = getActiveStorageScope(),
): string {
  return `${baseKey}:${scope}`;
}

export function readScopedStorageValue(
  baseKey: string,
  options?: {
    scope?: StorageScope;
    fallbackToLegacy?: boolean;
  },
): string | null {
  const scope = options?.scope ?? getActiveStorageScope();
  try {
    const scoped = window.localStorage.getItem(buildScopedStorageKey(baseKey, scope));
    if (scoped !== null) {
      return scoped;
    }
    if (options?.fallbackToLegacy !== false) {
      return window.localStorage.getItem(baseKey);
    }
  } catch {
    return null;
  }
  return null;
}

export function writeScopedStorageValue(
  baseKey: string,
  value: string,
  scope: StorageScope = getActiveStorageScope(),
): void {
  try {
    window.localStorage.setItem(buildScopedStorageKey(baseKey, scope), value);
  } catch {
    // ignore storage failures
  }
}

export function removeScopedStorageValue(
  baseKey: string,
  scope: StorageScope = getActiveStorageScope(),
): void {
  try {
    window.localStorage.removeItem(buildScopedStorageKey(baseKey, scope));
  } catch {
    // ignore storage failures
  }
}

export function hasScopedStorageValue(
  baseKey: string,
  scope: StorageScope = getActiveStorageScope(),
): boolean {
  try {
    return (
      window.localStorage.getItem(buildScopedStorageKey(baseKey, scope)) !== null
    );
  } catch {
    return false;
  }
}
