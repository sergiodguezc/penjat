// Focused local setup QA, with the online entry hero as reference. Uses the same local server and disposable Firefox as test:browser.
// For 200% text, use a disposable Firefox profile with font.size.variable.x-western=32 (see development docs).
// TEST_SERVER_URL=http://127.0.0.1:3002 node scripts/local-setup-browser-checks.mjs
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

export async function checkLocalSetup({ command, evaluate, waitFor, navigate, newTab }) {
  const context = await newTab((await command('browser.createUserContext')).userContext)
  const reference = await newTab((await command('browser.createUserContext')).userContext)
  const output = '/tmp/penjat-local-setup-review/after'
  await mkdir(output, { recursive: true })
  const click = (selector) => evaluate(context, `document.querySelector(${JSON.stringify(selector)}).click()`)
  const key = (value) => command('input.performActions', { context, actions: [{ type: 'key', id: 'local-setup-key', actions: [{ type: 'keyDown', value }, { type: 'keyUp', value }] }] })
  const shot = async (name) => writeFile(`${output}/${name}.png`, Buffer.from((await command('browsingContext.captureScreenshot', { context, origin: 'document' })).data, 'base64'))
  const heroStyle = `JSON.stringify(['.page-eyebrow', '.page-head h1', '.page-head h1 em'].map(selector => {
    const style = getComputedStyle(document.querySelector(selector))
    return ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing', 'color', 'backgroundColor'].map(key => style[key])
  }))`
  let textSize = '16px'
  const fits = () => evaluate(context, `(() => {
    const dialog = document.querySelector('.local-settings-dialog[open]')
    const root = dialog ?? document.querySelector('.local-setup')
    return root.scrollWidth <= root.clientWidth + 1 && document.documentElement.scrollWidth <= innerWidth
      && [...root.querySelectorAll('button:not(:disabled), input')].every(el => { const r = el.getBoundingClientRect(); return r.width >= 44 && r.height >= 44 })
  })()`)
  for (const language of ['ca', 'es']) {
    await navigate(context, '/passa-el-mobil/')
    await evaluate(context, `localStorage.clear(); localStorage.setItem('hangman-interface-language', '${language}')`)
    await navigate(context, '/passa-el-mobil/')
    await waitFor(context, "document.querySelector('.local-setup') !== null")
    await navigate(reference, '/')
    await evaluate(reference, `localStorage.setItem('hangman-interface-language', '${language}')`)
    await navigate(reference, '/multijugador/')
    await waitFor(reference, "document.querySelector('.page-head h1 em') !== null")
    textSize = await evaluate(context, 'getComputedStyle(document.documentElement).fontSize')
    for (const season of ['', 'spooky']) {
      await evaluate(context, `document.documentElement.dataset.season = '${season}'`)
      await evaluate(reference, `document.documentElement.dataset.season = '${season}'`)
      for (const [width, height] of [[375, 667], [390, 664], [768, 1024], [1280, 900]]) {
        await command('browsingContext.setViewport', { context, viewport: { width, height } })
        await command('browsingContext.setViewport', { context: reference, viewport: { width, height } })
        await command('browsingContext.activate', { context })
        // Focus/visibility refresh the seasonal runtime; set the test theme afterward and let colours settle.
        for (const tab of [context, reference]) await evaluate(tab, `document.documentElement.dataset.season = '${season}'; document.fonts.ready.then(() => new Promise(resolve => setTimeout(resolve, 250)))`)
        assert.ok(await fits(), `${language}/${season}/${width}: setup overflow and targets`)
        const label = `${language}-${season || 'standard'}-${width}-${textSize}`
        assert.equal(await evaluate(context, heroStyle), await evaluate(reference, heroStyle), `${label}: local and online hero typography and colours match`)
        assert.equal(await evaluate(context, "document.querySelector('.local-setup').getBoundingClientRect().top - document.querySelector('.local-setup-heading').getBoundingClientRect().bottom <= parseFloat(getComputedStyle(document.documentElement).fontSize) * 1.5 + 1"), true, `${label}: no excessive hero gap`)
        await writeFile(`${output}/${label}-online-reference.png`, Buffer.from((await command('browsingContext.captureScreenshot', { context: reference, origin: 'document' })).data, 'base64'))
        await command('browsingContext.activate', { context })
        await shot(label)
        // The shared native modal traps focus, closes with Escape and restores its opener.
        await click('.lobby-rules-configure')
        await waitFor(context, "document.querySelector('.local-settings-dialog[open]') !== null")
        assert.equal(await evaluate(context, "document.activeElement.closest('.local-settings-dialog') !== null"), true)
        assert.ok(await fits(), `${label}: dialog overflow and targets`)
        await shot(`${label}-settings`)
        await evaluate(context, "document.querySelector('.local-settings-dialog .primary-action').focus()")
        await key('\uE004')
        assert.equal(await evaluate(context, "document.activeElement === document.querySelector('.local-settings-dialog .language-options button')"), true)
        await key('\uE007')
        await key('\uE00C')
        await waitFor(context, "!document.querySelector('.local-settings-dialog') && document.activeElement.matches('.lobby-rules-configure')")
        if (width > 390) continue
        await command('browsingContext.setViewport', { context, viewport: { width, height: 300 } })
        await click('.lobby-rules-configure')
        await waitFor(context, "document.querySelector('.local-settings-dialog').getBoundingClientRect().bottom <= 300")
        assert.equal(await evaluate(context, "document.querySelector('.local-settings-dialog').getBoundingClientRect().top >= 0"), true)
        await key('\uE00C')
      }
    }
  }
  await command('browsingContext.setViewport', { context, viewport: { width: 390, height: 664 } })
  for (let count = 2; count < 10; count++) {
    await click('.local-add')
    await waitFor(context, `document.querySelectorAll('.local-players input').length === ${count + 1}`)
    await waitFor(context, "document.activeElement === document.querySelector('.local-players li:last-child input')")
  }
  assert.equal(await evaluate(context, "document.querySelector('.local-add').disabled"), true)
  await shot('ten-players')
  for (let count = 10; count > 2; count--) {
    await click('.local-players li:last-child .local-remove')
    await waitFor(context, `document.querySelectorAll('.local-players input').length === ${count - 1}`)
    await waitFor(context, "document.activeElement === document.querySelector('.local-players li:last-child input')")
  }
  assert.equal(await evaluate(context, "[...document.querySelectorAll('.local-remove')].every(el => el.disabled)"), true)
  await click('.lobby-rules-configure')
  await click('.local-settings-dialog .language-option-wrap:last-child button')
  await click('.local-settings-dialog .target-selector button:last-child')
  await click('.local-settings-dialog .primary-action')
  await waitFor(context, "document.querySelector('.lobby-rules-pills').textContent === 'En español5 rondas'")
  await click('.lobby-rules-configure')
  assert.equal(await evaluate(context, "document.querySelector('.local-settings-dialog .language-option-wrap:last-child button').getAttribute('aria-pressed')"), 'true')
  assert.equal(await evaluate(context, "document.querySelector('.local-settings-dialog .target-selector button:last-child').getAttribute('aria-pressed')"), 'true')
  await key('\uE00C')
  await command('browsingContext.close', { context })
  await command('browsingContext.close', { context: reference })
  console.log(`Local setup passed: CA/ES, standard/Castanyada, 375/390/768/1280, ${textSize} text, short viewport, modal focus and 2–10 players. Screenshots: ${output}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { openBidiSession } = await import('./bidi-session.mjs')
  const origin = process.env.TEST_SERVER_URL || 'http://127.0.0.1:3002'
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname))
  const session = await openBidiSession(origin)
  try { await checkLocalSetup(session); assert.deepEqual(session.errors, []) } finally { await session.close() }
}
