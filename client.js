/**
 * Response Chime browser half.
 *
 * One contribution: an "Audio settings" row beside Settings at the foot of the
 * left sidebar. The row opens an anchored panel, the same interaction model as
 * the Background Swapper, and the panel owns everything the chime needs:
 * on/off, volume, a choice of built-in sounds, a custom WAV/MP3, and a
 * background-only mode.
 *
 * While the chime is on, the module watches the Session status the slot
 * already publishes and plays the chosen sound when a turn that was running
 * stops — the moment the model has finished answering, whether the person is
 * still watching or has walked away.
 *
 * Why this shape:
 *
 * - The status arrives through the slot's own `useSessionStatus` hook, so this
 *   module never folds Session events, polls an agent, or touches the DOM. It
 *   subscribes to one slice and compares two snapshots.
 * - The built-in sounds are synthesized with WebAudio instead of shipped as
 *   audio files: no assets, no autoplay-blocked `<audio>` sources, and nothing
 *   to license. A custom clip is decoded into an AudioBuffer for the same
 *   audio-clock scheduling.
 * - Settings live in localStorage, the way the Host's other client
 *   preferences do. A custom clip's bytes live in IndexedDB, which is the
 *   browser's place for a Blob; neither leaves the machine. There is no Host
 *   half to ask: the row is inert and the package installs no service.
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

    /** Settings state, versioned so a changed shape is a new key rather than a crash. */
    const SETTINGS_KEY = 'dsh.response-chime.v2'

    /** The previous version's key; only its `enabled` field is migrated on read. */
    const LEGACY_SETTINGS_KEY = 'dsh.response-chime.v1'

    /** Locale namespace this module registers its own texts under. */
    const LOCALE_NS = 'response-chime'

    /** Texts for the two baseline locales; other locales fall back to English. */
    const TEXTS = {
      en: {
        label: 'Response chime',
        settings: 'Audio settings',
        close: 'Close',
        response: 'Response sound',
        enabled: 'Play a sound',
        enabledHint: 'A sound when an answer finishes, whichever conversation it was in.',
        on: 'On',
        off: 'Off',
        volume: 'Volume',
        volumeHint: 'How loud the sound plays.',
        resetValue: 'Reset',
        sound: 'Sound',
        soundChime: 'Chime',
        soundBell: 'Bell',
        soundDrop: 'Drop',
        soundSoft: 'Soft',
        custom: 'Custom',
        noCustom: 'No custom sound',
        customHint: 'Choose a WAV or MP3 up to 5 MB and 30 seconds. The file stays in this browser.',
        chooseFile: 'Choose a file',
        replaceFile: 'Replace',
        removeFile: 'Remove',
        preparing: 'Checking…',
        preview: 'Preview',
        when: 'When to ring',
        onlyAway: 'Only when this window is in the background',
        onlyAwayHint: 'Stay quiet while you are looking at the conversation.',
        reset: 'Reset sound settings',
        resetHint: 'Volume, sound and background-only go back to their defaults. A custom file is kept.',
        fileTooLarge: 'That file is larger than 5 MB.',
        fileTooLong: 'That sound is longer than 30 seconds.',
        fileUnreadable: 'That file could not be read as audio. Choose a WAV or MP3.',
        fileSilent: 'That file has no audible sound.',
        storageUnavailable: 'This browser will not store the file. The built-in sounds still work.',
        audioUnavailable: 'This browser cannot play audio.',
        customMissing: 'The custom sound could not be loaded. The default chime will play instead.',
        customSound: 'Custom sound',
      },
      zh: {
        label: '回复提示音',
        settings: '音频设置',
        close: '关闭',
        response: '回复提示音',
        enabled: '播放提示音',
        enabledHint: '任意对话中的回答结束时播放声音。',
        on: '已开启',
        off: '已关闭',
        volume: '音量',
        volumeHint: '调整播放声音的响度。',
        resetValue: '重置',
        sound: '声音',
        soundChime: '提示音',
        soundBell: '铃铛',
        soundDrop: '水滴',
        soundSoft: '轻柔',
        custom: '自定义',
        noCustom: '未选择自定义声音',
        customHint: '选择不超过 5 MB、30 秒的 WAV 或 MP3 文件。文件只保存在当前浏览器中。',
        chooseFile: '选择文件',
        replaceFile: '更换',
        removeFile: '移除',
        preparing: '正在检查…',
        preview: '试听',
        when: '何时播放',
        onlyAway: '仅在窗口处于后台时',
        onlyAwayHint: '正在查看当前对话时保持安静。',
        reset: '恢复默认设置',
        resetHint: '音量、声音和后台设置恢复默认，自定义文件会保留。',
        fileTooLarge: '文件超过 5 MB。',
        fileTooLong: '声音超过 30 秒。',
        fileUnreadable: '无法读取该音频，请选择 WAV 或 MP3 文件。',
        fileSilent: '该文件没有声音。',
        storageUnavailable: '此浏览器无法保存该文件，内置声音仍可使用。',
        audioUnavailable: '此浏览器无法播放音频。',
        customMissing: '无法加载自定义声音，将改用默认提示音。',
        customSound: '自定义声音',
      },
    }

    /**
     * The built-in notes. A rising fifth is the shape people already read as
     * "finished" rather than "wrong"; the other three are the same idea in a
     * different colour. Every preset is scheduled on the audio clock.
     */
    const SOUND_PRESETS = {
      chime: [
        { frequency: 880, offset: 0, decay: 0.55, gain: 0.5, type: 'sine' },
        { frequency: 1174.66, offset: 0.13, decay: 0.9, gain: 0.42, type: 'sine' },
      ],
      bell: [
        { frequency: 1046.5, offset: 0, decay: 1.2, gain: 0.4, type: 'sine' },
        { frequency: 1568, offset: 0.02, decay: 1.4, gain: 0.28, type: 'triangle' },
        { frequency: 2093, offset: 0.02, decay: 0.9, gain: 0.16, type: 'sine' },
      ],
      drop: [
        { frequency: 987.77, offset: 0, decay: 0.35, gain: 0.45, type: 'sine' },
        { frequency: 659.25, offset: 0.11, decay: 0.7, gain: 0.4, type: 'sine' },
      ],
      soft: [
        { frequency: 659.25, offset: 0, decay: 0.8, gain: 0.4, type: 'sine' },
        { frequency: 987.77, offset: 0.18, decay: 0.9, gain: 0.18, type: 'sine' },
      ],
    }

    /** The order the panel lists the built-in sounds in. */
    const SOUND_ORDER = ['chime', 'bell', 'drop', 'soft']

    /** The text key for each built-in sound. */
    const SOUND_KEYS = {
      chime: 'soundChime',
      bell: 'soundBell',
      drop: 'soundDrop',
      soft: 'soundSoft',
    }

    /** The settings a library with no stored preference reports. */
    const DEFAULTS = Object.freeze({
      enabled: true,
      volume: 1,
      sound: 'chime',
      custom: null,
      onlyWhenAway: false,
    })

    /**
     * Peak amplitude every sound is normalized to at 100% volume.
     *
     * The original chime was a fixed 0.22 master times a 0.5 envelope, peaking
     * near 0.11 — about −19 dBFS, which is quiet next to a normal notification.
     * Normalizing to 0.8 (−1.9 dBFS) puts the slider's top end where people
     * expect it; the slider then scales it down.
     */
    const PLAY_LEVEL = 0.8

    /** Attack used by every synthesized note, in seconds. */
    const ATTACK_SECONDS = 0.012

    /** Grid used to estimate a preset's peak, in seconds. */
    const PEAK_SAMPLE_STEP = 0.0005

    /** Largest accepted custom clip, in bytes. */
    const MAX_CLIP_BYTES = 5 * 1024 * 1024

    /** Longest accepted custom clip, in seconds. */
    const MAX_CLIP_SECONDS = 30

    /** A clip quieter than this is refused rather than amplified into noise. */
    const CLIP_SILENCE = 0.0001

    /** A cap on normalization gain, so a near-silent clip is not blown up. */
    const CLIP_GAIN_CAP = 8

    /**
     * Estimate a preset's peak amplitude by summing its note envelopes on a
     * fine grid. The same exponential shapes the synth uses are repeated here,
     * so the master gain ({@link SOUND_GAIN}) can normalize the preset without
     * guessing or clipping.
     * @param {ReadonlyArray<{ offset: number, decay: number, gain: number }>} notes - Preset notes.
     * @returns {number} The estimated peak before the master gain.
     */
    function presetPeak(notes) {
      let horizon = 0
      for (const note of notes) horizon = Math.max(horizon, note.offset + note.decay)
      let peak = 0
      for (let time = 0; time <= horizon; time += PEAK_SAMPLE_STEP) {
        let total = 0
        for (const note of notes) {
          if (time < note.offset) continue
          const age = time - note.offset
          if (age >= note.decay) continue
          total += age < ATTACK_SECONDS
            ? 0.0001 * Math.pow(note.gain / 0.0001, age / ATTACK_SECONDS)
            : note.gain * Math.pow(0.0001 / note.gain, (age - ATTACK_SECONDS) / (note.decay - ATTACK_SECONDS))
        }
        if (total > peak) peak = total
      }
      return peak
    }

    /**
     * Master gain per built-in sound at 100% volume. Each preset peaks at
     * {@link PLAY_LEVEL}, so switching sounds changes the character without
     * changing the loudness.
     */
    const SOUND_GAIN = Object.fromEntries(
      Object.entries(SOUND_PRESETS).map(([id, notes]) => [
        id,
        PLAY_LEVEL / Math.max(0.05, presetPeak(notes)),
      ]),
    )

    /** The custom clip's IndexedDB database, store and key. */
    const CLIP_DB = 'dsh-response-chime'
    const CLIP_STORE = 'clips'
    const CLIP_KEY = 'custom'

    /** Panel width in pixels; also the value the placement math clamps against. */
    const PANEL_WIDTH = 360

    /** Stable empty snapshot for a context without the Session status hook. */
    const NO_STATUS = new Map()

    /** Translation function; replaced by the locale service when it is there. */
    let translate = key => TEXTS.en[key] ?? key

    /** The Client locale service, kept for the subscription that follows a switch. */
    let localeService

    /** One AudioContext per loaded module; browsers cap how many a page may create. */
    let audioContext = null

    /** The latest settings, readable from gesture listeners outside React. */
    let settingsNow = DEFAULTS

    /** The decoded custom clip, or null while it is absent or still loading. */
    let customClip = null

    /** The in-flight custom clip load, so concurrent unlocks decode once. */
    let clipLoad = null

    /** Set once a selected clip is known to be absent or unreadable, so a keypress does not retry it. */
    let clipMissing = false

    /** The cached IndexedDB handle; null means storage is unavailable. */
    let clipDb = null

    /** The in-flight IndexedDB open, so concurrent reads share one connection. */
    let clipDbLoad = null

    /** Bumped whenever the selected clip changes, so a stale decode cannot win. */
    let clipEpoch = 0

    /** @returns {boolean} Whether a value is a plain object. */
    function isRecord(value) {
      return typeof value === 'object' && value !== null && !Array.isArray(value)
    }

    /** @returns {boolean} Whether a value is a Blob. */
    function isBlob(value) {
      return typeof Blob !== 'undefined' && value instanceof Blob
    }

    /** A value limited to a range. */
    function clamp(value, min, max) {
      return Math.min(max, Math.max(min, value))
    }

    /** The message carried by a thrown value. */
    function messageOf(error) {
      return error instanceof Error ? error.message : String(error)
    }

    /**
     * Normalize a custom clip's metadata, or null when it is not usable.
     * @param {unknown} value - Stored custom metadata.
     * @returns {{ name: string, type: string, bytes: number, seconds: number } | null} Metadata.
     */
    function normalizeCustom(value) {
      if (!isRecord(value)) return null
      const name = typeof value.name === 'string' ? value.name.trim().slice(0, 80) : ''
      if (name === '') return null
      return {
        name,
        type: typeof value.type === 'string' ? value.type.slice(0, 80) : '',
        bytes: typeof value.bytes === 'number' && Number.isFinite(value.bytes) && value.bytes > 0
          ? Math.round(value.bytes)
          : 0,
        seconds: typeof value.seconds === 'number' && Number.isFinite(value.seconds) && value.seconds > 0
          ? Math.round(value.seconds * 10) / 10
          : 0,
      }
    }

    /**
     * Coerce a stored value into the current settings shape.
     * @param {unknown} value - Parsed settings, or anything unreadable.
     * @returns {typeof DEFAULTS} The normalized settings.
     */
    function normalizeSettings(value) {
      const source = isRecord(value) ? value : {}
      const custom = normalizeCustom(source.custom)
      const named = typeof source.sound === 'string'
        && (SOUND_ORDER.includes(source.sound) || source.sound === 'custom')
        ? source.sound
        : DEFAULTS.sound
      return {
        enabled: typeof source.enabled === 'boolean' ? source.enabled : DEFAULTS.enabled,
        volume: typeof source.volume === 'number' && Number.isFinite(source.volume)
          ? Math.round(clamp(source.volume, 0, 1) * 100) / 100
          : DEFAULTS.volume,
        // A custom selection with no metadata has nothing to play, so it falls
        // back to the shipped chime rather than leaving a silent switch on.
        sound: named === 'custom' && custom === null ? 'chime' : named,
        custom,
        onlyWhenAway: typeof source.onlyWhenAway === 'boolean' ? source.onlyWhenAway : DEFAULTS.onlyWhenAway,
      }
    }

    /**
     * Read the stored settings. Anything unreadable counts as the defaults,
     * because a notification someone asked for going quiet is the failure worth
     * avoiding. A v1 value only contributes its `enabled` field.
     * @returns {typeof DEFAULTS} The settings to start from.
     */
    function readSettings() {
      let settings = DEFAULTS
      try {
        const raw = window.localStorage.getItem(SETTINGS_KEY)
        if (raw !== null) {
          settings = normalizeSettings(JSON.parse(raw))
        } else {
          const legacy = window.localStorage.getItem(LEGACY_SETTINGS_KEY)
          if (legacy !== null) {
            const parsed = JSON.parse(legacy)
            if (isRecord(parsed) && typeof parsed.enabled === 'boolean') {
              settings = { ...DEFAULTS, enabled: parsed.enabled }
            }
          }
        }
      } catch {
        settings = DEFAULTS
      }
      settingsNow = settings
      return settings
    }

    /**
     * Store the settings. A browser that refuses storage costs the preference,
     * not the sound.
     * @param {typeof DEFAULTS} settings - The complete settings value.
     */
    function writeSettings(settings) {
      settingsNow = settings
      try {
        window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
      } catch {
        // The live session still hears the change.
      }
    }

    /**
     * Open (once) the IndexedDB database holding the custom clip.
     * @returns {Promise<IDBDatabase | null>} The handle, or null where storage is unavailable.
     */
    function openClipDb() {
      if (clipDb !== null) return Promise.resolve(clipDb)
      if (clipDbLoad !== null) return clipDbLoad
      clipDbLoad = new Promise(resolve => {
        let request
        try {
          request = window.indexedDB?.open(CLIP_DB, 1)
        } catch {
          request = undefined
        }
        if (request === undefined || request === null) {
          resolve(null)
          return
        }
        request.onupgradeneeded = () => {
          const db = request.result
          if (!db.objectStoreNames.contains(CLIP_STORE)) db.createObjectStore(CLIP_STORE)
        }
        request.onsuccess = () => { resolve(request.result) }
        request.onerror = () => { resolve(null) }
        request.onblocked = () => { resolve(null) }
      }).then(db => {
        clipDb = db
        clipDbLoad = null
        return db
      })
      return clipDbLoad
    }

    /**
     * Read the stored clip.
     * @returns {Promise<Blob | null>} The bytes, or null when absent/unavailable.
     */
    async function readClipBlob() {
      const db = await openClipDb()
      if (db === null) return null
      return new Promise(resolve => {
        let request
        try {
          request = db.transaction(CLIP_STORE, 'readonly').objectStore(CLIP_STORE).get(CLIP_KEY)
        } catch {
          resolve(null)
          return
        }
        request.onsuccess = () => { resolve(isBlob(request.result) ? request.result : null) }
        request.onerror = () => { resolve(null) }
      })
    }

    /**
     * Replace the stored clip.
     * @param {Blob} blob - The clip bytes.
     * @returns {Promise<boolean>} Whether the write succeeded.
     */
    async function writeClipBlob(blob) {
      const db = await openClipDb()
      if (db === null) return false
      return new Promise(resolve => {
        let request
        try {
          request = db.transaction(CLIP_STORE, 'readwrite').objectStore(CLIP_STORE).put(blob, CLIP_KEY)
        } catch {
          resolve(false)
          return
        }
        request.onsuccess = () => { resolve(true) }
        request.onerror = () => { resolve(false) }
      })
    }

    /**
     * Delete the stored clip. A failure still lets the person drop the
     * selection; it only leaves an unreachable record behind.
     * @returns {Promise<boolean>} Whether the delete succeeded.
     */
    async function deleteClipBlob() {
      const db = await openClipDb()
      if (db === null) return false
      return new Promise(resolve => {
        let request
        try {
          request = db.transaction(CLIP_STORE, 'readwrite').objectStore(CLIP_STORE).delete(CLIP_KEY)
        } catch {
          resolve(false)
          return
        }
        request.onsuccess = () => { resolve(true) }
        request.onerror = () => { resolve(false) }
      })
    }

    /**
     * The page's AudioContext, created on first use.
     *
     * Creation is left until a user gesture on purpose: a context built before
     * one starts suspended, and every later `resume()` outside a gesture is
     * ignored, which would make the panel look broken with no error anywhere.
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
      if (audio !== null && audio.state === 'suspended') void audio.resume().catch(() => {})
      // A custom clip is decoded from the first gesture onward, so a chime
      // later in the turn does not have to wait for the decode. A clip already
      // known to be missing is not retried on every keystroke.
      if (settingsNow.sound === 'custom' && customClip === null && !clipMissing) void ensureCustomClip()
    }

    /**
     * Decode audio bytes with the page's context.
     * @param {ArrayBuffer} bytes - A copy the decoder is allowed to detach.
     * @returns {Promise<AudioBuffer>} The decoded buffer.
     */
    function decodeAudio(bytes) {
      const audio = ensureAudioContext()
      if (audio === null) return Promise.reject(new Error('audio unavailable'))
      return new Promise((resolve, reject) => {
        try {
          audio.decodeAudioData(bytes, buffer => { resolve(buffer) }, () => {
            reject(new Error('audio could not be decoded'))
          })
        } catch {
          reject(new Error('audio could not be decoded'))
        }
      })
    }

    /**
     * The largest absolute sample in a buffer.
     * @param {AudioBuffer} buffer - Decoded audio.
     * @returns {number} Peak amplitude from 0 to 1 (or more, for over-full decodes).
     */
    function peakOf(buffer) {
      let peak = 0
      try {
        for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
          const data = buffer.getChannelData(channel)
          for (let index = 0; index < data.length; index += 1) {
            const value = data[index] < 0 ? -data[index] : data[index]
            if (value > peak) peak = value
          }
        }
      } catch {
        return 0
      }
      return peak
    }

    /**
     * Turn a decoded buffer into a playable clip, refusing silence.
     * @param {AudioBuffer} buffer - Decoded audio.
     * @returns {{ buffer: AudioBuffer, gain: number, seconds: number } | null} The clip.
     */
    function makeClip(buffer) {
      const peak = peakOf(buffer)
      if (!(peak > CLIP_SILENCE)) return null
      return {
        buffer,
        // Normalize a quiet recording up and a hot one down, so the volume
        // slider means roughly the same thing for every custom file.
        gain: Math.min(CLIP_GAIN_CAP, PLAY_LEVEL / peak),
        seconds: buffer.duration,
      }
    }

    /**
     * Read and decode the stored clip, once per selection.
     * @returns {Promise<{ buffer: AudioBuffer, gain: number, seconds: number } | null>} The clip, or null.
     */
    function ensureCustomClip() {
      if (customClip !== null) return Promise.resolve(customClip)
      if (clipMissing) return Promise.resolve(null)
      if (clipLoad !== null) return clipLoad
      const epoch = clipEpoch
      const load = (async () => {
        const blob = await readClipBlob()
        if (blob === null) {
          if (epoch === clipEpoch) clipMissing = true
          return null
        }
        const buffer = await decodeAudio(await blob.arrayBuffer())
        const clip = makeClip(buffer)
        // The person may have replaced or removed the clip while this decode
        // was running; only the current selection may be installed.
        if (epoch !== clipEpoch) return null
        if (clip === null) {
          clipMissing = true
          return null
        }
        customClip = clip
        clipMissing = false
        return clip
      })().catch(() => {
        if (epoch === clipEpoch) clipMissing = true
        return null
      }).finally(() => {
        if (clipLoad === load) clipLoad = null
      })
      clipLoad = load
      return load
    }

    /**
     * Play one built-in sound at a volume.
     * @param {string} sound - One of {@link SOUND_PRESETS}.
     * @param {number} volume - 0 to 1.
     * @returns {boolean} Whether a context was available.
     */
    function playSynth(sound, volume) {
      const audio = ensureAudioContext()
      if (audio === null) return false
      if (audio.state === 'suspended') void audio.resume().catch(() => {})
      const notes = SOUND_PRESETS[sound] ?? SOUND_PRESETS.chime
      const master = audio.createGain()
      master.gain.value = volume * (SOUND_GAIN[sound] ?? SOUND_GAIN.chime)
      master.connect(audio.destination)
      const now = audio.currentTime
      for (const note of notes) {
        const at = now + note.offset
        const oscillator = audio.createOscillator()
        oscillator.type = note.type ?? 'sine'
        oscillator.frequency.setValueAtTime(note.frequency, at)
        const envelope = audio.createGain()
        // An exponential ramp cannot touch zero, so the envelope starts and
        // ends a hair above it and the note is silent either side of the shape.
        envelope.gain.setValueAtTime(0.0001, at)
        envelope.gain.exponentialRampToValueAtTime(note.gain, at + ATTACK_SECONDS)
        envelope.gain.exponentialRampToValueAtTime(0.0001, at + note.decay)
        oscillator.connect(envelope)
        envelope.connect(master)
        oscillator.start(at)
        oscillator.stop(at + note.decay + 0.05)
      }
      return true
    }

    /**
     * Play a decoded custom clip at a volume.
     * @param {{ buffer: AudioBuffer, gain: number }} clip - The decoded clip.
     * @param {number} volume - 0 to 1.
     * @returns {boolean} Whether a context was available.
     */
    function playClip(clip, volume) {
      const audio = ensureAudioContext()
      if (audio === null) return false
      if (audio.state === 'suspended') void audio.resume().catch(() => {})
      const master = audio.createGain()
      master.gain.value = volume * clip.gain
      master.connect(audio.destination)
      const source = audio.createBufferSource()
      source.buffer = clip.buffer
      source.connect(master)
      // The source starts on the audio clock, like the synthesized notes.
      source.start(audio.currentTime)
      return true
    }

    /**
     * Play the configured sound, falling back to the chime when a custom clip
     * is not ready. A notification must not wait on decoding; the fallback is
     * audible now and the custom clip is ready for the next finish.
     * @param {typeof DEFAULTS} settings - The current settings.
     * @returns {boolean} Whether a sound was started.
     */
    function playConfigured(settings) {
      if (settings.sound !== 'custom') return playSynth(settings.sound, settings.volume)
      if (customClip !== null) return playClip(customClip, settings.volume)
      void ensureCustomClip()
      return playSynth('chime', settings.volume)
    }

    /**
     * Whether the person is away from the page. A visible-but-unfocused
     * window counts as away, because they are working somewhere else.
     * @returns {boolean} Whether a background-only chime may play.
     */
    function isAway() {
      if (typeof document === 'undefined') return true
      if (document.visibilityState === 'hidden') return true
      return typeof document.hasFocus === 'function' ? !document.hasFocus() : false
    }

    /** A size in bytes as the panel's short readout. */
    function formatBytes(bytes) {
      if (!Number.isFinite(bytes) || bytes <= 0) return ''
      if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
      return `${Math.max(1, Math.round(bytes / 1024))} KB`
    }

    /**
     * The display name for a chosen file.
     * @param {string} name - The file's name.
     * @returns {string} A trimmed, bounded name.
     */
    function clipDisplayName(name) {
      const trimmed = typeof name === 'string' ? name.trim() : ''
      if (trimmed === '') return translate('customSound')
      return trimmed.length > 80 ? trimmed.slice(0, 80) : trimmed
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

    /** A play triangle for the preview control. */
    function PlayIcon({ size }) {
      return h('svg', {
        viewBox: '0 0 24 24',
        width: size,
        height: size,
        'aria-hidden': true,
        focusable: 'false',
        style: { display: 'block', flex: 'none' },
      }, h('path', { d: 'M8 5.5v13l10-6.5z', fill: 'currentColor' }))
    }

    /** The close glyph. */
    function CloseIcon({ size }) {
      return h('svg', {
        viewBox: '0 0 24 24',
        width: size,
        height: size,
        'aria-hidden': true,
        focusable: 'false',
        style: { display: 'block', flex: 'none' },
      }, h('path', {
        d: 'M6.5 6.5l11 11M17.5 6.5l-11 11',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.7,
        strokeLinecap: 'round',
      }))
    }

    /**
     * One labelled switch row. The whole row is the button, so the track is
     * decoration and the accessible state lives on the button.
     * @returns {React.ReactElement} The row.
     */
    function ToggleRow({ label, hint, checked, onChange }) {
      return h('div', { className: 'dsh-rc-field' },
        h('button', {
          type: 'button',
          role: 'switch',
          'aria-checked': checked,
          className: 'dsh-rc-toggle',
          onClick: onChange,
        },
        h('span', { className: 'dsh-rc-toggleLabel' }, label),
        h('span', { className: 'dsh-rc-track', 'aria-hidden': true },
          h('span', { className: 'dsh-rc-thumb' }))),
        hint === undefined ? null : h('p', { className: 'dsh-rc-hint' }, hint))
    }

    /**
     * One labelled range control with a readout, a reset and a commit hook.
     * @returns {React.ReactElement} The control.
     */
    function RangeRow({ label, hint, min, max, value, readout, onChange, onCommit, onReset }) {
      return h('div', { className: 'dsh-rc-range' },
        h('div', { className: 'dsh-rc-rangeHead' },
          h('span', { className: 'dsh-rc-rangeLabel' }, label),
          h('span', { className: 'dsh-rc-rangeValue' }, readout),
          onReset === undefined ? null : h('button', {
            type: 'button',
            className: 'dsh-rc-link',
            onClick: onReset,
          }, translate('resetValue'))),
        h('input', {
          type: 'range',
          className: 'dsh-rc-slider',
          min,
          max,
          step: 1,
          value,
          'aria-label': label,
          onChange: event => { onChange(Number(event.target.value)) },
          onPointerUp: onCommit,
          onKeyUp: onCommit,
        }),
        hint === undefined ? null : h('p', { className: 'dsh-rc-hint' }, hint))
    }

    /** Styles for the trigger and the panel; theme tokens only. */
    const UI_CSS = `
.dsh-rc-layer { position: relative; flex: 1 1 auto; min-width: 0; display: flex; align-items: center; width: 100%; height: 42px; }
.dsh-rc-layerRail { flex: none; width: 36px; height: 36px; }
.dsh-rc-trigger { display: inline-flex; align-items: center; gap: 8px; width: 100%; height: 42px; margin: 0; padding: 0 10px 0 8px; border: none; border-radius: 12px; background: transparent; color: var(--dsw-alias-label-primary); font-family: inherit; font-size: 14px; cursor: pointer; overflow: hidden; }
.dsh-rc-trigger:hover { background: color-mix(in srgb, var(--dsw-alias-label-primary) 8%, transparent); }
.dsh-rc-trigger[aria-expanded="true"] { background: color-mix(in srgb, var(--dsw-alias-label-primary) 10%, transparent); }
.dsh-rc-layerRail .dsh-rc-trigger { justify-content: center; gap: 0; width: 36px; height: 36px; padding: 0; border-radius: 50%; }
.dsh-rc-triggerLabel { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-rc-chip { flex: none; margin-left: auto; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 16px; }
.dsh-rc-panel { position: fixed; z-index: 60; box-sizing: border-box; display: flex; flex-direction: column; border: 1px solid var(--dsw-alias-border-l1); border-radius: 16px; background: var(--dsw-alias-bg-overlay); color: var(--dsw-alias-label-primary); box-shadow: var(--dsw-elevation-prominent); font-size: 13px; }
.dsh-rc-head { flex: none; display: flex; align-items: center; gap: 8px; padding: 12px 12px 8px; }
.dsh-rc-title { flex: 1 1 auto; min-width: 0; font-size: 14px; font-weight: 500; }
.dsh-rc-body { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 0 12px 12px; outline: none; }
.dsh-rc-foot { flex: none; padding: 8px 12px 12px; border-top: 1px solid var(--dsw-alias-border-l1); }
.dsh-rc-section { padding: 10px 0; border-top: 1px solid var(--dsw-alias-border-l1); }
.dsh-rc-section:first-of-type { border-top: none; }
.dsh-rc-heading { margin: 0 0 8px; font-size: 11px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: var(--dsw-alias-label-secondary); }
.dsh-rc-hint { margin: 6px 0 0; color: var(--dsw-alias-label-secondary); font-size: 11px; line-height: 1.4; overflow-wrap: anywhere; }
.dsh-rc-alert { margin: 0 0 8px; padding: 8px 10px; border: 1px solid var(--dsw-alias-state-error-primary); border-radius: 10px; color: var(--dsw-alias-label-primary); font-size: 12px; line-height: 1.5; overflow-wrap: anywhere; }
.dsh-rc-field + .dsh-rc-field { margin-top: 12px; }
.dsh-rc-toggle { display: flex; align-items: center; gap: 10px; width: 100%; padding: 4px 0; border: none; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.dsh-rc-toggleLabel { flex: 1 1 auto; min-width: 0; }
.dsh-rc-track { box-sizing: border-box; display: block; flex: 0 0 auto; width: 36px; height: 20px; padding: 2px; border-radius: 999px; corner-shape: round; background: var(--dsw-alias-border-l3); transition: background 120ms ease; }
.dsh-rc-toggle[aria-checked='true'] .dsh-rc-track { background: var(--dsw-alias-brand-primary); }
.dsh-rc-thumb { display: block; width: 16px; height: 16px; border-radius: 50%; corner-shape: round; background: var(--dsw-alias-switch-thumb); transition: transform 120ms ease, background 120ms ease; }
.dsh-rc-toggle[aria-checked='true'] .dsh-rc-thumb { transform: translateX(16px); background: var(--dsw-alias-label-primary-foreground); }
.dsh-rc-range { display: flex; flex-direction: column; gap: 6px; margin-top: 12px; }
.dsh-rc-rangeHead { display: flex; align-items: baseline; gap: 8px; }
.dsh-rc-rangeLabel { flex: 1 1 auto; min-width: 0; }
.dsh-rc-rangeValue { font-size: 12px; color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; }
.dsh-rc-slider { width: 100%; accent-color: var(--dsw-alias-brand-primary); }
.dsh-rc-link { padding: 0; border: none; background: transparent; color: var(--dsw-alias-brand-primary); font: inherit; font-size: 11px; cursor: pointer; }
.dsh-rc-sounds { display: flex; flex-wrap: wrap; gap: 6px; }
.dsh-rc-sound { padding: 5px 9px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; background: transparent; color: var(--dsw-alias-label-primary); font: inherit; font-size: 12px; cursor: pointer; }
.dsh-rc-sound:hover { background: color-mix(in srgb, var(--dsw-alias-label-primary) 8%, transparent); }
.dsh-rc-sound[aria-pressed='true'] { border-color: var(--dsw-alias-brand-primary); background: color-mix(in srgb, var(--dsw-alias-brand-primary) 12%, transparent); }
.dsh-rc-custom { margin-top: 10px; padding: 8px 10px; border: 1px dashed var(--dsw-alias-border-l2); border-radius: 10px; }
.dsh-rc-customHead { display: flex; align-items: center; gap: 8px; }
.dsh-rc-customName { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
.dsh-rc-customMeta { flex: none; color: var(--dsw-alias-label-secondary); font-size: 11px; }
.dsh-rc-customActions { display: flex; gap: 6px; margin-top: 6px; }
.dsh-rc-previewRow { display: flex; justify-content: flex-end; margin-top: 8px; }
.dsh-rc-preview { display: inline-flex; align-items: center; gap: 5px; }
.dsh-rc-small { padding: 4px 9px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; background: transparent; color: var(--dsw-alias-label-primary); font: inherit; font-size: 12px; cursor: pointer; }
.dsh-rc-small:hover:not(:disabled) { background: color-mix(in srgb, var(--dsw-alias-label-primary) 8%, transparent); }
.dsh-rc-small:disabled { opacity: .5; cursor: default; }
.dsh-rc-icon { display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; padding: 0; border: none; border-radius: 8px; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; }
.dsh-rc-icon:hover { background: color-mix(in srgb, var(--dsw-alias-label-primary) 8%, transparent); color: var(--dsw-alias-label-primary); }
.dsh-rc-file { display: none; }
.dsh-rc-trigger:focus-visible, .dsh-rc-toggle:focus-visible, .dsh-rc-slider:focus-visible, .dsh-rc-sound:focus-visible, .dsh-rc-small:focus-visible, .dsh-rc-link:focus-visible, .dsh-rc-icon:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
`

    /**
     * The sidebar trigger and the anchored panel it opens. The trigger is one
     * button; every control lives inside the panel, so the footer row cannot
     * nest interactive elements.
     * @param {object} props - Slot props: `wide` from the sidebar, `useSessionStatus` from the standard kit.
     * @returns {React.ReactElement} The footer row.
     */
    function ResponseChime({ wide, useSessionStatus }) {
      const t = useTranslate()
      const [settings, setSettings] = useState(readSettings)
      const settingsRef = useRef(settings)
      settingsRef.current = settings
      const [open, setOpen] = useState(false)
      const [anchor, setAnchor] = useState(null)
      const [busy, setBusy] = useState(false)
      const [notice, setNotice] = useState(null)
      const status = useStatus(useSessionStatus)
      const previous = useRef(null)
      const rootRef = useRef(null)
      const triggerRef = useRef(null)
      const bodyRef = useRef(null)
      const fileRef = useRef(null)

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
        if (!answered) return
        const current = settingsRef.current
        if (!current.enabled) return
        if (current.onlyWhenAway && !isAway()) return
        playConfigured(current)
      }, [status])

      /**
       * Persist a patch and make it the live value before React re-renders.
       * @param {Partial<typeof DEFAULTS>} patch - The fields to change.
       * @returns {typeof DEFAULTS} The normalized settings that now apply.
       */
      const applySettings = useCallback(patch => {
        const next = normalizeSettings({ ...settingsRef.current, ...patch })
        settingsRef.current = next
        setSettings(next)
        writeSettings(next)
        return next
      }, [])

      /**
       * Play the configured sound for an explicit click, waiting for a custom
       * clip if that is what it takes. This path ignores `enabled` and
       * `onlyWhenAway`: the person asked to hear it.
       * @param {typeof DEFAULTS} current - Settings to preview.
       */
      const previewSound = useCallback(async current => {
        setNotice(null)
        unlockAudio()
        if (ensureAudioContext() === null) {
          setNotice(t('audioUnavailable'))
          return
        }
        if (current.sound !== 'custom') {
          playSynth(current.sound, current.volume)
          return
        }
        const clip = await ensureCustomClip()
        if (clip === null) {
          setNotice(t('customMissing'))
          playSynth('chime', current.volume)
          return
        }
        playClip(clip, current.volume)
      }, [t])

      const toggleEnabled = useCallback(() => {
        const next = applySettings({ enabled: !settingsRef.current.enabled })
        if (next.enabled) void previewSound(next)
      }, [applySettings, previewSound])

      const selectSound = useCallback(id => {
        if (id === 'custom' && settingsRef.current.custom === null) return
        const next = applySettings({ sound: id })
        void previewSound(next)
      }, [applySettings, previewSound])

      const toggleAway = useCallback(() => {
        applySettings({ onlyWhenAway: !settingsRef.current.onlyWhenAway })
      }, [applySettings])

      const resetSettings = useCallback(() => {
        setNotice(null)
        applySettings({
          volume: DEFAULTS.volume,
          sound: 'chime',
          onlyWhenAway: DEFAULTS.onlyWhenAway,
        })
      }, [applySettings])

      /**
       * Validate and store a chosen clip, then select and preview it. The bytes
       * are decoded from a copy, because the decoder detaches its input.
       * @param {File | undefined} file - The chosen file.
       */
      const chooseClip = useCallback(async file => {
        if (file === undefined || file === null) return
        setNotice(null)
        if (!(file.size > 0)) {
          setNotice(t('fileUnreadable'))
          return
        }
        if (file.size > MAX_CLIP_BYTES) {
          setNotice(t('fileTooLarge'))
          return
        }
        setBusy(true)
        try {
          // Decoding does not need a running context, but resuming here (the
          // file picker is a gesture) makes it work on the widest range of
          // browsers. This deliberately does not call `unlockAudio`, which
          // would start a read of the clip being replaced.
          const audio = ensureAudioContext()
          if (audio === null) throw new Error(t('audioUnavailable'))
          if (audio.state === 'suspended') void audio.resume().catch(() => {})
          const bytes = await file.arrayBuffer()
          let buffer
          try {
            buffer = await decodeAudio(bytes.slice(0))
          } catch {
            throw new Error(t('fileUnreadable'))
          }
          if (!(buffer.duration > 0)) throw new Error(t('fileUnreadable'))
          if (buffer.duration > MAX_CLIP_SECONDS) throw new Error(t('fileTooLong'))
          const clip = makeClip(buffer)
          if (clip === null) throw new Error(t('fileSilent'))
          const type = typeof file.type === 'string' && file.type !== '' ? file.type : 'application/octet-stream'
          const saved = await writeClipBlob(new Blob([bytes], { type }))
          if (!saved) throw new Error(t('storageUnavailable'))
          // Retire any decode still running for the previous selection.
          clipEpoch += 1
          clipLoad = null
          clipMissing = false
          customClip = clip
          const next = applySettings({
            sound: 'custom',
            custom: {
              name: clipDisplayName(file.name),
              type,
              bytes: file.size,
              seconds: Math.round(buffer.duration * 10) / 10,
            },
          })
          await previewSound(next)
        } catch (error) {
          setNotice(messageOf(error))
        } finally {
          setBusy(false)
        }
      }, [applySettings, previewSound, t])

      const removeClip = useCallback(async () => {
        setNotice(null)
        setBusy(true)
        try {
          await deleteClipBlob()
          clipEpoch += 1
          clipLoad = null
          clipMissing = false
          customClip = null
          const patch = { custom: null }
          if (settingsRef.current.sound === 'custom') patch.sound = 'chime'
          applySettings(patch)
        } finally {
          setBusy(false)
        }
      }, [applySettings])

      /**
       * Place the panel above the trigger, clamped to the viewport. It is
       * measured from the trigger so the wide row and the rail share one rule.
       * @returns {{ left: number, bottom: number, width: number, maxHeight: number }} Placement.
       */
      function placement() {
        const viewportWidth = typeof window.innerWidth === 'number' ? window.innerWidth : 1024
        const viewportHeight = typeof window.innerHeight === 'number' ? window.innerHeight : 768
        const margin = 8
        const width = Math.min(PANEL_WIDTH, Math.max(240, viewportWidth - margin * 2))
        const rect = triggerRef.current?.getBoundingClientRect?.()
        const left = rect === undefined || rect === null
          ? Math.max(margin, viewportWidth - width - margin)
          : clamp(rect.left, margin, Math.max(margin, viewportWidth - width - margin))
        const bottom = rect === undefined || rect === null
          ? 56
          : Math.max(margin, viewportHeight - rect.top + margin)
        return { left, bottom, width, maxHeight: Math.max(240, viewportHeight - bottom - margin) }
      }

      const toggleOpen = () => {
        if (open) {
          setOpen(false)
          return
        }
        // Measure in the click, before the first paint of the panel, so it
        // appears where the trigger is rather than jumping after an effect.
        setAnchor(placement())
        setOpen(true)
      }

      // Keep the panel against the trigger as the window or the sidebar
      // changes shape. `wide` matters: collapsing the rail moves the trigger.
      useEffect(() => {
        if (!open) return undefined
        const place = () => { setAnchor(placement()) }
        place()
        window.addEventListener('resize', place)
        return () => { window.removeEventListener('resize', place) }
      }, [open, wide])

      // Dismiss on an outside pointer or Escape, and hand focus back on close.
      useEffect(() => {
        if (!open || typeof document === 'undefined') return undefined
        const onPointerDown = event => {
          if (rootRef.current !== null && rootRef.current.contains(event.target)) return
          setOpen(false)
        }
        const onKeyDown = event => {
          if (event.key !== 'Escape') return
          event.stopPropagation()
          setOpen(false)
        }
        document.addEventListener('pointerdown', onPointerDown, true)
        document.addEventListener('keydown', onKeyDown)
        return () => {
          document.removeEventListener('pointerdown', onPointerDown, true)
          document.removeEventListener('keydown', onKeyDown)
          triggerRef.current?.focus?.()
        }
      }, [open])

      // The panel body exists only after placement has measured the trigger,
      // so its initial focus waits for the first anchor.
      useEffect(() => {
        if (open && anchor !== null) bodyRef.current?.focus?.()
      }, [open, anchor])

      // Opening the panel is a gesture, so it is the first safe moment to find
      // out whether a selected custom clip is actually there. The name, not the
      // metadata object, is the dependency: normalization rebuilds that object
      // on every unrelated settings change.
      useEffect(() => {
        if (!open) return undefined
        const current = settingsRef.current
        if (current.sound !== 'custom' || current.custom === null) return undefined
        if (ensureAudioContext() === null) {
          setNotice(t('audioUnavailable'))
          return undefined
        }
        let live = true
        void ensureCustomClip().then(clip => {
          if (live && clip === null) setNotice(t('customMissing'))
        })
        return () => { live = false }
      }, [open, settings.sound, settings.custom === null ? null : settings.custom.name, t])

      const wideBar = wide !== false
      const volumePercent = Math.round(settings.volume * 100)

      const panel = open && anchor !== null
        ? h('div', {
          className: 'dsh-rc-panel',
          style: {
            left: `${anchor.left}px`,
            bottom: `${anchor.bottom}px`,
            width: `${anchor.width}px`,
            maxHeight: `${anchor.maxHeight}px`,
          },
          role: 'dialog',
          'aria-label': t('settings'),
        },
        h('div', { className: 'dsh-rc-head' },
          h('span', { className: 'dsh-rc-title' }, t('settings')),
          h('button', {
            type: 'button',
            className: 'dsh-rc-icon',
            title: t('close'),
            'aria-label': t('close'),
            onClick: () => { setOpen(false) },
          }, h(CloseIcon, { size: 14 }))),
        h('div', { className: 'dsh-rc-body', ref: bodyRef, tabIndex: -1 },
          notice === null
            ? null
            : h('div', { className: 'dsh-rc-alert', role: 'alert' }, notice),

          h('section', { className: 'dsh-rc-section' },
            h('h3', { className: 'dsh-rc-heading' }, t('response')),
            h(ToggleRow, {
              label: t('enabled'),
              hint: t('enabledHint'),
              checked: settings.enabled,
              onChange: toggleEnabled,
            }),
            h(RangeRow, {
              label: t('volume'),
              hint: t('volumeHint'),
              min: 0,
              max: 100,
              value: volumePercent,
              readout: `${volumePercent}%`,
              onReset: settings.volume === DEFAULTS.volume
                ? undefined
                : () => { applySettings({ volume: DEFAULTS.volume }) },
              onChange: next => { applySettings({ volume: next / 100 }) },
              onCommit: () => { void previewSound(settingsRef.current) },
            })),

          h('section', { className: 'dsh-rc-section' },
            h('h3', { className: 'dsh-rc-heading' }, t('sound')),
            h('div', { className: 'dsh-rc-sounds', role: 'group', 'aria-label': t('sound') },
              SOUND_ORDER.map(id => h('button', {
                key: id,
                type: 'button',
                className: 'dsh-rc-sound',
                'data-sound': id,
                'aria-pressed': settings.sound === id,
                onClick: () => { selectSound(id) },
              }, t(SOUND_KEYS[id]))),
              settings.custom === null
                ? null
                : h('button', {
                  key: 'custom',
                  type: 'button',
                  className: 'dsh-rc-sound',
                  'data-sound': 'custom',
                  'aria-pressed': settings.sound === 'custom',
                  onClick: () => { selectSound('custom') },
                }, t('custom'))),

            h('div', { className: 'dsh-rc-custom' },
              h('div', { className: 'dsh-rc-customHead' },
                h('span', {
                  className: 'dsh-rc-customName',
                  title: settings.custom === null ? undefined : settings.custom.name,
                }, settings.custom === null ? t('noCustom') : settings.custom.name),
                settings.custom === null
                  ? h('button', {
                    type: 'button',
                    className: 'dsh-rc-small',
                    disabled: busy,
                    onClick: () => { fileRef.current?.click() },
                  }, busy ? t('preparing') : t('chooseFile'))
                  : h('span', { className: 'dsh-rc-customMeta' }, formatBytes(settings.custom.bytes))),
              settings.custom === null
                ? null
                : h('div', { className: 'dsh-rc-customActions' },
                  h('button', {
                    type: 'button',
                    className: 'dsh-rc-small',
                    disabled: busy,
                    onClick: () => { fileRef.current?.click() },
                  }, busy ? t('preparing') : t('replaceFile')),
                  h('button', {
                    type: 'button',
                    className: 'dsh-rc-small',
                    disabled: busy,
                    onClick: () => { void removeClip() },
                  }, t('removeFile'))),
              h('p', { className: 'dsh-rc-hint' }, t('customHint'))),

            h('div', { className: 'dsh-rc-previewRow' },
              h('button', {
                type: 'button',
                className: 'dsh-rc-small dsh-rc-preview',
                onClick: () => { void previewSound(settingsRef.current) },
              }, h(PlayIcon, { size: 12 }), h('span', null, t('preview')))),

            h('input', {
              ref: fileRef,
              type: 'file',
              accept: 'audio/wav,audio/x-wav,audio/wave,audio/mpeg,audio/mp3,.wav,.mp3',
              className: 'dsh-rc-file',
              onChange: event => {
                const file = event.target.files?.[0]
                event.target.value = ''
                void chooseClip(file)
              },
            })),

          h('section', { className: 'dsh-rc-section' },
            h('h3', { className: 'dsh-rc-heading' }, t('when')),
            h(ToggleRow, {
              label: t('onlyAway'),
              hint: t('onlyAwayHint'),
              checked: settings.onlyWhenAway,
              onChange: toggleAway,
            }))),
        h('div', { className: 'dsh-rc-foot' },
          h('button', {
            type: 'button',
            className: 'dsh-rc-small',
            onClick: resetSettings,
          }, t('reset')),
          h('p', { className: 'dsh-rc-hint' }, t('resetHint'))))
        : null

      return h('div', {
        className: wideBar ? 'dsh-rc-layer' : 'dsh-rc-layer dsh-rc-layerRail',
        ref: rootRef,
      },
      h('style', null, UI_CSS),
      h('button', {
        type: 'button',
        ref: triggerRef,
        className: 'dsh-rc-trigger',
        'aria-label': t('settings'),
        'aria-haspopup': 'dialog',
        'aria-expanded': open,
        title: wideBar ? `${t('label')} · ${settings.enabled ? t('on') : t('off')}` : t('settings'),
        onClick: toggleOpen,
      },
      h(SpeakerIcon, { muted: !settings.enabled, size: wideBar ? 16 : 18 }),
      wideBar ? h('span', { className: 'dsh-rc-triggerLabel' }, t('settings')) : null,
      wideBar ? h('span', { className: 'dsh-rc-chip' }, settings.enabled ? t('on') : t('off')) : null),
      panel)
    }

    /**
     * Register the trigger and the audio unlock for the Client run's lifetime.
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
