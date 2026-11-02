# Response Chime

Hear when the agent has finished answering.

Send a prompt, walk away, and a two-note chime plays when the turn ends. It
rings for the long plan-and-goal runs too, for the moments the model stops to
ask you a question, and for a turn that finishes while you are reading another
conversation. A switch at the foot of the left sidebar turns it on and off.

Nothing is uploaded and there is no account: the plugin has no server side, and
the notes are generated in your browser.

## What you can do

- **Hear an answer land.** The chime plays the moment a Session that was working
  goes idle, so a turn you left running calls you back when it is done.
- **Turn it off in one click.** A speaker icon and a switch sit beside
  **Settings**. Click either to silence it, and click again to bring it back.
- **Hear that the switch works.** Switching it on plays a short preview, so you
  know the sound is working before you depend on it.
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

The switch sits just above **Settings**, at the bottom of the left sidebar: a
speaker icon with a switch on its right. It is on when you install the plugin.

1. Click the switch to turn the chime off. The speaker loses its sound waves and
   the switch slides across.
2. Click it again to turn the chime back on. It plays a preview as it comes back.
3. Close the sidebar, or drag it narrow, and the row becomes a single round
   button. The icon still tells you the state: sound waves when the chime is on,
   a slash through the speaker when it is off. Hovering it says which.

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

## Leaving it on in the background

Browsers do not let a page make sound before you have clicked or typed in it.
The plugin creates its audio on your first click or keypress in the page, then
schedules the notes on that audio clock, which does not advance while sound is
blocked. In practice: if you typed the prompt in this page, the chime plays even
with the page in a background tab and the screen off.

## Common questions

**I hear nothing.** Check the switch first: the speaker shows a slash when the
chime is off. If it is on, click somewhere in the page once and send a short
prompt — a page that has never been clicked cannot make sound yet. Your system
volume and the tab's own mute state apply as usual.

**Can I change the sound or the volume?** Not yet. It is two sine notes at a
fixed level, chosen to be audible from another room without being startling.

**Does it ring for other conversations?** Yes. Any Session finishing rings,
which is what makes it useful for work you started and then left.

**Does it ring when an agent is waiting for approval?** Yes. A paused turn is an
idle Session, and that is exactly the moment you need to come back.

**Does it send anything anywhere?** No. The Harness-side half of the plugin is an
empty row; the chime is synthesized in your browser, and the only thing stored is
your on/off choice.

**Is the setting per browser?** Yes. It lives in the page's local storage, so a
different browser starts with the chime on. Copy the `dsh.response-chime.v1` key
over if you want them to match.

## Removing it

Open **Plugins**, find **dsh-response-chime**, and uninstall it. The row leaves
the sidebar immediately. The stored switch state stays in local storage until you
clear the site's data; it is one small key and it is ignored once the plugin is
gone.

## For developers

Two files and no build step.

| File | Runs in | Owns |
| --- | --- | --- |
| [index.js](index.js) | the Harness | an inert row; there is no service and no route |
| [client.js](client.js) | the browser | the switch, the Session status comparison, and the chime |

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
  make the switch look broken with nothing in the console. `pointerdown` and
  `keydown` on the window are the unlock.
- **Every style is a theme token** or a `color-mix()` of one, and the stylesheet
  is a React child, so uninstalling restores the sidebar exactly.
- **The switch state is one key** in local storage (`dsh.response-chime.v1`).
  Bump the key if the shape of that value changes.

```sh
npm test
```

The test loads the bundle against a stub module loader and a stub hook surface,
needing no browser and no DOM. It covers the registration, the wiring, the
running-to-idle rule, the switch, and the stored preference. Edit `client.js` and
refresh the page; edit `index.js` or `cordis.patch.yml` and restart the Harness.
[AGENTS.md](AGENTS.md) has the working notes.

## License

[MIT](LICENSE).
