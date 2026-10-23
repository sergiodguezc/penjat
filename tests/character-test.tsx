import React from 'react'
import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import { HangmanDrawing } from '../src/components/HangmanDrawing'
import { CastanyeraScene } from '../src/seasonal/CastanyeraScene'
import { SeasonalPreview } from '../src/seasonal/SeasonalPreview'
import { MAX_ERRORS } from '../shared/game'
import { DAILY_MAX_ERRORS } from '../src/daily/game'
import { MAX_LEARNING_ERRORS } from '../src/learning/game'

const parts = ['head', 'torso', 'leftArm', 'rightArm', 'leftLeg', 'rightLeg']
for (let errors = 0; errors <= 6; errors++) {
  const html = renderToStaticMarkup(<HangmanDrawing errors={errors} label="Errors" />)
  assert.deepEqual([...html.matchAll(/data-part="([^"]+)"/g)].map((m) => m[1]), parts.slice(0, errors))
  assert.equal(html.includes('data-accessory="hat"'), errors >= 1)
  assert.equal(html.includes('data-accessory="scarf"'), errors >= 2)
  assert.ok(html.includes('class="gallows"'))
  assert.ok(html.includes(`aria-label="Errors: ${errors} / 6"`))
  assert.ok(!html.includes('figure--complete'))
  assert.equal((html.match(/data-flame=/g) ?? []).length, 6 - errors)
  assert.match(html, /data-castanyera="visible"/)
  assert.match(html, /data-moon="atmosphere"/)
  assert.equal(html.includes('data-embers="cold"'), errors === 6)
  assert.match(html, new RegExp(`data-expression="${['warm', 'warm', 'concerned', 'concerned', 'worried', 'worried', 'sad'][errors]}"`))
}
assert.match(renderToStaticMarkup(<HangmanDrawing errors={2} label="Errores" />), /aria-label="Errores: 2 \/ 6"/)
for (const errors of [0, 2, 5]) {
  const win = renderToStaticMarkup(<HangmanDrawing errors={errors} mood="win" size="compact" />)
  assert.equal([...win.matchAll(/data-part=/g)].length, 6, 'perfect wins also get the rescued figure')
  assert.ok(!win.includes('class="gallows"'))
  assert.match(win, /width="44" height="48"/)
  assert.match(win, /aria-hidden="true"/)
  assert.ok(!win.includes('aria-label') && !win.includes('role="img"'))
  assert.equal((win.match(/data-flame=/g) ?? []).length, 6 - errors, 'winning does not relight extinguished flames')
}
for (const mood of ['neutral', 'win', 'loss'] as const) {
  const html = renderToStaticMarkup(<HangmanDrawing errors={6} mood={mood} />)
  assert.equal((html.match(/data-flame=/g) ?? []).length, 0, 'outcome mood never changes the mistake count')
  assert.match(html, new RegExp(`data-expression="${mood === 'win' ? 'warm' : 'sad'}"`), 'a resolved victory overrides the retained mistake count')
  assert.equal([...html.matchAll(/data-part=/g)].length, 6)
}
assert.equal(MAX_ERRORS, 6)
assert.equal(DAILY_MAX_ERRORS, MAX_ERRORS)
assert.equal(MAX_LEARNING_ERRORS, MAX_ERRORS)
for (const errors of [-1, 0, 1, 2, 3, 4, 5, 6, 99]) {
  const scene = renderToStaticMarkup(<CastanyeraScene errors={errors} />)
  assert.equal((scene.match(/data-flame=/g) ?? []).length, Math.max(0, Math.min(6, 6 - errors)))
  assert.deepEqual([...scene.matchAll(/data-flame="(\d+)"/g)].map((match) => Number(match[1])), Array.from({ length: Math.max(0, Math.min(6, 6 - errors)) }, (_, index) => index + 1))
  assert.match(scene, /data-castanyera="visible"/)
  assert.doesNotMatch(scene, /gallows|data-part|data-accessory/)
}
const preview = renderToStaticMarkup(<HangmanDrawing errors={4} seasonalErrors={0} />)
assert.equal((preview.match(/data-part=/g) ?? []).length, 4, 'ordinary preview pose is preserved')
assert.equal((preview.match(/data-flame=/g) ?? []).length, 6, 'seasonal hero starts with six flames')
const gallery = renderToStaticMarkup(<SeasonalPreview />)
assert.equal((gallery.match(/<figure>/g) ?? []).length, 7)
assert.equal((gallery.match(/data-flame=/g) ?? []).length, 21)
assert.equal((gallery.match(/data-embers="cold"/g) ?? []).length, 1)
assert.match(renderToStaticMarkup(<CastanyeraScene errors={2} mood="loss" />), /data-expression="sad"/)
assert.match(renderToStaticMarkup(<CastanyeraScene errors={5} mood="win" />), /data-expression="warm"/)
for (let errors = 0; errors <= 7; errors++) {
  assert.match(renderToStaticMarkup(<CastanyeraScene errors={errors} mood="win" />), /data-expression="warm"/)
  assert.match(renderToStaticMarkup(<CastanyeraScene errors={errors} mood="loss" />), /data-expression="sad"/)
}
console.log('Six-error character mapping, accessories, rescue and accessibility passed')
