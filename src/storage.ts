/** localStorage, or null when the browser blocks it (cookies disabled, some in-app browsers): reading the property throws. */
export function browserStorage(): Storage | null {
  try { return globalThis.localStorage ?? null } catch { return null }
}

/** A stored preference, or null when storage is blocked or the read throws. */
export function readStored(key: string, storage: Pick<Storage, 'getItem'> | null = browserStorage()): string | null {
  try { return storage?.getItem(key) ?? null } catch { return null }
}

/** Saves a preference; false when it could not be saved (blocked storage or full quota). The caller keeps its state. */
export function writeStored(key: string, value: string, storage: Pick<Storage, 'setItem'> | null = browserStorage()): boolean {
  try { if (!storage) return false; storage.setItem(key, value); return true } catch { return false }
}
