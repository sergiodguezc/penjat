import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'

const viewports = [[1440,900], [1366,768], [768,1024], [390,844], [320,568]]
const directory = '/tmp/penjat-p0-validation'

async function key(command, context, value, shift = false) {
  const actions = [ ...(shift ? [{ type:'keyDown', value:'\uE008' }] : []), { type:'keyDown', value }, { type:'keyUp', value }, ...(shift ? [{ type:'keyUp', value:'\uE008' }] : []) ]
  await command('input.performActions', { context, actions:[{ type:'key', id:'p0-keyboard', actions }] })
}
async function pointer({ command, context, evaluate }, selector, pointerType = 'mouse') {
  await evaluate(context, `(() => { const element = document.querySelector(${JSON.stringify(selector)}); const r = element.getBoundingClientRect(); if (!element.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2))) element.scrollIntoView({block:'center'}) })()`)
  const point = JSON.parse(await evaluate(context, `JSON.stringify((() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)} })())`))
  await command('input.performActions', { context, actions:[{ type:'pointer', id:`p0-${pointerType}`, parameters:{pointerType}, actions:[{type:'pointerMove', ...point}, {type:'pointerDown',button:0}, {type:'pointerUp',button:0}] }] })
}
async function screenshot(command, context, name) {
  mkdirSync(directory, {recursive:true})
  const shot = await command('browsingContext.captureScreenshot', {context, origin:'viewport'})
  writeFileSync(`${directory}/${name}.png`, Buffer.from(shot.data,'base64'))
}
function contrast(a, b) {
  const luminance = color => color.match(/[\d.]+/g).slice(0,3).map(Number).map(v => v/255).map(v => v <= .04045 ? v/12.92 : ((v+.055)/1.055)**2.4).reduce((sum,v,i) => sum+v*[.2126,.7152,.0722][i],0)
  const x=luminance(a), y=luminance(b)
  return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)
}
async function checkContrast(evaluate, context, selector, backgroundSelector, minimum = 4.5, property = 'color') {
  const colors = JSON.parse(await evaluate(context, `JSON.stringify((() => {
    // Canvas resolves RGB and OKLCH into sRGB bytes; parsing OKLCH as RGB gives false failures.
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1
    const ctx = canvas.getContext('2d')
    const rgb = (color) => { ctx.clearRect(0,0,1,1); ctx.fillStyle=color; ctx.fillRect(0,0,1,1); return 'rgb(' + [...ctx.getImageData(0,0,1,1).data].slice(0,3).join(',') + ')' }
    return [rgb(getComputedStyle(document.querySelector(${JSON.stringify(selector)}))[${JSON.stringify(property)}]),rgb(getComputedStyle(document.querySelector(${JSON.stringify(backgroundSelector)})).backgroundColor)]
  })())`))
  const ratio = contrast(...colors)
  assert.ok(ratio >= minimum, `${selector}: ${colors} contrast ${ratio} < ${minimum}`)
  return ratio.toFixed(2)
}

export async function checkP0Dialogs(api) {
  const { context, command, evaluate, waitFor, navigate } = api
  // A learning word card (its word chips open the read-only card) and an unfinished daily game (header links ask first).
  const pages = {
    '.vocab-dialog': async () => {
      await navigate(context, '/aprendre/')
      await waitFor(context, "document.querySelector('.unit-card .primary-action') !== null")
      await pointer(api, '.unit-card .primary-action')
      await waitFor(context, "document.querySelector('.learning-game .keyboard') !== null")
      for (let i = 0; i < 26 && await evaluate(context, "document.querySelector('.vocab-card') === null"); i++) await evaluate(context, "document.querySelector('.keyboard button:not(:disabled)')?.click()")
      await waitFor(context, "document.querySelector('.word-chips button') !== null")
    },
    '.exit-confirmation-dialog': async () => {
      await navigate(context, '/paraula-del-dia/')
      await waitFor(context, "document.querySelector('.daily-game .keyboard') !== null")
      await evaluate(context, "document.querySelector('.keyboard button:not(:disabled)').click()")
      await waitFor(context, "document.querySelectorAll('.keyboard button:disabled').length === 1")
    },
  }
  for (const language of ['ca','es']) {
    await navigate(context, '/')
    await evaluate(context, `localStorage.setItem('hangman-interface-language','${language}'); localStorage.removeItem('penjat-learning'); localStorage.removeItem('penjat-daily-challenge')`)
    for (const [opener, dialog] of [['.word-chips button','.vocab-dialog'], ['.site-brand','.exit-confirmation-dialog']]) {
      await pages[dialog]()
      for (const [width,height] of viewports) {
        await command('browsingContext.setViewport', {context, viewport:{width,height}})
          await evaluate(context, `document.querySelector('${opener}').focus()`)
          await key(command, context, '\uE007')
          await waitFor(context, `document.querySelector('${dialog}:modal') !== null`)
          assert.equal(await evaluate(context, "document.activeElement.hasAttribute('data-modal-initial-focus')"), true)
          assert.equal(await evaluate(context, `!!document.getElementById(document.querySelector('${dialog}').getAttribute('aria-labelledby'))`), true)
          if (dialog.includes('exit')) assert.equal(await evaluate(context, "!!document.getElementById(document.querySelector('dialog').getAttribute('aria-describedby'))"), true)
          for (const shift of [false,true]) {
            for (let i=0; i<7; i++) {
              await key(command, context, '\uE004', shift)
              assert.equal(await evaluate(context, "document.querySelector('dialog').contains(document.activeElement)"), true, 'Tab stays in the modal')
            }
          }
          // Both programmatic focus and real pointer activation must be blocked by native inertness.
          await evaluate(context, "document.querySelector('.interface-language-toggle button:not(.active)').focus()")
          assert.equal(await evaluate(context, "document.querySelector('dialog').contains(document.activeElement)"), true)
          const storedLanguage = await evaluate(context, "localStorage.getItem('hangman-interface-language')")
          await pointer(api, '.interface-language-toggle button:not(.active)')
          assert.equal(await evaluate(context, "localStorage.getItem('hangman-interface-language')"), storedLanguage)
          const guesses = await evaluate(context, "document.querySelectorAll('.keyboard button:disabled').length")
          await key(command, context, 'a')
          assert.equal(await evaluate(context, "document.querySelectorAll('.keyboard button:disabled').length"), guesses, 'Dialog keystrokes cannot guess in the background')
          await key(command, context, '\uE004')
          await evaluate(context, "document.querySelector('[data-modal-initial-focus]').focus()")
          assert.equal(await evaluate(context, "document.activeElement.matches(':focus-visible')"), true)
          const bounds = JSON.parse(await evaluate(context, "JSON.stringify((() => { const r=document.querySelector('dialog').getBoundingClientRect(); return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,overflow:document.documentElement.scrollWidth>innerWidth} })())"))
          assert.ok(bounds.left>=0 && bounds.right<=width && bounds.top>=0 && bounds.bottom<=height && !bounds.overflow)
          assert.equal(await evaluate(context, "document.querySelector('dialog').scrollWidth <= document.querySelector('dialog').clientWidth"), true, 'Dialog content cannot clip horizontally')
          assert.equal(await evaluate(context, "[...document.querySelectorAll('dialog button')].every(b => { const r=b.getBoundingClientRect(), d=document.querySelector('dialog').getBoundingClientRect(); return r.left>=d.left && r.right<=d.right })"), true)
          await checkContrast(evaluate,context,'[data-modal-initial-focus]','dialog',3,'outlineColor')
          await screenshot(command,context,`${language}-${width}-${dialog.slice(1)}`)
          await key(command, context, '\uE00C')
          await waitFor(context, "document.querySelector('dialog') === null")
          assert.equal(await evaluate(context, `document.activeElement.matches('${opener}')`), true, 'Escape restores opener')
          await key(command, context, '\uE007')
          await waitFor(context, "document.querySelector('dialog:modal') !== null")
          await pointer(api, '[data-modal-initial-focus]')
          await waitFor(context, "document.querySelector('dialog') === null")
          assert.equal(await evaluate(context, `document.activeElement.matches('${opener}')`), true, 'Cancel restores opener')
      }
    }
  }
  // Confirming leaves the unfinished daily game for the chosen page.
  await pointer(api, '.site-brand')
  await pointer(api, '.exit-confirmation-dialog .primary-action')
  await waitFor(context, "location.pathname === '/' && document.querySelector('.exit-confirmation-dialog') === null")
  await evaluate(context, "localStorage.setItem('hangman-interface-language','ca'); localStorage.removeItem('penjat-learning'); localStorage.removeItem('penjat-daily-challenge')")
  console.log('P0 dialogs: real Tab/Shift+Tab, Escape, cancel, confirm, focus restoration, inert background and game shortcuts passed in CA/ES at all five requested viewports.')
}

export async function checkP0Chat(api) {
  const { context, command, evaluate, waitFor } = api
  const sender = await evaluate(context, "document.querySelector('.chat-messages article strong')?.textContent")
  for (const language of ['ca','es']) {
    await evaluate(context, `Array.from(document.querySelectorAll('.interface-language-toggle button')).find(b=>b.textContent.trim()==='${language.toUpperCase()}').click()`)
    await waitFor(context, `document.documentElement.lang === '${language}'`)
    assert.equal(await evaluate(context, "document.querySelector('.reaction-trigger').getAttribute('aria-label')"), language==='ca' ? `Reacciona al missatge de ${sender}` : `Reaccionar al mensaje de ${sender}`)
    for (const [width,height] of viewports) {
      await command('browsingContext.setViewport', {context, viewport:{width,height}})
      if (width < 1000) {
        await waitFor(context, "document.querySelector('.chat-launcher > button').getAttribute('aria-haspopup') === 'dialog'")
        await evaluate(context, "document.querySelector('.chat-launcher > button').click()")
        await waitFor(context, "document.querySelector('.chat-dialog').matches(':modal')")
      } else await waitFor(context, "document.querySelector('.chat-dialog').open && document.querySelector('.chat-dialog').getAttribute('role') === 'region'")
      await evaluate(context, "document.querySelector('.reaction-trigger').scrollIntoView({block:'center'}); document.querySelector('.reaction-trigger').focus()")
      await key(command,context,'\uE007')
      await waitFor(context, "document.querySelector('.reaction-trigger').getAttribute('aria-expanded') === 'true'")
      assert.equal(await evaluate(context, "document.querySelector('.reaction-picker').contains(document.activeElement)"), true)
      assert.equal(await evaluate(context, "document.activeElement.getAttribute('aria-label')"), language==='ca' ? 'Reaccionar amb un cor' : 'Reaccionar con corazón')
      assert.equal(await evaluate(context, "document.querySelector('.reaction-trigger').getAttribute('aria-controls') === document.querySelector('.reaction-picker').id"), true)
      await key(command,context,'\uE00C')
      assert.equal(await evaluate(context, "document.activeElement.matches('.reaction-trigger') && document.querySelector('.reaction-picker').hidden"), true)
      await key(command,context,' ')
      await waitFor(context, "!document.querySelector('.reaction-picker').hidden")
      // Keyboard reaction activation sends the real Socket.IO mutation.
      await key(command,context,'\uE007')
      await waitFor(context, "document.querySelector('.active-reactions') !== null")
      assert.equal(await evaluate(context, "document.activeElement.matches('.reaction-trigger')"), true)
      await key(command,context,'\uE007')
      await waitFor(context, "!document.querySelector('.reaction-picker').hidden")
      assert.equal(await evaluate(context, "document.querySelector('.reaction-picker button').getAttribute('aria-pressed')"), 'true')
      await key(command,context,'\uE007')
      await waitFor(context, "document.querySelector('.active-reactions') === null")
      // Touch explicitly opens the picker, with no hover dependency.
      await pointer(api,'.reaction-trigger','touch')
      await waitFor(context, "!document.querySelector('.reaction-picker').hidden")
      assert.equal(await evaluate(context, 'document.documentElement.scrollWidth > innerWidth'), false)
      await screenshot(command,context,`${language}-${width}-chat`)
      // Select and remove using touch too: opening alone misses Safari's blur-before-click failure.
      await evaluate(context, "document.activeElement.blur()")
      assert.equal(await evaluate(context, "document.querySelector('.reaction-picker').hidden"), false, 'A null blur destination must not cancel a pending inside tap')
      await pointer(api,'.reaction-picker button','touch')
      await waitFor(context, "document.querySelector('.active-reactions') !== null && document.querySelector('.reaction-picker').hidden")
      await pointer(api,'.active-reactions','touch')
      await waitFor(context, "!document.querySelector('.reaction-picker').hidden")
      await pointer(api,'.reaction-picker button','touch')
      await waitFor(context, "document.querySelector('.active-reactions') === null")
      // Leaving the control closes it without stealing focus back.
      await evaluate(context, "document.querySelector('.chat-form input').focus()")
      await waitFor(context, "document.querySelector('.reaction-picker').hidden")
      assert.equal(await evaluate(context, "document.activeElement.matches('.chat-form input')"), true)
      await evaluate(context, "document.querySelector('.reaction-trigger').focus()")
      await key(command,context,'\uE004',true)
      await key(command,context,'\uE004')
      assert.equal(await evaluate(context, "document.activeElement.matches('.reaction-trigger')"), true, 'New messages are reachable with Tab')
      assert.ok(Number(await checkContrast(evaluate,context,'.reaction-trigger','.chat-message-body p')) >= 4.5)
      if (width < 1000) await pointer(api,'.chat-close','touch')
    }
  }
  console.log('P0 chat: CA/ES labels, Enter/Space, Escape, focus, live reaction toggling/counts, Tab discovery and touch passed at all five requested viewports.')
}

export async function checkP0Terminal(api) {
  const { context, command, evaluate, waitFor } = api
  for (const language of ['ca','es']) {
    await evaluate(context, `Array.from(document.querySelectorAll('.interface-language-toggle button')).find(b=>b.textContent.trim()==='${language.toUpperCase()}').click()`)
    await waitFor(context, `document.documentElement.lang === '${language}'`)
    for (const [width,height] of viewports) {
      await command('browsingContext.setViewport', {context, viewport:{width,height}})
      // Phase 2A results replace the board; with one active player there is no rematch, only new-room/menu navigation.
      assert.equal(await evaluate(context, "document.querySelector('.keyboard, .round-result, .round-results, .game-columns, .match-round-details') !== null"), false)
      assert.equal(await evaluate(context, "document.querySelector('.rematch-unavailable') !== null && document.querySelector('.rematch-readiness') === null"), true)
      assert.equal(await evaluate(context, "[...document.querySelectorAll('.match-actions button')].some((b) => ['Revenja','Revancha'].includes(b.textContent))"), false)
      assert.equal(await evaluate(context, 'document.documentElement.scrollWidth > innerWidth'), false)
      await evaluate(context, "document.querySelector('.match-actions .primary-action').focus()")
      assert.equal(await evaluate(context, "(() => { const b=document.querySelector('.match-actions .primary-action').getBoundingClientRect(); return b.top-6>=0 && b.bottom+6<=document.documentElement.clientHeight && b.left-6>=0 && b.right+6<=innerWidth })()"), true, 'New-room action and its focus ring stay within the viewport')
      await screenshot(command,context,`${language}-${width}-terminal`)
    }
  }
  const ratio = await checkContrast(evaluate,context,'.standing-rank','.standing-rank')
  await key(command,context,'\uE007')
  await waitFor(context,"document.querySelector('.setup') !== null && localStorage.getItem('hangman-room-session') === null")
  console.log(`P0 terminal: no wordless board or impossible rematch; return to multiplayer clears membership. Ranking contrast ${ratio}:1. CA/ES at all five viewports.`)
}

export async function checkP0EmptyChat({context,evaluate}) {
  console.log(`P0 empty chat contrast: ${await checkContrast(evaluate,context,'.chat-empty','.room-chat')}:1`)
}
