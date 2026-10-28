import assert from 'node:assert/strict'

// Observe real transports before the app loads; no production test hooks or extra dependencies.
export async function checkSocketLifecycle({ command, evaluate, waitFor, navigate, newTab }) {
  const profile = (await command('browser.createUserContext')).userContext
  let tab = await newTab(profile)
  const { script } = await command('script.addPreloadScript', { functionDeclaration: `() => {
    const audit = window.__socketAudit = { attempts: 0, open: 0 }
    const NativeSocket = window.WebSocket
    window.WebSocket = class extends NativeSocket {
      constructor(...args) {
        super(...args)
        if (!String(args[0]).includes('/socket.io/')) return
        audit.attempts++
        this.addEventListener('open', () => { audit.open++ })
        this.addEventListener('close', () => { if (this.readyState === 3) audit.open = Math.max(0, audit.open - 1) })
      }
    }
    const open = XMLHttpRequest.prototype.open
    XMLHttpRequest.prototype.open = function(method, url, ...rest) {
      if (String(url).includes('/socket.io/')) audit.attempts++
      return open.call(this, method, url, ...rest)
    }
  }` })
  const pause = () => new Promise((resolve) => setTimeout(resolve, 250))
  const offline = async (context, noAttempts = false) => {
    await waitFor(context, 'window.__socketAudit.open === 0')
    const attempts = await evaluate(context, 'window.__socketAudit.attempts')
    await evaluate(context, "window.dispatchEvent(new Event('online')); window.dispatchEvent(new Event('pageshow')); document.dispatchEvent(new Event('visibilitychange'))")
    await pause()
    assert.equal(await evaluate(context, 'window.__socketAudit.attempts'), attempts, 'wake events cannot reconnect a public page')
    if (noAttempts) assert.equal(attempts, 0, 'public route never attempted a Socket.IO transport')
  }
  const online = (context) => waitFor(context, 'window.__socketAudit.open === 1')
  const click = (context, selector) => evaluate(context, `document.querySelector(${JSON.stringify(selector)}).click()`)
  try {
    for (const path of ['/', '/paraula-del-dia/', '/aprendre/', '/com-es-juga/', '/missing-page/']) {
      await navigate(tab, path)
      await waitFor(tab, "document.querySelector('main') !== null")
      await offline(tab, true)
    }
    await navigate(tab, '/')
    await evaluate(tab, "localStorage.setItem('hangman-name', 'Connexió')")
    await navigate(tab, '/')
    await click(tab, '.home-modes .primary-action')
    await waitFor(tab, "document.querySelector('.setup') !== null")
    await online(tab)
    const attempts = await evaluate(tab, 'window.__socketAudit.attempts')
    await evaluate(tab, "window.dispatchEvent(new Event('online')); document.dispatchEvent(new Event('visibilitychange'))")
    await pause()
    assert.equal(await evaluate(tab, 'window.__socketAudit.attempts'), attempts, 'wake events keep the existing transport')
    await command('browsingContext.traverseHistory', { context: tab, delta: -1 })
    await waitFor(tab, "location.pathname === '/'")
    await offline(tab)
    await command('browsingContext.traverseHistory', { context: tab, delta: 1 })
    await waitFor(tab, "document.querySelector('.setup') !== null")
    await online(tab)
    await click(tab, '.site-brand')
    await waitFor(tab, "location.pathname === '/'")
    await offline(tab)

    await click(tab, '.home-modes .primary-action')
    await online(tab)
    await evaluate(tab, "document.querySelector('.entry-create').requestSubmit()")
    await waitFor(tab, "document.querySelector('.lobby-page') !== null")
    const session = await evaluate(tab, "localStorage.getItem('hangman-room-session')")
    await navigate(tab, '/aprendre/')
    await waitFor(tab, "document.querySelector('.lobby-page') !== null")
    await online(tab)
    assert.equal(await evaluate(tab, "localStorage.getItem('hangman-room-session')"), session, 'refresh on a public route restores the same seat')
    await command('browsingContext.close', { context: tab })
    tab = await newTab(profile)
    await navigate(tab, '/')
    await waitFor(tab, "document.querySelector('.lobby-page') !== null")
    await online(tab)
    assert.equal(await evaluate(tab, "localStorage.getItem('hangman-room-session')"), session, 'reopening restores saved credentials')
    const second = await newTab(profile)
    await navigate(second, '/')
    await waitFor(second, "document.querySelector('.lobby-page') !== null")
    await online(second)
    await waitFor(tab, "document.querySelector('.room-restore-card') !== null")
    await offline(tab)
    assert.equal(await evaluate(second, "localStorage.getItem('hangman-room-session')"), session, 'takeover keeps the same seat')
    await click(tab, '.room-restore-card .primary-action')
    await waitFor(tab, "document.querySelector('.lobby-page') !== null")
    await online(tab)
    await waitFor(second, "document.querySelector('.room-restore-card') !== null")
    await offline(second)
    await command('browsingContext.close', { context: second })
    await click(tab, '.site-nav a[href="/aprendre"]')
    await waitFor(tab, "document.querySelector('.exit-confirmation-dialog[open]') !== null")
    await click(tab, '.exit-confirmation-dialog .danger-action')
    await waitFor(tab, "document.querySelector('.unit-list') !== null")
    await offline(tab)
    assert.equal(await evaluate(tab, "localStorage.getItem('hangman-room-session')"), null)

    // Missing rooms and forged credentials are definitive failures: one attempt, then no background reconnects.
    for (const saved of [session, JSON.stringify({ ...JSON.parse(session), reconnectToken: 'forged' })]) {
      await evaluate(tab, `localStorage.setItem('hangman-room-session', ${JSON.stringify(saved)})`)
      await navigate(tab, '/')
      await waitFor(tab, "document.querySelector('.home-modes') !== null && localStorage.getItem('hangman-room-session') === null")
      await offline(tab)
    }
    // A failed handshake retains credentials and the existing retry/exit UI; leaving stops the retry loop.
    const { script: blocked } = await command('script.addPreloadScript', { contexts: [tab], functionDeclaration: `() => {
      const open = XMLHttpRequest.prototype.open
      XMLHttpRequest.prototype.open = function(method, url, ...rest) { return open.call(this, method, String(url).includes('/socket.io/') ? 'http://127.0.0.1:9/' : url, ...rest) }
    }` })
    await evaluate(tab, `localStorage.setItem('hangman-room-session', ${JSON.stringify(session)})`)
    await navigate(tab, '/')
    await waitFor(tab, "document.querySelector('.room-restore-card .primary-action') !== null")
    assert.equal(await evaluate(tab, "localStorage.getItem('hangman-room-session')"), session, 'transport failures keep credentials')
    await click(tab, '.site-nav a[href="/aprendre"]')
    await waitFor(tab, "document.querySelector('.exit-confirmation-dialog[open]') !== null")
    await click(tab, '.exit-confirmation-dialog .danger-action')
    await waitFor(tab, "document.querySelector('.unit-list') !== null")
    await offline(tab)
    await command('script.removePreloadScript', { script: blocked })
    console.log('Lazy sockets passed: public routes/wake events, multiplayer, Back/Forward, entry exit, creation, saved-session refresh/reopen, tab takeover/reclaim, confirmed room exit, stale sessions and failed-handshake exit.')
  } finally {
    await command('script.removePreloadScript', { script })
    await command('browser.removeUserContext', { userContext: profile }).catch(() => {})
  }
}
