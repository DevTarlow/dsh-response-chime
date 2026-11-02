/**
 * Contract and behaviour tests for the browser half.
 *
 * Runs on plain Node. The React hook surface is stubbed to the minimum the
 * component uses — there is no DOM and no renderer here — so what is asserted
 * is the module contract the Harness loader relies on, the wiring `apply()`
 * performs, the settings schema, and the one rule that makes the plugin worth
 * installing: a chime on a running-to-idle transition, and silence everywhere
 * else.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

/** The bundle under test, loaded fresh for each case. */
const CLIENT_URL = new URL('../client.js', import.meta.url)

/** Cache-buster, so every case gets a module instance with its own module state. */
let loads = 0

/** Let queued IndexedDB/decode promises settle before asserting. */
async function settle(rounds = 12) {
  for (let round = 0; round < rounds; round += 1) {
    await new Promise(resolve => setTimeout(resolve, 0))
  }
}

/**
 * A minimal IndexedDB with one Map-backed store per name. The component only
 * uses `open`, `transaction`, `get`, `put` and `delete`, and every request
 * answers on a microtask like the real API.
 * @returns {{ stores: Map<string, Map<string, unknown>> }} The fake database.
 */
function createIdb() {
  const stores = new Map()
  const storeOf = name => {
    if (!stores.has(name)) stores.set(name, new Map())
    return stores.get(name)
  }
  return {
    stores,
    open() {
      const request = {}
      queueMicrotask(() => {
        const db = {
          objectStoreNames: { contains: name => stores.has(name) },
          createObjectStore: name => { storeOf(name) },
          transaction: name => {
            const map = storeOf(name)
            return {
              objectStore: () => ({
                get(key) {
                  const result = {}
                  queueMicrotask(() => {
                    result.result = map.get(key)
                    result.onsuccess?.()
                  })
                  return result
                },
                put(value, key) {
                  map.set(key, value)
                  const result = {}
                  queueMicrotask(() => {
                    result.result = key
                    result.onsuccess?.()
                  })
                  return result
                },
                delete(key) {
                  map.delete(key)
                  const result = {}
                  queueMicrotask(() => { result.onsuccess?.() })
                  return result
                },
              }),
            }
          },
        }
        request.result = db
        if (!stores.has('clips')) request.onupgradeneeded?.()
        request.onsuccess?.()
      })
      return request
    },
  }
}

/**
 * Load `client.js` against a stub page.
 * @param {{ storage?: Map<string, string>, idb?: ReturnType<typeof createIdb> }} [options] - Shared page storage.
 * @returns {Promise<object>} The captured registration and the page the module saw.
 */
async function loadPlugin(options = {}) {
  const store = options.storage ?? new Map()
  const idb = options.idb ?? createIdb()
  const audio = { oscillators: 0, bufferSources: 0, decodes: 0, gains: [] }
  const listeners = new Map()
  const documentListeners = new Map()
  const doc = {
    visibilityState: 'visible',
    listeners: documentListeners,
    hasFocus: () => true,
    addEventListener: (type, listener) => { documentListeners.set(type, listener) },
    removeEventListener: type => { documentListeners.delete(type) },
  }
  let registration
  globalThis.window = {
    __ModuleLoader__: { load(registered) { registration = registered } },
    localStorage: {
      getItem: key => store.get(key) ?? null,
      setItem: (key, value) => { store.set(key, value) },
    },
    innerWidth: 1280,
    innerHeight: 800,
    // One AudioContext per page; the stub counts the notes it is asked to play
    // and records the master gains so a volume assertion can read them.
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
        const gain = {
          value: 0,
          setValueAtTime() {},
          exponentialRampToValueAtTime() {},
        }
        audio.gains.push(gain)
        return { gain, connect() {} }
      }

      createOscillator() {
        audio.oscillators += 1
        return {
          type: '',
          frequency: { setValueAtTime() {} },
          connect() {},
          start() {},
          stop() {},
        }
      }

      createBufferSource() {
        audio.bufferSources += 1
        return {
          buffer: null,
          connect() {},
          start() {},
        }
      }

      decodeAudioData(bytes, resolve) {
        audio.decodes += 1
        resolve({
          duration: 0.5,
          numberOfChannels: 1,
          getChannelData: () => new Float32Array([0.5, -0.5]),
        })
      }
    },
    indexedDB: idb,
    addEventListener: (type, listener) => { listeners.set(type, listener) },
    removeEventListener: type => { listeners.delete(type) },
  }
  globalThis.document = doc
  loads += 1
  await import(`${CLIENT_URL.href}?load=${loads}`)
  return { registration, store, audio, listeners, idb, doc }
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
  // The component uses small function components for pieces with no hooks
  // (icons, the switch row, the range row) and maps arrays of children. Both
  // are flattened so the returned tree is inspectable without a DOM renderer.
  const expandChild = child => {
    if (Array.isArray(child)) return child.flatMap(expandChild)
    return [expand(child)]
  }
  const expand = node => {
    if (node === null || typeof node !== 'object') return node
    if (typeof node.type === 'function') return expand(node.type(node.props))
    return { ...node, children: (node.children ?? []).flatMap(expandChild) }
  }
  const render = (component, props) => {
    cursor = 0
    queued = []
    const tree = expand(component(props))
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
 * Props that hand the component one Session status snapshot. The snapshot is
 * built once per props object, so repeated renders with the same object are
 * genuinely unchanged snapshots.
 * @param {Record<string, object>} sessions - Status per Session id.
 * @returns {object} Slot props.
 */
function statusProps(sessions = {}) {
  const snapshot = new Map(Object.entries(sessions))
  return { wide: true, useSessionStatus: select => select(snapshot) }
}

/** The settings trigger. */
function triggerOf(tree) {
  return tree.children[1]
}

/** The panel, or null while it is closed. */
function panelOf(tree) {
  return tree.children[2]
}

/** Depth-first search for the first node matching a predicate. */
function find(node, predicate) {
  if (node === null || typeof node !== 'object') return undefined
  if (predicate(node)) return node
  for (const child of node.children ?? []) {
    const found = find(child, predicate)
    if (found !== undefined) return found
  }
  return undefined
}

/** Every node matching a predicate. */
function findAll(node, predicate, found = []) {
  if (node === null || typeof node !== 'object') return found
  if (predicate(node)) found.push(node)
  for (const child of node.children ?? []) findAll(child, predicate, found)
  return found
}

/** Whether a rendered subtree contains one exact text. */
function hasText(node, text) {
  if (typeof node === 'string') return node === text
  if (node === null || typeof node !== 'object') return false
  return (node.children ?? []).some(child => hasText(child, text))
}

/** The switch whose label contains the text. */
function switchWithText(tree, text) {
  return find(tree, node => node.props?.role === 'switch' && hasText(node, text))
}

/** The button whose visible text is the label. */
function buttonWithText(tree, text) {
  return find(tree, node => node.type === 'button' && hasText(node, text))
}

/** Open the panel and return the render that contains it. */
function openPanel(component, props, render) {
  let tree = render(component, props)
  triggerOf(tree).props.onClick()
  tree = render(component, props)
  return tree
}

test('registers one settings row under the package name', async () => {
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
  assert.equal(applied.dicts.get('response-chime/en').settings, 'Audio settings')
  assert.equal(applied.dicts.get('response-chime/zh').settings, '音频设置')
  assert.deepEqual(
    Object.keys(applied.dicts.get('response-chime/en')).sort(),
    Object.keys(applied.dicts.get('response-chime/zh')).sort(),
    'both locales carry the same keys',
  )

  assert.deepEqual(applied.effects, [
    'response-chime: en texts',
    'response-chime: zh texts',
    'response-chime: audio unlock',
  ])
  assert.ok(page.listeners.has('pointerdown'))
  assert.ok(page.listeners.has('keydown'))
})

test('the footer row is a dialog trigger, not a switch', async () => {
  const page = await loadPlugin()
  const { api, render } = createHooks()
  const applied = applyPlugin(page.registration, api)
  const props = statusProps()
  const tree = render(applied.rows[0].component, props)
  const trigger = triggerOf(tree)

  assert.equal(trigger.type, 'button')
  assert.equal(trigger.props['aria-haspopup'], 'dialog')
  assert.equal(trigger.props['aria-expanded'], false)
  assert.equal(trigger.props['aria-label'], 'Audio settings')
  assert.equal(trigger.props.role, undefined)
  assert.ok(hasText(trigger, 'Audio settings'))
  assert.ok(hasText(trigger, 'On'))

  const railTree = render(applied.rows[0].component, { ...props, wide: false })
  assert.match(railTree.props.className, /dsh-rc-layerRail/)
})

test('the panel opens with every setting and closes on Escape or an outside click', async () => {
  const page = await loadPlugin()
  const { api, render } = createHooks()
  const applied = applyPlugin(page.registration, api)
  const component = applied.rows[0].component
  const props = statusProps()
  let tree = openPanel(component, props, render)

  const panel = panelOf(tree)
  assert.ok(panel, 'the panel is mounted once opened')
  assert.equal(panel.props.role, 'dialog')
  assert.equal(panel.props['aria-label'], 'Audio settings')
  assert.equal(triggerOf(tree).props['aria-expanded'], true)

  assert.equal(switchWithText(panel, 'Play a sound').props['aria-checked'], true)
  assert.equal(switchWithText(panel, 'Only when this window is in the background').props['aria-checked'], false)
  assert.deepEqual(
    findAll(panel, node => node.props?.['data-sound'] !== undefined).map(node => node.props['data-sound']),
    ['chime', 'bell', 'drop', 'soft'],
  )
  assert.equal(find(panel, node => node.type === 'input' && node.props?.type === 'range').props.value, 100)
  assert.ok(find(panel, node => node.props?.className === 'dsh-rc-file'))
  assert.ok(buttonWithText(panel, 'Preview'))
  assert.ok(buttonWithText(panel, 'Reset sound settings'))

  buttonWithText(panel, 'Bell').props.onClick()
  tree = render(component, props)
  assert.equal(JSON.parse(page.store.get('dsh.response-chime.v2')).sound, 'bell')
  assert.equal(page.audio.oscillators, 3, 'a three-note bell previews when chosen')

  page.doc.listeners.get('keydown')({ key: 'Escape', stopPropagation() {} })
  tree = render(component, props)
  assert.equal(panelOf(tree), null)
  assert.equal(triggerOf(tree).props['aria-expanded'], false)

  tree = openPanel(component, props, render)
  page.doc.listeners.get('pointerdown')({ target: {} })
  tree = render(component, props)
  assert.equal(panelOf(tree), null)
})

test('a stored v1 choice migrates on read, and settings survive a reload', async () => {
  const storage = new Map([['dsh.response-chime.v1', JSON.stringify({ enabled: false })]])
  const first = await loadPlugin({ storage })
  const firstHooks = createHooks()
  const firstApplied = applyPlugin(first.registration, firstHooks.api)
  const component = firstApplied.rows[0].component
  const props = statusProps()
  let tree = openPanel(component, props, firstHooks.render)

  assert.equal(switchWithText(panelOf(tree), 'Play a sound').props['aria-checked'], false)

  switchWithText(panelOf(tree), 'Play a sound').props.onClick()
  tree = firstHooks.render(component, props)
  assert.equal(switchWithText(panelOf(tree), 'Play a sound').props['aria-checked'], true)
  const saved = JSON.parse(first.store.get('dsh.response-chime.v2'))
  assert.equal(saved.enabled, true)
  assert.equal(saved.volume, 1)
  assert.equal(saved.sound, 'chime')
  assert.equal(saved.onlyWhenAway, false)
  assert.equal(saved.custom, null)

  // A fresh module over the same page storage reads the v2 shape back.
  const second = await loadPlugin({ storage: first.store })
  const secondHooks = createHooks()
  const secondApplied = applyPlugin(second.registration, secondHooks.api)
  tree = openPanel(secondApplied.rows[0].component, props, secondHooks.render)
  assert.equal(switchWithText(panelOf(tree), 'Play a sound').props['aria-checked'], true)
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

test('turning the sound off from the panel is silent, and turning it on previews', async () => {
  const page = await loadPlugin()
  const { api, render } = createHooks()
  const applied = applyPlugin(page.registration, api)
  const component = applied.rows[0].component
  const props = statusProps({ s1: { running: true } })
  let tree = openPanel(component, props, render)

  switchWithText(panelOf(tree), 'Play a sound').props.onClick()
  tree = render(component, props)
  assert.equal(switchWithText(panelOf(tree), 'Play a sound').props['aria-checked'], false)
  assert.equal(page.audio.oscillators, 0, 'switching off is silent')
  assert.equal(JSON.parse(page.store.get('dsh.response-chime.v2')).enabled, false)

  render(component, statusProps({ s1: { running: false } }))
  assert.equal(page.audio.oscillators, 0, 'a finished turn is silent while off')

  tree = render(component, statusProps({ s1: { running: false } }))
  switchWithText(panelOf(tree), 'Play a sound').props.onClick()
  assert.equal(page.audio.oscillators, 2, 'switching on plays a preview')
  assert.equal(JSON.parse(page.store.get('dsh.response-chime.v2')).enabled, true)
})

test('the volume slider scales a normalized chime and persists', async () => {
  const page = await loadPlugin()
  const { api, render } = createHooks()
  const applied = applyPlugin(page.registration, api)
  const component = applied.rows[0].component
  const props = statusProps({ s1: { running: true } })
  const sliderOf = tree => find(panelOf(tree), node => node.type === 'input' && node.props?.type === 'range')
  let tree = openPanel(component, props, render)

  sliderOf(tree).props.onChange({ target: { value: '50' } })
  tree = render(component, props)
  assert.equal(JSON.parse(page.store.get('dsh.response-chime.v2')).volume, 0.5)
  assert.equal(sliderOf(tree).props.value, 50)
  assert.equal(page.audio.gains.length, 0, 'moving the slider alone does not play')

  render(component, statusProps({ s1: { running: false } }))
  assert.equal(page.audio.oscillators, 2)
  const half = page.audio.gains[0].value
  assert.ok(half > 0.2, 'the normalized chime is clearly audible at 50%')

  // Raise the slider to 100% and let a second turn end.
  tree = render(component, statusProps({ s1: { running: false } }))
  sliderOf(tree).props.onChange({ target: { value: '100' } })
  tree = render(component, statusProps({ s1: { running: false } }))
  assert.equal(JSON.parse(page.store.get('dsh.response-chime.v2')).volume, 1)
  render(component, statusProps({ s1: { running: true } }))
  const before = page.audio.gains.length
  render(component, statusProps({ s1: { running: false } }))
  const full = page.audio.gains[before].value
  assert.ok(full > half * 1.9 && full < half * 2.1, 'volume scales the master gain linearly')
  assert.ok(full > 0.5, '100% is much louder than the old fixed level')
})

test('a missing custom clip falls back to the built-in chime', async () => {
  const page = await loadPlugin()
  page.store.set('dsh.response-chime.v2', JSON.stringify({
    enabled: true,
    volume: 1,
    sound: 'custom',
    custom: { name: 'gone.wav', type: 'audio/wav', bytes: 4, seconds: 0.5 },
    onlyWhenAway: false,
  }))
  const { api, render } = createHooks()
  const applied = applyPlugin(page.registration, api)
  const component = applied.rows[0].component

  render(component, statusProps({ s1: { running: true } }))
  render(component, statusProps({ s1: { running: false } }))
  assert.equal(page.audio.oscillators, 2, 'the fallback is audible rather than silent')
  await settle()
  assert.equal(page.audio.bufferSources, 0)
})

test('a stored custom clip is loaded from IndexedDB and played after a reload', async () => {
  const idb = createIdb()
  idb.stores.set('clips', new Map([
    ['custom', new Blob([new Uint8Array([9, 8, 7])], { type: 'audio/wav' })],
  ]))
  const storage = new Map([['dsh.response-chime.v2', JSON.stringify({
    enabled: true,
    volume: 1,
    sound: 'custom',
    custom: { name: 'ding.wav', type: 'audio/wav', bytes: 3, seconds: 0.5 },
    onlyWhenAway: false,
  })]])
  const page = await loadPlugin({ storage, idb })
  const { api, render } = createHooks()
  const applied = applyPlugin(page.registration, api)
  const component = applied.rows[0].component

  render(component, statusProps({ s1: { running: true } }))
  page.listeners.get('pointerdown')({})
  await settle()
  assert.equal(page.audio.decodes, 1, 'the first gesture decodes the stored clip')
  assert.equal(page.audio.bufferSources, 0, 'decoding alone makes no sound')

  render(component, statusProps({ s1: { running: false } }))
  assert.equal(page.audio.bufferSources, 1, 'the stored clip plays on the finish')
  assert.equal(page.audio.oscillators, 0)
})

test('only-when-away suppresses the chime while the page is focused', async () => {
  const page = await loadPlugin()
  page.store.set('dsh.response-chime.v2', JSON.stringify({
    enabled: true, volume: 1, sound: 'chime', custom: null, onlyWhenAway: true,
  }))
  const { api, render } = createHooks()
  const applied = applyPlugin(page.registration, api)
  const component = applied.rows[0].component

  page.doc.visibilityState = 'visible'
  page.doc.hasFocus = () => true
  render(component, statusProps({ s1: { running: true } }))
  render(component, statusProps({ s1: { running: false } }))
  assert.equal(page.audio.oscillators, 0, 'a focused, visible page stays quiet')

  page.doc.hasFocus = () => false
  render(component, statusProps({ s1: { running: true } }))
  render(component, statusProps({ s1: { running: false } }))
  assert.equal(page.audio.oscillators, 2, 'an unfocused page is away')

  page.doc.hasFocus = () => true
  page.doc.visibilityState = 'hidden'
  render(component, statusProps({ s1: { running: true } }))
  render(component, statusProps({ s1: { running: false } }))
  assert.equal(page.audio.oscillators, 4, 'a hidden tab is away')
})

test('a custom WAV is stored, previewed, played on a finish, and removed', async () => {
  const page = await loadPlugin()
  const { api, render } = createHooks()
  const applied = applyPlugin(page.registration, api)
  const component = applied.rows[0].component
  const props = statusProps({ s1: { running: true } })
  let tree = openPanel(component, props, render)
  const input = find(panelOf(tree), node => node.props?.className === 'dsh-rc-file')
  const file = new File([new Uint8Array([1, 2, 3, 4])], 'ding.wav', { type: 'audio/wav' })

  input.props.onChange({ target: { files: [file], value: '' } })
  await settle()

  const stored = JSON.parse(page.store.get('dsh.response-chime.v2'))
  assert.equal(stored.sound, 'custom')
  assert.equal(stored.custom.name, 'ding.wav')
  assert.equal(stored.custom.bytes, 4)
  assert.equal(page.audio.decodes, 1)
  assert.equal(page.audio.bufferSources, 1, 'the new clip previews once')
  assert.ok(page.idb.stores.get('clips').get('custom') instanceof Blob)

  tree = render(component, props)
  assert.equal(find(panelOf(tree), node => node.props?.['data-sound'] === 'custom').props['aria-pressed'], true)

  render(component, statusProps({ s1: { running: false } }))
  assert.equal(page.audio.bufferSources, 2, 'a finish plays the stored clip')
  assert.equal(page.audio.oscillators, 0, 'the built-in chime is not mixed in')

  tree = render(component, statusProps({ s1: { running: false } }))
  buttonWithText(panelOf(tree), 'Remove').props.onClick()
  await settle()

  const removed = JSON.parse(page.store.get('dsh.response-chime.v2'))
  assert.equal(removed.custom, null)
  assert.equal(removed.sound, 'chime')
  assert.equal(page.idb.stores.get('clips').get('custom'), undefined)
  tree = render(component, statusProps({ s1: { running: false } }))
  assert.equal(find(panelOf(tree), node => node.props?.['data-sound'] === 'custom'), undefined)
})
