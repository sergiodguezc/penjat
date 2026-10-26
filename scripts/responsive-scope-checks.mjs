import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'

// Optional before/after evidence for a CSS change. The caller supplies the saved original CSS;
// regular browser runs still verify the existing 660px layout contracts without that file.
export async function checkResponsiveScope({ context, command, evaluate, page, root, selectors }) {
  const baseline = process.env.RESPONSIVE_BASELINE_CSS && readFileSync(process.env.RESPONSIVE_BASELINE_CSS, 'utf8')
  for (const width of [599, 600, 660, 661]) {
    await command('browsingContext.setViewport', { context, viewport: { width, height: 1000 } })
    const measure = `JSON.stringify((() => {
      const root = document.querySelector(${JSON.stringify(root)}).getBoundingClientRect()
      const round = n => Math.round(n * 100) / 100
      return [...document.querySelectorAll(${JSON.stringify(selectors)})].map(el => {
        const r = el.getBoundingClientRect(), s = getComputedStyle(el)
        return { tag: el.tagName, class: el.className, x: r.width || r.height ? round(r.x-root.x) : 0, y: r.width || r.height ? round(r.y-root.y) : 0, width: round(r.width), height: round(r.height), display:s.display, direction:s.flexDirection, columns:s.gridTemplateColumns, font:s.font.replaceAll(String.fromCharCode(34), ''), padding:s.padding, gap:s.gap }
      })
    })())`
    const current = await evaluate(context, measure)
    assert.equal(await evaluate(context, 'document.documentElement.scrollWidth > innerWidth'), false, `${page} overflow at ${width}`)
    // Phase 3B: the help header is a stacked page head; the numbered rule cards go from one column on phones to two.
    if (page === 'help') assert.equal(await evaluate(context, "getComputedStyle(document.querySelector('.howto-steps ol')).gridTemplateColumns.split(' ').length"), width <= 599 ? 1 : 2)
    if (page === 'lobby') {
      assert.equal(await evaluate(context, "getComputedStyle(document.querySelector('.lobby-layout .room-chat')).minHeight"), '0px')
      assert.equal(await evaluate(context, "getComputedStyle(document.querySelector('.chat-launcher')).position"), 'fixed')
      assert.equal(await evaluate(context, "Math.round(document.querySelector('main').getBoundingClientRect().bottom - document.querySelector('.chat-launcher').getBoundingClientRect().top)"), 0, 'Chat rail stays outside the game scroll viewport')
    }
    if (page === 'match') assert.equal(await evaluate(context, "getComputedStyle(document.querySelector('.match-header')).flexWrap"), width <= 660 ? 'wrap' : 'nowrap')
    if (baseline) {
      await evaluate(context, `(() => {
        window.scopeSheets = [...document.styleSheets]; window.scopeSheets.forEach(s=>s.disabled=true)
        const style = document.createElement('style'); style.id='scope-baseline'; style.textContent=${JSON.stringify(baseline)}; document.head.append(style)
      })()`)
      try { assert.deepEqual(JSON.parse(current), JSON.parse(await evaluate(context, measure)), `${page} content layout changed at ${width}`) }
      finally { await evaluate(context, "document.getElementById('scope-baseline').remove(); window.scopeSheets.forEach(s=>s.disabled=false)") }
      if (width === 600) {
        const directory = new URL('../design-explorations/phase-2-1-sizing/screenshots/', import.meta.url)
        mkdirSync(directory, { recursive:true })
        const shot = await command('browsingContext.captureScreenshot', { context, origin:'document' })
        writeFileSync(new URL(`scope-${page}-600.png`,directory),Buffer.from(shot.data,'base64'))
      }
    }
  }
  console.log(`${page}: 599/600/660/661px responsive contracts passed${baseline ? '; content geometry/styles equal saved original CSS' : ''}.`)
}
