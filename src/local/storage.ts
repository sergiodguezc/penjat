import { browserStorage } from '../storage'
import { LOCAL_MATCH_VERSION, parseLocalMatch, type LocalMatch } from './match'

/** Separate from the online room session (`hangman-room-session`); nothing here reads or writes any other key. */
export const LOCAL_MATCH_STORAGE_KEY = 'penjat-local-match'

export type StoredLocalMatch =
  | { status: 'empty' }
  | { status: 'saved'; match: LocalMatch }
  /** Unreadable, or a state the game could not reach: ignored, and replaced by the next match that is saved. */
  | { status: 'discarded' }
  /** Saved by a newer Penjat: kept untouched until the player explicitly replaces it. */
  | { status: 'newer'; version: number }
  /** Blocked storage: a match can only live in memory. */
  | { status: 'unavailable' }
export type SaveResult = 'saved' | 'failed' | 'newer-save'

/** Never throws, and never changes what is stored. */
export function readLocalMatch(storage: Pick<Storage, 'getItem'> | null = browserStorage()): StoredLocalMatch {
  let raw: string | null
  try { if (!storage) return { status: 'unavailable' }; raw = storage.getItem(LOCAL_MATCH_STORAGE_KEY) } catch { return { status: 'unavailable' } }
  if (raw === null) return { status: 'empty' }
  let value: unknown
  try { value = JSON.parse(raw) } catch { return { status: 'discarded' } }
  const version = (value as { version?: unknown } | null)?.version
  if (typeof version === 'number' && Number.isInteger(version) && version > LOCAL_MATCH_VERSION) return { status: 'newer', version }
  const match = parseLocalMatch(value)
  return match ? { status: 'saved', match } : { status: 'discarded' }
}

/** One `setItem` per snapshot, so a save is all or nothing. Only `'saved'` means the match will survive a reload.
 A newer-version save is replaced only with `replaceNewer` (the player chose to start over). */
export function writeLocalMatch(match: LocalMatch, storage: Pick<Storage, 'getItem' | 'setItem'> | null = browserStorage(), { replaceNewer = false } = {}): SaveResult {
  if (!replaceNewer && readLocalMatch(storage).status === 'newer') return 'newer-save'
  try { if (!storage) return 'failed'; storage.setItem(LOCAL_MATCH_STORAGE_KEY, JSON.stringify(match)); return 'saved' } catch { return 'failed' }
}

/** Abandon or finish: forgets the saved match, whatever its version. False when storage refused. */
export function clearLocalMatch(storage: Pick<Storage, 'removeItem'> | null = browserStorage()): boolean {
  try { if (!storage) return false; storage.removeItem(LOCAL_MATCH_STORAGE_KEY); return true } catch { return false }
}
