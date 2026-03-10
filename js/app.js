// js/app.js — Entry point: wires everything together

import { initApp, state } from './state.js';
import { tick, exitFocusMode } from './timer.js';
import { updateUI } from './ui.js';

// ─── Tick loop ────────────────────────────────────────────────────────────────

let tickInterval = null;

function startTick() {
  if (tickInterval) return;
  tickInterval = setInterval(() => {
    if (state.focusMode) {
      tick();
    }
  }, 250);
}

// ─── Keyboard shortcuts ───────────────────────────────────────────────────────

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && state.focusMode) {
    exitFocusMode();
  }
});

// ─── Service Worker registration ─────────────────────────────────────────────

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => console.log('SW registered:', reg.scope))
      .catch((err) => console.warn('SW registration failed:', err));
  });
}

// ─── Bootstrap ───────────────────────────────────────────────────────────────

initApp();
updateUI();
startTick();
