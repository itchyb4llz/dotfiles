// Pure state-machine and formatting helpers for the pomodoro plugin. Kept
// free of QML/Quickshell types so it can be reasoned about (and tested) on
// its own; Panel.qml drives it and owns all the timers/UI.

function clamp(value, lo, hi) {
  return Math.max(lo, Math.min(hi, value))
}

function formatTime(totalSeconds) {
  var s = Math.max(0, Math.round(totalSeconds))
  var m = Math.floor(s / 60)
  var r = s % 60
  return (m < 10 ? "0" + m : String(m)) + ":" + (r < 10 ? "0" + r : String(r))
}

// durations: { focusMinutes, shortBreakMinutes, longBreakMinutes }
function durationSeconds(sessionType, durations) {
  var minutes = sessionType === "focus" ? durations.focusMinutes
    : sessionType === "long" ? durations.longBreakMinutes
    : durations.shortBreakMinutes
  return Math.max(1, Math.round(minutes * 60))
}

function statusLabel(sessionType) {
  if (sessionType === "focus") return "Focus"
  if (sessionType === "long") return "Long break"
  return "Short break"
}

// Session sequence: focus -> short -> focus -> short -> ... -> focus -> long -> focus (cycle resets)
// cycleCount tracks completed focus sessions since the last long break (0..cyclesUntilLong-1).
function nextSession(sessionType, cycleCount, cyclesUntilLong) {
  if (sessionType === "focus") {
    var completed = cycleCount + 1
    return completed >= cyclesUntilLong
      ? { type: "long", cycleCount: completed }
      : { type: "short", cycleCount: completed }
  }
  return { type: "focus", cycleCount: sessionType === "long" ? 0 : cycleCount }
}

function completionMessage(finishedType, upcoming) {
  if (finishedType === "focus") {
    return upcoming.type === "long"
      ? "Focus session done — long break time."
      : "Focus session done — short break time."
  }
  return "Break's over — back to focus."
}

function progressFraction(remainingSeconds, totalSeconds) {
  if (totalSeconds <= 0) return 0
  return clamp((totalSeconds - remainingSeconds) / totalSeconds, 0, 1)
}
