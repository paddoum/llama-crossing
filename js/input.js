// Relative-drag steering: the boat moves by how far the finger travels, not where it is.
// That way the thumb never covers the boat.
export class Input {
  constructor(canvas, handlers) {
    this.canvas = canvas;
    this.h = handlers; // { onFirstInteract, onDragStart, onDragMove }
    this.keys = new Set();
    this.dragging = false;
    this.lastX = 0;
    this.downAt = 0;
    this.downX = 0;
    this.travel = 0;
    this.pixelsPerUnit = 1; // set by main on resize

    canvas.addEventListener('pointerdown', (e) => {
      this.h.onFirstInteract?.();
      this.dragging = true;
      this.lastX = e.clientX;
      this.downAt = performance.now();
      this.downX = e.clientX;
      this.travel = 0;
      try { canvas.setPointerCapture(e.pointerId); } catch {}
      this.h.onDragStart?.();
      e.preventDefault();
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      const dx = (e.clientX - this.lastX) / this.pixelsPerUnit;
      this.travel += Math.abs(e.clientX - this.lastX);
      this.lastX = e.clientX;
      this.h.onDragMove?.(dx * 1.25);
    });
    // A quick press that barely moved is a tap, not a steer: that is the spit.
    const end = (e) => {
      if (this.dragging && e && e.type === 'pointerup' &&
          performance.now() - this.downAt < 260 && this.travel < 12) {
        this.h.onTap?.();
      }
      this.dragging = false;
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('lostpointercapture', end);

    // Kill scroll/zoom gestures on the whole page.
    document.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
    document.addEventListener('gesturestart', (e) => e.preventDefault());
    document.addEventListener('dblclick', (e) => e.preventDefault());

    window.addEventListener('keydown', (e) => {
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' '].includes(e.key)) e.preventDefault();
      this.keys.add(e.key);
      this.h.onKey?.(e.key);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key));
    window.addEventListener('blur', () => this.keys.clear());
  }

  // -1, 0, 1 from arrow keys / A-D
  axis() {
    let a = 0;
    if (this.keys.has('ArrowLeft') || this.keys.has('a') || this.keys.has('q')) a -= 1;
    if (this.keys.has('ArrowRight') || this.keys.has('d')) a += 1;
    return a;
  }
}
