// One source of truth for "how much of the screen can the player actually see".
//
// On a phone the layout viewport -- what `position: fixed` and `100vh` size
// themselves to -- is the *large* viewport: the whole screen, including the
// strip hidden behind the browser's own toolbar. visualViewport reports what
// is really on show. The 3D build sized its drawing buffer from
// window.innerHeight but left the canvas element stretched across the layout
// viewport, so on iOS the picture was squashed vertically and its bottom
// (where the boat sits) was parked behind Safari's bottom bar.
//
// Everything -- canvas, HUD, menus, overlays -- is now sized from one
// measurement, published as CSS variables so the stylesheet can use it too.
export function watchViewport(onChange) {
  const vv = window.visualViewport;
  let w = 0, h = 0;

  function measure() {
    // Round down: a fractional height leaves a hairline of page showing.
    const nw = Math.floor(vv ? vv.width : window.innerWidth);
    const nh = Math.floor(vv ? vv.height : window.innerHeight);
    if (nw === w && nh === h) return false;
    w = nw; h = nh;
    const s = document.documentElement.style;
    s.setProperty('--vvw', w + 'px');
    s.setProperty('--vvh', h + 'px');
    return true;
  }

  function update() { if (measure()) onChange(w, h); }

  measure();
  window.addEventListener('resize', update);
  window.addEventListener('orientationchange', () => setTimeout(update, 50));
  if (vv) {
    // Fires as the URL bar slides away, and on rotation.
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
  }

  // Some in-app browsers and emulated viewports resize without firing any of
  // the above, so the game loop re-checks each frame as well.
  return { update, width: () => w, height: () => h };
}
