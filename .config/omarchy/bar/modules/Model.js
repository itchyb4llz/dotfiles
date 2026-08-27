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

// Local calendar-day key (YYYY-MM-DD), used to detect midnight rollover for
// the daily focus-session counter. Takes a Date so it stays testable without
// a live clock.
function dateKey(date) {
  var d = date || new Date()
  var m = String(d.getMonth() + 1)
  var day = String(d.getDate())
  if (m.length < 2) m = "0" + m
  if (day.length < 2) day = "0" + day
  return d.getFullYear() + "-" + m + "-" + day
}

// Shown on the break-lock overlay when a key is pressed while it's up --
// keyboard input never gets through to whatever's underneath, so this is
// the only feedback a keystroke gets.
var teaseMessages = [
  "Nice try. Still on break.",
  "Nope — put it down.",
  "The keyboard's on break too.",
  "That key does nothing right now.",
  "Zero points for effort.",
  "Typing won't do it."
]

// Picks a random tease, avoiding an immediate repeat of the last one shown.
function randomTeaseMessage(previous) {
  if (teaseMessages.length <= 1) return teaseMessages[0] || ""
  var pick
  do { pick = teaseMessages[Math.floor(Math.random() * teaseMessages.length)] } while (pick === previous)
  return pick
}
