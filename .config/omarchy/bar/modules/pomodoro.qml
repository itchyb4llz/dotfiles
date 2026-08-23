import QtQuick
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Ui
import "Model.js" as Model

// Pomodoro timer: bar pill + popup panel in one file, mirroring the built-in
// Power widget's structure. The pill always ticks (even with the popup
// closed) and auto-advances through focus/break sessions on its own, so the
// only thing a session ever needs from the user is Start.
Panel {
  id: root
  moduleName: "pomodoro"
  ipcTarget: "pomodoro"

  // ---- Configuration (overridable per-instance via shell.json settings) ----
  readonly property var durations: ({
    focusMinutes: setting("focusMinutes", 50),
    shortBreakMinutes: setting("shortBreakMinutes", 10),
    longBreakMinutes: setting("longBreakMinutes", 30)
  })
  readonly property int cyclesUntilLong: setting("cyclesUntilLong", 4)

  // ---- Session state ----
  property string sessionType: "focus"   // "focus" | "short" | "long"
  property int cycleCount: 0             // completed focus sessions since the last long break
  property bool running: false
  property real remainingSeconds: Model.durationSeconds("focus", durations)

  readonly property int totalSeconds: Model.durationSeconds(sessionType, durations)
  readonly property real progress: Model.progressFraction(remainingSeconds, totalSeconds)
  readonly property string timeText: Model.formatTime(remainingSeconds)
  readonly property string statusText: Model.statusLabel(sessionType)
  readonly property bool onBreak: sessionType !== "focus"
  // Focus reads urgent (the theme's alert color) so the pill visibly says
  // "you're on the clock"; breaks read the calmer accent color.
  readonly property color sessionColor: onBreak ? Color.accent : Color.urgent
  readonly property int displayRound: Math.min(cyclesUntilLong, Math.max(1, sessionType === "focus" ? cycleCount + 1 : cycleCount))

  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  function start() { running = true }
  function pause() { running = false }
  function toggleRun() { running = !running }

  function reset() {
    running = false
    remainingSeconds = totalSeconds
  }

  // natural: true when the countdown reached zero on its own (chime +
  // notification fire); false for a manual skip, which stays quiet.
  function advance(natural) {
    var result = Model.nextSession(sessionType, cycleCount, cyclesUntilLong)
    if (natural) {
      playChime()
      notify(Model.completionMessage(sessionType, result))
    }
    sessionType = result.type
    cycleCount = result.cycleCount
    remainingSeconds = Model.durationSeconds(sessionType, durations)
  }

  function skip() { advance(false) }

  function tick() {
    if (!running) return
    if (remainingSeconds > 1) remainingSeconds -= 1
    else { remainingSeconds = 0; advance(true) }
  }

  function playChime() {
    chimeProc.running = false
    chimeProc.running = true
  }

  function notify(message) {
    notifyProc.command = ["omarchy-notification-send", "Pomodoro — " + Model.statusLabel(root.sessionType), message, "-g", "🍅"]
    notifyProc.running = false
    notifyProc.running = true
  }

  function switchPanel(direction) {
    if (root.bar && typeof root.bar.switchPanelFrom === "function")
      return root.bar.switchPanelFrom(root, direction)
    return false
  }

  Timer {
    // Always running: the pill stays live whether or not the popup is open.
    interval: 1000
    running: true
    repeat: true
    onTriggered: root.tick()
  }

  Process {
    id: chimeProc
    command: ["bash", "-c", "if command -v paplay >/dev/null 2>&1; then paplay /usr/share/sounds/freedesktop/stereo/complete.oga; elif command -v mpv >/dev/null 2>&1; then mpv --no-video /usr/share/sounds/freedesktop/stereo/complete.oga >/dev/null 2>&1; fi"]
  }

  Process {
    id: notifyProc
  }

  BarIconButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    text: "🍅 " + root.timeText
    slotSize: Style.bar.iconSlot * 2.6
    active: true
    activeColor: root.sessionColor
    tooltipText: root.statusText + (root.running ? "" : " (paused)")
    onPressed: function(b) {
      if (b === Qt.RightButton) root.toggleRun()
      else if (b === Qt.MiddleButton) root.skip()
      else root.toggle()
    }
  }

  KeyboardPanel {
    id: panel
    anchorItem: button
    owner: root
    bar: root.bar
    open: root.opened
    focusTarget: keyCatcher
    contentWidth: panel.fittedContentWidth(Style.space(360))
    contentHeight: panel.fittedContentHeight(column.implicitHeight)

    PanelKeyCatcher {
      id: keyCatcher
      anchors.fill: parent
      onCloseRequested: root.close()
      onTabRequested: function(direction) { root.switchPanel(direction) }

      Column {
        id: column
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: parent.top
        spacing: Style.space(16)

        // ---------- Hero: tomato · title/status · big countdown ----------
        Item {
          width: parent.width
          implicitHeight: Math.max(heroIcon.implicitHeight, heroLabels.implicitHeight, heroTime.implicitHeight)

          Text {
            id: heroIcon
            text: "🍅"
            font.pixelSize: Style.font.display
            anchors.left: parent.left
            anchors.verticalCenter: parent.verticalCenter
          }

          Column {
            id: heroLabels
            anchors.left: heroIcon.right
            anchors.leftMargin: Style.space(14)
            anchors.right: heroTime.left
            anchors.rightMargin: Style.space(10)
            anchors.verticalCenter: parent.verticalCenter
            spacing: Style.space(2)

            Text {
              text: "Pomodoro"
              color: root.bar.foreground
              font.family: root.bar.fontFamily
              font.pixelSize: Style.font.title
              font.bold: true
              elide: Text.ElideRight
              width: parent.width
            }

            Text {
              text: root.statusText.toUpperCase() + (root.running ? "" : " · PAUSED") + "  ·  " + root.displayRound + "/" + root.cyclesUntilLong
              color: Qt.darker(root.bar.foreground, 1.4)
              font.family: root.bar.fontFamily
              font.pixelSize: Style.font.caption
              font.bold: true
              font.letterSpacing: 1.1
              elide: Text.ElideRight
              width: parent.width
            }
          }

          Text {
            id: heroTime
            text: root.timeText
            color: root.sessionColor
            font.family: root.bar.fontFamily
            font.pixelSize: Style.font.displayLarge
            font.bold: true
            anchors.right: parent.right
            anchors.verticalCenter: parent.verticalCenter

            Behavior on color { ColorAnimation { duration: 200 } }
          }
        }

        // ---------- Session progress bar ----------
        Item {
          width: parent.width
          implicitHeight: Style.space(8)

          Rectangle {
            id: barTrack
            anchors.fill: parent
            radius: height / 2
            color: Qt.rgba(root.bar.foreground.r, root.bar.foreground.g, root.bar.foreground.b, 0.12)
          }

          Rectangle {
            id: barFill
            anchors.left: barTrack.left
            anchors.verticalCenter: barTrack.verticalCenter
            height: barTrack.height
            radius: barTrack.radius
            color: root.sessionColor
            width: Math.max(barTrack.height, barTrack.width * root.progress)

            Behavior on width { NumberAnimation { duration: 280; easing.type: Easing.OutCubic } }
            Behavior on color { ColorAnimation { duration: 220 } }

            // A slow pulse while running, so a glance confirms it's actually
            // counting down and not just paused mid-bar.
            SequentialAnimation on opacity {
              running: root.running && root.opened
              loops: Animation.Infinite
              alwaysRunToEnd: true
              NumberAnimation { from: 1.0; to: 0.6; duration: 1000; easing.type: Easing.InOutSine }
              NumberAnimation { from: 0.6; to: 1.0; duration: 1000; easing.type: Easing.InOutSine }
            }
          }
        }

        // ---------- Controls ----------
        Row {
          width: parent.width
          spacing: Style.space(8)

          Button {
            width: (parent.width - parent.spacing * 2) / 3
            text: root.running ? "Pause" : "Start"
            iconText: root.running ? "⏸" : "▶"
            foreground: root.bar.foreground
            fontFamily: root.bar.fontFamily
            bordered: true
            active: root.running
            horizontalPadding: Style.spacing.controlPaddingX
            verticalPadding: Style.spacing.controlPaddingY + Style.space(2)
            onClicked: root.toggleRun()
          }

          Button {
            width: (parent.width - parent.spacing * 2) / 3
            text: "Reset"
            iconText: "↺"
            foreground: root.bar.foreground
            fontFamily: root.bar.fontFamily
            bordered: true
            horizontalPadding: Style.spacing.controlPaddingX
            verticalPadding: Style.spacing.controlPaddingY + Style.space(2)
            onClicked: root.reset()
          }

          Button {
            width: (parent.width - parent.spacing * 2) / 3
            text: "Skip"
            iconText: "⏭"
            foreground: root.bar.foreground
            fontFamily: root.bar.fontFamily
            bordered: true
            horizontalPadding: Style.spacing.controlPaddingX
            verticalPadding: Style.spacing.controlPaddingY + Style.space(2)
            onClicked: root.skip()
          }
        }
      }
    }
  }
}
