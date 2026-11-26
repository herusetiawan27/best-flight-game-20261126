// Keyboard + mouse + touch input.
// Mouse steering engages when the mouse has moved within the last 2.5
// seconds: pitch/roll ease toward the pointer's offset from centre.
// Touch (on the canvas): the left thumb is a floating virtual joystick
// (joyX/joyY in -1..1), the right thumb drags an absolute throttle
// slider. A tap also registers as a click for menus.
export class Input {
  constructor(canvas) {
    this.keys = new Set();
    this.mouseX = 0.5; this.mouseY = 0.5; // normalised 0..1
    this.mouseLastMove = -Infinity;
    this.pressed = new Set(); // one-shot keys, cleared by consumer each frame
    this.clickX = 0.5; this.clickY = 0.5; // last click/tap, normalised
    this.touch = {
      active: false,
      joyId: null, joyBaseX: 0, joyBaseY: 0, joyX: 0, joyY: 0,
      thrId: null, throttle: 0.62, throttleActive: false,
    };
    window.addEventListener('keydown', (e) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) e.preventDefault();
      if (!e.repeat) this.pressed.add(e.key.length === 1 ? e.key.toLowerCase() : e.key);
      this.keys.add(e.key.length === 1 ? e.key.toLowerCase() : e.key);
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key);
    });
    window.addEventListener('mousemove', (e) => {
      const r = canvas.getBoundingClientRect();
      this.mouseX = (e.clientX - r.left) / Math.max(1, r.width);
      this.mouseY = (e.clientY - r.top) / Math.max(1, r.height);
      this.mouseLastMove = performance.now();
    });
    canvas.addEventListener('mousedown', (e) => {
      const r = canvas.getBoundingClientRect();
      this.clickX = (e.clientX - r.left) / Math.max(1, r.width);
      this.clickY = (e.clientY - r.top) / Math.max(1, r.height);
      this.pressed.add('__click');
    });
    window.addEventListener('blur', () => this.keys.clear());

    // --- Touch ----------------------------------------------------------------
    const norm = (t) => {
      const r = canvas.getBoundingClientRect();
      return {
        x: (t.clientX - r.left) / Math.max(1, r.width),
        y: (t.clientY - r.top) / Math.max(1, r.height),
        px: t.clientX - r.left, py: t.clientY - r.top, h: Math.max(1, r.height),
      };
    };
    const setThrottle = (ny) => {
      // Slider track occupies y 0.30..0.78 of the canvas (see ui.js).
      const v = 1 - (ny - 0.30) / (0.78 - 0.30);
      this.touch.throttle = Math.min(1, Math.max(0, v));
      this.touch.throttleActive = true;
    };
    canvas.addEventListener('touchstart', (e) => {
      e.preventDefault();
      this.touch.active = true;
      for (const t of e.changedTouches) {
        const n = norm(t);
        this.clickX = n.x; this.clickY = n.y;
        this.pressed.add('__click');
        if (n.x < 0.55 && this.touch.joyId === null) {
          this.touch.joyId = t.identifier;
          this.touch.joyBaseX = n.x; this.touch.joyBaseY = n.y;
          this.touch.joyBasePx = n.px; this.touch.joyBasePy = n.py;
          this.touch.joyX = 0; this.touch.joyY = 0;
        } else if (n.x >= 0.55 && this.touch.thrId === null) {
          this.touch.thrId = t.identifier;
          setThrottle(n.y);
        }
      }
    }, { passive: false });
    canvas.addEventListener('touchmove', (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        const n = norm(t);
        if (t.identifier === this.touch.joyId) {
          // Circular stick: deflection measured in pixels against a
          // radius of 11% of the canvas height, same for both axes.
          const R = 0.11 * n.h;
          this.touch.joyX = Math.min(1, Math.max(-1, (n.px - this.touch.joyBasePx) / R));
          this.touch.joyY = Math.min(1, Math.max(-1, (n.py - this.touch.joyBasePy) / R));
        } else if (t.identifier === this.touch.thrId) {
          setThrottle(n.y);
        }
      }
    }, { passive: false });
    const endTouch = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === this.touch.joyId) {
          this.touch.joyId = null; this.touch.joyX = 0; this.touch.joyY = 0;
        }
        if (t.identifier === this.touch.thrId) this.touch.thrId = null;
      }
    };
    canvas.addEventListener('touchend', endTouch);
    canvas.addEventListener('touchcancel', endTouch);
  }
  down(k) { return this.keys.has(k); }
  takePressed(k) { const p = this.pressed.has(k); if (p) this.pressed.delete(k); return p; }
  clearPressed() { this.pressed.clear(); }
  mouseActive(now) { return now - this.mouseLastMove < 2500; }
}
