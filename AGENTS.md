# AGENTS.md — Response Chime

A DeepSeek Harness plugin. The short version: it is a browser-only bundle that
watches the Session status the sidebar already publishes and plays a sound when
a turn stops running. A speaker row at the foot of the left sidebar opens an
anchored audio settings panel. There is no Harness service, no route, and no
stored document.

## Layout

```
index.js            the Harness row — apply() and nothing else
client.js           the browser half: settings panel, status comparison, WebAudio, IndexedDB clip
cordis.patch.yml    the bundle layer: one insert row
locale/*.json       inventory title and description (en, zh)
test/client.test.mjs
```

## Invariants

1. **One transition, one chime.** `running: true` to `running: false` is an
   answer. The first snapshot after mount is a baseline and must never ring, or
   every page load in the middle of a turn would lie.
2. **The status is read, not derived.** `useSessionStatus` is the slot's own
   standard prop. Do not add a Session event subscription, a poll, or a
   projection to answer a question the slot already answers.
3. **Audio needs a gesture.** The `AudioContext` is created on the first
   `pointerdown`/`keydown` and resumed there. Creating it at load, or resuming
   outside a gesture, silently yields silence with no error anywhere.
4. **The notes are scheduled on the audio clock**, which stops while the context
   is suspended. The synthesized notes use oscillator start times and a custom
   clip uses an `AudioBufferSourceNode`. Do not replace this with `setTimeout`.
5. **No Harness Client package is imported.** The factory requests `react` and
   nothing else. Controls are copied from the host primitive and renamed with a
   `dsh-rc-` prefix.
6. **Theme tokens only.** No literal colours in `client.js`; artwork is the only
   exception and lives in `icon.svg`.
7. **The footer row is one dialog trigger.** One `button` with
   `aria-haspopup="dialog"` and `aria-expanded`; the on/off switch lives inside
   the panel as its own `role="switch"` button. A nested interactive control in
   the trigger would break keyboard and screen-reader behaviour.
8. **The stored preference is one versioned key.** `dsh.response-chime.v2` in
   local storage. `dsh.response-chime.v1` is read once to carry over the on/off
   choice. A changed value shape means a new key.
9. **A custom clip is a separate IndexedDB record.** Bytes live under
   `clips`/`custom` in the `dsh-response-chime` database, never in the settings
   JSON. Every clip is decoded before it is accepted, capped at 5 MB and 30
   seconds, peak-normalized, and never uploaded. A missing or undecodable clip
   falls back to the built-in chime rather than leaving a silent switch on. An
   epoch guard retires an in-flight decode when the selection changes.
10. **Loudness is normalized, not preset-dependent.** Every built-in preset and
    every custom clip peaks at the same level at 100% volume, so the slider is
    the only loudness control. The built-in gain is derived from an estimate of
    the same exponential envelopes the synth schedules; do not replace it with a
    fixed per-note gain without rechecking the peaks.

## Loop

```sh
node test/client.test.mjs
```

`npm test` runs the same file. Edit `client.js` and refresh the page. Edit
`index.js` or `cordis.patch.yml` and restart the Harness. A freshly installed
bundle activates over HMR, but a replaced package needs a page reload to load a
new module generation. Settings and a custom clip are per browser: changing them
in one browser does not carry to another, and clearing the site's data removes
them.
