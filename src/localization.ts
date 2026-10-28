import type { Language } from '../shared/game'
import { readStored } from './storage'

export const INTERFACE_LANGUAGE_STORAGE_KEY = 'hangman-interface-language'

export function readInterfaceLanguage(storage: Pick<Storage, 'getItem'> | null): Language {
  const stored = readStored(INTERFACE_LANGUAGE_STORAGE_KEY, storage)
  return stored === 'es' || stored === 'ca' ? stored : 'ca'
}
