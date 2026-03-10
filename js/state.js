// js/state.js — Application state model and persistence

const STORAGE_KEY = 'focusTimerState';

export let state = {
  totalTimeMinutes: 60,
  usableTimeMinutes: 0,
  remainingBudgetMinutes: 60,

  defaultTimer: {
    durationMinutes: 5,
  },

  activities: [],

  activeTimer: null,
  // activeTimer shape when set:
  // {
  //   type: "activity" | "defaultBreak",
  //   activityId: string | null,
  //   segmentId: string | null,
  //   endTime: number,
  //   pausedRemainingSeconds: number | null
  // }

  focusMode: false,
};

// ─── ID helpers ─────────────────────────────────────────────────────────────

function generateId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// ─── Segment expansion ───────────────────────────────────────────────────────

export function expandSegments(activity) {
  const segments = [];
  for (let i = 0; i < activity.repetitions; i++) {
    segments.push({
      segmentId: generateId(),
      durationMinutes: activity.durationMinutes,
      remainingSeconds: activity.durationMinutes * 60,
      status: 'pending',
    });
  }
  return segments;
}

// ─── Activity management ─────────────────────────────────────────────────────

export function addActivity(name, durationMinutes, repetitions) {
  const activity = {
    id: generateId(),
    name: name.trim(),
    durationMinutes,
    repetitions,
    segments: [],
  };
  activity.segments = expandSegments(activity);
  state.activities.push(activity);
  recalculateBudget();
  saveState();
}

export function removeActivity(activityId) {
  state.activities = state.activities.filter((a) => a.id !== activityId);
  // If the removed activity was active, clear the timer
  if (state.activeTimer && state.activeTimer.activityId === activityId) {
    state.activeTimer = null;
    state.focusMode = false;
  }
  recalculateBudget();
  saveState();
}

export function recalculateBudget() {
  let usable = 0;
  state.activities.forEach((a) => {
    usable += a.durationMinutes * a.repetitions;
  });
  // Add break time between activities (one break per activity segment completed, minus last)
  const totalSegments = state.activities.reduce((sum, a) => sum + a.repetitions, 0);
  if (totalSegments > 1) {
    usable += state.defaultTimer.durationMinutes * (totalSegments - 1);
  }
  state.usableTimeMinutes = usable;
  state.remainingBudgetMinutes = state.totalTimeMinutes - usable;
}

// ─── Persistence ─────────────────────────────────────────────────────────────

export function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('Failed to save state:', e);
  }
}

export function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const saved = JSON.parse(raw);
    // Merge saved state into current state
    Object.assign(state, saved);

    // Recompute remaining time for the active timer
    if (state.activeTimer && state.activeTimer.endTime) {
      const remaining = Math.floor((state.activeTimer.endTime - Date.now()) / 1000);
      if (remaining <= 0) {
        // Timer expired while away — mark segment completed
        if (state.activeTimer.type === 'activity') {
          const seg = findSegment(state.activeTimer.activityId, state.activeTimer.segmentId);
          if (seg) {
            seg.status = 'completed';
            seg.remainingSeconds = 0;
          }
        }
        state.activeTimer = null;
      } else if (state.activeTimer.pausedRemainingSeconds === null) {
        // Still running — update the segment's remainingSeconds for display
        if (state.activeTimer.type === 'activity') {
          const seg = findSegment(state.activeTimer.activityId, state.activeTimer.segmentId);
          if (seg) {
            seg.remainingSeconds = remaining;
            seg.status = 'running';
          }
        }
      }
    }

    // Recompute budget from activities to ensure it's always accurate
    recalculateBudget();

    return true;
  } catch (e) {
    console.warn('Failed to load state:', e);
    return false;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function findActivity(activityId) {
  return state.activities.find((a) => a.id === activityId) || null;
}

export function findSegment(activityId, segmentId) {
  const activity = findActivity(activityId);
  if (!activity) return null;
  return activity.segments.find((s) => s.segmentId === segmentId) || null;
}

export function getFirstPendingSegment(activityId) {
  const activity = findActivity(activityId);
  if (!activity) return null;
  return activity.segments.find((s) => s.status === 'pending' || s.status === 'paused') || null;
}

export function isActivityComplete(activityId) {
  const activity = findActivity(activityId);
  if (!activity) return true;
  return activity.segments.every((s) => s.status === 'completed');
}

// ─── Init ─────────────────────────────────────────────────────────────────────

export function initApp() {
  const loaded = loadState();
  if (!loaded) {
    // Fresh start — defaults already set above
    saveState();
  }
}
