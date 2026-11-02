/**
 * Response Chime browser half.
 *
 * One contribution: a switch beside Settings at the foot of the left sidebar.
 * While it is on, the module watches the Session status the slot already
 * publishes and plays a two-note chime when a turn that was running stops —
 * the moment the model has finished answering, whether the person is still
 * watching or has walked away.
 *
 * Why this shape:
 *
 * - The status arrives through the slot's own `useSessionStatus` hook, so this
 *   module never folds Session events, polls an agent, or touches the DOM. It
 *   subscribes to one slice and compares two snapshots.
 * - The sound is synthesized with WebAudio instead of shipped as an audio file:
 *   no asset, no autoplay-blocked `<audio>` source, and nothing to license.
 *   Browsers keep a page's audio graph running in a background tab, which is
 *   exactly the case this plugin exists for.
 * - The switch state lives in localStorage, the way the Host's other client
 *   preferences do. There is no Host half to ask: the row is inert and the
 *   package installs no service.
 * - Every style is a theme token or a `color-mix()` of one, and the `<style>`
 *   element is a React child, so uninstalling restores the sidebar exactly.
 *
 * @module dsh-response-chime/client
 */

window.__ModuleLoader__.load({
  id: 'dsh-response-chime',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useReducer, useRef, useState } = React

    /** Switch state, versioned so a changed shape is a new key rather than a crash. */
    const STORAGE_KEY = 'dsh.response-chime.v1'

    /** Locale namespace this module registers its own texts under. */
    const LOCALE_NS = 'response-chime'

    /** Texts for the two baseline locales; other locales fall back to English. */
    const TEXTS = {
      en: {
        label: 'Response chime',
        on: 'On',
        off: 'Off',
      },
      zh: {
        label: '回复提示音',
        on: '已开启',
        off: '已关闭',
      },
    }

    /**
     * The two notes of the chime. A rising fifth is the shape people already
     * read as "finished" rather than "wrong", and the decay is long enough to
     * carry across a room without ringing over the next thought.
     */
    const CHIME_NOTES = [
      { frequency: 880, offset: 0, decay: 0.55, gain: 0.5 },
      { frequency: 1174.66, offset: 0.13, decay: 0.9, gain: 0.42 },
    ]

    /** Master level, low enough that a quiet room is not startled. */
    const CHIME_LEVEL = 0.22

    /** Stable empty snapshot for a context without the Session status hook. */
    const NO_STATUS = new Map()

    /** Translation function; replaced by the locale service when it is there. */
    let translate = key => TEXTS.en[key] ?? key

    /** The Client locale service, kept for the subscription that follows a switch. */
    let localeService

    /** One AudioContext per loaded module; browsers cap how many a page may create. */
    let audioContext = null

    /**
     * Read the stored switch state. Anything unreadable counts as on, because a
     * notification someone asked for going quiet is the failure worth avoiding.
     * @returns {boolean} Whether the chime plays.
     */
    function readEnabled() {
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY)
        if (raw === null) return true
        const parsed = JSON.parse(raw)
        return typeof parsed?.enabled === 'boolean' ? parsed.enabled : true
      } catch {
        return true
      }
    }

    /**
     * Store the switch state.
     * @param {boolean} enabled - Whether the chime plays.
     */
    function writeEnabled(enabled) {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ enabled }))
      } catch {
        // A browser that refuses storage costs the preference, not the sound.
      }
    }

    /**
     * The page's AudioContext, created on first use.
     *
     * Creation is left until a user gesture on purpose: a context built before
     * one starts suspended, and every later `resume()` outside a gesture is
     * ignored, which would make the switch look broken with no error anywhere.
     * @returns {AudioContext | null} The context, or null where WebAudio is absent.
     */
    function ensureAudioContext() {
      if (audioContext !== null) return audioContext
      const Ctor = window.AudioContext ?? window.webkitAudioContext
      if (Ctor === undefined) return null
      try {
        audioContext = new Ctor()
      } catch {
        return null
      }
      return audioContext
    }

    /** Start (or restart) the audio clock; safe to call outside a gesture. */
    function unlockAudio() {
      const audio = ensureAudioContext()
      if (audio === null || audio.state !== 'suspended') return
      void audio.resume().catch(() => {})
    }

    /**
     * Play the chime.
     *
     * Notes are scheduled against the context clock, which does not advance
     * while the context is suspended — so a chime requested a moment before the
     * page is allowed to make sound still plays from its beginning rather than
     * arriving half-finished.
     */
    function playChime() {
      const audio = ensureAudioContext()
      if (audio === null) return
      if (audio.state === 'suspended') void audio.resume().catch(() => {})
      const now = audio.currentTime
      const master = audio.createGain()
      master.gain.value = CHIME_LEVEL
      master.connect(audio.destination)
      for (const note of CHIME_NOTES) {
        const at = now + note.offset
        const oscillator = audio.createOscillator()
        oscillator.type = 'sine'
        oscillator.frequency.setValueAtTime(note.frequency, at)
        const envelope = audio.createGain()
        // An exponential ramp cannot touch zero, so the envelope starts and
        // ends a hair above it and the note is silent either side of the shape.
        envelope.gain.setValueAtTime(0.0001, at)
        envelope.gain.exponentialRampToValueAtTime(note.gain, at + 0.012)
        envelope.gain.exponentialRampToValueAtTime(0.0001, at + note.decay)
        oscillator.connect(envelope)
        envelope.connect(master)
        oscillator.start(at)
        oscillator.stop(at + note.decay + 0.05)
      }
    }

    /** @returns {boolean} Whether a Session status hook was supplied for this slot. */
    function useNoStatus() {
      return NO_STATUS
    }

    /**
     * Read the Session status snapshot through the slot's own selector hook.
     * @param {Function | undefined} useSessionStatus - Standard slot hook.
     * @returns {ReadonlyMap<string, { running: boolean | undefined }>} Current status by Session id.
     */
    function useStatus(useSessionStatus) {
      const hook = typeof useSessionStatus === 'function' ? useSessionStatus : useNoStatus
      return hook(snapshot => snapshot)
    }

    /**
     * Read the module's texts, re-rendering when the active locale changes.
     * @returns {(key: string) => string} Translate function over this namespace.
     */
    function useTranslate() {
      const [, bump] = useReducer(version => version + 1, 0)
      useEffect(() => {
        if (localeService === undefined) return undefined
        return localeService.subscribe(() => { bump() })
      }, [])
      return translate
    }

    /**
     * The speaker glyph; a slash replaces the waves while the chime is off.
     * @param {{ muted: boolean, size: number }} props - State and requested square edge.
     * @returns {React.ReactElement} The icon.
     */
    function SpeakerIcon({ muted, size }) {
      const stroke = {
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.6,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      }
      const waves = muted
        ? h('path', Object.assign({ d: 'M15.5 9.5l5 5m0-5l-5 5' }, stroke))
        : h('g', null,
          h('path', Object.assign({ d: 'M15.5 9a4.6 4.6 0 0 1 0 6' }, stroke)),
          h('path', Object.assign({ d: 'M18.5 6.5a8 8 0 0 1 0 11' }, stroke)))
      return h('svg', {
        viewBox: '0 0 24 24',
        width: size,
        height: size,
        'aria-hidden': true,
        focusable: 'false',
        style: { display: 'block', flex: 'none' },
      },
        h('path', Object.assign({ d: 'M4.5 9h3L12 5.5v13L7.5 15h-3z' }, stroke)),
        waves)
    }

    /** Styles for the row and its switch; theme tokens only. */
    const UI_CSS = `
.dsh-rc-holder { display: flex; flex: 0 0 auto; align-items: center; min-width: 0; }
.dsh-rc-row { box-sizing: border-box; display: inline-flex; align-items: center; gap: 8px; height: 42px; margin: 0; padding: 0 10px 0 8px; border: none; border-radius: 12px; background: transparent; color: var(--dsw-alias-label-primary); font-family: inherit; font-size: 14px; cursor: pointer; }
.dsh-rc-row:hover { background: color-mix(in srgb, var(--dsw-alias-label-primary) 8%, transparent); }
.dsh-rc-row:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.dsh-rc-rail { width: 36px; height: 36px; padding: 0; justify-content: center; border-radius: 50%; }
.dsh-rc-track { box-sizing: border-box; display: block; flex: 0 0 auto; width: 36px; height: 20px; padding: 2px; border-radius: 999px; corner-shape: round; background: var(--dsw-alias-border-l3); transition: background 120ms ease; }
.dsh-rc-row[aria-checked='true'] .dsh-rc-track { background: var(--dsw-alias-brand-primary); }
.dsh-rc-thumb { display: block; width: 16px; height: 16px; border-radius: 50%; corner-shape: round; background: var(--dsw-alias-switch-thumb); transition: transform 120ms ease, background 120ms ease; }
.dsh-rc-row[aria-checked='true'] .dsh-rc-thumb { transform: translateX(16px); background: var(--dsw-alias-label-primary-foreground); }
`

    /**
     * The sidebar switch. The whole row is one switch control, so the track is
     * decoration: the accessible name and the state live on the button, and a
     * click anywhere on the row toggles it.
     * @param {object} props - Slot props: `wide` from the sidebar, `useSessionStatus` from the standard kit.
     * @returns {React.ReactElement} The footer row.
     */
    function ResponseChime({ wide, useSessionStatus }) {
      const t = useTranslate()
      const [enabled, setEnabled] = useState(readEnabled)
      const status = useStatus(useSessionStatus)
      const previous = useRef(null)

      // Compare consecutive snapshots: a Session that was running and no longer
      // is has just answered. The first snapshot is the baseline, not an answer,
      // so a page opened mid-turn does not chime on load.
      useEffect(() => {
        if (status === undefined || status === null) return
        const before = previous.current
        if (before === status) return
        previous.current = status
        if (before === null) return
        let answered = false
        for (const [sessionId, value] of status) {
          const prior = before.get(sessionId)
          if (prior !== undefined && prior.running === true && value !== undefined && value.running === false) {
            answered = true
            break
          }
        }
        if (answered && enabled) playChime()
      }, [status, enabled])

      const toggle = useCallback(() => {
        const next = !enabled
        setEnabled(next)
        writeEnabled(next)
        // Turning it on is a gesture, so the preview both confirms the switch
        // and gives the audio clock the permission it needs for later chimes.
        if (next) {
          unlockAudio()
          playChime()
        }
      }, [enabled])

      const label = t('label')
      const wideBar = wide !== false
      return h('div', { className: 'dsh-rc-holder' },
        h('style', null, UI_CSS),
        h('button', {
          type: 'button',
          role: 'switch',
          'aria-checked': enabled,
          'aria-label': label,
          title: `${label} · ${enabled ? t('on') : t('off')}`,
          className: wideBar ? 'dsh-rc-row' : 'dsh-rc-row dsh-rc-rail',
          onClick: toggle,
        },
        h(SpeakerIcon, { muted: !enabled, size: wideBar ? 16 : 18 }),
        wideBar
          ? h('span', { className: 'dsh-rc-track', 'aria-hidden': true },
            h('span', { className: 'dsh-rc-thumb' }))
          : null))
    }

    /**
     * Register the row and the audio unlock for the Client run's lifetime.
     * @param {object} ctx - Client context, carrying the `slots` and `locale` services.
     */
    function apply(ctx) {
      const locale = ctx.get('locale')
      if (locale !== undefined) {
        localeService = locale
        for (const [id, dict] of Object.entries(TEXTS)) {
          ctx.effect(() => locale.register(LOCALE_NS, id, dict), `response-chime: ${id} texts`)
        }
        translate = locale.bind(LOCALE_NS)
      }

      // A page is allowed to make sound only after a gesture, and the person
      // will certainly click or type on the way to starting a turn. Hooking the
      // first of those is what keeps the chime audible when the turn ends on an
      // idle page they have since walked away from.
      ctx.effect(() => {
        window.addEventListener('pointerdown', unlockAudio, true)
        window.addEventListener('keydown', unlockAudio, true)
        return () => {
          window.removeEventListener('pointerdown', unlockAudio, true)
          window.removeEventListener('keydown', unlockAudio, true)
        }
      }, 'response-chime: audio unlock')

      ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
        name: 'sidebar.footer.action',
        id: 'response-chime',
        order: 30,
        // A thunk, so the accessible name follows the active locale.
        label: () => translate('label'),
      }, ResponseChime))
    }

    return { inject: ['slots'], apply }
  },
})
