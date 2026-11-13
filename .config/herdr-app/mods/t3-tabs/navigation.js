import { spaces, panes, agents, terminals, machines, run, openOverlay, closeOverlay, focused, hc, notify, layout, shared, setShared, home, window } from "herdr";
import { namer, programOf } from "./name.js";
import { descendants, kidStatus, ownStatus, treeStatus } from "./tree.js";
import { focusAgent, focusPane } from "./zoom.js";
import { sidebarParts } from "./sidebar.js";
import { newTab } from "./project.js";
import { t3Settings } from "./layout-settings.js";
import { KEY } from "./store.js";
import { writeLabel } from "./labels.js";

// One instance per Tabs view; the Herdr operations also admit the check's fake core.
export function navigation(beforeAsk = (_cx) => {}, core = { spaces, panes, agents, terminals, machines: () => machines(), run, openOverlay, closeOverlay, focused, hc, notify, layout, shared, setShared, home: () => home(), window: () => window(), namer, programOf, focusAgent, focusPane, writeLabel }) {
  const { spaces, panes, agents, terminals, machines, run, openOverlay, closeOverlay, focused, hc, notify, layout, shared, setShared, home, window, namer, programOf, focusAgent, focusPane, writeLabel } = core;
  // lastIn: each tab's agent last in view, which the Inbox's bar holds while a program there has the focus.
  // fresh: spaces where the person started something new (the breadcrumb's space, cmd-t) since last looking at an agent there.
  const trail = {}, lastIn = {}, fresh = new Set(), owed = new Map(), waking = new Map();
  let states = new Map();
  // Spaces that were Home until an agent started there: their rename may not have shown yet.
  const released = new Set();
  let renaming = false, going, homing, inView, wasHome, unread, focusWas, zoomOff, asking, settingsOpen;
  const inboxShown = () => sidebarParts(layout()).stack?.active === "inbox";
  // The Inbox's ways with attention hold unless Lists is the mode (docs/adr/0002).
  const listsShown = () => sidebarParts(layout()).stack?.active === "lists";
  const nameOf = (c, lead, name) => c.named ? c.name : lead ? name(lead) : "Terminal";

  // Home: one place to land, a space of its own on this computer, known by its id so whatever someone arranges there is theirs.
  // The layout's lists leave it out and the keys that walk spaces go around it, so it takes no number. This mod answers for it
  // because the tab bar always shows; the sidebar, with its brand bar, can be hidden.
  const homeId = () => shared(KEY.home);
  // Reads "Home", with a zero-width space nobody types: a space someone else calls Home is never taken for it, and being wrong would hide theirs.
  const HOME_NAME = "Home\u200b";

  // The id is this computer's (shared.json) and the space the core's, so another window on that core finds Home by its name.
  function knowHome() {
    const all = spaces(), known = all.find(s => s.id === homeId());
    // A Home made before it had a name of its own.
    if (known?.name === "Home" && !renaming) { renaming = true; run("space.rename", { id: known.id, name: HOME_NAME }); }
    if (known) return;
    const found = all.find(s => s.machine === null && s.named && s.name === HOME_NAME && !released.has(s.id));
    if (found) setShared(KEY.home, found.id);
  }
  const atHome = () => Boolean(homeId()) && spaces().some(s => s.active && s.id === homeId());
  // Home's tab is selected but spaces() hasn't caught up: the layout already takes Home's shape, so Home's first frame isn't
  // the 60px shorter one under `main`'s header and the unfolded row. 1s at most, for a select that didn't land.
  // Arrived, it's over: leaving straight after isn't taken for still coming.
  const shownHome = () => atHome() ? (homing = null, true) : Date.now() - (homing ?? 0) < 1000;
  // The one mod Home is (t3.settings, docs/adr/0005); null: a shell in the home folder.
  const homeMod = () => t3Settings().homeMod;
  const fill = () => homeMod() ? { mod: homeMod() } : {};
  // spaces() catches up a frame or so after a command, so each step waits to see the one before.
  async function seen(cx, look) {
    // 10s: past this a slow core's Home would be there with nothing knowing it's Home, an orphan in the lists.
    for (let i = 0; i < 400; i++) {
      const found = look();
      if (found) return found;
      await new Promise(resolve => cx.timer.after(25, () => resolve(undefined)));
    }
    return null;
  }
  async function goHome(cx) {
    // Before this computer's layout is read, a Home that exists reads as missing.
    const here = machines().find(m => m.name === null);
    if (here && here.layout !== "ready") return;
    knowHome();
    if (spaces().some(s => s.id === homeId())) return refitHome(true, cx);
    const before = new Set(spaces().map(s => s.id));
    run("space.new", { name: HOME_NAME, machine: "", folder: home() });
    const made = await seen(cx, () => spaces().find(s => !before.has(s.id) && s.name === HOME_NAME));
    if (!made) return;
    setShared(KEY.home, made.id);
    // A new space comes with a shell: Home as a terminal, that's it. Else, as a space can't lose its last tab, the mod goes in first.
    if (!homeMod()) return;
    const shell = made.tabs[0]?.id;
    run("tab.new", { space: made.id, name: "Home", mod: homeMod() });
    const page = await seen(cx, () => spaces().find(s => s.id === made.id)?.tabs.find(c => c.id !== shell)?.id);
    if (page && shell) run("tab.close", { id: shell, confirmed: true });
  }
  // The selected sidebar's rows, shown or hidden, stopping at either end.
  function step(command) {
    const { order = [], view = null } = shared(inboxShown() ? KEY.inboxRows : KEY.agentsRows) ?? {};
    const i = view === null ? -1 : order.indexOf(view);
    const to = view === null ? (command === "next" ? order[0] : order.at(-1)) : i < 0 ? null : order[command === "next" ? i + 1 : i - 1];
    if (to?.startsWith("pane:")) focusPane(to.slice(5));
    else if (to) focusAgent(to);
  }
  // A space by the keys. Out of view Herdr may have moved its active tab to a closed one's neighbour, and being shown costs an
  // agent its unread done: return to the tab last shown there. tab.select brings the space along; the space first would show its active tab for that step.
  function showSpace(s) {
    const back = trail[s.id]?.find(id => s.tabs.some(c => c.id === id));
    run(back ? "tab.select" : "space.select", { id: back ?? s.id });
  }
  // The spaces the keys count and walk: all but Home, wrapping as space.next does.
  function selectSpace(index) {
    const s = spaces().filter(s => s.id !== homeId())[index - 1];
    if (s) showSpace(s);
  }
  function walkSpaces(by) {
    const list = spaces().filter(s => s.id !== homeId());
    if (!list.length) return;
    const i = list.findIndex(s => s.active);
    // From Home, the first going forward, the last going back.
    showSpace(list[i < 0 ? (by > 0 ? 0 : list.length - 1) : (i + by + list.length) % list.length]);
  }

  // A pane is empty when its own shell holds the foreground. No answer counts as busy: better to ask.
  // shortcut: a shell's background jobs read as empty, upgrade if Herdr ever reports them.
  const SHELL = /^-?(zsh|bash|fish|sh|dash|ksh|tcsh|nu)$/;
  async function atPrompt(terminal) {
    try {
      const k = JSON.parse((await hc(["get", terminal, "--json"])).stdout);
      return k.foreground?.pid === k.pid && SHELL.test(k.foreground.name);
    } catch { return false; }
  }

  // As T3's confirmTerminalClose: `Close terminal "Pi"?` or `Close 2 terminals?`, then what that ends. A held cmd-w replaces the dialog rather than stacking it.
  function ask(names, more, command, cx) {
    // The dialog covers it, nothing reports the leaving until the pointer moves, and the × stops the press that would close the card.
    beforeAsk(cx);
    if (asking) closeOverlay(asking);
    const [title, detail] = names.length === 1
      ? [`Close terminal "${names[0]}"?`, "This stops the running process and clears its history."]
      : [`Close ${names.length} terminals?`, `This stops their running processes and clears their histories: ${names.map(n => `"${n}"`).join(", ")}.`];
    // t3-actions draws T3's alert dialog: the shipped confirm mod's measures are its own.
    asking = openOverlay({ mod: "t3-actions", kind: "dialog", frame: "none", width: 512, props: { actions: "confirm", title, detail: detail + more, yes: "Close", command: { name: command } } });
  }

  // Ending a program asks first; empty panes have none to lose, and Herdr still asks if it's the space's last tab.
  async function closeTab(id, cx) {
    const space = spaces().find(s => s.tabs.some(c => c.id === id));
    // A key pressed out of habit doesn't take Home and what's there with it.
    if (!space || space.id === homeId()) return;
    const c = space.tabs.find(c => c.id === id), mine = panes().filter(p => p.tab === id);
    const live = mine.filter(p => p.terminal), empty = await Promise.all(live.map(p => atPrompt(p.terminal)));
    // A lone pane goes by its tab's name, as the tab shows it.
    const name = namer();
    const names = live.filter((_, k) => !empty[k]).map(p => mine.length === 1 ? nameOf(c, p, name) : name(p));
    if (names.length === 0) return closeTabNow(id, {}, cx);
    ask(names, space.tabs.length === 1 ? " It's the space's last tab, so the space closes too." : "", `t3-tabs.close-tab-now:${id}`, cx);
  }

  async function closeTabNow(id, args, cx) {
    await leave(id, cx);
    run("tab.close", { id, ...args });
  }

  async function closePaneNow(pane, cx) {
    const ps = panes(), p = ps.find(p => p.pane === pane), tab = p?.tab;
    if (ps.filter(p => p.tab === tab).length === 1) await leave(tab, cx);
    else if (focused()?.pane === pane && p?.mod && programOf(p)?.inbox) {
      const mine = agents().filter(a => a.tab === tab), back = mine.find(a => a.address === focused()?.agent) ?? mine[0];
      if (back) focusAgent(back.address);
    }
    run("pane.close", { pane });
  }

  // Home is one thing alone (docs/adr/0005): its own tab, a lone pane that is the setting's mod or, set so, a shell. Another mod
  // there, or an idle shell when a mod is wanted, gives way to it; a shell busy with something else keeps its tab, and Home
  // gets a new one.
  async function refitHome(go, cx) {
    const homeTabs = () => spaces().find(s => s.id === homeId())?.tabs.map(c => c.id) ?? [];
    const ps = panes(), mine = ps.filter(p => homeTabs().includes(p.tab));
    // panes() hasn't caught up with Home yet: showing it is all there is to do.
    if (!mine.length) return go && run("space.select", { id: homeId() });
    const fits = (p) => homeMod() ? p.mod === homeMod() : Boolean(p.terminal);
    const owns = mine.filter(p => ps.filter(q => q.tab === p.tab).length === 1);
    let own = owns.find(fits) ?? owns.find(p => p.mod);
    for (const p of own ? [] : owns.filter(p => p.terminal)) if (await atPrompt(p.terminal)) { own = p; break; }
    if (own && !fits(own)) {
      run("pane.split", { direction: "right", pane: own.pane, ...fill() });
      run("pane.close", { pane: own.pane });
    }
    if (!go) return;
    // tab.select brings the space along, so nothing else there shows on the way.
    if (own) {
      homing = Date.now();
      api.arrive?.(homeId());
      return run("tab.select", { id: own.tab });
    }
    run("tab.new", { space: homeId(), name: "Home", folder: home(), ...fill() });
  }

  // The Inbox breadcrumb's space: a tab to work in. One already waiting (a shell alone in its tab, at its prompt), the latest
  // shown first, else a new one, so pressing again doesn't pile up empty tabs.
  async function openEmpty() {
    const space = spaces().find(s => s.active);
    if (!space || atHome()) return;
    fresh.add(space.id);
    const ps = panes(), every = agents();
    const ids = [...new Set([...(trail[space.id] ?? []), ...space.tabs.map(c => c.id)])].filter(id => space.tabs.some(c => c.id === id));
    for (const id of ids) {
      const mine = ps.filter(p => p.tab === id);
      if (mine.length === 1 && mine[0].terminal && !every.some(a => a.tab === id) && await atPrompt(mine[0].terminal)) return run("tab.select", { id });
    }
    newTab(space);
  }

  // The Inbox's next card after `from`, going around, when the person chose to go on to it (t3.settings); its rows' first
  // `cards` are the cards. False: the caller goes Home.
  function nextCard(from) {
    if (t3Settings().afterAway !== "next") return false;
    const { order = [], cards = 0 } = shared(KEY.inboxRows) ?? {}, list = order.slice(0, cards), i = list.indexOf(from);
    const to = i < 0 ? null : [...list.slice(i + 1), ...list.slice(0, i)][0];
    if (to?.startsWith("pane:")) focusPane(to.slice(5));
    else if (to) focusAgent(to);
    return Boolean(to);
  }

  // Going first, so Herdr's neighbour never shows: being shown costs an agent its unread done, one the bar hides included.
  async function leave(id, cx) {
    const space = spaces().find(s => s.active);
    // Out of view, closing it moves nothing.
    if (atHome() || !space?.tabs.find(c => c.id === id)?.active) return;
    // With the Inbox, the agent in view lands on Home (docs/adr/0004), the space's last tab too: Herdr would show another
    // space's tab. In Lists it goes back as any tab does.
    if (!listsShown() && agents().some(a => a.tab === id)) return goHome(cx);
    // A space's last tab takes the space, and Herdr may still ask.
    if (space.tabs.length === 1) return;
    goBack(space.id, id);
  }

  // Back to where the person was before a tab with no agent. Nowhere remembered: Herdr's pick stands.
  function goBack(space, from) {
    const back = trail[space]?.find(id => id !== from && spaces().some(s => s.tabs.some(c => c.id === id)));
    if (!back) return;
    going = { tab: back, until: Date.now() + 500 };
    run("tab.select", { id: back });
  }

  async function closePane(pane, cx) {
    const ps = panes(), p = ps.find(p => p.pane === pane);
    if (!p) return;
    const space = spaces().find(s => s.tabs.some(c => c.id === p.tab)), tabs = space?.tabs.map(c => c.id) ?? [];
    const last = ps.filter(q => tabs.includes(q.tab)).length === 1, inHome = space?.id === homeId();
    // Home's last pane stays: a key doesn't empty Home.
    if (inHome && last) return;
    // A space's last pane closes the space, and Herdr asks that itself.
    if (!p.terminal || last || await atPrompt(p.terminal)) return closePaneNow(pane, cx);
    ask([namer()(p)], "", `t3-tabs.close-pane-now:${pane}`, cx);
  }

  // Where the person has been, once a frame, by what the app reports: each space's tabs, latest shown first. The one memory
  // the bar keeps; which agent it holds and where a close lands both read from it, so they can't disagree.
  // shortcut: it's gone after a restart, so Herdr's pick stands until a tab has been shown; upgrade if that matters.
  function track() {
    knowHome();
    // An agent started in Home (in its shell) makes that space an ordinary one, named for its folder, where it is: nothing
    // moves, so nothing flickers. Going Home next makes a new Home (docs/adr/0005).
    const homeSpace = spaces().find(s => s.id === homeId());
    if (homeSpace && agents().some(a => homeSpace.tabs.some(c => c.id === a.tab))) {
      released.add(homeSpace.id);
      setShared(KEY.home, null);
      run("space.rename", { id: homeSpace.id, name: "" });
      // Home's own tab is called Home, which a card would take for the agent's name.
      for (const c of homeSpace.tabs.filter(c => c.named && c.name === "Home")) run("tab.rename", { id: c.id, name: "" });
      wasHome = false;
    }
    const all = spaces(), space = all.find(s => s.active), tab = space?.tabs.find(c => c.active), home = atHome();
    const alive = (id) => all.some(s => s.tabs.some(c => c.id === id));
    const was = inView;
    // Herdr's pick shows until Home does, and that isn't somewhere the person went.
    const toHome = () => { going = { until: Date.now() + 500 }; run("t3-tabs.home"); };
    // Home's last program ended, past closePane: the space went with it.
    if (wasHome && all.length && !all.some(s => s.id === homeId())) toHome();
    wasHome = home;
    // For the closes this mod doesn't make, which leave() can't go ahead of: the tab's menu, the program ending. Herdr has
    // already picked the neighbour, and it may have been shown.
    const terms = terminals(), every = agents();
    if (was && !alive(was.tab) && !home) {
      // With the Inbox, the agent in view lands on Home, as settling it does: what to look at next stays the person's to say.
      // In Lists, as any tab, unless no space is left to show.
      if (was.agent && (!listsShown() || !space)) toHome();
      else if (space?.id === was.space) goBack(was.space, was.tab);
      // Herdr marked what it showed as seen in the same step it picked it (window active), before any mod hears of it. An agent
      // unread a frame ago that only the pick showed is owed its done back, the way Herdr's Mark unread writes it.
      for (const a of every.filter(a => a.tab === tab?.id)) {
        const before = unread?.get(a.address);
        if (before) owed.set(a.address, { ...before, until: Date.now() + 3000 });
      }
    }
    zoomFollows(every);
    payBack(tab, home, terms, every);
    endSnoozes(terms, every);
    // What's unread now, for the next frame's close: its turn, and a snooze it woke from (seeing it clears that too).
    unread = new Map(every.filter(a => a.status === "done").map(a => {
      const k = terms.find(k => k.address === a.address);
      return [a.address, { turn: k?.turn ?? 0, snoozed: k?.labels?.snoozed }];
    }));
    if (going && (tab?.id === going.tab || Date.now() > going.until)) going = null;
    // Until a close's target shows, what shows is Herdr's pick, not somewhere the person went.
    if (space && tab && !home && !going) trail[space.id] = [tab.id, ...(trail[space.id] ?? []).filter(id => id !== tab.id && alive(id))];
    inView = tab && !home ? { tab: tab.id, space: space.id, agent: every.some(a => a.tab === tab.id) } : null;
    const looked = !going && every.find(a => a.address === inViewAgent(terms, every));
    if (looked && !home) { lastIn[looked.tab] = looked.address; fresh.delete(looked.space); }
    for (const id of Object.keys(lastIn)) if (!alive(id)) delete lastIn[id];
  }

  // For what focuses a pane without zoom.js going first, Herdr's own: a toast, hc, the palette, its keys. Its focus moved and the
  // zoom stayed, or a zoom landed on a pane the focus isn't on: the later of the two wins. What the stale zoom showed for that
  // frame is owed its done, as a close's neighbour is. Once per disagreement: pane.zoom toggles, and a repeat would undo it.
  function zoomFollows(every) {
    const ps = panes(), f = ps.find(p => p.focused), z = f && ps.find(p => p.tab === f.tab && p.zoomed), was = focusWas;
    const off = z && z.pane !== f.pane ? `${f.pane}:${z.pane}` : null, told = zoomOff;
    focusWas = f?.pane; zoomOff = off;
    if (!off || off === told) return;
    if (was === f.pane) return run("pane.focus", { pane: z.pane });
    run("pane.zoom", { pane: f.pane });
    const before = unread?.get(z.terminal);
    if (before && every.some(a => a.address === z.terminal)) owed.set(z.terminal, { ...before, until: Date.now() + 3000 });
  }

  // Once what Herdr's pick showed is out of view, and its seen has come back from the core (or the lower write could land first),
  // its turn is unread again. Still in view after a few seconds: the person stayed there, so it was seen after all.
  function payBack(tab, home, terms, every) {
    for (const [addr, o] of owed) {
      const k = terms.find(k => k.address === addr), a = every.find(a => a.address === addr);
      if (!k || (k.turn ?? 0) !== o.turn || o.turn < 1) { owed.delete(addr); continue; }
      // Done already (the window wasn't active, so nothing was marked): only a cleared snooze may be owed.
      if (a?.status === "done") o.seen = true;
      // In its tab but zoomed away from isn't in view either.
      const covered = panes().some(p => p.tab === a?.tab && p.zoomed && p.terminal !== addr);
      if (a?.tab === tab?.id && !home && !covered) { if (Date.now() > o.until) owed.delete(addr); continue; }
      if (!o.seen && !o.seenWriting && Number(k.labels?.["herdr.seen"]) >= o.turn) {
        o.seenWriting = true;
        writeLabel(addr, "herdr.seen", String(o.turn - 1), o.seenTold).then(ok => { o.seenWriting = false; if (ok) o.seen = true; });
        o.seenTold = true;
      }
      // The Inbox clears a woken snooze when it's seen, and that write may come back after ours: wait for it.
      if (o.snoozed && !o.snoozeWriting && !k.labels?.snoozed) {
        o.snoozeWriting = true;
        writeLabel(addr, "snoozed", o.snoozed, o.snoozeTold).then(ok => { o.snoozeWriting = false; if (ok) o.snoozed = null; });
        o.snoozeTold = true;
      }
      if ((o.seen && !o.snoozed) || Date.now() > o.until) owed.delete(addr);
    }
  }

  // A snooze ends on a failure in its tree or a new turn given in view, as the Inbox ends it; here too, in either sidebar,
  // as the Inbox copy may not have started (docs/adr/0003). Seeing it once it has woken stays the Inbox's: Woke is its mark.
  function endSnoozes(terms, every) {
    const was = states, active = window()?.active, now = Date.now();
    const listed = new Map(every.map(a => [a.address, a.status]));
    const state = (a) => treeStatus(ownStatus(a.status, a.address, terms), descendants(terms, a.address).map(k => kidStatus(k, listed)));
    states = new Map(every.map(a => [a.address, state(a)]));
    const viewed = inViewAgent(terms, every);
    for (const a of every) {
      const k = terms.find(k => k.address === a.address);
      if (!k?.labels?.snoozed || now - (waking.get(a.address) ?? -Infinity) < 10000) continue;
      const failed = k.status === "error" || descendants(terms, a.address).some(d => d.status === "error");
      const turned = active && a.address === viewed && states.get(a.address) === "working" && ["idle", "done"].includes(was.get(a.address));
      if (!failed && !turned) continue;
      // Once per 10s: the label takes a moment to come back, and a refused write mustn't retry, and tell, on every frame.
      waking.set(a.address, now);
      writeLabel(a.address, "snoozed", "");
    }
  }

  // The agent in view, as the Inbox's row in view (t3-inbox/row-model.js inboxInView): the focused one; else a sub-agent with
  // no row of its own (a block, a peek) stands for its nearest agent; a mod pane for the agent beside it, unless it has a card.
  function inViewAgent(terms, every) {
    const own = every.find(a => a.focused);
    if (own) return own.address;
    const f = focused(), byAddress = new Map(terms.map(k => [k.address, k])), listed = (k) => every.some(a => a.address === k.address);
    if (f?.pane && !f.terminal) {
      const p = panes().find(p => p.pane === f.pane);
      if (p?.mod && programOf(p)?.inbox) return null;
      const here = every.filter(a => a.tab === f.tab);
      return (here.find(a => a.address === f.agent) ?? here[0])?.address ?? null;
    }
    const seen = new Set();
    let k = byAddress.get(f?.pane ? f.terminal : f?.agent ?? f?.terminal);
    while (k && !listed(k) && !seen.has(k.address)) { seen.add(k.address); k = byAddress.get(k.parent); }
    return k && listed(k) ? k.address : null;
  }

  // Who the Inbox's bar is about: the agent in view, the card the Inbox lights. With none (a program has the focus), the one
  // last looked at in the tab that holds the work, so the way back stays in reach: the shown tab, else, in a tool's tab, the one
  // last shown here with an agent. Started something new (fresh), a tab with no agent holds none: the space alone. The tab's heads are its agents whose own parent isn't in it; a sub-agent split beside its parent goes under it.
  function work() {
    const space = spaces().find(s => s.active);
    if (!space || atHome()) return null;
    const every = agents(), all = terminals(), byAddress = new Map(all.map(k => [k.address, k]));
    const listed = new Map(every.map(a => [a.address, a]));
    // The nearest live agent above, through what isn't listed (a shell between them).
    const above = (address) => {
      const seen = new Set();
      let k = byAddress.get(byAddress.get(address)?.parent);
      while (k?.state === "live" && !seen.has(k.address)) {
        if (listed.has(k.address)) return listed.get(k.address);
        seen.add(k.address);
        k = byAddress.get(k.parent);
      }
      return null;
    };
    const shownTab = going?.tab ?? space.tabs.find(c => c.active)?.id;
    // Until a close's target shows, the focus is on Herdr's pick, not on anyone the person went to.
    const current = going ? null : every.find(a => a.address === inViewAgent(all, every) && space.tabs.some(c => c.id === a.tab));
    const tab = current?.tab ?? (fresh.has(space.id) ? [shownTab] : [shownTab, ...(trail[space.id] ?? [])]).find(id => every.some(a => a.tab === id));
    const here = every.filter(a => a.tab === tab), heads = here.filter(a => above(a.address)?.tab !== tab);
    const viewed = current ?? here.find(a => a.address === lastIn[tab]) ?? heads[0];
    let head = viewed;
    while (head && !heads.includes(head)) head = above(head.address);
    // A sub-agent counts as the agent at its top, whose family the bar holds.
    let top = viewed?.address;
    for (let up = viewed && above(top); up; up = above(top)) top = up.address;
    return { space, every, all, tab, shownTab, heads, head, viewed, held: !current, parent: head ? above(head.address) : null, top };
  }

  // With the Inbox showing, cards lead to the agents, so the bar holds what's around the work in view: the agent, its
  // sub-agents' tabs, then the tabs with no agent in their own order. Home has no tabs to show.
  function visibleTabs(w = work()) {
    if (!w) return [];
    const { space, every, all, top } = w;
    if (!inboxShown()) return space.tabs;
    // No agent in view, no family: descendants() of nothing would be every top-level agent.
    const family = new Set(top ? [top, ...descendants(all, top).map(k => k.address)] : []);
    const lead = space.tabs.find(c => c.id === every.find(a => a.address === top)?.tab);
    const kin = space.tabs.filter(c => c !== lead && every.some(a => a.tab === c.id && family.has(a.address)));
    return [...(lead ? [lead] : []), ...kin, ...space.tabs.filter(c => !every.some(a => a.tab === c.id))];
  }

  // The Inbox's bar as it draws: who's in view (docs/research/inbox-tab-bar-plan.md), then its family's other tabs and the
  // space's programs. The tab in view and the parent's are in the breadcrumb, so not again among them.
  function context(w, tabs) {
    if (!w || !inboxShown()) return null;
    const { space, every, tab, shownTab, heads, head, viewed, held, parent } = w;
    const skip = new Set([tab, parent?.tab]);
    const others = tabs.filter(c => !skip.has(c.id));
    return {
      space, tab: tab ?? null, parent: parent?.address ?? null, heads: heads.map(a => a.address), head: head?.address ?? null,
      sub: viewed && viewed !== head ? viewed.address : null, held, away: Boolean(tab) && shownTab !== tab,
      kin: others.filter(c => every.some(a => a.tab === c.id)), programs: others.filter(c => !every.some(a => a.tab === c.id)),
    };
  }

  // The next or previous tab the bar shows, going around.
  function walkTabs(by) {
    const list = visibleTabs();
    if (!list.length) return;
    run("tab.select", { id: list[(list.findIndex(c => c.active) + by + list.length) % list.length].id });
  }

  // arrive(space): set by the view, lays the window out for Home (row, frame, panel) in the same go as the select that shows it.
  const api = {
    get atHome() { return shownHome(); },
    nextCard,
    async handle(command, cx) {
      if (command === "close-tab") await closeTab(focused()?.tab, cx);
      else if (command === "close-pane") await closePane(focused()?.pane, cx);
      else if (command.startsWith("close-tab:")) await closeTab(command.slice("close-tab:".length), cx);
      else if (command.startsWith("close-pane:")) await closePane(command.slice("close-pane:".length), cx);
      // What a close's dialog runs, once the person has said yes.
      else if (command.startsWith("close-tab-now:")) await closeTabNow(command.slice("close-tab-now:".length), { confirmed: true }, cx);
      else if (command.startsWith("close-pane-now:")) await closePaneNow(command.slice("close-pane-now:".length), cx);
      else if (command === "home") await goHome(cx);
      else if (command === "home-mod") await refitHome(false, cx);
      // As Herdr's own Settings, a dialog; pressed again, it replaces the open one (closing one already gone does nothing).
      else if (command === "settings") {
        if (settingsOpen) closeOverlay(settingsOpen);
        settingsOpen = openOverlay({ mod: "t3-chrome", kind: "dialog", width: 880, props: { view: "settings" } });
      }
      else if (command === "next" || command === "prev") step(command);
      // New work doesn't start in Home: New picks its space.
      else if (command === "open-empty") await openEmpty();
      else if (command === "new") {
        const space = spaces().find(s => s.active);
        if (atHome()) run("mod.open", { name: "t3-new-menu" });
        else { fresh.add(space.id); newTab(space); }
      }
      else if (command.startsWith("space:")) selectSpace(Number(command.slice("space:".length)));
      else if (command === "space-next") walkSpaces(1);
      else if (command === "space-prev") walkSpaces(-1);
      else if (command.startsWith("tab:")) {
        const c = visibleTabs()[Number(command.slice("tab:".length)) - 1];
        if (c) run("tab.select", { id: c.id });
      }
      else if (command === "tab-next") walkTabs(1);
      else if (command === "tab-prev") walkTabs(-1);
    },
    // Only the strip tracks: the layout's other copies just ask what to draw.
    frame(trackFrame = true) {
      if (trackFrame) track();
      const w = work(), tabs = visibleTabs(w);
      return { tabs, atHome: shownHome(), context: context(w, tabs) };
    },
  };
  return api;
}
