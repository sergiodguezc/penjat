import assert from 'node:assert/strict'

// QA-01: browser Back/Forward follow the same exit guard as header links. A guarded move is undone while the dialog is
// open, so the dialog stays with the game it protects: Cancel keeps playing, Confirm performs the move.
export async function checkHistoryGuard({ context, command, evaluate, waitFor, navigate }) {
  const dialogOpen = "document.querySelector('.exit-confirmation-dialog[open]') !== null"
  const traverse = async (delta) => {
    try { await command('browsingContext.traverseHistory', { context, delta }) }
    catch (error) {
      // Firefox 158 can time out when the exit guard immediately undoes the requested history move.
      if (!error.message.includes('History was not updated for index') || !await evaluate(context, dialogOpen)) throw error
    }
  }
  const back = () => traverse(-1)
  const forward = () => traverse(1)
  const noDialog = "document.querySelector('.exit-confirmation-dialog') === null"
  const guessed = "document.querySelectorAll('.keyboard button:disabled').length"
  const cancel = () => evaluate(context, "document.querySelector('.exit-confirmation-dialog .secondary-action').click()")
  const confirm = () => evaluate(context, "document.querySelector('.exit-confirmation-dialog .danger-action').click()")
  const openUnit = async () => {
    await waitFor(context, "document.querySelector('.unit-card .primary-action') !== null")
    await evaluate(context, "document.querySelector('.unit-card .primary-action').click()")
    await waitFor(context, "document.querySelector('.learning-game .keyboard') !== null")
  }
  // The dialog and the page it guards stay together: same URL, same game, same guesses.
  const expectGuarded = async (path, game, title) => {
    await waitFor(context, dialogOpen)
    await waitFor(context, `location.pathname === '${path}'`)
    assert.equal(await evaluate(context, `document.querySelector('${game}') !== null`), true, `${path} game stays mounted under the dialog`)
    assert.equal(await evaluate(context, "document.querySelector('#exit-confirmation-title').textContent"), title)
  }

  await command('browsingContext.setViewport', { context, viewport: { width: 1440, height: 900 } })
  await navigate(context, '/')
  await evaluate(context, "localStorage.setItem('hangman-interface-language', 'ca'); localStorage.setItem('hangman-name', 'Historial')")
  await navigate(context, '/')
  await waitFor(context, "document.querySelector('.home-modes') !== null")

  // Learning is never guarded: every guess is saved, so leaving mid-word and coming back restores the round.
  await evaluate(context, "localStorage.removeItem('penjat-learning'); localStorage.removeItem('penjat-daily-challenge')")
  await evaluate(context, "document.querySelector('.site-nav a[href=\"/aprendre\"]').click()")
  await openUnit()
  await evaluate(context, "document.querySelector('.keyboard button:not(:disabled)').click()")
  await waitFor(context, `${guessed} === 1`)
  await evaluate(context, "document.querySelector('.site-brand').click()")
  await waitFor(context, "location.pathname === '/' && document.querySelector('.home-modes') !== null")
  assert.equal(await evaluate(context, noDialog), true, 'Leaving a learning word asks nothing')
  await back()
  await waitFor(context, "location.pathname === '/aprendre/' && document.querySelector('.unit-list') !== null")
  assert.equal(await evaluate(context, "document.querySelector('.unit-card .primary-action').textContent"), 'Continua')
  await openUnit()
  assert.equal(await evaluate(context, guessed), 1, 'The unit reopens on the same word with its guesses')
  await evaluate(context, "document.querySelector('.site-nav a[href=\"/paraula-del-dia\"]').click()")
  await waitFor(context, "location.pathname === '/paraula-del-dia/' && document.querySelector('.daily-game') !== null")
  assert.equal(await evaluate(context, noDialog), true)

  // Daily: an unfinished challenge is guarded the same way; confirming leaves and the stored guess survives.
  await evaluate(context, "document.querySelector('.keyboard button:not(:disabled)').click()")
  await waitFor(context, `${guessed} === 1`)
  await back()
  await expectGuarded('/paraula-del-dia/', '.daily-game', 'Vols acabar la partida?')
  await cancel()
  await waitFor(context, noDialog)
  assert.equal(await evaluate(context, guessed), 1)
  await back()
  await waitFor(context, dialogOpen)
  await confirm()
  await waitFor(context, "location.pathname === '/aprendre/' && document.querySelector('.unit-list') !== null")
  await forward()
  await waitFor(context, `location.pathname === '/paraula-del-dia/' && ${guessed} === 1`)
  // Forward out of an active game is guarded as well (daily → help, Back, Forward).
  await evaluate(context, "document.querySelector('.site-nav a[href=\"/com-es-juga\"]').click()")
  await waitFor(context, dialogOpen)
  await confirm()
  await waitFor(context, "location.pathname === '/com-es-juga/'")
  await back()
  await waitFor(context, `location.pathname === '/paraula-del-dia/' && ${guessed} === 1`)
  await forward()
  await expectGuarded('/paraula-del-dia/', '.daily-game', 'Vols acabar la partida?')
  await cancel()
  await waitFor(context, noDialog)
  assert.equal(await evaluate(context, guessed), 1)
  await forward()
  await waitFor(context, dialogOpen)
  await confirm()
  await waitFor(context, "location.pathname === '/com-es-juga/'")
  await back()
  await waitFor(context, `location.pathname === '/paraula-del-dia/' && ${guessed} === 1`)
  await evaluate(context, "localStorage.removeItem('penjat-daily-challenge')")

  // Multiplayer: Back from a waiting room asks before leaving; Cancel keeps the room and its credentials.
  // (The restored daily game is still unfinished, so the header link asks first too.)
  await evaluate(context, "document.querySelector('.site-nav a[href=\"/multijugador\"]').click()")
  await waitFor(context, dialogOpen)
  await confirm()
  await waitFor(context, "document.querySelector('.setup-name input')?.value === 'Historial'")
  await evaluate(context, "document.querySelector('.entry-create .primary-action').click()")
  await waitFor(context, "document.querySelector('.lobby-page') !== null")
  const room = await evaluate(context, "localStorage.getItem('hangman-room-session')")
  assert.ok(room)
  await back()
  await expectGuarded('/multijugador/', '.lobby-page', 'Vols sortir de la sala?')
  await cancel()
  await waitFor(context, noDialog)
  assert.equal(await evaluate(context, "localStorage.getItem('hangman-room-session')"), room)
  // A header link's dialog replaced by Back still belongs to the room; Confirm leaves it for the Back destination.
  await evaluate(context, "document.querySelector('.site-nav a[href=\"/com-es-juga\"]').click()")
  await waitFor(context, dialogOpen)
  await back()
  await expectGuarded('/multijugador/', '.lobby-page', 'Vols sortir de la sala?')
  await confirm()
  await waitFor(context, "location.pathname === '/paraula-del-dia/' && localStorage.getItem('hangman-room-session') === null")
  assert.equal(await evaluate(context, noDialog), true)
  assert.equal(await evaluate(context, "document.querySelector('.lobby-page') === null"), true)
  await evaluate(context, "localStorage.removeItem('hangman-name'); localStorage.removeItem('penjat-daily-challenge'); localStorage.removeItem('penjat-learning')")
  console.log('History guard passed: learning leaves unguarded and resumes; Back/Forward with and without an open dialog in daily and a waiting room; Cancel keeps the game, Confirm navigates.')
}
