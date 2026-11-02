// A WebDriver BiDi session for the standalone browser checks (Firefox, Node's built-in WebSocket, no npm dependency):
//   firefox --headless --no-remote --profile DIR --remote-debugging-port 9222
// Each helper takes a browsing context; console errors are collected for a final assertion.
export async function openBidiSession(origin, url = process.env.BIDI_URL || 'ws://127.0.0.1:9222') {
  const ws = new WebSocket(`${url}/session`)
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject })
  let id = 0
  const pending = new Map()
  const errors = []
  ws.onmessage = ({ data }) => {
    const message = JSON.parse(data)
    if (message.method === 'log.entryAdded' && message.params.level === 'error') errors.push(message.params.text)
    const request = pending.get(message.id)
    if (!request) return
    pending.delete(message.id); clearTimeout(request.timer)
    if (message.type === 'error') request.reject(new Error(`${message.error}: ${message.message}`)); else request.resolve(message.result)
  }
  const command = (method, params = {}) => new Promise((resolve, reject) => {
    const requestId = ++id
    const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`Timed out: ${method}`)) }, 15000)
    pending.set(requestId, { resolve, reject, timer })
    ws.send(JSON.stringify({ id: requestId, method, params }))
  })
  const evaluate = async (context, expression) => {
    const result = await command('script.evaluate', { expression, target: { context }, awaitPromise: true, userActivation: true })
    if (result.type === 'exception') throw new Error(JSON.stringify(result.exceptionDetails))
    return result.result.type === 'null' ? null : result.result.value
  }
  const waitFor = async (context, expression, timeout = 7000) => {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) { if (await evaluate(context, expression).catch(() => false)) return; await new Promise((resolve) => setTimeout(resolve, 50)) }
    throw new Error(`Browser condition failed: ${expression}\n${await evaluate(context, 'document.body.innerText').catch(() => '')}`)
  }
  const navigate = (context, path) => command('browsingContext.navigate', { context, url: new URL(path, origin).href, wait: 'complete' })
  const contexts = []
  const newTab = async (userContext) => { const { context } = await command('browsingContext.create', { type: 'tab', userContext }); contexts.push(context); return context }
  await command('session.new', { capabilities: {} })
  await command('session.subscribe', { events: ['log.entryAdded'] })
  const close = async () => {
    for (const context of contexts.reverse()) await command('browsingContext.close', { context }).catch(() => {})
    await command('session.end').catch(() => {})
    ws.close()
  }
  return { command, evaluate, waitFor, navigate, newTab, close, errors }
}
