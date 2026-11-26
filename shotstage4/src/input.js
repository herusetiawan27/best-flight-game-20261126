// Keyboard + mouse input. Mouse steering engages when the mouse has
// moved within the last 2.5 seconds: pitch/roll ease toward the pointer's
// offset from screen centre.
export class Input {
  constructor(canvas) {
    this.keys = new Set();
    this.mouseX = 0.5; this.mouseY = 0.5; // normalised 0..1
    this.mouseLastMove = -Infinity;
    this.pressed = new Set(); // one-shot keys, cleared by consumer each frame
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
    canvas.addEventListener('mousedown', () => this.pressed.add('__click'));
    window.addEventListener('blur', () => this.keys.clear());
  }
  down(k) { return this.keys.has(k); }
  takePressed(k) { const p = this.pressed.has(k); if (p) this.pressed.delete(k); return p; }
  clearPressed() { this.pressed.clear(); }
  mouseActive(now) { return now - this.mouseLastMove < 2500; }
}
