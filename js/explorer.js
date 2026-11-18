// Explorer Quest link: the app opens the game as ?session=<run>&return=<app page>, and gets the player back with the
// highest level they completed (?session=…&level=…), which it reports as mission 09 (the Final Crossing). Without
// those parameters the game plays as it always did.

// The app's own addresses: anything else is refused, so the game can't be used to send players elsewhere.
const APP_ORIGINS = ['https://pla2026.ar-go.co', 'https://pla2026-stage.ar-go.co', 'https://pla2026-dev.ar-go.co'];
const LOCAL_HOSTS = ['localhost', '127.0.0.1'];

/** Returns the given return address if it is one of the app's, else null. */
export function toAppReturn(value) {
  if (!value) return null;
  let url;
  try { url = new URL(value); } catch { return null; }
  const isApp = APP_ORIGINS.includes(url.origin) || (url.protocol === 'http:' && LOCAL_HOSTS.includes(url.hostname));
  return isApp ? url : null;
}

/** Returns the run and the return address the app gave, or null when the game wasn't opened from the app. */
export function readExplorerLink(search) {
  const params = new URLSearchParams(search);
  const session = Number(params.get('session'));
  const back = toAppReturn(params.get('return'));
  return Number.isInteger(session) && session > 0 && back ? { session, back } : null;
}

/** Returns the highest level completed (1-based), from the saved progress's stars, or 0 for none. */
export function highestLevelDone(progress) {
  let highest = 0;
  for (const [index, stars] of Object.entries(progress.stars || {})) {
    if (stars > 0) highest = Math.max(highest, Number(index) + 1);
  }
  return highest;
}

/** Returns the address back to the app, carrying the run and the highest level completed. */
export function returnHref(link, progress) {
  const url = new URL(link.back);
  url.searchParams.set('session', String(link.session));
  url.searchParams.set('level', String(highestLevelDone(progress)));
  return url.toString();
}

/**
 * Adds "Back to the Explorer Quest" to the given screens, its address kept up to date with the progress: call the
 * returned function whenever the progress changes.
 */
export function addReturnButtons(link, screenIds, getProgress) {
  const buttons = screenIds
    .map((id) => document.getElementById(id))
    .filter(Boolean)
    .map((screen) => {
      const button = document.createElement('a');
      button.className = 'btn eq-return';
      button.textContent = 'Back to the Explorer Quest';
      screen.appendChild(button);
      return button;
    });
  const update = () => { for (const button of buttons) button.href = returnHref(link, getProgress()); };
  update();
  return update;
}
