/**
 * Response Chime host half.
 *
 * Nothing to own: the settings panel's state lives in the browser, the built-in
 * sounds are synthesized there, and a chosen clip is kept in its IndexedDB.
 * The row exists so the profile has one Host entry describing the capability,
 * and so the bundle carries its display metadata without running any code.
 *
 * @module dsh-response-chime
 */

/** Activate the row; the Client module owns everything visible and audible. */
export function apply() {}
