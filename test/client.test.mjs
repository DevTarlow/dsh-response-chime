/**
 * Contract and behaviour tests for the browser half.
 *
 * Runs on plain Node. The React hook surface is stubbed to the minimum the
 * component uses — there is no DOM and no renderer here — so what is asserted
 * is the module contract the Harness loader relies on, the wiring `apply()`
 * performs, and the one rule that makes the plugin worth installing: a chime on
 * a running-to-idle transition, and silence everywhere else.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

/** The bundle under test, loaded fresh for each case. */
const CLIENT_URL = new URL('../client.js', import.meta.url)

/** Cache-buster, so every case gets a module instance with its own module state. */
let loads = 0

/**
 * Load `client.js` against a stub page.
 * @returns {Promise<{registration: object, store: Map<string, string>, audio: {oscillators: number}, listeners: Map<string, Function>}>} The captured registration and the page the module saw.
 */
async function loadPlugin() {
  const store = new Map()
  const audio = { oscillators: 0 }
  const listeners = new Map()
  let registration
  globalThis.window = {
    __ModuleLoader__: { load(registered) { registration = registered } },
    localStorage: {
      getItem: key => store.get(key) ?? null,
      setItem: (key, value) => { store.set(key, value) },
    },
    // One AudioContext per page; the stub counts the notes it is asked to play.
    AudioContext: class {
      constructor() {
        this.state = 'suspended'
        this.currentTime = 0
        this.destination = {}
      }

      resume() {
        this.state = 'running'
        return Promise.resolve()
      }

      createGain() {
        return { gain: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }
      }

      createOscillator() {
        audio.oscillators += 1
        return { type: '', frequency: { setValueAtTime() {} }, connect() {}, start() {}, stop() {} }
      }
    },
    addEventListener: (type, listener) => { listeners.set(type, listener) },
    removeEventListener: (type) => { listeners.delete(type) },
  }
  loads += 1
  await import(`${CLIENT_URL.href}?load=${loads}`)
  return { registration, store, audio, listeners }
}

/**
 * A minimal hook surface: the component keeps its own state between renders and
 * its effects run after each one, which is all the chime rule depends on.
 *
 * Running every effect on every render is a superset of React's dependency
 * comparison; the component's status effect is written to be idempotent for an
 * unchanged snapshot, so the extra runs cannot produce an extra chime.
 * @returns {{ api: object, render: (component: Function, props: object) => object }} The stub and its renderer.
 */
function createHooks() {
  const cells = new Map()
  let cursor = 0
  let queued = []
  const api = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    useReducer: (reducer, initial) => {
      const index = cursor++
      if (!cells.has(index)) cells.set(index, initial)
      return [cells.get(index), action => { cells.set(index, reducer(cells.get(index), action)) }]
    },
    useState: initial => {
      const index = cursor++
      if (!cells.has(index)) cells.set(index, typeof initial === 'function' ? initial() : initial)
      return [cells.get(index), next => { cells.set(index, next) }]
    },
    useRef: initial => {
      const index = cursor++
      if (!cells.has(index)) cells.set(index, { current: initial })
      return cells.get(index)
    },
    useEffect: effect => { queued.push(effect) },
    useCallback: callback => callback,
  }
  const render = (component, props) => {
    cursor = 0
    queued = []
    const tree = component(props)
    for (const effect of queued) effect()
    return tree
  }
  return { api, render }
}

/**
 * Instantiate the plugin and apply it to a stub Client context.
 * @param {object} registration - Captured module registration.
 * @param {object} reactApi - Stub React surface the factory requires.
 * @returns {{ rows: object[], effects: string[], dicts: Map<string, object> }} What `apply` registered.
 */
function applyPlugin(registration, reactApi) {
  const rows = []
  const effects = []
  const dicts = new Map()
  const locale = {
    register: (namespace, id, dict) => {
      dicts.set(`${namespace}/${id}`, dict)
      return () => {}
    },
    bind: namespace => key => dicts.get(`${namespace}/en`)?.[key] ?? key,
    subscribe: () => () => {},
  }
  const ctx = {
    get: name => (name === 'locale' ? locale : undefined),
    effect: (callback, label) => { effects.push(label); callback() },
    slots: {
      inject: (key, callback) => callback(),
      register: (options, component) => { rows.push({ options, component }) },
    },
  }
  const plugin = registration.factory(specifier => {
    assert.equal(specifier, 'react', 'the browser half may request React and nothing else')
    return reactApi
  })
  plugin.apply(ctx)
  return { rows, effects, dicts }
}

/**
 * Read the footer button out of a rendered tree.
 * @param {object} tree - Component output.
 * @returns {object} The switch element.
 */
function switchOf(tree) {
  return tree.children[1]
}

/**
 * Props that hand the component one Session status snapshot.
 * @param {Record<string, object>} sessions - Status per Session id.
 * @returns {object} Slot props.
 */
function statusProps(sessions = {}) {
  return { wide: true, useSessionStatus: select => select(new Map(Object.entries(sessions))) }
}

test('registers one switch row under the package name', async () => {
  const page = await loadPlugin()
  assert.equal(page.registration.id, 'dsh-response-chime')
  assert.equal(typeof page.registration.factory, 'function')
})

test('apply contributes the sidebar row, both locales and the audio unlock', async () => {
  const page = await loadPlugin()
  const { api } = createHooks()
  const applied = applyPlugin(page.registration, api)

  assert.equal(applied.rows.length, 1)
  const { options } = applied.rows[0]
  assert.equal(options.name, 'sidebar.footer.action')
  assert.equal(options.id, 'response-chime')
  assert.equal(options.order, 30)
  assert.equal(options.label(), 'Response chime')

  assert.deepEqual([...applied.dicts.keys()], ['response-chime/en', 'response-chime/zh'])
  assert.equal(applied.dicts.get('response-chime/en').label, 'Response chime')

  assert.deepEqual(applied.effects, [
    'response-chime: en texts',
    'response-chime: zh texts',
    'response-chime: audio unlock',
  ])
  assert.ok(page.listeners.has('pointerdown'))
  assert.ok(page.listeners.has('keydown'))
})

test('the row is a switch that reflects its state', async () => {
  const page = await loadPlugin()
  const { api, render } = createHooks()
  const applied = applyPlugin(page.registration, api)

  const wide = switchOf(render(applied.rows[0].component, statusProps()))
  assert.equal(wide.type, 'button')
  assert.equal(wide.props.role, 'switch')
  assert.equal(wide.props['aria-checked'], true, 'the chime is on by default')
  assert.equal(wide.props['aria-label'], 'Response chime')
  assert.ok(wide.children.some(child => child?.props?.className === 'dsh-rc-track'))

  const rail = switchOf(render(applied.rows[0].component, { ...statusProps(), wide: false }))
  assert.match(rail.props.className, /dsh-rc-rail/)
  assert.ok(!rail.children.some(child => child?.props?.className === 'dsh-rc-track'), 'the rail shows no track')
})

test('chimes when a running Session stops, and not before', async () => {
  const page = await loadPlugin()
  const { api, render } = createHooks()
  const applied = applyPlugin(page.registration, api)
  const component = applied.rows[0].component

  render(component, statusProps({ s1: { running: true } }))
  assert.equal(page.audio.oscillators, 0, 'the first snapshot is the baseline, not an answer')

  render(component, statusProps({ s1: { running: false } }))
  assert.equal(page.audio.oscillators, 2, 'a two-note chime when the turn ends')

  render(component, statusProps({ s1: { running: false } }))
  assert.equal(page.audio.oscillators, 2, 'a Session that stays idle chimes once')

  render(component, statusProps({ s1: { running: true }, s2: { running: false } }))
  assert.equal(page.audio.oscillators, 2, 'a Session appearing already idle is not an answer')

  render(component, statusProps({ s1: { running: false }, s2: { running: false } }))
  assert.equal(page.audio.oscillators, 4, 'the second turn ends with its own chime')
})

test('stays silent while switched off, and previews when switched on', async () => {
  const page = await loadPlugin()
  const { api, render } = createHooks()
  const applied = applyPlugin(page.registration, api)
  const component = applied.rows[0].component

  switchOf(render(component, statusProps({ s1: { running: true } }))).props.onClick()
  const off = switchOf(render(component, statusProps({ s1: { running: true } })))
  assert.equal(off.props['aria-checked'], false)
  assert.equal(page.audio.oscillators, 0, 'switching off is silent')
  assert.equal(JSON.parse(page.store.get('dsh.response-chime.v1')).enabled, false)

  render(component, statusProps({ s1: { running: false } }))
  assert.equal(page.audio.oscillators, 0, 'a finished turn is silent while off')

  switchOf(render(component, statusProps({ s1: { running: false } }))).props.onClick()
  assert.equal(page.audio.oscillators, 2, 'switching on plays a preview')
  assert.equal(JSON.parse(page.store.get('dsh.response-chime.v1')).enabled, true)
})

test('a stored switch state survives a reload', async () => {
  const first = await loadPlugin()
  const firstHooks = createHooks()
  const firstApplied = applyPlugin(first.registration, firstHooks.api)
  switchOf(firstHooks.render(firstApplied.rows[0].component, statusProps())).props.onClick()
  assert.equal(JSON.parse(first.store.get('dsh.response-chime.v1')).enabled, false)

  // Same page storage, fresh module: the switch comes back off.
  const second = await loadPlugin()
  for (const [key, value] of first.store) second.store.set(key, value)
  const secondHooks = createHooks()
  const secondApplied = applyPlugin(second.registration, secondHooks.api)
  const row = switchOf(secondHooks.render(secondApplied.rows[0].component, statusProps()))
  assert.equal(row.props['aria-checked'], false)
})
