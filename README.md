# Response Chime

Hear when the agent has finished answering.

Send a prompt, walk away, and a chime plays when the turn ends. It rings for the
long plan-and-goal runs too, for the moments the model stops to ask you a
question, and for a turn that finishes while you are reading another
conversation. A speaker icon at the foot of the left sidebar opens the audio
settings panel.

Nothing is uploaded and there is no account: the plugin has no server side, the
built-in sounds are generated in your browser, and a custom sound stays in this
browser's own storage.

## What you can do

- **Hear an answer land.** The chime plays the moment a Session that was working
  goes idle, so a turn you left running calls you back when it is done.
- **Open the audio settings panel.** The speaker row sits beside **Settings**.
  It shows **On** or **Off**, and opens a panel with every control.
- **Pick a sound.** Four built-in sounds — Chime, Bell, Drop and Soft. Choosing
  one plays it, so you hear the change before you rely on it.
- **Use your own sound.** Choose a WAV or MP3 up to 5 MB and 30 seconds. It is
  decoded and stored in this browser, then played at the volume you set.
- **Set the volume.** A slider from silent to full, with a preview when you let
  go.
- **Stay quiet while you are watching.** Turn on **Only when this window is in the
  background** to keep the chime for the moments you have walked away from the
  page.
- **Keep it set the way you like.** The choice is saved in your browser and
  applies to every conversation in the app.

## Install

You need the DeepSeek Harness, running either in a browser or in the desktop app.

1. In the Harness, open **Plugins** in the left sidebar.
2. Press **Install**.
3. Paste this repository's address:

   ```
   https://github.com/DevTarlow/dsh-response-chime
   ```

4. Install it, then refresh the page.

If you would rather work from a local copy, clone the repository and paste the
folder's full path instead. The install dialog accepts a GitHub address, a
package name, or a local folder.

The plugin is added to your Harness, so it stays available in every session until
you remove it.

## Using it

The speaker row sits just above **Settings**, at the bottom of the left sidebar.

1. Click the row to open **Audio settings**. The row itself is not a switch; it
   is the door to the panel.
2. **Play a sound** turns the chime on and off. Turning it back on plays the
   current sound as a preview.
3. **Volume** changes how loud it plays. The value is saved as you drag.
4. **Sound** lists Chime, Bell, Drop and Soft. Click one to hear it and use it.
5. **Choose a file** replaces the built-in sound with your own WAV or MP3, if one
   has not been chosen yet. Once one is stored, **Replace** and **Remove** sit
   beside its name.
6. **Preview** plays the current sound at the current volume at any time.
7. **Only when this window is in the background** keeps the chime quiet while the
   window is visible and focused.
8. **Reset sound settings** returns volume, sound and background-only to their
   defaults. A custom file is kept.

Close the sidebar, or drag it narrow, and the row becomes a single round speaker
button. The icon still tells you the state: sound waves when the chime is on, a
slash through the speaker when it is off.

The panel closes on `Escape` or a click outside it, and focus returns to the
speaker row.

## When it rings

A ring means a Session went from working to idle. That covers the cases worth
walking away from:

- a normal answer finishing;
- a long plan, goal or workflow run ending;
- the model stopping to ask a question, because the turn is waiting on you;
- a background or scheduled turn ending while you are in another conversation.

It does not ring when you open the page in the middle of a turn, because the
first thing it sees is treated as the starting point rather than as an answer,
and it does not ring when a Session merely appears or stays idle.

With **Only when this window is in the background** on, it also stays quiet while
the page is visible and focused. A visible but unfocused window counts as
background, because you are working somewhere else.

## Custom sounds

- **Formats:** WAV and MP3. The file is validated by decoding it, so a file with
  the wrong extension is refused with an explanation rather than played as
  noise.
- **Limits:** 5 MB and 30 seconds. The panel says which one was exceeded.
- **Storage:** the bytes are kept in this browser's IndexedDB. The file is never
  uploaded, and other browsers do not see it.
- **Level:** the clip is peak-normalized, so a quiet recording and a loud one
  land at roughly the same volume. The volume slider then scales both.
- **Missing file:** if the stored clip cannot be found or decoded later, the
  default chime plays instead of leaving a silent switch on.
- **Removing it:** press **Remove** in the panel. Clearing the site's data also
  removes it.

## Leaving it on in the background

Browsers do not let a page make sound before you have clicked or typed in it.
The plugin creates its audio on your first click or keypress in the page, then
schedules the notes on that audio clock, which does not advance while sound is
blocked. In practice: if you typed the prompt in this page, the chime plays even
with the page in a background tab and the screen off. A custom clip is decoded
from that first gesture too, so it is ready by the time a turn ends.

## Common questions

**I hear nothing.** Open **Audio settings** and check that **Play a sound** is
on. If it is, click somewhere in the page once and send a short prompt — a page
that has never been clicked cannot make sound yet. Your system volume and the
tab's own mute state apply as usual. If a custom sound is selected and its file
is gone, the default chime plays instead; choose another file to replace it.

**Can I change the sound or the volume?** Yes. Open the panel: four built-in
sounds, a custom WAV or MP3, and a volume slider. The old fixed two-note chime is
still the default.

**Does it ring for other conversations?** Yes. Any Session finishing rings,
which is what makes it useful for work you started and then left.

**Does it ring when an agent is waiting for approval?** Yes. A paused turn is an
idle Session, and that is exactly the moment you need to come back.

**Does it send anything anywhere?** No. The Harness-side half of the plugin is an
empty row. The sounds are generated or decoded in your browser, the settings are
in the page's local storage, and a custom sound's bytes are in this browser's
IndexedDB.

**Is the setting per browser?** Yes. It lives in local storage, so a different
browser starts with the defaults. Copy the `dsh.response-chime.v2` key over if
you want the settings to match, though a custom sound still has to be chosen in
each browser.

**What is stored, exactly?** One settings key,
`dsh.response-chime.v2`, holding the on/off choice, volume, sound name, custom
file's name and size, and the background-only choice. A custom clip is one
IndexedDB record in the `dsh-response-chime` database. The old
`dsh.response-chime.v1` key is read once to carry over the on/off choice.

**What happens if I clear the site's data?** The settings and any custom sound
are removed and the plugin returns to its defaults. The plugin itself stays
installed.

## Removing it

Open **Plugins**, find **dsh-response-chime**, and uninstall it. The row leaves
the sidebar immediately. The stored settings and any custom clip stay in local
storage and IndexedDB until you clear the site's data; they are ignored once the
plugin is gone.

## For developers

Two files and no build step.

| File | Runs in | Owns |
| --- | --- | --- |
| [index.js](index.js) | the Harness | an inert row; there is no service and no route |
| [client.js](client.js) | the browser | the settings panel, the Session status comparison, the audio, and the stored clip |

Things to know before changing it:

- **It imports nothing it is not given.** The browser half requests `react` and
  nothing else, which is what lets it load on a released `dsh` with no build.
- **The status comes from the slot, not from the Session log.** The row is
  registered in `sidebar.footer.action`, whose standard props include
  `useSessionStatus`. The component reads that slice and compares two snapshots,
  so it never polls an agent, folds Session events, or rescans a transcript.
- **The first snapshot is a baseline.** Mounting in the middle of a turn must not
  fire a chime, so the first observation only records what is running.
- **Audio is created on a gesture.** A context created before a user gesture
  starts suspended, and every resume outside a gesture is ignored, which would
  make the panel look broken with nothing in the console. `pointerdown` and
  `keydown` on the window are the unlock.
- **The notes are scheduled on the audio clock.** The synthesized notes use
  oscillator start times and the custom clip uses an `AudioBufferSourceNode`;
  neither waits on `setTimeout`.
- **Loudness is normalized.** Every built-in preset and every custom clip is
  scaled to the same peak at 100% volume, so changing sounds does not change how
  loud the chime is and the slider is a real level control. A preset's peak is
  estimated from the same exponential envelopes the synth schedules.
- **The settings are one versioned key.** `dsh.response-chime.v2` in local
  storage. `dsh.response-chime.v1` is read only to migrate the on/off choice. A
  further shape change means a new key.
- **A custom clip is a separate record.** Its bytes live in IndexedDB under
  `clips`/`custom`, never in the settings JSON. The file is decoded, checked for
  duration and silence, peak-normalized, and capped at 5 MB / 30 seconds. A
  decode that was in flight when the selection changed is retired by an epoch
  guard, so an old clip cannot overwrite a new one. If the clip is missing at
  playback time, the built-in chime plays instead.
- **Every style is a theme token** or a `color-mix()` of one, and the stylesheet
  is a React child, so uninstalling restores the sidebar exactly.
- **The footer row is one dialog trigger.** It is a single button with
  `aria-haspopup="dialog"` and `aria-expanded`; the switch lives inside the
  panel. A nested interactive control in the trigger would break keyboard and
  screen-reader behaviour.

```sh
npm test
```

The test loads the bundle against a stub module loader, a stub hook surface, a
stub AudioContext and a stub IndexedDB, needing no browser and no DOM. It covers
the registration, the wiring, the running-to-idle rule, the trigger and panel,
the settings shape and legacy migration, volume, background-only, custom-clip
storage and playback, and the fallback when a clip is missing. Edit `client.js`
and refresh the page; edit `index.js` or `cordis.patch.yml` and restart the
Harness. [AGENTS.md](AGENTS.md) has the working notes.

## License

[MIT](LICENSE).
