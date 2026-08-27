import QtQuick
import Quickshell
import Quickshell.Io
import Quickshell.Wayland
import qs.Commons
import qs.Ui
import "Model.js" as Model

// Pomodoro timer: bar pill + popup panel in one file, mirroring the built-in
// Power widget's structure. The pill always ticks (even with the popup
// closed) and auto-advances focus -> break on its own, but always pauses
// and prompts (via the ready-prompt overlay) before break -> focus, so a
// break can never silently roll into work time without you.
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
  // When true, entering a break locks the screen behind a fullscreen
  // overlay instead of just chiming/notifying, so a break can't be
  // absent-mindedly worked through. Right-click on the overlay dismisses
  // it early without ending the break.
  readonly property bool breakLockEnabled: setting("breakLock", true)

  // ---- Session state ----
  property string sessionType: "focus"   // "focus" | "short" | "long"
  property int cycleCount: 0             // completed focus sessions since the last long break
  property bool running: false
  property real remainingSeconds: Model.durationSeconds("focus", durations)
  // Extra time tacked onto the current break via the snooze button. Reset
  // to 0 at the start of every session.
  property real extraSeconds: 0
  // Drives the fullscreen break-lock overlay. Set on entering a break,
  // cleared by an explicit right-click dismissal, a reset, or the break
  // ending naturally (visible: also requires onBreak, see below).
  property bool breakLockActive: false
  // Drives the "ready to focus?" overlay. Set whenever a break ends
  // (naturally or via Skip) so a session never quietly rolls into work
  // time; cleared by starting or by an explicit dismissal.
  property bool readyPromptActive: false

  // ---- Daily focus-session counter (in-memory; resets on shell restart,
  // same as everything else in this plugin) ----
  property string dailyCountDate: Model.dateKey()
  property int dailyFocusCount: 0

  readonly property int totalSeconds: Model.durationSeconds(sessionType, durations) + extraSeconds
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
    extraSeconds = 0
    remainingSeconds = totalSeconds
    breakLockActive = false
    readyPromptActive = false
  }

  function recordFocusCompletion() {
    var today = Model.dateKey()
    if (today !== dailyCountDate) {
      dailyCountDate = today
      dailyFocusCount = 0
    }
    dailyFocusCount += 1
  }

  // natural: true when the countdown reached zero on its own (chime +
  // notification fire); false for a manual skip, which stays quiet.
  function advance(natural) {
    var finishedType = sessionType
    var result = Model.nextSession(sessionType, cycleCount, cyclesUntilLong)
    if (natural) {
      playChime()
      notify(Model.completionMessage(sessionType, result))
      if (finishedType === "focus") recordFocusCompletion()
    }
    sessionType = result.type
    cycleCount = result.cycleCount
    remainingSeconds = Model.durationSeconds(sessionType, durations)
    extraSeconds = 0
    if (sessionType === "focus") {
      // A break just ended (naturally or via Skip): don't auto-continue
      // into focus. Wait for an explicit Start so a break can't silently
      // roll into work time.
      running = false
      readyPromptActive = true
      breakLockActive = false
    } else {
      readyPromptActive = false
      breakLockActive = root.breakLockEnabled
    }
  }

  function skip() { advance(false) }

  // Right-click escape hatch on the break-lock overlay: dismiss the lock
  // without touching the break timer, which keeps counting down underneath.
  function dismissBreakLock() { breakLockActive = false }

  // Adds time to the current break without ending it. No-op outside a break.
  function snoozeBreak(minutes) {
    if (!onBreak) return
    var extra = (minutes || 5) * 60
    extraSeconds += extra
    remainingSeconds += extra
  }

  // Ready-prompt overlay: Start begins the session immediately; dismiss
  // just hides the prompt and leaves the timer paused for a manual Start
  // later from the bar pill or panel.
  function startFromReadyPrompt() {
    readyPromptActive = false
    start()
  }

  function dismissReadyPrompt() { readyPromptActive = false }

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
    tooltipText: root.statusText + (root.running ? "" : (root.readyPromptActive ? " (ready to start)" : " (paused)"))
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

        // ---------- Daily count ----------
        Text {
          width: parent.width
          horizontalAlignment: Text.AlignHCenter
          text: root.dailyFocusCount + (root.dailyFocusCount === 1 ? " focus session today" : " focus sessions today")
          color: Qt.darker(root.bar.foreground, 1.4)
          font.family: root.bar.fontFamily
          font.pixelSize: Style.font.caption
        }
      }
    }
  }

  // ---- Break-lock overlay: fullscreen, grabs keyboard focus, sits above
  // every window and the bar itself. Only a right-click dismisses it early;
  // it otherwise clears itself the moment the break ends. One instance per
  // screen so it can't be dodged by moving to another monitor.
  Variants {
    model: Quickshell.screens

    PanelWindow {
      id: breakLock
      required property var modelData
      screen: modelData

      // Text/animation state for the keystroke tease, below.
      property string teaseText: ""
      property real teaseOpacity: 0
      property real teaseShake: 0

      visible: root.breakLockActive && root.onBreak
      anchors { top: true; bottom: true; left: true; right: true }
      color: "transparent"
      exclusionMode: ExclusionMode.Ignore
      WlrLayershell.namespace: "omarchy-pomodoro-breaklock"
      WlrLayershell.layer: WlrLayer.Overlay
      WlrLayershell.keyboardFocus: WlrKeyboardFocus.Exclusive

      // The surface only grabs keyboard focus once mapped, so (re)claim it
      // for keyCatcher every time the overlay appears.
      onVisibleChanged: if (visible) Qt.callLater(function() {
        if (breakLock.visible) keyCatcher.forceActiveFocus()
      })

      Rectangle {
        anchors.fill: parent
        color: Qt.rgba(0, 0, 0, 0.88)
      }

      Item {
        id: keyCatcher
        anchors.fill: parent
        focus: true

        // Every keystroke is swallowed here -- it never reaches the app
        // underneath. All it does is trigger a fresh tease.
        Keys.onPressed: function(event) {
          breakLock.teaseText = Model.randomTeaseMessage(breakLock.teaseText)
          teaseAnim.restart()
          event.accepted = true
        }

        MouseArea {
          anchors.fill: parent
          acceptedButtons: Qt.RightButton
          onClicked: root.dismissBreakLock()
        }

        Column {
          anchors.centerIn: parent
          spacing: Style.space(14)

          Text {
            anchors.horizontalCenter: parent.horizontalCenter
            text: "🍅"
            font.pixelSize: Style.font.display
          }

          Text {
            anchors.horizontalCenter: parent.horizontalCenter
            text: root.statusText.toUpperCase()
            color: Color.lock.text
            font.family: root.bar.fontFamily
            font.pixelSize: Style.font.title
            font.bold: true
            font.letterSpacing: 2
          }

          Text {
            anchors.horizontalCenter: parent.horizontalCenter
            text: root.timeText
            color: root.sessionColor
            font.family: root.bar.fontFamily
            font.pixelSize: Style.font.displayLarge
            font.bold: true
          }

          Button {
            anchors.horizontalCenter: parent.horizontalCenter
            text: "+5 min"
            iconText: "💤"
            foreground: Color.lock.text
            fontFamily: root.bar.fontFamily
            bordered: true
            horizontalPadding: Style.spacing.controlPaddingX
            verticalPadding: Style.spacing.controlPaddingY
            onClicked: root.snoozeBreak(5)
          }

          Text {
            anchors.horizontalCenter: parent.horizontalCenter
            text: "right-click to dismiss early"
            color: Util.alpha(Color.lock.text, 0.5)
            font.family: root.bar.fontFamily
            font.pixelSize: Style.font.caption
          }
        }

        // Tease callout: hidden until a keystroke lands, then pops in with a
        // little head-shake "no" and fades back out. The shake drives
        // horizontalCenterOffset rather than x directly, since animating x
        // on an anchored item would permanently break the anchor binding.
        Text {
          id: teaseLabel
          anchors.horizontalCenter: parent.horizontalCenter
          anchors.horizontalCenterOffset: breakLock.teaseShake
          anchors.top: parent.verticalCenter
          anchors.topMargin: Style.space(120)
          text: breakLock.teaseText
          color: root.sessionColor
          font.family: root.bar.fontFamily
          font.pixelSize: Style.font.subtitle
          font.bold: true
          opacity: breakLock.teaseOpacity
        }

        SequentialAnimation {
          id: teaseAnim
          NumberAnimation { target: breakLock; property: "teaseOpacity"; to: 1; duration: 80 }
          NumberAnimation { target: breakLock; property: "teaseShake"; to: -8; duration: 60 }
          NumberAnimation { target: breakLock; property: "teaseShake"; to: 8; duration: 60 }
          NumberAnimation { target: breakLock; property: "teaseShake"; to: 0; duration: 60 }
          PauseAnimation { duration: 1300 }
          NumberAnimation { target: breakLock; property: "teaseOpacity"; to: 0; duration: 450 }
        }
      }
    }
  }

  // ---- Ready-prompt overlay: fires when a break ends (naturally or via
  // Skip) instead of silently rolling into focus. Any key, a click on the
  // Start button, or a left-click on the backdrop begins the session;
  // right-click dismisses and leaves the timer paused for a manual Start
  // later. One instance per screen, same as the break-lock.
  Variants {
    model: Quickshell.screens

    PanelWindow {
      id: readyPrompt
      required property var modelData
      screen: modelData

      visible: root.readyPromptActive
      anchors { top: true; bottom: true; left: true; right: true }
      color: "transparent"
      exclusionMode: ExclusionMode.Ignore
      WlrLayershell.namespace: "omarchy-pomodoro-readyprompt"
      WlrLayershell.layer: WlrLayer.Overlay
      WlrLayershell.keyboardFocus: WlrKeyboardFocus.Exclusive

      onVisibleChanged: if (visible) Qt.callLater(function() {
        if (readyPrompt.visible) readyKeyCatcher.forceActiveFocus()
      })

      Rectangle {
        anchors.fill: parent
        color: Qt.rgba(0, 0, 0, 0.88)
      }

      Item {
        id: readyKeyCatcher
        anchors.fill: parent
        focus: true

        // Any keystroke means "I'm here" -- start immediately.
        Keys.onPressed: function(event) {
          root.startFromReadyPrompt()
          event.accepted = true
        }

        MouseArea {
          anchors.fill: parent
          acceptedButtons: Qt.LeftButton | Qt.RightButton
          onClicked: function(mouse) {
            if (mouse.button === Qt.RightButton) root.dismissReadyPrompt()
            else root.startFromReadyPrompt()
          }
        }

        Column {
          anchors.centerIn: parent
          spacing: Style.space(14)

          Text {
            anchors.horizontalCenter: parent.horizontalCenter
            text: "🍅"
            font.pixelSize: Style.font.display
          }

          Text {
            anchors.horizontalCenter: parent.horizontalCenter
            text: "BREAK'S OVER"
            color: Color.lock.text
            font.family: root.bar.fontFamily
            font.pixelSize: Style.font.title
            font.bold: true
            font.letterSpacing: 2
          }

          Text {
            anchors.horizontalCenter: parent.horizontalCenter
            text: "Ready to focus?"
            color: root.sessionColor
            font.family: root.bar.fontFamily
            font.pixelSize: Style.font.subtitle
            font.bold: true
          }

          Button {
            anchors.horizontalCenter: parent.horizontalCenter
            text: "Start"
            iconText: "▶"
            foreground: Color.lock.text
            fontFamily: root.bar.fontFamily
            bordered: true
            horizontalPadding: Style.spacing.controlPaddingX
            verticalPadding: Style.spacing.controlPaddingY
            onClicked: root.startFromReadyPrompt()
          }

          Text {
            anchors.horizontalCenter: parent.horizontalCenter
            text: "any key starts · right-click to dismiss"
            color: Util.alpha(Color.lock.text, 0.5)
            font.family: root.bar.fontFamily
            font.pixelSize: Style.font.caption
          }
        }
      }
    }
  }
}
