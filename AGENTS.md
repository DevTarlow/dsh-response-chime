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

## Development loop

1. **Edit.** Make the smallest change that completes the task; keep unrelated
   cleanup out of it.
2. **Verify.** Run `npm test` — the whole suite takes about a tenth of a second,
   and there is no build or typecheck step. Run `git diff --check` before
   committing.
3. **Try it.** Edit `client.js` and refresh the page. Edit `index.js` or
   `cordis.patch.yml` and restart the Harness. A freshly installed bundle
   activates over HMR, but a replaced package needs a page reload to load a new
   module generation.
4. **Commit.** As soon as the task is done and the suite is green, commit without
   being asked. One task, one commit.
5. **Report.** Give the short SHA and subject, and say it has not been pushed.
6. **Stop.** Do not push until the human explicitly says so.

Settings and a custom clip are per browser: changing them in one browser does
not carry to another, and clearing the site's data removes them.

## Git contract

> **Commit after a task is done. Push only when explicitly asked.**

| Action | Who | When |
| --- | --- | --- |
| `git commit` | **the agent, unprompted** | as soon as a task is complete and verified |
| `git push` | **only when the human explicitly says so** | on an unambiguous instruction such as "push", "push it", "push that" or "push to GitHub" |

- **Never push on your own initiative.** A green suite, a clean diff or a
  finished task are not permission. A previous push does not authorise the next
  one. `commit ≠ push`.
- **One task, one commit.** Keep unrelated fixes out; an unrelated fix gets its
  own commit. The subject is an imperative, capitalised sentence with no type
  prefix and no trailing period — `Add the audio settings panel`, not
  `feat(panel): ...`. Add a body explaining why for anything non-obvious.
- **Never rewrite published history.** No force-push, no amending or rebasing
  commits already on `origin/main`, and no `reset --hard` against published
  commits.
- **Never commit secrets, `node_modules/`, logs, or `.DS_Store`.**
- **A question or analysis with no file changes needs no commit.** A red suite
  does not get committed; report the failure instead.
- **Before a push**, re-run `npm test` and confirm `git status --short` is clean.
  This repo has no CI or deploy on push; the push is just GitHub.
- The remote is `origin` → <https://github.com/DevTarlow/dsh-response-chime.git>;
  the working branch is `main`.

```sh
npm test
```
