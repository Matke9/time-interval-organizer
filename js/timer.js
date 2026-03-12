// js/timer.js — Timestamp-based timer engine

import {
  state,
  saveState,
  findActivity,
  findSegment,
  getFirstPendingSegment,
  isActivityComplete,
} from './state.js';
import { updateUI, playAlert } from './ui.js';

// ─── Internal helpers ─────────────────────────────────────────────────────────

function setActiveTimer(type, activityId, segmentId, durationSeconds) {
  const endTime = Date.now() + durationSeconds * 1000;
  state.activeTimer = {
    type,
    activityId,
    segmentId,
    endTime,
    pausedRemainingSeconds: null,
  };
}

function getCurrentRemainingSeconds() {
  if (!state.activeTimer) return 0;
  if (state.activeTimer.pausedRemainingSeconds !== null) {
    return state.activeTimer.pausedRemainingSeconds;
  }
  return Math.max(0, Math.floor((state.activeTimer.endTime - Date.now()) / 1000));
}

// ─── Start / switch ───────────────────────────────────────────────────────────

export function startActivitySegment(activityId) {
  const segment = getFirstPendingSegment(activityId);
  if (!segment) return;

  const durationSeconds =
    segment.status === 'paused'
      ? segment.remainingSeconds
      : segment.durationMinutes * 60;

  segment.status = 'running';
  segment.remainingSeconds = durationSeconds;

  setActiveTimer('activity', activityId, segment.segmentId, durationSeconds);
  state.focusMode = true;
  saveState();
  updateUI();
}

export function startDefaultTimer() {
  const durationSeconds = state.defaultTimer.durationMinutes * 60;
  setActiveTimer('defaultBreak', null, null, durationSeconds);
  state.focusMode = true;
  saveState();
  updateUI();
}

export function switchActivity(activityId) {
  if (isActivityComplete(activityId)) return;

  // Pause current timer if it's an activity segment
  if (state.activeTimer && state.activeTimer.type === 'activity') {
    const remaining = getCurrentRemainingSeconds();
    const seg = findSegment(state.activeTimer.activityId, state.activeTimer.segmentId);
    if (seg && seg.status === 'running') {
      seg.status = 'paused';
      seg.remainingSeconds = remaining;
    }
  }

  state.activeTimer = null;
  startActivitySegment(activityId);
}

// ─── Pause / resume ───────────────────────────────────────────────────────────

export function pauseTimer() {
  if (!state.activeTimer) return;
  if (state.activeTimer.pausedRemainingSeconds !== null) return; // already paused

  const remaining = getCurrentRemainingSeconds();
  state.activeTimer.pausedRemainingSeconds = remaining;

  if (state.activeTimer.type === 'activity') {
    const seg = findSegment(state.activeTimer.activityId, state.activeTimer.segmentId);
    if (seg) {
      seg.status = 'paused';
      seg.remainingSeconds = remaining;
    }
  }

  saveState();
  updateUI();
}

export function resumeTimer() {
  if (!state.activeTimer) return;
  if (state.activeTimer.pausedRemainingSeconds === null) return; // not paused

  const remaining = state.activeTimer.pausedRemainingSeconds;
  state.activeTimer.endTime = Date.now() + remaining * 1000;
  state.activeTimer.pausedRemainingSeconds = null;

  if (state.activeTimer.type === 'activity') {
    const seg = findSegment(state.activeTimer.activityId, state.activeTimer.segmentId);
    if (seg) {
      seg.status = 'running';
    }
  }

  saveState();
  updateUI();
}

// ─── Skip ─────────────────────────────────────────────────────────────────────

export function skipTimer() {
  if (!state.activeTimer) return;

  if (state.activeTimer.type === 'activity') {
    const seg = findSegment(state.activeTimer.activityId, state.activeTimer.segmentId);
    if (seg) {
      seg.status = 'completed';
      seg.remainingSeconds = 0;
    }
  }

  state.activeTimer = null;
  saveState();

  // Auto-start break timer after skipping an activity segment (only if break > 0)
  if (state.defaultTimer.durationMinutes > 0) {
    startDefaultTimer();
  } else {
    updateUI();
  }
}

// ─── Tick — called by setInterval every 250ms ─────────────────────────────────

export function tick() {
  if (!state.activeTimer) return;
  if (state.activeTimer.pausedRemainingSeconds !== null) return; // paused — don't tick

  const remaining = getCurrentRemainingSeconds();

  if (state.activeTimer.type === 'activity') {
    const seg = findSegment(state.activeTimer.activityId, state.activeTimer.segmentId);
    if (seg) {
      seg.remainingSeconds = remaining;
    }
  }

  if (remaining <= 0) {
    handleTimerComplete();
    return;
  }

  updateUI();
}

function handleTimerComplete() {
  playAlert();

  if (state.activeTimer.type === 'activity') {
    const seg = findSegment(state.activeTimer.activityId, state.activeTimer.segmentId);
    if (seg) {
      seg.status = 'completed';
      seg.remainingSeconds = 0;
    }
    state.activeTimer = null;
    saveState();
    // Start break after activity (only if break > 0)
    if (state.defaultTimer.durationMinutes > 0) {
      startDefaultTimer();
    } else {
      updateUI();
    }
  } else {
    // Break complete — just clear the timer
    state.activeTimer = null;
    saveState();
    updateUI();
  }
}

// ─── Exit focus mode (ESC) ────────────────────────────────────────────────────

export function exitFocusMode() {
  pauseTimer();
  state.focusMode = false;
  saveState();
  updateUI();
}
