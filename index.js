/**
 * Response Chime host half.
 *
 * Nothing to own: the switch's state lives in the browser, and the sound is
 * synthesized by WebAudio in the half that can hear it. The row exists so the
 * profile has one Host entry describing the capability, and so the bundle
 * carries its display metadata without running any code.
 *
 * @module dsh-response-chime
 */

/** Activate the row; the Client module owns everything visible and audible. */
export function apply() {}
