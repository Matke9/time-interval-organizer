// js/ui.js — Rendering and audio

import {
  state,
  saveState,
  findActivity,
  isActivityComplete,
  recalculateBudget,
  addActivity,
  removeActivity,
  updateActivity,
  reorderActivities,
} from './state.js';

import {
  startActivitySegment,
  startDefaultTimer,
  switchActivity,
  pauseTimer,
  resumeTimer,
  skipTimer,
  exitFocusMode,
} from './timer.js';

// ─── Edit-mode state (config view) ───────────────────────────────────────────

let editingActivityId = null;
let dragSrcIndex = null;

// ─── Audio ────────────────────────────────────────────────────────────────────

let audioCtx = null;

function getAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioCtx;
}

export function playAlert() {
  try {
    const ctx = getAudioContext();
    const frequencies = [880, 1100, 880, 660];
    let time = ctx.currentTime;

    frequencies.forEach((freq) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, time);
      gain.gain.setValueAtTime(0.4, time);
      gain.gain.exponentialRampToValueAtTime(0.001, time + 0.3);
      osc.start(time);
      osc.stop(time + 0.3);
      time += 0.3;
    });
  } catch (e) {
    console.warn('Audio alert failed:', e);
  }
}

// ─── Time formatting ──────────────────────────────────────────────────────────

export function formatTime(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

// ─── Segment progress bar ─────────────────────────────────────────────────────

function buildSegmentBar(segments) {
  return segments
    .map((seg) => {
      if (seg.status === 'completed') return '<span class="seg seg-done">█</span>';
      if (seg.status === 'running') return '<span class="seg seg-active">▶</span>';
      if (seg.status === 'paused') return '<span class="seg seg-paused">▌▌</span>';
      return '<span class="seg seg-pending">░</span>';
    })
    .join('');
}

// ─── Session elapsed / remaining ─────────────────────────────────────────────

function getSessionStats() {
  const totalSec = state.totalTimeMinutes * 60;
  // Count seconds elapsed based on segment durations and actual time spent
  let elapsedSec = 0;
  state.activities.forEach((a) => {
    a.segments.forEach((seg) => {
      if (seg.status === 'completed') {
        elapsedSec += seg.durationMinutes * 60 - seg.remainingSeconds;
      } else if (seg.status === 'running' || seg.status === 'paused') {
        const spent = seg.durationMinutes * 60 - seg.remainingSeconds;
        elapsedSec += Math.max(0, spent);
      }
    });
  });
  const remainingSec = Math.max(0, totalSec - elapsedSec);
  return { elapsedSec, remainingSec };
}

// ─── Master render ────────────────────────────────────────────────────────────

export function updateUI() {
  if (state.focusMode) {
    renderFocusMode();
  } else {
    renderConfigView();
  }
}

// ─── Configuration View ───────────────────────────────────────────────────────

export function renderConfigView() {
  const app = document.getElementById('app');

  const budgetClass = state.remainingBudgetMinutes < 0 ? 'budget-over' : '';

  const activitiesHTML = state.activities
    .map((a, index) => {
      if (a.id === editingActivityId) {
        return `
          <div class="activity-row activity-row-editing" data-id="${a.id}" data-index="${index}">
            <div class="activity-edit-inline">
              <input type="text" class="edit-act-name" value="${escapeHtml(a.name)}" maxlength="40" placeholder="Activity name">
              <input type="number" class="edit-act-duration" min="1" max="240" value="${a.durationMinutes}" placeholder="min">
              <input type="number" class="edit-act-reps" min="1" max="20" value="${a.repetitions}" placeholder="reps">
            </div>
            <div class="activity-row-actions">
              <button class="btn-save-edit" data-save="${a.id}" aria-label="Save changes">✓ Save</button>
              <button class="btn-cancel-edit" data-cancel="${a.id}" aria-label="Cancel edit">✕</button>
            </div>
          </div>
        `;
      }
      return `
        <div class="activity-row" data-id="${a.id}" data-index="${index}" draggable="true">
          <span class="drag-handle" aria-hidden="true" title="Drag to reorder">⠿</span>
          <div class="activity-info">
            <span class="activity-name">${escapeHtml(a.name)}</span>
            <span class="activity-meta">${a.durationMinutes} min × ${a.repetitions} reps = ${a.durationMinutes * a.repetitions} min</span>
            <div class="seg-preview">${buildSegmentBar(a.segments)}</div>
          </div>
          <div class="activity-row-actions">
            <button class="btn-edit" data-edit="${a.id}" aria-label="Edit ${escapeHtml(a.name)}">✏</button>
            <button class="btn-remove" data-remove="${a.id}" aria-label="Remove ${escapeHtml(a.name)}">✕</button>
          </div>
        </div>
      `;
    })
    .join('');

  const canStart = state.activities.length > 0;

  app.innerHTML = `
    <div class="config-view">
      <header class="app-header">
        <h1>⏱ Focus Timer</h1>
      </header>

      <section class="config-section">
        <h2>Session Settings</h2>
        <div class="form-row">
          <label for="totalTime">Total session time (min)</label>
          <input id="totalTime" type="number" min="1" max="480" value="${state.totalTimeMinutes}">
        </div>
        <div class="form-row">
          <label for="breakTime">Break timer duration (min)</label>
          <input id="breakTime" type="number" min="0" max="60" value="${state.defaultTimer.durationMinutes}">
        </div>
      </section>

      <section class="config-section">
        <h2>Activities</h2>
        <div class="add-activity-form">
          <input id="actName" type="text" placeholder="Activity name" maxlength="40">
          <input id="actDuration" type="number" min="1" max="240" placeholder="Duration (min)" value="25">
          <input id="actReps" type="number" min="1" max="20" placeholder="Repetitions" value="1">
          <button id="btnAddActivity" class="btn-primary">Add Activity</button>
        </div>
        <div class="activities-list">
          ${activitiesHTML || '<p class="empty-hint">No activities yet. Add one above.</p>'}
        </div>
      </section>

      <section class="budget-section">
        <div class="budget-bar">
          <span>Budget: <strong class="${budgetClass}">${state.remainingBudgetMinutes} min remaining</strong></span>
          <span class="budget-detail">(${state.usableTimeMinutes} min planned / ${state.totalTimeMinutes} min total)</span>
        </div>
      </section>

      ${
        canStart
          ? `<button id="btnStart" class="btn-start">▶ Start Session</button>`
          : `<button class="btn-start btn-disabled" disabled>Add activities to start</button>`
      }
    </div>
  `;

  // ── Event listeners ──────────────────────────────────────────────────────

  document.getElementById('totalTime').addEventListener('change', (e) => {
    const val = parseInt(e.target.value, 10);
    if (val > 0) {
      state.totalTimeMinutes = val;
      recalculateBudget();
      saveState();
      renderConfigView();
    }
  });

  document.getElementById('breakTime').addEventListener('change', (e) => {
    const val = parseInt(e.target.value, 10);
    if (val >= 0) {
      state.defaultTimer.durationMinutes = val;
      recalculateBudget();
      saveState();
      renderConfigView();
    }
  });

  document.getElementById('btnAddActivity').addEventListener('click', () => {
    const name = document.getElementById('actName').value.trim();
    const duration = parseInt(document.getElementById('actDuration').value, 10);
    const reps = parseInt(document.getElementById('actReps').value, 10);
    if (!name) {
      alert('Please enter an activity name.');
      return;
    }
    if (!duration || duration < 1) {
      alert('Please enter a valid duration.');
      return;
    }
    if (!reps || reps < 1) {
      alert('Please enter a valid number of repetitions.');
      return;
    }
    addActivity(name, duration, reps);
    renderConfigView();
    document.getElementById('actName').value = '';
  });

  // Remove buttons
  document.querySelectorAll('[data-remove]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.remove;
      removeActivity(id);
      renderConfigView();
    });
  });

  // Edit buttons
  document.querySelectorAll('[data-edit]').forEach((btn) => {
    btn.addEventListener('click', () => {
      editingActivityId = btn.dataset.edit;
      renderConfigView();
    });
  });

  // Save edit buttons
  document.querySelectorAll('[data-save]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.save;
      const row = document.querySelector(`.activity-row[data-id="${id}"]`);
      if (!row) return;
      const name = row.querySelector('.edit-act-name').value.trim();
      const duration = parseInt(row.querySelector('.edit-act-duration').value, 10);
      const reps = parseInt(row.querySelector('.edit-act-reps').value, 10);
      if (!name) { alert('Please enter an activity name.'); return; }
      if (!duration || duration < 1) { alert('Please enter a valid duration (1–240 min).'); return; }
      if (!reps || reps < 1) { alert('Please enter a valid number of repetitions (1–20).'); return; }
      editingActivityId = null;
      updateActivity(id, name, duration, reps);
      renderConfigView();
    });
  });

  // Cancel edit buttons
  document.querySelectorAll('[data-cancel]').forEach((btn) => {
    btn.addEventListener('click', () => {
      editingActivityId = null;
      renderConfigView();
    });
  });

  // Keyboard shortcuts inside the inline edit form
  document.querySelectorAll('.activity-row-editing input').forEach((input) => {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const saveBtn = input.closest('.activity-row-editing').querySelector('[data-save]');
        if (saveBtn) saveBtn.click();
      } else if (e.key === 'Escape') {
        editingActivityId = null;
        renderConfigView();
      }
    });
  });

  // Auto-focus name field when entering edit mode
  if (editingActivityId) {
    const nameInput = document.querySelector('.edit-act-name');
    if (nameInput) nameInput.focus();
  }

  // Drag and drop reordering
  document.querySelectorAll('.activity-row[draggable="true"]').forEach((row) => {
    row.addEventListener('dragstart', (e) => {
      dragSrcIndex = parseInt(row.dataset.index, 10);
      row.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    row.addEventListener('dragend', () => {
      row.classList.remove('dragging');
      document.querySelectorAll('.activity-row').forEach((r) => r.classList.remove('drag-over'));
      dragSrcIndex = null;
    });
    row.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      document.querySelectorAll('.activity-row').forEach((r) => r.classList.remove('drag-over'));
      row.classList.add('drag-over');
    });
    row.addEventListener('dragleave', (e) => {
      if (!row.contains(e.relatedTarget)) {
        row.classList.remove('drag-over');
      }
    });
    row.addEventListener('drop', (e) => {
      e.preventDefault();
      const targetIndex = parseInt(row.dataset.index, 10);
      if (dragSrcIndex !== null && dragSrcIndex !== targetIndex) {
        reorderActivities(dragSrcIndex, targetIndex);
        renderConfigView();
      }
    });
  });

  if (canStart) {
    document.getElementById('btnStart').addEventListener('click', () => {
      // Start first available activity
      const firstActivity = state.activities[0];
      if (firstActivity) {
        startActivitySegment(firstActivity.id);
      }
    });
  }
}

// ─── Focus Mode ───────────────────────────────────────────────────────────────

function isTimerPaused() {
  return !!(state.activeTimer && state.activeTimer.pausedRemainingSeconds !== null);
}

export function renderFocusMode() {
  const app = document.getElementById('app');
  const existingFocusView = app.querySelector('.focus-view');

  if (!existingFocusView) {
    fullRenderFocusMode(app);
    return;
  }

  // Check for structural changes that require a full re-render
  const timerActive = !!state.activeTimer;
  const floatControlsExist = !!document.querySelector('.float-controls');
  if (timerActive !== floatControlsExist) {
    fullRenderFocusMode(app);
    return;
  }

  // Check if any card transitioned to done (structural change)
  for (const activity of state.activities) {
    const card = document.getElementById(`card-${activity.id}`);
    if (!card) {
      fullRenderFocusMode(app);
      return;
    }
    const done = isActivityComplete(activity.id);
    const wasDone = card.classList.contains('card-done');
    if (done !== wasDone) {
      fullRenderFocusMode(app);
      return;
    }
  }

  incrementalUpdateFocusMode();
}

function fullRenderFocusMode(app) {
  // Build activity cards
  const activityCards = state.activities
    .map((a) => buildActivityCard(a))
    .join('');

  // Break button card — only include when break > 0
  const shouldShowBreakCard = Number(state.defaultTimer.durationMinutes) > 0;
  const breakCard = shouldShowBreakCard ? buildBreakCard() : '';

  // Total card count for grid layout
  const totalCards = state.activities.length + (shouldShowBreakCard ? 1 : 0);

  // Active timer info for skip
  const timerActive = !!state.activeTimer;
  const isPaused = state.activeTimer && state.activeTimer.pausedRemainingSeconds !== null;

  const { elapsedSec, remainingSec } = getSessionStats();

  app.innerHTML = `
    <div class="focus-view">
      <div class="focus-header">
        <div class="session-time">
          <span>⏱ Elapsed: <strong>${formatTime(elapsedSec)}</strong></span>
          <span>⌛ Remaining: <strong>${formatTime(remainingSec)}</strong></span>
        </div>
        <button id="btnExitFocus" class="btn-exit" title="Exit Focus Mode (ESC)">✕ Exit</button>
      </div>

      <div class="focus-grid" style="--grid-cols: ${getGridCols(totalCards)}">
        ${activityCards}
        ${breakCard}
      </div>

      ${
        timerActive
          ? `<div class="float-controls">
              <button id="btnSkip" class="btn-float btn-skip" title="Skip current timer">⏭ Skip</button>
              <button id="btnPauseResume" class="btn-float ${isPaused ? 'btn-resume' : 'btn-pause'}" title="${isPaused ? 'Resume' : 'Pause'}">
                ${isPaused ? '▶ Resume' : '⏸ Pause'}
              </button>
            </div>`
          : ''
      }
    </div>
  `;

  // ── Event listeners ──────────────────────────────────────────────────────

  document.getElementById('btnExitFocus').addEventListener('click', exitFocusMode);

  if (timerActive) {
    document.getElementById('btnSkip').addEventListener('click', skipTimer);
    document.getElementById('btnPauseResume').addEventListener('click', () => {
      if (isTimerPaused()) {
        resumeTimer();
      } else {
        pauseTimer();
      }
    });
  }

  // Activity card clicks
  state.activities.forEach((a) => {
    const card = document.getElementById(`card-${a.id}`);
    if (card && !card.classList.contains('card-done')) {
      card.addEventListener('click', () => {
        const isCurrentlyActive =
          state.activeTimer &&
          state.activeTimer.type === 'activity' &&
          state.activeTimer.activityId === a.id;

        if (isCurrentlyActive) {
          if (isTimerPaused()) {
            resumeTimer();
          } else {
            pauseTimer();
          }
        } else {
          switchActivity(a.id);
        }
      });
    }
  });

  // Break card click
  const breakCardEl = document.getElementById('card-break');
  if (breakCardEl) {
    breakCardEl.addEventListener('click', () => {
      const isBreakActive =
        state.activeTimer && state.activeTimer.type === 'defaultBreak';
      if (isBreakActive) {
        if (isTimerPaused()) {
          resumeTimer();
        } else {
          pauseTimer();
        }
      } else {
        // Stop current activity timer and start break
        if (state.activeTimer && state.activeTimer.type === 'activity') {
          const remaining = Math.max(
            0,
            Math.floor((state.activeTimer.endTime - Date.now()) / 1000)
          );
          const seg = findActivity(state.activeTimer.activityId)?.segments.find(
            (s) => s.segmentId === state.activeTimer.segmentId
          );
          if (seg) {
            seg.status = 'paused';
            seg.remainingSeconds = remaining;
          }
          state.activeTimer = null;
        }
        startDefaultTimer();
      }
    });
  }
}

function incrementalUpdateFocusMode() {
  // Update session stats
  const { elapsedSec, remainingSec } = getSessionStats();
  const sessionTimeEl = document.querySelector('.session-time');
  if (sessionTimeEl) {
    const spans = sessionTimeEl.querySelectorAll('strong');
    if (spans[0]) spans[0].textContent = formatTime(elapsedSec);
    if (spans[1]) spans[1].textContent = formatTime(remainingSec);
  }

  // Update each activity card
  state.activities.forEach((a) => {
    updateActivityCard(a);
  });

  // Update break card
  if (Number(state.defaultTimer.durationMinutes) > 0) {
    updateBreakCard();
  }

  // Update pause/resume button text
  updateFloatControls();
}

function updateActivityCard(activity) {
  const card = document.getElementById(`card-${activity.id}`);
  if (!card) return;

  const done = isActivityComplete(activity.id);
  const isActive =
    state.activeTimer &&
    state.activeTimer.type === 'activity' &&
    state.activeTimer.activityId === activity.id;
  const isPaused = isActive && state.activeTimer.pausedRemainingSeconds !== null;

  let remainingSeconds = 0;
  if (isActive) {
    remainingSeconds = isPaused
      ? state.activeTimer.pausedRemainingSeconds
      : Math.max(0, Math.floor((state.activeTimer.endTime - Date.now()) / 1000));
  } else {
    const pending = activity.segments.find(
      (s) => s.status === 'pending' || s.status === 'paused'
    );
    remainingSeconds = pending ? pending.remainingSeconds : 0;
  }

  const totalDuration = activity.durationMinutes * 60;
  const pct = totalDuration > 0 ? remainingSeconds / totalDuration : 0;
  const pulse = isActive && !isPaused && pct <= 0.1 && remainingSeconds > 0;

  card.classList.toggle('card-active', !!(isActive && !done));
  card.classList.toggle('card-pulse', !!pulse);
  card.classList.toggle('card-paused', !!isPaused);

  if (!done) {
    const timerEl = card.querySelector('.card-timer');
    if (timerEl) timerEl.textContent = formatTime(remainingSeconds);
  }

  const completedCount = activity.segments.filter((s) => s.status === 'completed').length;
  const totalCount = activity.segments.length;
  const segmentsEl = card.querySelector('.card-segments');
  if (segmentsEl) {
    segmentsEl.innerHTML = `${buildSegmentBar(activity.segments)}<span class="seg-count">${completedCount}/${totalCount}</span>`;
  }

  // Show/hide paused label
  let pausedLabel = card.querySelector('.card-paused-label');
  if (isPaused && !pausedLabel) {
    pausedLabel = document.createElement('div');
    pausedLabel.className = 'card-paused-label';
    pausedLabel.textContent = 'PAUSED';
    card.appendChild(pausedLabel);
  } else if (!isPaused && pausedLabel) {
    pausedLabel.remove();
  }
}

function updateBreakCard() {
  const card = document.getElementById('card-break');
  if (!card) return;

  const isBreakActive = state.activeTimer && state.activeTimer.type === 'defaultBreak';
  const isPaused = isBreakActive && state.activeTimer.pausedRemainingSeconds !== null;

  let remainingSeconds = state.defaultTimer.durationMinutes * 60;
  if (isBreakActive) {
    remainingSeconds = isPaused
      ? state.activeTimer.pausedRemainingSeconds
      : Math.max(0, Math.floor((state.activeTimer.endTime - Date.now()) / 1000));
  }

  const totalDuration = state.defaultTimer.durationMinutes * 60;
  const pct = totalDuration > 0 ? remainingSeconds / totalDuration : 0;
  const pulse = isBreakActive && !isPaused && pct <= 0.1 && remainingSeconds > 0;

  card.classList.toggle('card-active', !!isBreakActive);
  card.classList.toggle('card-pulse', !!pulse);
  card.classList.toggle('card-paused', !!isPaused);

  const timerEl = card.querySelector('.card-timer');
  if (timerEl) timerEl.textContent = formatTime(remainingSeconds);

  let pausedLabel = card.querySelector('.card-paused-label');
  if (isPaused && !pausedLabel) {
    pausedLabel = document.createElement('div');
    pausedLabel.className = 'card-paused-label';
    pausedLabel.textContent = 'PAUSED';
    card.appendChild(pausedLabel);
  } else if (!isPaused && pausedLabel) {
    pausedLabel.remove();
  }
}

function updateFloatControls() {
  const btn = document.getElementById('btnPauseResume');
  if (!btn) return;
  if (isTimerPaused()) {
    btn.textContent = '▶ Resume';
    btn.title = 'Resume';
    btn.classList.remove('btn-pause');
    btn.classList.add('btn-resume');
  } else {
    btn.textContent = '⏸ Pause';
    btn.title = 'Pause';
    btn.classList.remove('btn-resume');
    btn.classList.add('btn-pause');
  }
}

function buildActivityCard(activity) {
  const done = isActivityComplete(activity.id);

  const isActive =
    state.activeTimer &&
    state.activeTimer.type === 'activity' &&
    state.activeTimer.activityId === activity.id;

  const isPaused = isActive && state.activeTimer.pausedRemainingSeconds !== null;

  let remainingSeconds = 0;
  if (isActive) {
    if (isPaused) {
      remainingSeconds = state.activeTimer.pausedRemainingSeconds;
    } else {
      remainingSeconds = Math.max(
        0,
        Math.floor((state.activeTimer.endTime - Date.now()) / 1000)
      );
    }
  } else {
    // Show remaining time of next pending segment
    const pending = activity.segments.find(
      (s) => s.status === 'pending' || s.status === 'paused'
    );
    remainingSeconds = pending ? pending.remainingSeconds : 0;
  }

  const totalDuration = activity.durationMinutes * 60;
  const pct = totalDuration > 0 ? remainingSeconds / totalDuration : 0;
  const pulse = isActive && !isPaused && pct <= 0.1 && remainingSeconds > 0;

  const completedCount = activity.segments.filter((s) => s.status === 'completed').length;
  const totalCount = activity.segments.length;

  let classes = 'focus-card';
  if (done) classes += ' card-done';
  if (isActive && !done) classes += ' card-active';
  if (pulse) classes += ' card-pulse';
  if (isPaused) classes += ' card-paused';

  return `
    <div class="${classes}" id="card-${activity.id}" role="button" tabindex="${done ? -1 : 0}" aria-label="${escapeHtml(activity.name)}">
      <div class="card-name">${escapeHtml(activity.name)}</div>
      ${
        done
          ? '<div class="card-status">✓ Completed</div>'
          : `<div class="card-timer">${formatTime(remainingSeconds)}</div>`
      }
      <div class="card-segments">
        ${buildSegmentBar(activity.segments)}
        <span class="seg-count">${completedCount}/${totalCount}</span>
      </div>
      ${isPaused ? '<div class="card-paused-label">PAUSED</div>' : ''}
    </div>
  `;
}

function buildBreakCard() {
  const isBreakActive = state.activeTimer && state.activeTimer.type === 'defaultBreak';
  const isPaused = isBreakActive && state.activeTimer.pausedRemainingSeconds !== null;

  let remainingSeconds = state.defaultTimer.durationMinutes * 60;
  if (isBreakActive) {
    if (isPaused) {
      remainingSeconds = state.activeTimer.pausedRemainingSeconds;
    } else {
      remainingSeconds = Math.max(
        0,
        Math.floor((state.activeTimer.endTime - Date.now()) / 1000)
      );
    }
  }

  const totalDuration = state.defaultTimer.durationMinutes * 60;
  const pct = totalDuration > 0 ? remainingSeconds / totalDuration : 0;
  const pulse = isBreakActive && !isPaused && pct <= 0.1 && remainingSeconds > 0;

  let classes = 'focus-card card-break';
  if (isBreakActive) classes += ' card-active';
  if (pulse) classes += ' card-pulse';
  if (isPaused) classes += ' card-paused';

  return `
    <div class="${classes}" id="card-break" role="button" tabindex="0" aria-label="Break">
      <div class="card-name">☕ Break</div>
      <div class="card-timer">${formatTime(remainingSeconds)}</div>
      <div class="card-segments"><span class="seg-count">${state.defaultTimer.durationMinutes} min</span></div>
      ${isPaused ? '<div class="card-paused-label">PAUSED</div>' : ''}
    </div>
  `;
}

function getGridCols(count) {
  if (count <= 1) return 1;
  if (count <= 2) return 2;
  if (count <= 4) return 2;
  if (count <= 6) return 3;
  return 3;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
