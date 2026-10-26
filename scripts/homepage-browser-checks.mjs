import assert from 'node:assert/strict'

export const homeMetrics = `JSON.stringify((() => {
  const box = (selector) => {
    const el = document.querySelector(selector), r = el.getBoundingClientRect(), s = getComputedStyle(el)
    return { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom, fontSize: parseFloat(s.fontSize), lineHeight: parseFloat(s.lineHeight) }
  }
  return {
    viewport: [innerWidth, innerHeight], clientWidth: document.documentElement.clientWidth, overflow: document.documentElement.scrollWidth > innerWidth,
    h1: box('h1'), primary: box('.home-modes .primary-action'), secondary: box('.home-modes .secondary-action'),
    // Row alignment uses the untransformed list items: Phase 3B's hover lift moves a hovered action by up to 1px.
    primaryItem: box('.home-modes li:has(> .primary-action)'), secondaryItem: box('.home-modes li:has(> .secondary-action)'),
    daily: box('.daily-entry'), separator: box('.mode-daily'), shell: box('.home-shell'), header: box('.site-header'),
    card: box('.home-preview'), slots: box('.preview-word'), drawing: box('.preview-drawing'), caption: box('.mode-caption'), dailyTitle: box('.daily-title'),
    reminder: document.querySelector('.daily-entry .daily-tomorrow') ? box('.daily-entry .daily-tomorrow') : null,
    ios: !!document.querySelector('.ios-install-card'),
    headings: [...document.querySelectorAll('h1')].map(el => el.textContent),
    canonical: document.querySelector('link[rel=canonical]').href, title: document.title,
    description: document.querySelector('meta[name=description]').content,
    // Phones (≤599px) swap .home-modes for the Phase 3C hero actions; exactly one of the two navigations is rendered.
    modesShown: getComputedStyle(document.querySelector('.home-modes')).display !== 'none', quickShown: getComputedStyle(document.querySelector('.home-quick')).display !== 'none',
    lede: box('.home-lede'), play: box('.quick-play'), playLabel: box('.quick-play-label'), learn: box('.quick-card--learn'), dailyCard: box('.quick-card--daily'), cardLabel: box('.quick-card-label'),
    links: [...document.querySelectorAll('.home-modes a, .home-quick a')].filter(el => el.getClientRects().length).map(el => ({ href: el.getAttribute('href'), height: el.getBoundingClientRect().height }))
  }
})())`

export function checkHomeLayout(m, size = 's0') {
  const [width] = m.viewport
  assert.equal(m.overflow, false, `Overflow at ${width}`)
  assert.equal(m.headings.length, 1)
  assert.equal(m.canonical, 'https://penjat.cat/')
  assert.deepEqual(m.links.map(link => link.href), ['/multijugador', '/aprendre', '/paraula-del-dia'])
  assert.ok(m.links.every(link => link.height >= 48))
  // Phase 3B adopts Lovable's display headline, capped at 4.75rem (76px).
  assert.ok(m.h1.fontSize <= 76)
  // The compact phone header and the full desktop header both stay well under a tenth of a tall viewport.
  assert.ok(m.header.height <= (width >= 661 ? 66 : 58), `Header height ${m.header.height}`)
  if (width <= 599) checkPhoneHero(m)
  else checkWideHero(m, size)
  // Phones keep a compact two-line maximum; wider layouts allow Lovable's three-line display headline.
  if (width >= 390) assert.ok(Math.round(m.h1.height / m.h1.lineHeight) <= (width < 600 ? 2 : 3), `Headline at ${width}`)
}

// Phase 3C phone hero: headline → centred character → one dominant full-width "Jugar" → two equal, smaller cards.
function checkPhoneHero(m) {
  const [width, height] = m.viewport
  assert.deepEqual([m.modesShown, m.quickShown], [false, true], `Phone hero navigation at ${width}`)
  const near = (a, b, tolerance = 1) => Math.abs(a - b) <= tolerance
  assert.ok(m.h1.bottom <= m.lede.y && m.lede.bottom <= m.card.y && m.slots.bottom <= m.play.y && m.play.bottom < m.learn.y, 'Title → description → illustration → Jugar → cards')
  assert.ok(near(m.drawing.x + m.drawing.width / 2, m.shell.x + m.shell.width / 2, 2), 'Illustration centred')
  assert.ok(near(m.play.x, m.shell.x) && near(m.play.width, m.shell.width), `Jugar spans the content width at ${width}`)
  assert.ok(m.play.height >= 100 && m.play.height <= 112, `Jugar height ${m.play.height}`)
  assert.ok(near(m.learn.width, m.dailyCard.width, .5) && near(m.learn.height, m.dailyCard.height, .5), 'Secondary cards share one size')
  if (width >= 320) {
    assert.ok(near(m.learn.y, m.dailyCard.y, .5) && m.dailyCard.x > m.learn.x + m.learn.width, `Secondary cards side by side at ${width}`)
    assert.ok(m.learn.height >= 64 && m.learn.height <= 76, `Secondary card height ${m.learn.height}`)
  }
  assert.ok(m.play.height >= 1.35 * m.learn.height && m.playLabel.fontSize >= 1.5 * m.cardLabel.fontSize, 'Jugar dominates the secondary cards')
  // From 375×812 the whole hero, both secondary cards included, is in the first viewport; 320×568 scrolls naturally.
  if (width >= 375 && height >= 812) assert.ok(m.dailyCard.bottom <= height, `Secondary actions below the fold at ${width}×${height}`)
}

function checkWideHero(m, size) {
  const [width, height] = m.viewport
  assert.deepEqual([m.modesShown, m.quickShown], [true, false])
  // Semantic scale: metadata is 14px below 1200px and 16px on spacious desktops; the daily title and CTAs step up there too.
  const spacious = width >= 1200
  assert.equal(m.caption.fontSize, spacious ? 16 : 14)
  if (m.reminder) assert.equal(m.reminder.fontSize, spacious ? 16 : 14)
  assert.equal(m.dailyTitle.fontSize, spacious ? 20 : 18)
  // A 2px outline: 17px × 1.2 line-height + padding + borders = 48.4px.
  const expectedHeight = spacious || (size === 's1' && width >= 600) ? 52 : 48
  assert.ok(m.primary.height >= expectedHeight && m.primary.height <= expectedHeight + 1, `Primary height ${m.primary.height}`)
  if (height >= 568) assert.ok(m.primary.bottom <= height, `Primary below fold at ${width}×${height}`)
  assert.equal(m.primaryItem.y, m.secondaryItem.y)
  assert.ok(m.secondaryItem.x > m.primaryItem.x)
  assert.ok(m.drawing.y >= m.card.y + 16, 'Drawing remains inside the card padding')
  assert.ok(m.slots.bottom <= m.card.bottom - 16, 'Letter slots remain inside the card padding')
  if (width < 1000) {
    // Stacked hero: the preview follows the actions and the daily entry, centred in the content column.
    assert.ok(m.card.y > m.daily.bottom)
    assert.ok(Math.abs((m.card.x + m.card.width / 2) - (m.shell.x + m.shell.width / 2)) <= 2, 'Preview centred')
    assert.ok(m.separator.width <= m.shell.width)
  } else assert.ok(m.card.x > m.primary.x + m.primary.width)
}

export async function checkHomeNavigation({ context, command, evaluate, waitFor, navigate }) {
  await navigate(context, '/')
  await waitFor(context, "document.querySelector('.home-modes') !== null")
  await evaluate(context, 'window.homeNavigationSentinel = 42')
  const head = await evaluate(context, "JSON.stringify([document.title, document.querySelector('meta[name=description]').content, document.querySelector('link[rel=canonical]').href])")
  // Observe React's cancellation before canceling the native default in this synthetic probe.
  // Actual Ctrl/middle clicks are exercised separately below using BiDi input.
  for (const href of ['/multijugador', '/aprendre', '/paraula-del-dia', '/com-es-juga']) {
    for (const modifiers of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) {
      const prevented = await evaluate(context, `(() => {
        let prevented
        const observe = event => { prevented = event.defaultPrevented; event.preventDefault() }
        document.addEventListener('click', observe, { once: true })
        document.querySelector('a[href="${href}"]').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...${JSON.stringify(modifiers)} }))
        return prevented
      })()`)
      assert.equal(prevented, false, `${href} modified click`)
    }
    await evaluate(context, `document.querySelector('a[href="${href}"]').click()`)
    await waitFor(context, `location.pathname === '${href}/'`)
    assert.equal(await evaluate(context, 'window.homeNavigationSentinel'), 42, 'Ordinary click must not reload')
    await command('browsingContext.traverseHistory', { context, delta: -1 })
    await waitFor(context, "location.pathname === '/' && document.querySelector('.home-modes') !== null")
    await command('browsingContext.traverseHistory', { context, delta: 1 })
    await waitFor(context, `location.pathname === '${href}/'`)
    await command('browsingContext.traverseHistory', { context, delta: -1 })
    await waitFor(context, "location.pathname === '/' && document.querySelector('.home-modes') !== null")
    assert.equal(await evaluate(context, 'window.homeNavigationSentinel'), 42)
  }
  assert.equal(await evaluate(context, "JSON.stringify([document.title, document.querySelector('meta[name=description]').content, document.querySelector('link[rel=canonical]').href])"), head, 'Homepage metadata restored after history navigation')
  // Real keyboard navigation: skip link, brand, the four header sections, both interface languages, then the page's mode links.
  await command('browsingContext.setViewport', { context, viewport: { width: 1024, height: 768 } })
  await navigate(context, '/')
  await waitFor(context, "document.querySelector('.home-modes') !== null")
  const tab = () => command('input.performActions', { context, actions: [{ type: 'key', id: 'keyboard', actions: [{ type: 'keyDown', value: '\uE004' }, { type: 'keyUp', value: '\uE004' }] }] })
  for (const href of ['#contingut', '/', '/multijugador', '/aprendre', '/paraula-del-dia', '/com-es-juga']) {
    await tab()
    assert.equal(await evaluate(context, 'document.activeElement.getAttribute("href")'), href)
    assert.equal(await evaluate(context, 'document.activeElement.matches(":focus-visible")'), true)
  }
  for (const code of ['CA', 'ES']) {
    await tab()
    assert.equal(await evaluate(context, 'document.activeElement.closest(".interface-language-toggle") !== null && document.activeElement.textContent'), code)
  }
  for (const href of ['/multijugador', '/aprendre', '/paraula-del-dia']) {
    await tab()
    assert.equal(await evaluate(context, 'document.activeElement.closest(".home-modes") !== null && document.activeElement.getAttribute("href")'), href)
    assert.equal(await evaluate(context, 'document.activeElement.matches(":focus-visible")'), true)
  }
  await command('input.performActions', { context, actions: [{ type: 'key', id: 'keyboard', actions: [{ type: 'keyDown', value: '\uE007' }, { type: 'keyUp', value: '\uE007' }] }] })
  await waitFor(context, "location.pathname === '/paraula-del-dia/'")
  // The skip link moves focus to the page content without changing the URL.
  await navigate(context, '/')
  await waitFor(context, "document.querySelector('.home-modes') !== null")
  await tab()
  await command('input.performActions', { context, actions: [{ type: 'key', id: 'keyboard', actions: [{ type: 'keyDown', value: '\uE007' }, { type: 'keyUp', value: '\uE007' }] }] })
  assert.equal(await evaluate(context, "document.activeElement === document.querySelector('main') && location.pathname + location.hash"), '/')
  for (const button of [0, 1]) {
    await navigate(context, '/')
    await waitFor(context, "document.querySelector('.home-modes') !== null")
    const before = new Set((await command('browsingContext.getTree')).contexts.map(item => item.context))
    const point = JSON.parse(await evaluate(context, "JSON.stringify((r => ({ x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }))(document.querySelector('.home-modes .primary-action').getBoundingClientRect()))"))
    if (button === 0) await command('input.performActions', { context, actions: [{ type: 'key', id: 'keyboard', actions: [{ type: 'keyDown', value: '\uE009' }] }] })
    await command('input.performActions', { context, actions: [{ type: 'pointer', id: 'mouse', parameters: { pointerType: 'mouse' }, actions: [{ type: 'pointerMove', ...point }, { type: 'pointerDown', button }, { type: 'pointerUp', button }] }] })
    await command('input.releaseActions', { context })
    let opened
    for (let i = 0; i < 50 && !opened; i++) {
      opened = (await command('browsingContext.getTree')).contexts.find(item => !before.has(item.context))
      if (!opened) await new Promise(resolve => setTimeout(resolve, 50))
    }
    assert.ok(opened, `${button === 0 ? 'Ctrl' : 'Middle'} click opens a tab`)
    try {
      await waitFor(opened.context, "location.pathname === '/multijugador/' && document.querySelector('.setup') !== null")
      assert.equal(await evaluate(context, 'location.pathname'), '/')
    } finally { await command('browsingContext.close', { context: opened.context }) }
  }
  // Phase 3C phone hero: after the header's menu button, Tab reaches Jugar and the two cards in order with a visible ring,
  // Enter follows a card, and a click anywhere on the Jugar surface (here near its right edge) opens multiplayer.
  await command('browsingContext.setViewport', { context, viewport: { width: 390, height: 844 } })
  for (const target of ['keyboard', 'pointer']) {
    await navigate(context, '/')
    await waitFor(context, "document.querySelector('.home-quick a') !== null")
    if (target === 'keyboard') {
      await evaluate(context, "document.querySelector('.site-menu-toggle').focus()")
      for (const href of ['/multijugador', '/aprendre', '/paraula-del-dia']) {
        await tab()
        assert.equal(await evaluate(context, 'document.activeElement.closest(".home-quick") !== null && document.activeElement.getAttribute("href")'), href)
        assert.equal(await evaluate(context, 'document.activeElement.matches(":focus-visible") && getComputedStyle(document.activeElement).outlineStyle'), 'solid')
      }
      await command('input.performActions', { context, actions: [{ type: 'key', id: 'keyboard', actions: [{ type: 'keyDown', value: '' }, { type: 'keyUp', value: '' }] }] })
      await waitFor(context, "location.pathname === '/paraula-del-dia/'")
    } else {
      await evaluate(context, 'window.homeNavigationSentinel = 42')
      const point = JSON.parse(await evaluate(context, "JSON.stringify((r => ({ x: Math.round(r.right - 12), y: Math.round(r.y + r.height / 2) }))(document.querySelector('.quick-play').getBoundingClientRect()))"))
      await command('input.performActions', { context, actions: [{ type: 'pointer', id: 'mouse', parameters: { pointerType: 'mouse' }, actions: [{ type: 'pointerMove', ...point }, { type: 'pointerDown', button: 0 }, { type: 'pointerUp', button: 0 }] }] })
      await command('input.releaseActions', { context })
      await waitFor(context, "location.pathname === '/multijugador/' && document.querySelector('.setup') !== null")
      assert.equal(await evaluate(context, 'window.homeNavigationSentinel'), 42, 'Jugar routes inside the app')
    }
  }
  await command('browsingContext.setViewport', { context, viewport: { width: 1024, height: 768 } })
  console.log('Homepage navigation passed: semantic links, modifiers, Ctrl/middle new tabs, keyboard, SPA routing and back/forward metadata.')
}

// Multiplayer entry: one panel with one shared name, then Create, its hint and the secondary "join" action, which reveals
// the code and "Entra" in place (name kept, focus on the code). Same layout from 320px to desktop, no accordion.
export async function checkSetupEmphasis({ context, command, evaluate, waitFor, navigate }) {
  const key = (value) => command('input.performActions', { context, actions: [{ type: 'key', id: 'keyboard', actions: [{ type: 'keyDown', value }, { type: 'keyUp', value }] }] })
  const state = () => evaluate(context, `JSON.stringify((() => {
    const box = (sel) => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom, right: r.right } }
    return { overflow: document.documentElement.scrollWidth > innerWidth, panel: box('.setup'), name: box('.setup-name input'), create: box('.entry-create .primary-action'),
      hint: box('.setup-hint'), toggle: box('.entry-join-toggle'), code: box('.room-code-input'), enter: box('.entry-join .secondary-action'), inputs: document.querySelectorAll('.setup input').length }
  })())`).then(JSON.parse)
  const type = (selector, value) => evaluate(context, `(() => { const i = document.querySelector('${selector}'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, ${JSON.stringify(value)}); i.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
  const inside = (inner, outer) => inner.y >= outer.y && inner.bottom <= outer.bottom && inner.x >= outer.x && inner.right <= outer.right
  for (const language of ['ca', 'es']) {
    await navigate(context, '/')
    await evaluate(context, `localStorage.setItem('hangman-interface-language', '${language}'); localStorage.setItem('hangman-name', 'Desada')`)
    for (const [width, height] of [[1440, 900], [768, 1024], [390, 844], [320, 568]]) {
      await command('browsingContext.setViewport', { context, viewport: { width, height } })
      await navigate(context, '/multijugador/')
      await waitFor(context, "document.querySelector('.entry-join-toggle') !== null")
      let m = await state()
      assert.equal(m.overflow, false, `Entry overflow at ${width}`)
      assert.equal(m.inputs, 1, 'one shared name field')
      assert.equal(m.code, null, 'the code appears only after opening join')
      for (const theme of ['', 'spooky']) {
        await evaluate(context, `document.documentElement.dataset.season = '${theme}'`)
        assert.equal(await evaluate(context, `(() => {
          const copy = document.querySelector('.multiplayer-about'), link = copy.querySelector('a');
          return copy.getBoundingClientRect().top >= document.querySelector('.setup').getBoundingClientRect().bottom
            && copy.getBoundingClientRect().width <= innerWidth && getComputedStyle(copy).display !== 'none'
            && copy.innerText.includes('${language === 'ca' ? 'penjat multijugador online' : 'ahorcado online'}')
            && copy.innerText.includes('${language === 'ca' ? 'sense registrar-te' : 'sin registrarte'}')
            && link.getAttribute('href') === '/com-es-juga' && link.getBoundingClientRect().height >= 44;
        })()`), true, `visible localized copy and crawlable help link in ${theme || 'normal'} at ${width}`)
      }
      assert.ok(inside(m.name, m.panel) && inside(m.create, m.panel) && inside(m.toggle, m.panel) && m.name.height >= 44, `controls inside the panel at ${width}`)
      assert.ok(m.name.bottom < m.create.y && m.create.bottom <= m.hint.y && m.hint.bottom <= m.toggle.y, `name, Create, hint, join in order at ${width}`)
      if (width >= 390) assert.ok(m.toggle.bottom <= height, `both actions in the first screen at ${width}`)
      await evaluate(context, "document.querySelector('.entry-join-toggle').click()")
      await waitFor(context, "document.activeElement === document.querySelector('.room-code-input')")
      m = await state()
      assert.equal(m.overflow, false, `Expanded overflow at ${width}`)
      assert.equal(await evaluate(context, "document.querySelector('.setup-name input').value"), 'Desada', 'name kept when joining')
      assert.ok(m.toggle === null && inside(m.code, m.panel) && inside(m.enter, m.panel) && Math.abs(m.code.y - m.enter.y) <= 2 && m.code.height >= 44, `code and Entra on one row inside the panel at ${width}`)
    }
    await evaluate(context, "document.querySelector('.multiplayer-about a').click()")
    await waitFor(context, "location.pathname === '/com-es-juga/' && document.querySelector('.howto-page') !== null")
    // Keyboard (desktop): name, Create, then the join action; Enter on it moves focus to the code.
    await command('browsingContext.setViewport', { context, viewport: { width: 1440, height: 900 } })
    await navigate(context, '/multijugador/')
    await waitFor(context, "document.querySelector('.entry-join-toggle') !== null")
    await evaluate(context, "document.querySelector('.setup-name input').focus()")
    await key('\uE004')
    assert.equal(await evaluate(context, "document.activeElement.matches('.entry-create .primary-action:focus-visible')"), true, 'Tab continues to Create')
    await key('\uE004')
    assert.equal(await evaluate(context, "document.activeElement.matches('.entry-join-toggle:focus-visible')"), true, 'then to join')
    await key('\uE007')
    await waitFor(context, "document.activeElement === document.querySelector('.room-code-input')")
    assert.equal(await evaluate(context, "document.querySelector('.setup .target-selector, .setup .language-selector')"), null, 'no match settings on the entry screen')
    // Validation explains itself: a name is needed for both actions, and the code has five characters.
    const t = language === 'ca' ? { name: 'Escriu el teu nom per continuar.', code: 'El codi de sala té 5 caràcters.' } : { name: 'Escribe tu nombre para continuar.', code: 'El código de sala tiene 5 caracteres.' }
    await type('.setup-name input', '')
    await type('.room-code-input', 'ABCDE')
    await evaluate(context, "document.querySelector('.entry-join').requestSubmit()")
    await waitFor(context, `document.querySelector('.setup .form-error')?.textContent === ${JSON.stringify(t.name)} && document.activeElement === document.querySelector('.setup-name input')`)
    await type('.setup-name input', 'Tester')
    await type('.room-code-input', 'ABC')
    await evaluate(context, "document.querySelector('.entry-join').requestSubmit()")
    await waitFor(context, `document.querySelector('.setup .form-error')?.textContent === ${JSON.stringify(t.code)} && document.activeElement === document.querySelector('.room-code-input')`)
    await type('.setup-name input', '')
    await evaluate(context, "document.querySelector('.entry-create').requestSubmit()")
    await waitFor(context, `document.querySelector('.setup .form-error')?.textContent === ${JSON.stringify(t.name)}`)
    assert.equal(await evaluate(context, "document.querySelector('.lobby-page')"), null, 'no room without a name')
  }
  // Submitting right after load, while App's connection handshake is still pending, must still reach the lobby
  // (a second connect() used to make the server drop the connection and the button stayed busy forever).
  await evaluate(context, "localStorage.setItem('hangman-interface-language', 'ca'); localStorage.setItem('hangman-name', 'Ràpida'); localStorage.removeItem('hangman-room-session')")
  await navigate(context, '/multijugador/')
  await evaluate(context, "document.querySelector('.entry-create .primary-action').click()")
  await waitFor(context, "document.querySelector('.lobby-page') !== null")
  const code = await evaluate(context, "document.querySelector('.room-code').textContent")
  await evaluate(context, "localStorage.removeItem('hangman-room-session')")
  await navigate(context, '/multijugador/')
  await type('.setup-name input', 'Ràpid')
  await evaluate(context, "document.querySelector('.entry-join-toggle').click()")
  await type('.room-code-input', code)
  await evaluate(context, "document.querySelector('.entry-join .secondary-action').click()")
  await waitFor(context, "document.querySelector('.lobby-page') !== null && document.querySelectorAll('.player-list li').length === 2")
  await evaluate(context, "localStorage.removeItem('hangman-room-session')")
  await navigate(context, '/')
  await evaluate(context, "localStorage.setItem('hangman-interface-language', 'ca'); localStorage.removeItem('hangman-name')")
  console.log('Multiplayer entry passed in CA/ES: one panel with a shared name at 1440/768/390/320; join reveals code and Entra in place (name kept, focus on code); keyboard order; name and code validation; create and join submitted right after load.')
}

export async function checkNotFoundNavigation({ context, command, evaluate, waitFor, navigate }) {
  for (const language of ['ca', 'es']) {
    await navigate(context, '/')
    await evaluate(context, `localStorage.setItem('hangman-interface-language', '${language}')`)
    const path = '/missing-page?keep=1#test'
    await navigate(context, path)
    await waitFor(context, "document.querySelector('.not-found-page') !== null")
    assert.equal(await evaluate(context, 'location.pathname + location.search + location.hash'), path, 'unknown addresses are not rewritten to home')
    assert.equal(await evaluate(context, 'document.title'), language === 'ca' ? 'Pàgina no trobada | Penjat' : 'Página no encontrada | Penjat')
    assert.equal(await evaluate(context, 'document.documentElement.lang'), language)
    assert.equal(await evaluate(context, "document.querySelector('link[rel=canonical]')"), null)
    assert.equal(await evaluate(context, "document.querySelector('[aria-current=page]')"), null)
    for (const width of [320, 390, 1440]) {
      await command('browsingContext.setViewport', { context, viewport: { width, height: 844 } })
      assert.equal(await evaluate(context, 'document.documentElement.scrollWidth > innerWidth'), false)
    }
    await evaluate(context, "document.querySelector('.not-found-page a[href=\"/\"]').click()")
    await waitFor(context, "location.pathname === '/' && document.querySelector('.home-modes') !== null")
    await command('browsingContext.traverseHistory', { context, delta: -1 })
    await waitFor(context, "location.pathname === '/missing-page' && document.querySelector('.not-found-page') !== null")
    assert.equal(await evaluate(context, "document.querySelector('link[rel=canonical]')"), null)
    await command('browsingContext.traverseHistory', { context, delta: 1 })
    await waitFor(context, "location.pathname === '/' && document.querySelector('.home-modes') !== null")
    assert.equal(await evaluate(context, "document.querySelector('link[rel=canonical]').href"), 'https://penjat.cat/')
    await evaluate(context, "history.pushState({}, '', '/another-missing'); window.dispatchEvent(new PopStateEvent('popstate'))")
    await waitFor(context, "location.pathname === '/another-missing' && document.querySelector('.not-found-page') !== null")
  }
  await navigate(context, '/')
  await evaluate(context, "localStorage.setItem('hangman-interface-language', 'ca')")
  console.log('Not-found navigation passed: CA/ES, original URL, no canonical, home recovery, Back/Forward and mobile reflow.')
}
