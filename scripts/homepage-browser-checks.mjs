import assert from 'node:assert/strict'

export const homeMetrics = `JSON.stringify((() => {
  const box = (selector) => {
    const el = typeof selector === 'string' ? document.querySelector(selector) : selector
    if (!el) return null
    const r = el.getBoundingClientRect(), s = getComputedStyle(el)
    return { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom, right: r.right, shown: s.display !== 'none' && r.height > 0, fontSize: parseFloat(s.fontSize), lineHeight: parseFloat(s.lineHeight) }
  }
  // Computed oklch() colours are converted through color-mix() in sRGB, which serialises as rgb() or color(srgb …).
  const probe = document.body.appendChild(document.createElement('i'))
  const srgb = (color) => {
    probe.style.color = 'color-mix(in srgb, ' + color + ' 100%, ' + color + ')'
    const value = getComputedStyle(probe).color, numbers = value.match(/[\\d.]+/g).map(Number)
    return (value.startsWith('color(') ? numbers.map(v => v * 255) : numbers).slice(0, 3).map(Math.round)
  }
  const srgbAlpha = (color) => { probe.style.color = color; const value = getComputedStyle(probe).color; return /\\/\\s*0\\)$|, 0\\)$/.test(value) ? 0 : 1 }
  const lum = (color) => { const [r, g, b] = srgb(color).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }); return 0.2126 * r + 0.7152 * g + 0.0722 * b }
  const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
  // The effective background: the nearest ancestor that paints one (Passa el mòbil shows the group's surface).
  const background = (el) => { for (; el; el = el.parentElement) { const c = getComputedStyle(el).backgroundColor; if (srgbAlpha(c) > 0) return c } return getComputedStyle(document.body).backgroundColor }
  const online = document.querySelector('.friends-option--online'), local = document.querySelector('.friends-option--local')
  const onlineStyle = getComputedStyle(online), localStyle = getComputedStyle(local)
  const metrics = {
    viewport: [innerWidth, innerHeight], overflow: document.documentElement.scrollWidth > innerWidth, season: document.documentElement.dataset.season ?? '',
    h1: box('h1'), lede: box('.home-lede'), eyebrow: box('.home-copy > .page-eyebrow'), shell: box('.home-shell'), header: box('.site-header'),
    card: box('.home-preview'), drawing: box('.preview-drawing'), slots: box('.preview-word'),
    modes: box('.home-modes'), friends: box('.friends-options'), online: box(online), local: box(local), daily: box('.daily-entry'), learn: box('.solo-option'),
    dailyCaption: box('.daily-caption'), dailyPlayed: box('.daily-played'),
    onlineContrast: contrast(onlineStyle.color, background(online)), localContrast: contrast(localStyle.color, background(local)),
    onlineFilled: srgb(background(online)).join() !== srgb(background(local)).join(),
    // Header CA/ES: the visible pill is 26px tall; a ::before extends each button's hit area vertically.
    language: [...document.querySelectorAll('.site-actions > .interface-language-toggle button')].filter(el => el.getClientRects().length)
      .map(el => ({ width: el.getBoundingClientRect().width, hit: el.getBoundingClientRect().height - 2 * parseFloat(getComputedStyle(el, '::before').top) })),
    headings: [...document.querySelectorAll('h1')].map(el => el.textContent),
    canonical: document.querySelector('link[rel=canonical]').href, title: document.title,
    description: document.querySelector('meta[name=description]').content,
    links: [...document.querySelectorAll('.home-modes a')].filter(el => el.getClientRects().length).map(el => { const r = el.getBoundingClientRect(); return { href: el.getAttribute('href'), height: r.height, width: r.width, bottom: r.bottom } }),
    phoneOnly: document.querySelectorAll('.home-quick').length,
  }
  probe.remove()
  return metrics
})())`

export function checkHomeLayout(m) {
  const [width] = m.viewport
  const at = `${m.viewport.join('×')} ${m.season || 'standard'}`
  assert.equal(m.overflow, false, `Overflow at ${at}`)
  assert.equal(m.headings.length, 1)
  assert.equal(m.canonical, 'https://penjat.cat/')
  // One hero navigation at every width: "Juga amb amics" (En línia, Passa el mòbil), then "Pel teu compte".
  assert.equal(m.phoneOnly, 0, 'no phone-only copy of the modes')
  assert.deepEqual(m.links.map(link => link.href), ['/multijugador', '/passa-el-mobil', '/paraula-del-dia', '/aprendre'], `Hero links at ${at}`)
  assert.ok(m.links.every(link => link.height >= 48 && link.width >= 44), `Hero link targets at ${at}`)
  // En línia is the filled, primary half; both halves keep AA text contrast in both themes.
  assert.ok(m.onlineFilled, `En línia filled at ${at}`)
  assert.ok(m.onlineContrast >= 4.5 && m.localContrast >= 4.5, `Option contrast ${m.onlineContrast.toFixed(2)}/${m.localContrast.toFixed(2)} at ${at}`)
  assert.ok(m.h1.fontSize <= 76)
  // The compact phone header and the full desktop header both stay well under a tenth of a tall viewport.
  assert.ok(m.header.height <= (width >= 661 ? 66 : 58), `Header height ${m.header.height}`)
  assert.ok(m.language.every(button => button.width >= 44 && button.hit >= 44), `Language targets at ${at}: ${JSON.stringify(m.language)}`)
  if (width <= 599) checkPhoneHero(m, at)
  else checkWideHero(m, at)
  // Phones keep a compact two-line maximum; wider layouts allow Lovable's three-line display headline.
  if (width >= 390) assert.ok(Math.round(m.h1.height / m.h1.lineHeight) <= (width < 600 ? 2 : 3), `Headline at ${at}`)
}

// Phone hero: headline, then the lede beside a small character, then the friends group (stacked) and the solo row.
function checkPhoneHero(m, at) {
  const [width, height] = m.viewport
  const near = (a, b, tolerance = 1) => Math.abs(a - b) <= tolerance
  assert.ok(m.h1.bottom <= m.lede.y && m.lede.bottom <= m.friends.y && m.friends.bottom <= m.daily.y, `Title → lede → friends → solo at ${at}`)
  // From 320px the character sits beside the lede; narrower (or 200% text) it follows the full-width lede.
  if (width >= 320) assert.ok(m.drawing.x >= m.lede.right - 1 && m.drawing.y < m.lede.bottom && m.drawing.bottom > m.lede.y, `Character beside the lede at ${at}`)
  else assert.ok(m.drawing.y >= m.lede.bottom && m.drawing.bottom <= m.friends.y, `Character between lede and modes at ${at}`)
  assert.ok(m.drawing.width >= 80, `Character keeps a readable size at ${at}`)
  assert.equal(m.slots.shown, false)
  assert.ok(near(m.friends.x, m.shell.x) && near(m.friends.width, m.shell.width), `Friends group spans the content width at ${at}`)
  assert.ok(m.local.y >= m.online.bottom - 1 && near(m.local.x, m.online.x), `Friends options stacked at ${at}`)
  assert.ok(m.online.height >= 56, `En línia height ${m.online.height}`)
  // The solo links stack as full-width rows below the friends group, each with its caption (number or topic).
  assert.ok(m.learn.y >= m.daily.bottom - 1 && near(m.learn.x, m.daily.x) && near(m.daily.width, m.shell.width), `Solo links stacked at ${at}`)
  assert.deepEqual([m.dailyCaption.shown, m.dailyPlayed === null || !m.dailyPlayed.shown], [true, true], `Phone daily shows its status line at ${at}`)
  // Short phones give the eyebrow's row to the modes; taller phones keep it (and the Castanyada chip).
  assert.equal(m.eyebrow.shown, height >= 640, `Eyebrow at ${at}`)
  // Spacing comes first on the iPhone SE (375×553 visible): both friends options are in the first viewport and the solo
  // row starts in it. From 390×664 all four modes fit.
  const [online, local] = m.links.map(link => link.bottom)
  if (width >= 375 && height >= 553) assert.ok(online <= height && local <= height && m.daily.y < height, `Friends below the fold at ${at}`)
  if (width >= 390 && height >= 664) assert.ok(m.links.every(link => link.bottom <= height), `Mode below the fold at ${at}: ${JSON.stringify(m.links.map(link => Math.round(link.bottom)))}`)
}

function checkWideHero(m, at) {
  const [width, height] = m.viewport
  const near = (a, b, tolerance = 1) => Math.abs(a - b) <= tolerance
  assert.ok(near(m.online.y, m.local.y) && m.local.x >= m.online.right - 1, `Friends options side by side at ${at}`)
  assert.ok(near(m.daily.y, m.learn.y, .5) && m.learn.x > m.daily.x, `Solo links side by side at ${at}`)
  assert.ok(m.friends.bottom <= m.daily.y, `Friends before solo at ${at}`)
  assert.equal(m.dailyCaption.shown, true, `Daily status line at ${at}`)
  assert.equal(m.eyebrow.shown, true)
  if (height >= 568) assert.ok(m.online.bottom <= height, `En línia below fold at ${at}`)
  assert.ok(m.drawing.y >= m.card.y + 16, 'Drawing remains inside the card padding')
  assert.ok(m.slots.bottom <= m.card.bottom - 16, 'Letter slots remain inside the card padding')
  if (width < 1000) {
    // Tablet hero: a compact board beside the headline and lede; both groups span the content width below them.
    assert.ok(m.card.x >= m.lede.right && m.card.right <= m.shell.right + 4 && m.card.bottom <= m.modes.y, `Preview beside the copy at ${at}`)
    assert.ok(near(m.friends.width, m.shell.width), `Friends group spans the content width at ${at}`)
    if (height >= 1024) assert.ok(m.links.every(link => link.bottom <= height), `All modes in the first tablet viewport at ${at}`)
  } else assert.ok(m.card.x > m.friends.right, `Preview beside the groups at ${at}`)
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
  // Real keyboard navigation: skip link, brand, the five header sections, both interface languages, then the page's mode links.
  await command('browsingContext.setViewport', { context, viewport: { width: 1024, height: 768 } })
  await navigate(context, '/')
  await waitFor(context, "document.querySelector('.home-modes') !== null")
  const tab = () => command('input.performActions', { context, actions: [{ type: 'key', id: 'keyboard', actions: [{ type: 'keyDown', value: '\uE004' }, { type: 'keyUp', value: '\uE004' }] }] })
  for (const href of ['#contingut', '/', '/multijugador', '/passa-el-mobil', '/paraula-del-dia', '/aprendre', '/com-es-juga']) {
    await tab()
    assert.equal(await evaluate(context, 'document.activeElement.getAttribute("href")'), href)
    assert.equal(await evaluate(context, 'document.activeElement.matches(":focus-visible")'), true)
  }
  for (const code of ['CA', 'ES']) {
    await tab()
    assert.equal(await evaluate(context, 'document.activeElement.closest(".interface-language-toggle") !== null && document.activeElement.textContent'), code)
  }
  for (const href of ['/multijugador', '/passa-el-mobil', '/paraula-del-dia']) {
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
    const point = JSON.parse(await evaluate(context, "JSON.stringify((r => ({ x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }))(document.querySelector('.friends-option--online').getBoundingClientRect()))"))
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
  // Phone hero: after the header's menu button, Tab reaches En línia, Passa el mòbil and the daily link in order with a
  // visible ring, Enter follows the link, and a click near the right edge (the arrow) of each friends option routes in-app.
  await command('browsingContext.setViewport', { context, viewport: { width: 390, height: 844 } })
  for (const target of ['keyboard', 'pointer']) {
    await navigate(context, '/')
    await waitFor(context, "document.querySelector('.friends-option') !== null")
    if (target === 'keyboard') {
      await evaluate(context, "document.querySelector('.site-menu-toggle').focus()")
      for (const href of ['/multijugador', '/passa-el-mobil', '/paraula-del-dia']) {
        await tab()
        assert.equal(await evaluate(context, 'document.activeElement.closest(".home-modes") !== null && document.activeElement.getAttribute("href")'), href)
        assert.equal(await evaluate(context, 'document.activeElement.matches(":focus-visible") && getComputedStyle(document.activeElement).outlineStyle'), 'solid')
      }
      await command('input.performActions', { context, actions: [{ type: 'key', id: 'keyboard', actions: [{ type: 'keyDown', value: '' }, { type: 'keyUp', value: '' }] }] })
      await waitFor(context, "location.pathname === '/paraula-del-dia/'")
    } else {
      for (const [tone, path] of [['online', '/multijugador/'], ['local', '/passa-el-mobil/']]) {
        await navigate(context, '/')
        await waitFor(context, "document.querySelector('.friends-option') !== null")
        await evaluate(context, 'window.homeNavigationSentinel = 42')
        const point = JSON.parse(await evaluate(context, `JSON.stringify((r => ({ x: Math.round(r.right - 12), y: Math.round(r.y + r.height / 2) }))(document.querySelector('.friends-option--${tone}').getBoundingClientRect()))`))
        await command('input.performActions', { context, actions: [{ type: 'pointer', id: 'mouse', parameters: { pointerType: 'mouse' }, actions: [{ type: 'pointerMove', ...point }, { type: 'pointerDown', button: 0 }, { type: 'pointerUp', button: 0 }] }] })
        await command('input.releaseActions', { context })
        await waitFor(context, `location.pathname === '${path}'`)
        assert.equal(await evaluate(context, 'window.homeNavigationSentinel'), 42, `${tone} routes inside the app`)
      }
    }
  }
  // Below the hero: the band (one control with a visible pause/play mark) opens "Com es juga", whose four steps sit in
  // 4, 2 or 1 columns; Tab goes hero → band → rules link → footer, and nothing scrolls sideways.
  for (const [width, height, columns] of [[1280, 800, 4], [768, 1024, 2], [390, 844, 1]]) {
    await command('browsingContext.setViewport', { context, viewport: { width, height } })
    await navigate(context, '/')
    await waitFor(context, "document.querySelector('.home-how') !== null")
    const how = JSON.parse(await evaluate(context, `JSON.stringify((() => {
      const box = (element) => element.getBoundingClientRect()
      const band = box(document.querySelector('.home-band')), control = box(document.querySelector('.home-band-control > span')), panel = box(document.querySelector('.home-how'))
      const steps = [...document.querySelectorAll('.how-step')].map(box)
      return { overflow: document.documentElement.scrollWidth > innerWidth, columns: new Set(steps.map((step) => Math.round(step.x))).size, count: steps.length,
        controlInside: control.width >= 32 && control.x >= band.x && control.right <= band.right && control.y >= band.y && control.bottom <= band.bottom,
        joined: Math.abs(panel.y - band.bottom) <= 1, panelWidth: Math.round(panel.width), heroX: Math.round(box(document.querySelector('.home-copy h1')).x), howX: Math.round(box(document.querySelector('.home-how-head h2')).x) }
    })())`))
    assert.deepEqual([how.overflow, how.count, how.columns, how.controlInside, how.joined], [false, 4, columns, true, true], `Com es juga at ${width}: ${JSON.stringify(how)}`)
    assert.ok(Math.abs(how.heroX - how.howX) <= 1, `Com es juga aligns with the hero at ${width}: ${JSON.stringify(how)}`)
  }
  await command('browsingContext.setViewport', { context, viewport: { width: 1024, height: 768 } })
  await navigate(context, '/')
  await waitFor(context, "document.querySelector('.home-how') !== null")
  await evaluate(context, "document.querySelector('.solo-option').focus()")
  await tab()
  assert.equal(await evaluate(context, "document.activeElement.classList.contains('home-band') && document.activeElement.getAttribute('aria-label')"), await evaluate(context, "document.documentElement.lang === 'es' ? 'Detén el movimiento de las palabras' : 'Atura el moviment de les paraules'"))
  assert.equal(await evaluate(context, 'document.activeElement.matches(":focus-visible")'), true)
  await command('input.performActions', { context, actions: [{ type: 'key', id: 'keyboard', actions: [{ type: 'keyDown', value: '\uE007' }, { type: 'keyUp', value: '\uE007' }] }] })
  assert.equal(await evaluate(context, "document.querySelector('.home-band').classList.contains('is-paused') && document.querySelector('.home-band-control path').getAttribute('d').startsWith('M5 3.5')"), true, 'Enter pauses the band and shows the play mark')
  await tab()
  assert.equal(await evaluate(context, 'document.activeElement.closest(".home-how") !== null && document.activeElement.getAttribute("href")'), '/com-es-juga')
  await tab()
  assert.equal(await evaluate(context, 'document.activeElement.closest(".site-footer") !== null'), true)
  console.log('Homepage navigation passed: semantic links, modifiers, Ctrl/middle new tabs, keyboard, SPA routing, back/forward metadata, band control and Com es juga.')
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
