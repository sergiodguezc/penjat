import assert from 'node:assert/strict'
import { io } from 'socket.io-client'

// Persistent room reconnection in a real browser profile: a refresh and a closed-then-reopened tab return to the same
// player without typing anything, a second tab takes the player over without duplicating it, an explicit leave is
// final, one seat per profile from the entry screen (same room resumes, another room asks first), forged or malformed credentials fall back to the normal page, and a legacy sessionStorage session migrates.
export async function checkReconnect({ origin, command, evaluate, waitFor, navigate, newTab }) {
  const profile = (await command('browser.createUserContext')).userContext
  const guest = io(origin, { transports: ['websocket'], forceNew: true })
  let latest = null
  guest.on('room:state', (view) => { latest = view })
  await new Promise((resolve, reject) => { guest.once('connect', resolve); guest.once('connect_error', reject) })
  const stored = (context) => evaluate(context, "localStorage.getItem('hangman-room-session')").then((value) => value && JSON.parse(value))
  const lobby = "document.querySelector('.lobby-page') !== null"
  const connectedPlayers = () => latest?.players.filter((player) => player.active && player.connectionState === 'connected').length
  const until = async (check, label) => {
    const deadline = Date.now() + 7000
    while (!check()) { if (Date.now() > deadline) assert.fail(`timed out: ${label}`); await new Promise((resolve) => setTimeout(resolve, 50)) }
  }

  try {
    // Create a room through the UI; a second player joins from Node.
    let tab = await newTab(profile)
    await command('browsingContext.setViewport', { context: tab, viewport: { width: 1024, height: 768 } })
    await navigate(tab, '/')
    await evaluate(tab, "localStorage.setItem('hangman-interface-language', 'ca'); localStorage.setItem('hangman-name', 'Reconnexió')")
    await navigate(tab, '/multijugador/')
    await waitFor(tab, "document.querySelector('.entry-create .primary-action') !== null")
    await evaluate(tab, "document.querySelector('.entry-create').requestSubmit()")
    await waitFor(tab, lobby)
    const session = await stored(tab)
    assert.equal(session.version, 1)
    const joined = await new Promise((resolve) => guest.emit('room:join', { name: 'Convidat', code: session.roomCode }, resolve))
    assert.equal(joined.ok, true)
    await until(() => connectedPlayers() === 2, 'two players')

    // Refresh: back in the same lobby as the same player and still the host, nothing typed.
    await navigate(tab, '/multijugador/')
    await waitFor(tab, lobby)
    assert.equal((await stored(tab)).playerId, session.playerId)
    await until(() => connectedPlayers() === 2 && latest.players.filter((player) => player.active).length === 2, 'refresh keeps two players')
    assert.equal(latest.hostId, session.playerId, 'host status survives a refresh')

    // Close the tab and reopen the site (within the server's grace period) on another page: the room comes back.
    await command('browsingContext.close', { context: tab })
    await until(() => latest.players.find((player) => player.id === session.playerId)?.connectionState === 'reconnecting', 'closed tab marked reconnecting')
    tab = await newTab(profile)
    await navigate(tab, '/')
    await waitFor(tab, lobby)
    await until(() => connectedPlayers() === 2, 'reopened tab reconnected')
    assert.equal(latest.players.filter((player) => player.active).length, 2, 'no duplicate player after reopening')

    // A second tab of the same profile takes the player over; the first one says so and can take it back.
    const second = await newTab(profile)
    await navigate(second, '/multijugador/')
    await waitFor(second, lobby)
    await waitFor(tab, "document.querySelector('.room-restore-card') !== null && document.body.innerText.includes('Sala oberta en una altra pestanya')")
    await evaluate(tab, "document.querySelector('.room-restore-card .primary-action').click()")
    await waitFor(tab, lobby)
    await waitFor(second, "document.querySelector('.room-restore-card') !== null")
    assert.equal(latest.players.filter((player) => player.active).length, 2, 'two tabs never make two players')
    await evaluate(second, "document.querySelector('.room-restore-card .secondary-action').click()")
    await waitFor(second, "document.querySelector('.setup') !== null")
    assert.equal((await stored(second)).playerId, session.playerId, 'dismissing the replaced tab keeps the shared credentials')
    await command('browsingContext.close', { context: second })

    // One player per profile from the entry screen. A third tab takes over; the first goes to the entry screen and joins
    // the same room with another name typed: it resumes the existing player (no second seat, no rename).
    const setValue = (context, selector, value) => evaluate(context, `(() => { const input = document.querySelector('${selector}'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '${value}'); input.dispatchEvent(new Event('input', { bubbles: true })) })()`)
    const toEntry = async (context) => {
      await waitFor(context, "document.querySelector('.room-restore-card') !== null")
      await evaluate(context, "document.querySelector('.room-restore-card .secondary-action').click()")
      await waitFor(context, "document.querySelector('.setup') !== null")
    }
    const activeIn = () => latest.players.filter((player) => player.active).length
    const third = await newTab(profile)
    await navigate(third, '/multijugador/')
    await waitFor(third, lobby)
    await toEntry(tab)
    await setValue(tab, '.setup-name input', 'Un altre nom')
    await evaluate(tab, "document.querySelector('.entry-join-toggle').click()")
    await setValue(tab, '.room-code-input', session.roomCode)
    await evaluate(tab, "document.querySelector('.entry-join').requestSubmit()")
    await waitFor(tab, lobby)
    await waitFor(third, "document.querySelector('.room-restore-card') !== null")
    assert.equal((await stored(tab)).playerId, session.playerId, 'same player resumed')
    await until(() => connectedPlayers() === 2 && activeIn() === 2, 'still two players')
    assert.equal(latest.players.find((player) => player.id === session.playerId).name, 'Reconnexió', 'the typed name does not rename the player')

    // Creating a room from the replaced tab asks first; cancelling keeps the seat, confirming gives it up.
    await toEntry(third)
    await evaluate(third, "document.querySelector('.entry-create').requestSubmit()")
    await waitFor(third, `document.querySelector('.exit-confirmation-dialog[open]')?.innerText.includes('Vols sortir de la sala ${session.roomCode}?')`)
    assert.equal(await evaluate(third, 'document.activeElement.textContent'), 'Cancel·la', 'focus starts on cancel')
    await evaluate(third, "document.querySelector('.exit-confirmation-dialog .secondary-action').click()")
    await waitFor(third, "document.querySelector('.exit-confirmation-dialog') === null && document.querySelector('.setup') !== null")
    assert.equal((await stored(third)).playerId, session.playerId, 'cancelling keeps the credentials')
    assert.equal(await evaluate(tab, lobby), true); assert.equal(activeIn(), 2, 'cancelling keeps the seat')
    await evaluate(third, "document.querySelector('.entry-create').requestSubmit()")
    await waitFor(third, "document.querySelector('.exit-confirmation-dialog[open]') !== null")
    await evaluate(third, "document.querySelector('.exit-confirmation-dialog .danger-action').click()")
    await waitFor(third, lobby)
    const newRoom = await stored(third)
    assert.notEqual(newRoom.roomCode, session.roomCode)
    // The older tab is told the seat was left, not that it is open elsewhere; it may continue in the new room.
    await waitFor(tab, `document.querySelector('.room-restore-card')?.innerText.includes('Ara jugues en una altra sala') && document.body.innerText.includes('sala ${newRoom.roomCode}')`)
    assert.equal(await evaluate(tab, "document.querySelectorAll('.room-restore-card button').length"), 2)
    assert.equal(await evaluate(tab, "document.body.innerText.includes('Sala oberta en una altra pestanya')"), false)
    await until(() => activeIn() === 1, 'the old seat was given up')
    // With no saved session left (another tab cleared it), the notice says so and offers only the multiplayer page.
    await evaluate(third, "localStorage.removeItem('hangman-room-session')")
    await waitFor(tab, "document.querySelector('.room-restore-card')?.innerText.includes('Has sortit de la sala') && document.querySelectorAll('.room-restore-card button').length === 1")
    assert.equal(await evaluate(tab, "document.querySelector('.room-restore-card button').textContent"), 'Vés al multijugador')
    await evaluate(third, `localStorage.setItem('hangman-room-session', ${JSON.stringify(JSON.stringify(newRoom))})`)
    await waitFor(tab, "document.querySelector('.room-restore-card')?.innerText.includes('Ara jugues en una altra sala')")

    // Joining a different room from the entry screen asks too, naming both rooms; confirming moves this profile there.
    await toEntry(tab)
    await evaluate(tab, "document.querySelector('.entry-join-toggle').click()")
    await setValue(tab, '.room-code-input', session.roomCode)
    await evaluate(tab, "document.querySelector('.entry-join').requestSubmit()")
    await waitFor(tab, `document.querySelector('.exit-confirmation-dialog[open]')?.innerText.includes("entraràs a la sala ${session.roomCode}")`)
    await evaluate(tab, "document.querySelector('.exit-confirmation-dialog .danger-action').click()")
    await waitFor(tab, lobby)
    await waitFor(third, "document.querySelector('.room-restore-card')?.innerText.includes('Ara jugues en una altra sala')")
    assert.equal((await stored(tab)).roomCode, session.roomCode)
    await until(() => activeIn() === 2, 'joined the old room as a new player')
    await command('browsingContext.close', { context: third })

    // Explicit leave clears the credentials; a refresh then shows the setup page instead of dragging the player back.
    await evaluate(tab, "document.querySelector('.global-back-button').click()")
    await waitFor(tab, "document.querySelector('.setup') !== null && localStorage.getItem('hangman-room-session') === null")
    await until(() => latest.players.filter((player) => player.active).length === 1, 'left the room')
    await navigate(tab, '/multijugador/')
    await waitFor(tab, "document.querySelector('.setup') !== null")
    assert.equal(await evaluate(tab, lobby), false)

    // A forged token for a live room is rejected and cleared; it never takes the guest's seat.
    const forged = { version: 1, roomCode: session.roomCode, playerId: joined.data.session.playerId, reconnectToken: 'forged' }
    await evaluate(tab, `localStorage.setItem('hangman-room-session', ${JSON.stringify(JSON.stringify(forged))})`)
    await navigate(tab, '/multijugador/')
    await waitFor(tab, "document.querySelector('.setup') !== null && localStorage.getItem('hangman-room-session') === null")
    await waitFor(tab, "document.body.innerText.includes(\"No s'ha pogut recuperar la partida\")")
    assert.equal(latest.players.find((player) => player.id === joined.data.session.playerId)?.connectionState, 'connected')

    // Malformed and outdated-format credentials are ignored without a reconnecting flash or a page error.
    for (const raw of ['{', JSON.stringify({ ...joined.data.session, version: 0 })]) {
      await evaluate(tab, `localStorage.setItem('hangman-room-session', ${JSON.stringify(raw)})`)
      await navigate(tab, '/')
      await waitFor(tab, "document.querySelector('.home-modes') !== null")
      assert.equal(await evaluate(tab, "document.querySelector('.room-restore-card') === null"), true)
    }

    // A session saved by the previous version (sessionStorage, unversioned) moves to localStorage and restores the seat.
    const legacyGuest = io(origin, { transports: ['websocket'], forceNew: true })
    await new Promise((resolve) => legacyGuest.once('connect', resolve))
    const legacy = await new Promise((resolve) => legacyGuest.emit('room:join', { name: 'Antic', code: session.roomCode }, resolve))
    legacyGuest.disconnect()
    await until(() => latest.players.find((player) => player.id === legacy.data.session.playerId)?.connectionState === 'reconnecting', 'legacy player dropped')
    await evaluate(tab, `localStorage.removeItem('hangman-room-session'); sessionStorage.setItem('hangman-room-session', ${JSON.stringify(JSON.stringify(legacy.data.session))})`)
    await navigate(tab, '/multijugador/')
    await waitFor(tab, lobby)
    assert.equal(await evaluate(tab, "sessionStorage.getItem('hangman-room-session')"), null, 'legacy entry removed')
    assert.equal((await stored(tab)).playerId, legacy.data.session.playerId)
    await until(() => latest.players.find((player) => player.id === legacy.data.session.playerId)?.connectionState === 'connected', 'legacy seat restored')
    await evaluate(tab, "document.querySelector('.global-back-button').click()")
    await waitFor(tab, "localStorage.getItem('hangman-room-session') === null && sessionStorage.getItem('hangman-room-session') === null")
    await command('browsingContext.close', { context: tab })
  } finally {
    guest.disconnect()
    await command('browser.removeUserContext', { userContext: profile }).catch(() => {})
  }
  console.log('Reconnect passed: refresh, closed and reopened tab, two tabs, one seat per profile from the entry screen, explicit leave, forged/malformed credentials, legacy session migration.')
}
