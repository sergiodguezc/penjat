// "Passa el mòbil" domain: setup, rotation, sequential guessing, forgiveness, scoring parity with GameRoom (from source),
// the active-time clock, privacy gates on restore, and versioned storage that survives corruption and failures.
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { ALPHABETS, normalizeGuess, type Language } from '../shared/game'
import { rankByScore } from '../shared/ranking'
import type { Voltes } from '../shared/protocol'
import { GameRoom } from '../server/game/GameRoom'
import {
  createLocalMatch, guesserBoard, localMatchResult, nextSetterId, parseLocalMatch, playableGuess, reduceLocalMatch, requiredGate, roundResults,
  setterId, totalTurns, voltaNumber, type LocalAction, type LocalMatch,
} from '../src/local/match'
import { createTurnClock, HEARTBEAT_MS, MAX_SEGMENT_MS } from '../src/local/clock'
import { clearLocalMatch, LOCAL_MATCH_STORAGE_KEY, readLocalMatch, writeLocalMatch } from '../src/local/storage'
import { clearRoomSession, ROOM_SESSION_KEY, saveRoomSession } from '../src/multiplayer/roomSession'

let now = 0
Date.now = () => now

const names = (count: number) => Array.from({ length: count }, (_, index) => `Jugador ${index + 1}`)
const create = (count: number, voltes: Voltes = 1, gameLanguage: Language = 'ca', random = 0) => {
  const created = createLocalMatch(names(count), { gameLanguage, voltes }, () => random)
  assert.ok(created.ok)
  return created.match
}
const play = (match: LocalMatch, ...actions: LocalAction[]) => actions.reduce(reduceLocalMatch, match)
const guesses = (letters: string, elapsedMs = 1000): LocalAction[] => [...letters].map((letter) => ({ type: 'guess', letter, elapsedMs }))
const scores = (match: LocalMatch) => Object.fromEntries(match.players.map((player) => [player.id, player.score]))
const memory = () => {
  const values = new Map<string, string>(); const keys = new Set<string>()
  return { values, keys, getItem: (key: string) => { keys.add(key); return values.get(key) ?? null }, setItem: (key: string, value: string) => { keys.add(key); values.set(key, value) }, removeItem: (key: string) => { keys.add(key); values.delete(key) } }
}

// Setup: 2–10 players, trimmed unique names, supported settings; ids follow seating order.
{
  assert.deepEqual(createLocalMatch(names(1), { gameLanguage: 'ca', voltes: 1 }), { ok: false, error: 'player-count' })
  assert.deepEqual(createLocalMatch(names(11), { gameLanguage: 'ca', voltes: 1 }), { ok: false, error: 'player-count' })
  assert.deepEqual(createLocalMatch(['Anna', '  '], { gameLanguage: 'ca', voltes: 1 }), { ok: false, error: 'invalid-name' })
  assert.deepEqual(createLocalMatch(['Anna', 'x'.repeat(25)], { gameLanguage: 'ca', voltes: 1 }), { ok: false, error: 'invalid-name' })
  assert.deepEqual(createLocalMatch(['Anna', 42], { gameLanguage: 'ca', voltes: 1 }), { ok: false, error: 'invalid-name' })
  assert.deepEqual(createLocalMatch(['Anna', ' anna '], { gameLanguage: 'ca', voltes: 1 }), { ok: false, error: 'duplicate-name' })
  assert.deepEqual(createLocalMatch(names(2), { gameLanguage: 'fr' as Language, voltes: 1 }), { ok: false, error: 'invalid-settings' })
  assert.deepEqual(createLocalMatch(names(2), { gameLanguage: 'toString' as Language, voltes: 1 }), { ok: false, error: 'invalid-settings' })
  assert.deepEqual(createLocalMatch(names(2), { gameLanguage: 'ca', voltes: 2 as Voltes }), { ok: false, error: 'invalid-settings' })
  const created = createLocalMatch(['  Anna   Maria ', 'Bernat', 'Carla'], { gameLanguage: 'es', voltes: 3 }, () => 0.5)
  assert.ok(created.ok)
  const match = created.match
  assert.deepEqual(match.players, [{ id: 'p1', name: 'Anna Maria', score: 0 }, { id: 'p2', name: 'Bernat', score: 0 }, { id: 'p3', name: 'Carla', score: 0 }])
  assert.deepEqual(match.roster, ['p2', 'p3', 'p1'])
  assert.equal(match.step, 'set-word')
  assert.equal(totalTurns(match), 9)
  assert.deepEqual(requiredGate(match), { kind: 'write-word', playerId: 'p2' })
  assert.deepEqual(match.guessers.map((guesser) => guesser.playerId), ['p3', 'p1'])
}

// Rotation: every roster member sets once per volta, guessers follow seating order after the setter.
{
  let match = create(4, 3, 'ca', 0.75)
  assert.deepEqual(match.roster, ['p4', 'p1', 'p2', 'p3'])
  const setters: string[] = []
  while (match.step !== 'match-over') {
    setters.push(setterId(match))
    const order = match.guessers.map((guesser) => guesser.playerId)
    const seat = match.players.findIndex((player) => player.id === setterId(match))
    assert.deepEqual(order, [1, 2, 3].map((offset) => match.players[(seat + offset) % 4].id))
    assert.equal(voltaNumber(match), Math.floor(match.turnIndex / 4) + 1)
    match = play(match, { type: 'set-word', word: 'GAT' }, ...Array.from({ length: 3 }, () => guesses('GAT')).flat())
    if (match.step === 'round-over') match = play(match, { type: 'next-turn' })
  }
  assert.deepEqual(setters, [...match.roster, ...match.roster, ...match.roster])
}

// Two players: one guesser per turn, the match ends after roster × voltes turns.
{
  let match = create(2)
  match = play(match, { type: 'set-word', word: 'sol' }, ...guesses('SOL', 700))
  assert.equal(match.step, 'round-over')
  assert.deepEqual(roundResults(match), [
    { playerId: 'p2', position: 1, status: 'solved', forgiven: false, errors: 0, resolutionTimeMs: 2100, pointsAwarded: 1 },
    { playerId: 'p1', position: null, status: 'setter', forgiven: false, errors: null, resolutionTimeMs: null, pointsAwarded: 0 },
  ])
  assert.equal(nextSetterId(match), 'p2')
  match = play(match, { type: 'next-turn' }, { type: 'set-word', word: 'lluna' }, ...guesses('BCDEFG'), { type: 'decide-forgiveness', forgive: false })
  assert.equal(match.step, 'match-over')
  assert.equal(nextSetterId(match), null)
  assert.deepEqual(localMatchResult(match), { ranking: ['p2', 'p1'], scores: { p1: 0, p2: 1 } })
}

// Ten players: every guesser plays independently in turn; points G−i by order; final ranking with tied totals.
{
  let match = create(10)
  match = play(match, { type: 'set-word', word: 'MUNTANYA' })
  for (const [index, guesser] of match.guessers.entries()) {
    assert.equal(requiredGate(match).kind, 'guess')
    assert.equal(guesserBoard(match)!.playerId, guesser.playerId)
    // Odd seats miss once; times differ so every place is distinct.
    match = play(match, ...(index % 2 ? guesses('X', 100) : []), ...guesses('MUNTAY', 1000 + index))
  }
  assert.equal(match.step, 'round-over')
  const results = roundResults(match)
  assert.deepEqual(results.map((result) => [result.playerId, result.pointsAwarded]), [
    ['p2', 9], ['p4', 8], ['p6', 7], ['p8', 6], ['p10', 5], ['p3', 4], ['p5', 3], ['p7', 2], ['p9', 1], ['p1', 0],
  ])
  assert.equal(results.at(-1)!.status, 'setter')
}

// Independent guessers, normalization, forgiveness granted / denied / exhausted, and invalid actions.
{
  let match = create(4)
  const unchanged = (action: LocalAction) => assert.equal(reduceLocalMatch(match, action), match, JSON.stringify(action))
  for (const action of [{ type: 'guess', letter: 'A', elapsedMs: 1 }, { type: 'add-time', elapsedMs: 5 }, { type: 'decide-forgiveness', forgive: true }, { type: 'next-turn' }, { type: 'rematch', random: 0 }] as LocalAction[]) unchanged(action)
  for (const word of ['', '   ', '123', 'x'.repeat(51), 'NIÑO']) unchanged({ type: 'set-word', word })
  match = play(match, { type: 'set-word', word: "  plaça   d'ànec " })
  assert.equal(match.word, "PLAÇA D'ÀNEC")
  unchanged({ type: 'set-word', word: 'GAT' })
  for (const letter of ['1', 'AB', 'Ñ', '']) unchanged({ type: 'guess', letter, elapsedMs: 1 })
  for (const elapsedMs of [-1, Number.NaN, Number.POSITIVE_INFINITY]) unchanged({ type: 'guess', letter: 'P', elapsedMs })
  unchanged({ type: 'add-time', elapsedMs: 0 })
  unchanged({ type: 'decide-forgiveness', forgive: true })
  unchanged({ type: 'unknown' } as unknown as LocalAction)

  match = play(match, { type: 'guess', letter: 'à', elapsedMs: 300 })
  assert.equal(playableGuess(match, 'a'), null)
  assert.equal(playableGuess(match, 'ç'), 'Ç')
  unchanged({ type: 'guess', letter: 'a', elapsedMs: 50 })
  let board = guesserBoard(match)!
  assert.deepEqual(board.displayWord, ['_', '_', 'A', '_', 'A', ' ', '_', "'", 'À', '_', '_', '_'])
  assert.ok(!JSON.stringify(board).includes(match.word!))

  // p2 reaches six errors: only the setter decides; a grant resumes p2's own board at six errors.
  match = play(match, ...guesses('BFGHIJ'))
  assert.equal(match.step, 'forgive')
  assert.deepEqual(requiredGate(match), { kind: 'forgive', playerId: 'p1', guesserId: 'p2' })
  assert.equal(guesserBoard(match), null)
  unchanged({ type: 'guess', letter: 'P', elapsedMs: 1 })
  unchanged({ type: 'add-time', elapsedMs: 1 })
  match = play(match, { type: 'decide-forgiveness', forgive: true })
  assert.deepEqual(requiredGate(match), { kind: 'guess', playerId: 'p2', resuming: true })
  assert.equal(guesserBoard(match)!.errors, 6)
  // Exhausted: one more miss eliminates, with no second request; p3 starts fresh.
  match = play(match, ...guesses('K'))
  assert.equal(match.guessers[0].status, 'eliminated')
  assert.deepEqual(requiredGate(match), { kind: 'guess', playerId: 'p3', resuming: false })
  board = guesserBoard(match)!
  assert.deepEqual(board.guessed, [])
  assert.equal(board.errors, 0)
  // p3 is denied; p4 solves after a grant.
  match = play(match, ...guesses('BFGHIJ'), { type: 'decide-forgiveness', forgive: false })
  assert.equal(match.guessers[1].status, 'failed')
  match = play(match, ...guesses('BFGHIJ'), { type: 'decide-forgiveness', forgive: true }, ...guesses('PLAÇDNEC'))
  assert.equal(match.step, 'round-over')
  assert.deepEqual(roundResults(match).map((result) => [result.playerId, result.status, result.forgiven, result.errors, result.pointsAwarded]), [
    ['p4', 'solved', true, 6, 3], ['p3', 'failed', false, 6, 0], ['p2', 'eliminated', true, 7, 0], ['p1', 'setter', false, null, 0],
  ])
  assert.deepEqual(scores(match), { p1: 0, p2: 0, p3: 0, p4: 3 })
}

// Ties and the final result: equal totals share a place; match order is score, then roster order; rematch resets.
{
  let match = create(3)
  match = play(match, { type: 'set-word', word: 'GAT' }, ...guesses('GAT', 1000), ...guesses('GAT', 2000), { type: 'next-turn' })
  match = play(match, { type: 'set-word', word: 'GOS' }, ...guesses('GOS', 1000), ...guesses('GOS', 1000), { type: 'next-turn' })
  match = play(match, { type: 'set-word', word: 'LLOP' }, ...guesses('LOP', 1000), ...guesses('BCDEFG'), { type: 'decide-forgiveness', forgive: false })
  assert.equal(match.step, 'match-over')
  // Turn 2 tied p3 and p1 on errors and time: roster order put p1 first.
  assert.deepEqual(scores(match), { p1: 4, p2: 2, p3: 2 })
  assert.deepEqual(localMatchResult(match), { ranking: ['p1', 'p2', 'p3'], scores: { p1: 4, p2: 2, p3: 2 } })
  assert.deepEqual(rankByScore(match.players).map(({ player, rank }) => [player.id, rank]), [['p1', 1], ['p2', 2], ['p3', 2]])
  // Points were added once: re-reading results or replaying finished actions changes nothing.
  assert.deepEqual(roundResults(match), roundResults(match))
  assert.equal(reduceLocalMatch(match, { type: 'next-turn' }), match)
  const rematch = play(match, { type: 'rematch', random: 0.9 })
  assert.deepEqual(rematch.roster, ['p3', 'p1', 'p2'])
  assert.deepEqual(scores(rematch), { p1: 0, p2: 0, p3: 0 })
  assert.deepEqual([rematch.step, rematch.turnIndex, rematch.word, localMatchResult(rematch)], ['set-word', 0, null, null])
  assert.deepEqual(rematch.players.map((player) => player.name), match.players.map((player) => player.name))
}

// Parity: identical scripted turns through GameRoom and the local reducer give identical results, scores and rankings.
{
  const WORDS: Record<Language, string[]> = {
    ca: ['GAT', 'PLAÇA', "D'ACORD", 'MUNTANYA', 'CAFÈ', 'XOCOLATA', 'COL·LEGI', 'ÀNEC'],
    es: ['NIÑO', 'ÁRBOL', 'PINGÜINO', 'CASA', 'MURCIÉLAGO', 'AÑO NUEVO'],
  }
  const seeded = (seed: number) => () => {
    seed = (seed + 0x6d2b79f5) | 0
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
  const stats = { grants: 0, denials: 0, eliminated: 0, timeTies: 0, matches: 0 }

  const parity = (count: number, voltes: Voltes, language: Language, seed: number, rematches = 0) => {
    const rng = seeded(seed)
    let roomRandom = rng()
    const created = createLocalMatch(names(count), { gameLanguage: language, voltes }, () => roomRandom)
    assert.ok(created.ok)
    let local = created.match
    const room = new GameRoom('PARIT', language, voltes, () => roomRandom)
    for (const player of local.players) room.addPlayer(player.id, `socket-${player.id}`, `token-${player.id}`, player.name)
    room.start('p1')
    for (let match = 0; match <= rematches; match += 1) {
      assert.deepEqual(room.viewFor('p1').match.turnOrder, local.roster)
      for (;;) {
        const setter = setterId(local)
        assert.equal(room.viewFor('p1').round!.setterId, setter)
        const word = WORDS[language][Math.floor(rng() * WORDS[language].length)]
        const start = now = (stats.matches * 1000 + local.turnIndex + 1) * 1_000_000
        room.setWord(setter, word)
        local = reduceLocalMatch(local, { type: 'set-word', word })
        const wordLetters = [...new Set([...word].map((character) => normalizeGuess(character, language)).filter((letter) => letter !== null))]
        const active = new Map<string, number>()
        while (local.step === 'guess' || local.step === 'forgive') {
          const id = local.guessers[local.current].playerId
          if (local.step === 'forgive') {
            const forgive = rng() < 0.5
            stats[forgive ? 'grants' : 'denials'] += 1
            now = start + (active.get(id) ?? 0)
            const request = room.viewFor(setter).forgivenessRequests.find((candidate) => candidate.playerId === id && candidate.status === 'pending')!
            room.decideForgiveness(setter, request.id, forgive)
            local = reduceLocalMatch(local, { type: 'decide-forgiveness', forgive })
            continue
          }
          const guessed = local.guessers[local.current].guessed
          const pool = (rng() < 0.55 ? wordLetters : ALPHABETS[language]).filter((letter) => !guessed.includes(letter))
          const candidates = pool.length ? pool : wordLetters.filter((letter) => !guessed.includes(letter))
          const letter = candidates[Math.floor(rng() * candidates.length)]
          const input = rng() < 0.3 ? letter.toLocaleLowerCase(language) : letter
          const elapsedMs = [500, 1000, 1000, 2500][Math.floor(rng() * 4)]
          active.set(id, (active.get(id) ?? 0) + elapsedMs)
          now = start + active.get(id)!
          room.guess(id, input)
          const next = reduceLocalMatch(local, { type: 'guess', letter: input, elapsedMs })
          assert.notEqual(next, local)
          local = next
        }
        const view = room.viewFor('p1')
        assert.deepEqual(roundResults(local), view.round!.results, `seed ${seed} turn ${local.turnIndex}`)
        assert.deepEqual(scores(local), Object.fromEntries(room.players.map((player) => [player.id, player.score])))
        const solvedTimes = roundResults(local).filter((result) => result.status === 'solved').map((result) => `${result.errors}:${result.resolutionTimeMs}`)
        stats.timeTies += solvedTimes.length - new Set(solvedTimes).size
        stats.eliminated += roundResults(local).filter((result) => result.status === 'eliminated').length
        if (local.step === 'match-over') break
        assert.equal(nextSetterId(local), view.round!.nextSetterId)
        room.continue(nextSetterId(local)!)
        local = reduceLocalMatch(local, { type: 'next-turn' })
      }
      assert.equal(room.roomStatus, 'match-over')
      assert.deepEqual(localMatchResult(local), room.viewFor('p1').matchResult)
      stats.matches += 1
      if (match < rematches) {
        roomRandom = rng()
        for (const player of local.players) room.requestRematch(player.id)
        local = reduceLocalMatch(local, { type: 'rematch', random: roomRandom })
      }
    }
  }
  parity(2, 1, 'ca', 1, 1)
  parity(2, 3, 'es', 2)
  parity(4, 3, 'ca', 3)
  parity(10, 1, 'ca', 4)
  parity(10, 1, 'es', 5)
  for (let seed = 10; seed < 40; seed += 1) parity(2 + (seed % 9), ([1, 3, 5] as const)[seed % 3], seed % 2 ? 'ca' : 'es', seed)
  assert.ok(stats.grants > 0 && stats.denials > 0 && stats.eliminated > 0 && stats.timeTies > 0, JSON.stringify(stats))
}

// Clock: counts only running segments, once; repeated pauses and starts are harmless; suspensions are capped.
{
  let clockNow = 0
  const clock = createTurnClock(() => clockNow)
  assert.equal(clock.running, false)
  assert.equal(clock.flush(), 0)
  assert.equal(clock.stop(), 0)
  clock.start(); clockNow = 1500
  assert.equal(clock.flush(), 1500)
  clockNow = 1600; clock.start()
  clockNow = 2000
  assert.equal(clock.stop(), 500)
  assert.equal(clock.stop(), 0)
  assert.equal(clock.flush(), 0)
  clockNow = 9000
  assert.equal(clock.flush(), 0, 'time while stopped (hidden page, gate) is never counted')
  clock.start(); clockNow = 8000
  assert.equal(clock.flush(), 0, 'a clock going backwards counts nothing')
  clockNow = 8000 + MAX_SEGMENT_MS * 5
  assert.equal(clock.stop(), MAX_SEGMENT_MS)
  assert.equal(createTurnClock(() => 0).running, false)
}

// Interrupted turn: unlock, guess, heartbeat, hide, "kill" and restore. Saved time is exact up to the last flush;
// the restored clock is stopped until the gate is unlocked again, and nothing is counted twice.
{
  const storage = memory()
  let clockNow = 0
  let match = play(create(3), { type: 'set-word', word: 'GAT' })
  let clock = createTurnClock(() => clockNow)
  const save = () => assert.equal(writeLocalMatch(match, storage), 'saved')
  save()
  clockNow = 60_000 // a long time on the gate: not counted
  clock.start()
  clockNow += 1200; match = reduceLocalMatch(match, { type: 'guess', letter: 'G', elapsedMs: clock.flush() }); save()
  clockNow += HEARTBEAT_MS; match = reduceLocalMatch(match, { type: 'add-time', elapsedMs: clock.flush() }); save()
  clockNow += 800; match = reduceLocalMatch(match, { type: 'add-time', elapsedMs: clock.stop() }); save() // hidden
  assert.equal(match.guessers[0].activeMs, 1200 + HEARTBEAT_MS + 800)
  clockNow += 300_000 // app in the background
  clock = createTurnClock(() => clockNow) // relaunch
  let restored = readLocalMatch(storage)
  assert.equal(restored.status, 'saved')
  match = (restored as { match: LocalMatch }).match
  assert.equal(clock.running, false)
  assert.deepEqual(requiredGate(match), { kind: 'guess', playerId: 'p2', resuming: true })
  clock.start()
  clockNow += 1500; match = reduceLocalMatch(match, { type: 'add-time', elapsedMs: clock.flush() }); save()
  clockNow += 1900 // killed before the next heartbeat: at most HEARTBEAT_MS is lost
  restored = readLocalMatch(storage)
  assert.equal((restored as { match: LocalMatch }).match.guessers[0].activeMs, 1200 + HEARTBEAT_MS + 800 + 1500)
}

// Persistence and restore at every phase: the saved match round-trips exactly, reading never changes it, and the
// required gate after a reload is the one for the stored step (never a board or the word).
{
  const snapshots: [string, LocalMatch, ReturnType<typeof requiredGate>][] = []
  let match = create(3)
  snapshots.push(['set-word', match, { kind: 'write-word', playerId: 'p1' }])
  match = play(match, { type: 'set-word', word: 'GAT' })
  snapshots.push(['guess, fresh', match, { kind: 'guess', playerId: 'p2', resuming: false }])
  match = play(match, { type: 'add-time', elapsedMs: 400 })
  snapshots.push(['guess, unlocked without letters', match, { kind: 'guess', playerId: 'p2', resuming: true }])
  match = play(match, ...guesses('BC'))
  snapshots.push(['guess, mid-turn', match, { kind: 'guess', playerId: 'p2', resuming: true }])
  match = play(match, ...guesses('DEFH'))
  snapshots.push(['forgive', match, { kind: 'forgive', playerId: 'p1', guesserId: 'p2' }])
  match = play(match, { type: 'decide-forgiveness', forgive: true })
  snapshots.push(['guess, after a grant', match, { kind: 'guess', playerId: 'p2', resuming: true }])
  match = play(match, ...guesses('GAT'))
  snapshots.push(['guess, next guesser', match, { kind: 'guess', playerId: 'p3', resuming: false }])
  match = play(match, ...guesses('IGAT'))
  snapshots.push(['round-over', match, { kind: 'reveal' }])
  match = play(match, { type: 'next-turn' }, { type: 'set-word', word: 'GOS' }, ...guesses('GOS'), ...guesses('GOS'), { type: 'next-turn' }, { type: 'set-word', word: 'MAR' }, ...guesses('MAR'), ...guesses('MAR'))
  snapshots.push(['match-over', match, { kind: 'reveal' }])
  for (const [label, snapshot, gate] of snapshots) {
    const storage = memory()
    assert.equal(writeLocalMatch(snapshot, storage), 'saved', label)
    const stored = storage.values.get(LOCAL_MATCH_STORAGE_KEY)
    const first = readLocalMatch(storage)
    assert.deepEqual(first, { status: 'saved', match: snapshot }, label)
    assert.deepEqual(readLocalMatch(storage), first, label)
    assert.equal(storage.values.get(LOCAL_MATCH_STORAGE_KEY), stored, `${label}: reading never rewrites`)
    assert.deepEqual(requiredGate((first as { match: LocalMatch }).match), gate, label)
    // Nothing private is reachable from a gate; the word is public only from the reveal on.
    assert.ok(!JSON.stringify(requiredGate(snapshot)).includes('GAT'), label)
    assert.equal(roundResults(snapshot).length > 0, gate.kind === 'reveal', label)
    if (gate.kind !== 'guess') assert.equal(guesserBoard(snapshot), null, label)
  }
}

// Storage: corrupt, impossible and future saves; blocked, throwing and full storage; key isolation from online rooms.
{
  const valid = play(create(3), { type: 'set-word', word: 'GAT' }, ...guesses('GAT'), ...guesses('BC'))
  assert.ok(parseLocalMatch(JSON.parse(JSON.stringify(valid))))
  const stored = (raw: string) => { const storage = memory(); storage.values.set(LOCAL_MATCH_STORAGE_KEY, raw); return readLocalMatch(storage) }
  for (const raw of ['not json', 'null', '[]', '42', '"text"', '{}']) assert.deepEqual(stored(raw), { status: 'discarded' }, raw)
  const mutations: [string, (match: any) => void][] = [
    ['no version', (match) => { delete match.version }], ['version 0', (match) => { match.version = 0 }], ['string version', (match) => { match.version = '1' }],
    ['one player', (match) => { match.players.length = 1 }], ['duplicate id', (match) => { match.players[1].id = 'p1' }],
    ['duplicate name', (match) => { match.players[1].name = 'JUGADOR 1' }], ['long name', (match) => { match.players[0].name = 'x'.repeat(25) }],
    ['untrimmed name', (match) => { match.players[0].name = ' Anna' }], ['negative score', (match) => { match.players[0].score = -1 }],
    ['fractional score', (match) => { match.players[0].score = 1.5 }], ['language', (match) => { match.gameLanguage = 'fr' }], ['voltes', (match) => { match.voltes = 2 }],
    ['roster not a rotation', (match) => { match.roster = ['p1', 'p3', 'p2'] }], ['short roster', (match) => { match.roster.pop() }],
    ['turn past the end', (match) => { match.turnIndex = 3 }], ['unknown step', (match) => { match.step = 'paused' }], ['unlocked flag', (match) => { match.step = 'guess-unlocked' }],
    ['missing word', (match) => { match.word = null }], ['invalid word', (match) => { match.word = 'G4T' }], ['lowercase word', (match) => { match.word = 'gat' }],
    ['word while choosing', (match) => { match.step = 'set-word'; match.current = 0 }], ['guessers reordered', (match) => { match.guessers.reverse() }],
    ['guesser missing', (match) => { match.guessers.pop() }], ['invalid letter', (match) => { match.guessers[1].guessed.push('1') }],
    ['lowercase letter', (match) => { match.guessers[1].guessed[0] = 'b' }], ['repeated letter', (match) => { match.guessers[1].guessed.push('B') }],
    ['errors mismatch', (match) => { match.guessers[1].errors = 0 }], ['solved without the word', (match) => { match.guessers[1].status = 'solved' }],
    ['forgiven before six errors', (match) => { match.guessers[1].forgiven = true }], ['earlier guesser still playing', (match) => { match.guessers[0].status = 'playing' }],
    ['negative time', (match) => { match.guessers[1].activeMs = -5 }], ['time as text', (match) => { match.guessers[1].activeMs = '5' }],
    ['current past the end', (match) => { match.current = 3 }], ['current wrong', (match) => { match.current = 0 }],
    ['awaiting in a guess step', (match) => { match.guessers[1].guessed.push('D', 'E', 'F', 'H'); match.guessers[1].errors = 6; match.guessers[1].status = 'awaiting-forgiveness' }],
  ]
  for (const [label, mutate] of mutations) {
    const copy = JSON.parse(JSON.stringify(valid))
    mutate(copy)
    assert.deepEqual(stored(JSON.stringify(copy)), { status: 'discarded' }, label)
  }
  const lastTurn = play(create(2), { type: 'set-word', word: 'GAT' }, ...guesses('GAT'), { type: 'next-turn' }, { type: 'set-word', word: 'GOS' }, ...guesses('GOS'))
  assert.equal(lastTurn.step, 'match-over')
  assert.deepEqual(stored(JSON.stringify({ ...lastTurn, step: 'round-over' })), { status: 'discarded' })
  const later = play(create(3), { type: 'set-word', word: 'GAT' })
  assert.deepEqual(stored(JSON.stringify({ ...later, guessers: later.guessers.with(1, { ...later.guessers[1], activeMs: 5 }) })), { status: 'discarded' }, 'a later guesser has not started')

  // A newer save is kept until explicitly replaced.
  const newer = memory()
  newer.values.set(LOCAL_MATCH_STORAGE_KEY, JSON.stringify({ version: 2, future: true }))
  assert.deepEqual(readLocalMatch(newer), { status: 'newer', version: 2 })
  assert.equal(writeLocalMatch(valid, newer), 'newer-save')
  assert.equal(newer.values.get(LOCAL_MATCH_STORAGE_KEY), JSON.stringify({ version: 2, future: true }))
  assert.equal(writeLocalMatch(valid, newer, { replaceNewer: true }), 'saved')
  assert.equal(readLocalMatch(newer).status, 'saved')
  // A discarded save is simply replaced by the next match.
  const corrupt = memory()
  corrupt.values.set(LOCAL_MATCH_STORAGE_KEY, '{broken')
  assert.equal(writeLocalMatch(valid, corrupt), 'saved')

  // Blocked or failing storage never throws and never reports a save that did not happen; play continues in memory.
  const throwing = { getItem() { throw new Error('blocked') }, setItem() { throw new Error('QuotaExceededError') }, removeItem() { throw new Error('blocked') } }
  assert.deepEqual(readLocalMatch(null), { status: 'unavailable' })
  assert.deepEqual(readLocalMatch(throwing), { status: 'unavailable' })
  assert.equal(writeLocalMatch(valid, null), 'failed')
  assert.equal(writeLocalMatch(valid, throwing), 'failed')
  const full = { ...memory(), setItem() { throw new Error('QuotaExceededError') } }
  assert.equal(writeLocalMatch(valid, full), 'failed')
  assert.notEqual(reduceLocalMatch(valid, { type: 'guess', letter: 'G', elapsedMs: 10 }), valid)
  assert.equal(clearLocalMatch(null), false)
  assert.equal(clearLocalMatch(throwing), false)

  // New match and abandon.
  const storage = memory()
  writeLocalMatch(valid, storage)
  assert.equal(clearLocalMatch(storage), true)
  assert.deepEqual(readLocalMatch(storage), { status: 'empty' })

  // Isolation: local saves touch only their key, and online session saves never touch the local match.
  const shared = memory()
  writeLocalMatch(valid, shared); readLocalMatch(shared); clearLocalMatch(shared); writeLocalMatch(valid, shared)
  assert.deepEqual([...shared.keys], [LOCAL_MATCH_STORAGE_KEY])
  const localValue = shared.values.get(LOCAL_MATCH_STORAGE_KEY)
  saveRoomSession({ roomCode: 'ABCDE', playerId: 'player-1', reconnectToken: 'token-1' }, shared)
  clearRoomSession(shared, null)
  assert.equal(shared.values.get(LOCAL_MATCH_STORAGE_KEY), localValue)
  assert.equal(shared.values.has(ROOM_SESSION_KEY), false)
  assert.notEqual(LOCAL_MATCH_STORAGE_KEY, ROOM_SESSION_KEY)
}

// The local domain stays independent of the online transport and session.
for (const file of readdirSync('src/local')) {
  const source = readFileSync(`src/local/${file}`, 'utf8')
  assert.doesNotMatch(source, /multiplayer\/(socket|roomSession)|socket\.io|from 'react'/, file)
}

console.log('local match checks passed: setup, rotation, 2–10 players, forgiveness, scoring parity with GameRoom, clock, restore gates, storage')
