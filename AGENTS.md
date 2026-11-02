# AGENTS.md — Response Chime

A DeepSeek Harness plugin. The short version: it is a browser-only bundle that
watches the Session status the sidebar already publishes and plays a chime when
a turn stops running. There is no Harness service, no route, and no stored
document.

## Layout

```
index.js            the Harness row — apply() and nothing else
client.js           the browser half: switch row, status comparison, WebAudio
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
   is suspended. Do not replace this with `setTimeout`.
5. **No Harness Client package is imported.** The factory requests `react` and
   nothing else. Controls are copied from the host primitive and renamed with a
   `dsh-rc-` prefix.
6. **Theme tokens only.** No literal colours in `client.js`; artwork is the only
   exception and lives in `icon.svg`.
7. **The whole row is the switch.** One `button` with `role="switch"` and
   `aria-checked`; the track is decoration. A nested interactive control would
   break keyboard and screen-reader behaviour.
8. **The stored preference is one key.** `dsh.response-chime.v1` in local
   storage. A changed value shape means a new key.

## Loop

```sh
node test/client.test.mjs
```

`npm test` runs the same file. Edit `client.js` and refresh the page. Edit
`index.js` or `cordis.patch.yml` and restart the Harness. A freshly installed
bundle activates over HMR, but a replaced package needs a page reload to load a
new module generation.
