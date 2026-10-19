import assert from 'node:assert/strict'

// Phase 3B site header: desktop navigation, the phone menu disclosure and guarded navigation out of a room.
export async function checkSiteHeader({ context, command, evaluate, waitFor, navigate }) {
  const key = (value) => command('input.performActions', { context, actions: [{ type: 'key', id: 'keyboard', actions: [{ type: 'keyDown', value }, { type: 'keyUp', value }] }] })
  const click = (x, y) => command('input.performActions', { context, actions: [{ type: 'pointer', id: 'mouse', parameters: { pointerType: 'mouse' }, actions: [{ type: 'pointerMove', x: Math.round(x), y: Math.round(y) }, { type: 'pointerDown', button: 0 }, { type: 'pointerUp', button: 0 }] }] })
  const center = async (selector) => JSON.parse(await evaluate(context, `JSON.stringify((r => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 }))(document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect()))`))
  const state = () => evaluate(context, "JSON.stringify({ expanded: document.querySelector('.site-menu-toggle').getAttribute('aria-expanded'), hidden: document.querySelector('.site-menu').hidden, focus: document.activeElement.className })").then(JSON.parse)
  const viewport = (width, height) => command('browsingContext.setViewport', { context, viewport: { width, height } })

  for (const language of ['ca', 'es']) {
    await viewport(390, 844)
    await navigate(context, '/')
    await evaluate(context, `localStorage.setItem('hangman-interface-language', '${language}')`)
    await navigate(context, '/')
    await waitFor(context, "document.querySelector('.home-modes') !== null")
    assert.equal(await evaluate(context, "getComputedStyle(document.querySelector('.site-nav')).display"), 'none', 'Phone hides the inline navigation')
    assert.deepEqual(await state(), { expanded: 'false', hidden: true, focus: '' })
    assert.equal(await evaluate(context, "document.querySelector('.site-menu-toggle').getAttribute('aria-label')"), language === 'ca' ? 'Obre el menú' : 'Abrir el menú')

    // Keyboard: the toggle opens the disclosure in place, focus stays on it and Tab continues into the menu.
    await evaluate(context, "document.querySelector('.site-menu-toggle').focus()")
    await key('')
    assert.deepEqual(await state(), { expanded: 'true', hidden: false, focus: 'site-menu-toggle' })
    assert.equal(await evaluate(context, "document.querySelector('.site-menu-toggle').getAttribute('aria-label')"), language === 'ca' ? 'Tanca el menú' : 'Cerrar el menú')
    const menu = JSON.parse(await evaluate(context, "JSON.stringify({ bottom: document.querySelector('.site-menu').getBoundingClientRect().bottom, overflow: document.documentElement.scrollWidth > innerWidth, links: [...document.querySelectorAll('.site-menu-list a')].map((a) => [a.getAttribute('href'), a.textContent, a.getAttribute('aria-current'), a.getBoundingClientRect().height]) })"))
    assert.ok(menu.bottom <= 844 * .6, `Menu uses ${menu.bottom}px of the viewport`)
    assert.equal(menu.overflow, false)
    assert.deepEqual(menu.links.map(([href]) => href), ['/', '/multijugador', '/aprendre', '/paraula-del-dia', '/com-es-juga'])
    assert.deepEqual(menu.links.map(([, text]) => text), language === 'ca' ? ['Inici', 'Multijugador', 'Aprèn vocabulari', 'Paraula del dia', 'Com es juga'] : ['Inicio', 'Multijugador', 'Aprende vocabulario', 'Palabra del día', 'Cómo se juega'])
    assert.equal(menu.links[0][2], 'page')
    assert.ok(menu.links.every(([, , , height]) => height >= 44))
    await key('')
    assert.equal(await evaluate(context, 'document.activeElement.getAttribute("href")'), '/')
    // Escape closes and returns focus to the toggle.
    await key('')
    assert.deepEqual(await state(), { expanded: 'false', hidden: true, focus: 'site-menu-toggle' })

    // Pointer: a click outside the header closes it without activating what lies beneath.
    const toggle = await center('.site-menu-toggle')
    await click(toggle.x, toggle.y)
    assert.equal((await state()).expanded, 'true')
    // A non-interactive spot below the open menu: the hero illustration's letter row (Phase 3C moved the mode cards up to y≈820).
    const outside = JSON.parse(await evaluate(context, "JSON.stringify({ y: (r => r.y + r.height / 2)(document.querySelector('.preview-word').getBoundingClientRect()), menu: document.querySelector('.site-menu').getBoundingClientRect().bottom })"))
    assert.ok(outside.y > outside.menu + 8, 'Outside-click target lies below the open menu')
    await click(30, outside.y)
    assert.equal((await state()).expanded, 'false')
    assert.equal(await evaluate(context, 'location.pathname'), '/')

    // Navigation closes the menu and lands on the chosen page with its link marked current.
    await click(toggle.x, toggle.y)
    const daily = await center('.site-menu-list a[href="/paraula-del-dia"]')
    await click(daily.x, daily.y)
    await waitFor(context, "location.pathname === '/paraula-del-dia/' && document.querySelector('.daily-game') !== null")
    assert.deepEqual(await state(), { expanded: 'false', hidden: true, focus: '' })
    assert.equal(await evaluate(context, "document.querySelector('.site-menu-list a[aria-current=page]').getAttribute('href')"), '/paraula-del-dia')

    // The CA/ES pill stays in the header, so the open menu does not repeat it; switching from the header keeps the menu
    // open and relabels it.
    await click(toggle.x, toggle.y)
    assert.equal(await evaluate(context, "getComputedStyle(document.querySelector('.site-menu-language')).display"), 'none', 'Language offered once on phones')
    const other = language === 'ca' ? 'es' : 'ca'
    const pill = (code) => `[...document.querySelectorAll('.site-actions > .interface-language-toggle button')].find((button) => button.textContent.trim() === '${code}').click()`
    await evaluate(context, pill(other.toUpperCase()))
    await waitFor(context, `document.documentElement.lang === '${other}'`)
    assert.equal((await state()).expanded, 'true')
    assert.equal(await evaluate(context, "document.querySelector('.interface-language-toggle button.active').textContent"), other.toUpperCase())
    await evaluate(context, pill(language.toUpperCase()))

    // Growing into the desktop layout closes the menu; the inline navigation marks the current page.
    await viewport(1440, 900)
    await waitFor(context, "document.querySelector('.site-menu-toggle').getAttribute('aria-expanded') === 'false'")
    assert.equal(await evaluate(context, "getComputedStyle(document.querySelector('.site-menu-toggle')).display"), 'none')
    assert.equal(await evaluate(context, "document.querySelector('.site-nav a[aria-current=page]').getAttribute('href')"), '/paraula-del-dia')
    assert.equal(await evaluate(context, "getComputedStyle(document.querySelector('.site-header')).position"), 'relative', 'Gameplay pages do not pin the header')
    await navigate(context, '/com-es-juga')
    await waitFor(context, "document.querySelector('.howto-card') !== null")
    assert.equal(await evaluate(context, "getComputedStyle(document.querySelector('.site-header')).position"), 'sticky', 'Desktop content pages keep the header in reach')
  }

  // A room is never left silently: header links ask first, cancelling keeps the room, confirming leaves it.
  await viewport(390, 844)
  await navigate(context, '/multijugador')
  await evaluate(context, "localStorage.setItem('hangman-interface-language', 'ca'); localStorage.setItem('hangman-name', 'Capçalera')")
  await navigate(context, '/multijugador')
  await waitFor(context, "document.querySelector('.setup-name input')?.value === 'Capçalera'")
  // Phones show the two choices as an accordion: open "create", then create.
  await evaluate(context, "document.querySelector('.setup-panel--create .setup-toggle')?.click()")
  await evaluate(context, "document.querySelector('.setup-panel--create .primary-action').click()")
  await waitFor(context, "document.querySelector('.lobby-page') !== null")
  const room = await evaluate(context, "localStorage.getItem('hangman-room-session')")
  assert.ok(room)
  for (const width of [390, 320]) {
    await viewport(width, 568)
    assert.equal(await evaluate(context, 'document.documentElement.scrollWidth > innerWidth'), false, `Lobby header overflow at ${width}`)
    assert.equal(await evaluate(context, "document.querySelector('.global-back-button').getAttribute('aria-label')"), 'Surt de la sala')
  }
  // At 320px the exit takes the language switch's place; the language remains in the menu.
  assert.equal(await evaluate(context, "getComputedStyle(document.querySelector('.site-actions > .interface-language-toggle')).display"), 'none')
  await evaluate(context, "document.querySelector('.site-menu-toggle').click()")
  assert.equal(await evaluate(context, "getComputedStyle(document.querySelector('.site-menu-language')).display"), 'flex', 'The menu offers the language when the header cannot')
  await evaluate(context, "document.querySelector('.site-menu-list a[href=\"/com-es-juga\"]').click()")
  await waitFor(context, "document.querySelector('.exit-confirmation-dialog[open]') !== null")
  assert.equal(await evaluate(context, "document.querySelector('#exit-confirmation-title').textContent"), 'Vols sortir de la sala?')
  await evaluate(context, "document.querySelector('.exit-confirmation-dialog .secondary-action').click()")
  await waitFor(context, "document.querySelector('.exit-confirmation-dialog') === null")
  assert.equal(await evaluate(context, "location.pathname"), '/multijugador/')
  assert.equal(await evaluate(context, "localStorage.getItem('hangman-room-session')"), room)
  assert.ok(await evaluate(context, "document.querySelector('.lobby-page') !== null"))
  await evaluate(context, "document.querySelector('.site-brand').click()")
  await waitFor(context, "document.querySelector('.exit-confirmation-dialog[open]') !== null")
  await evaluate(context, "document.querySelector('.exit-confirmation-dialog .danger-action').click()")
  await waitFor(context, "location.pathname === '/' && document.querySelector('.home-modes') !== null && localStorage.getItem('hangman-room-session') === null")
  // Leave the shared profile as found: later checks rely on an isolated, nameless profile.
  await evaluate(context, "localStorage.removeItem('hangman-name')")
  console.log('Site header passed in CA/ES: phone menu keyboard/Escape/outside click/navigation/language/resize, current page, sticky scope, 320px room header and guarded room exit.')
}
