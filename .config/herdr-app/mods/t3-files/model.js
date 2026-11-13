// What the Files page knows, apart from drawing it: git's answers parsed, the search filter, sort order and file kinds.
// check-files.cjs loads this alone.
import { sortEntries } from "./file-tree.js";

export const RANKED = 1000; // a search ranks at most this many matches; past it, the first ones as found

/** `a/b`: either may be "" (the space's folder, or a path from it). */
export const join = (a, b) => !a ? b : !b ? a : `${a.replace(/\/$/, "")}/${b}`;
export const parentOf = (p) => p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "";
export const nameOf = (p) => p.slice(p.lastIndexOf("/") + 1);
/** The folders above a path, from the top: `a/b/c` → `a`, `a/b`. */
export const ancestors = (p) => { const out = []; for (let at = p.indexOf("/"); at > 0; at = p.indexOf("/", at + 1)) out.push(p.slice(0, at)); return out; };

// A folder's entries, NUL-separated kind and name, `.git` left out (as Herdr's files mod lists them).
export const LIST = 'for p in "$1"/* "$1"/.[!.]* "$1"/..?*; do [ -e "$p" ] || [ -L "$p" ] || continue; n=${p##*/}; [ "$n" = .git ] && continue; if [ -d "$p" ]; then k=d; else k=f; fi; printf "%s\\0%s\\0" "$k" "$n"; done; test -d "$1"';
// The same entries as paths from the space's folder ($2 is the folder's, "" or "src/"), a folder's with a slash, put to Git.
export const IGNORED = 'for p in "$1"/* "$1"/.[!.]* "$1"/..?*; do [ -e "$p" ] || [ -L "$p" ] || continue; n=${p##*/}; [ "$n" = .git ] && continue; if [ -d "$p" ]; then printf "%s%s/\\0" "$2" "$n"; else printf "%s%s\\0" "$2" "$n"; fi; done | git check-ignore --stdin -z; :';
// Before reading a file on another machine: its size, and NULs in its first 8 KB. readTextFile there turns a binary into
// text with U+FFFD and takes up to half a minute to refuse one past 1 MiB.
export const PROBE = 's=$(wc -c < "$1") || exit 1; h=$(head -c 8192 "$1" | wc -c); z=$(head -c 8192 "$1" | tr -d "\\000" | wc -c); echo $s $((h - z))';
// Search on another machine runs there: the whole list would take seconds to come over. Every term in the path, case
// aside, 1000 at most. The query goes as an argument, never into the script.
export const REMOTE_SEARCH = `if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then git ls-files -co --exclude-standard -z | tr '\\0' '\\n'; else find . -name .git -prune -o -type f -print | sed 's|^\\./||'; fi | awk 'BEGIN { n = split(tolower(ARGV[1]), t, " "); ARGV[1] = "" } { p = tolower($0); for (i = 1; i <= n; i++) if (!index(p, t[i])) next; print; if (++c >= ${RANKED}) exit }' "$1"`;

// The listing script's output: a kind (d or f) and a name, each ended by NUL; in file-tree.js's order.
export function parseListing(stdout) {
  const fields = stdout.split("\0"), out = [];
  for (let i = 0; i + 1 < fields.length; i += 2) out.push({ name: fields[i + 1], dir: fields[i] === "d" });
  return sortEntries(out);
}

// `git status --porcelain=v2 -z`, run at the repo's top, for a space whose folder is `prefix` inside it ("" or "sub/dir/").
// Paths come back relative to the space's folder; changes outside it are left out. A letter per file (A, M, D or R:
// untracked counts as added, a conflict as modified) and every folder holding one.
export function parseStatus(stdout, prefix = "") {
  const marks = new Map(), dirs = new Set(), records = stdout.split("\0");
  // The path follows a fixed number of space-separated fields; it may hold spaces itself.
  const after = (rec, n) => { let at = -1; for (let i = 0; i < n; i++) at = rec.indexOf(" ", at + 1); return at < 0 ? null : rec.slice(at + 1); };
  for (let i = 0; i < records.length; i++) {
    const rec = records[i], xy = rec.slice(2, 4);
    let path = null, letter = "M";
    if (rec[0] === "1") {
      path = after(rec, 8);
      letter = xy.includes("D") ? "D" : xy[0] === "A" ? "A" : "M";
    } else if (rec[0] === "2") { path = after(rec, 9); letter = "R"; i++; } // the next record is where it came from
    else if (rec[0] === "u") path = after(rec, 10);
    else if (rec[0] === "?") { path = rec.slice(2); letter = "A"; }
    if (!path || !path.startsWith(prefix)) continue;
    path = path.slice(prefix.length);
    marks.set(path, letter);
    for (let at = path.indexOf("/"); at > 0; at = path.indexOf("/", at + 1)) dirs.add(path.slice(0, at));
  }
  return { marks, dirs };
}

// `git check-ignore --stdin -z`'s answer: the paths it was given that Git ignores. A folder was asked with a trailing slash.
export function parseIgnored(stdout) {
  return new Set(stdout.split("\0").filter(Boolean).map((p) => p.replace(/\/$/, "")));
}

// A folder's entries, listed again: those Git ignores now (`found`) marked, the others not. Under an ignored folder, nothing
// is asked: everything there is.
export function markIgnored(ignored, rel, entries, found) {
  for (const e of entries) { const p = join(rel, e.name); if (found.has(p)) ignored.add(p); else ignored.delete(p); }
}

/**
 * A folder's entries as file-tree.js's treeRows takes them: a deleted file where it was (after the files there), and
 * everything under an ignored folder ignored too.
 */
export const folderEntries = ({ entries, ignored, marks }) => (rel) => {
  const list = entries.get(rel) ?? [], names = new Set(list.map((e) => e.name));
  const gone = [...marks].filter(([p, l]) => l === "D" && parentOf(p) === rel && !names.has(nameOf(p))).map(([p]) => ({ name: nameOf(p), dir: false, gone: true }));
  const dim = Boolean(rel) && [...ancestors(rel), rel].some((p) => ignored.has(p));
  return [...list, ...gone].map((e) => ({ name: e.name, dir: e.dir, gone: Boolean(e.gone), ignored: dim || ignored.has(join(rel, e.name)) }));
};

// A search's terms: every one must be in the path, case aside.
export const terms = (query) => query.toLowerCase().split(/\s+/).filter(Boolean);
// The candidates a query can start from: the last query's matches while this one only adds to it, else everything.
export const narrows = (query, last) => Boolean(last) && query.startsWith(last);

/**
 * The indexes into `lower` (lowercased paths) whose path holds every term, from `from` (indexes, or null for all).
 * Every CHUNK candidates it awaits `pause()`: past about 100k paths in one go, Herdr interrupts the script.
 * `alive()` false stops it early (a newer query); it then returns null.
 */
export const CHUNK = 5000;
export async function filterPaths(lower, words, from, pause, alive = () => true) {
  const out = [], n = from ? from.length : lower.length;
  for (let start = 0; start < n; start += CHUNK) {
    for (let k = start; k < Math.min(n, start + CHUNK); k++) {
      const i = from ? from[k] : k, p = lower[i];
      if (words.every((w) => p.includes(w))) out.push(i);
    }
    if (start + CHUNK < n) { await pause(); if (!alive()) return null; }
  }
  return out;
}

/**
 * At most `limit` of `paths` (all matching `query`), best first, each with the [start, end) ranges uFuzzy matched, for
 * highlighting. uFuzzy wants its terms in order: paths it doesn't match keep their place after the ones it ranks.
 * Only for a few hundred paths: ranking ten thousand takes a frame and more.
 */
export function rank(uf, paths, query, limit) {
  const idxs = uf.filter(paths, query) ?? [], seen = new Set();
  const out = [];
  if (idxs.length) {
    const info = uf.info(idxs, paths, query), order = uf.sort(info, paths, query);
    for (const o of order) {
      if (out.length >= limit) break;
      const r = info.ranges[o], ranges = [];
      for (let k = 0; k < r.length; k += 2) ranges.push([r[k], r[k + 1]]);
      seen.add(info.idx[o]);
      out.push({ path: paths[info.idx[o]], ranges });
    }
  }
  for (let i = 0; i < paths.length && out.length < limit; i++) if (!seen.has(i)) out.push({ path: paths[i], ranges: [] });
  return out;
}

// What a file is shown as.
const IMAGES = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg"]);
export const extOf = (name) => name.includes(".") ? name.split(".").pop().toLowerCase() : "";
export const kindOf = (name) => IMAGES.has(extOf(name)) ? "image" : /^(md|markdown|mdx)$/.test(extOf(name)) ? "markdown" : "text";

// The Editor's languages that color something (docs/research/files-panel-verify-local.md); the rest stay plain.
const LANGUAGES = {
  js: "js", mjs: "js", cjs: "js", jsx: "js", ts: "js", mts: "js", cts: "js", tsx: "js", json: "json", jsonc: "json", yaml: "yaml", yml: "yaml",
  rs: "rust", go: "go", py: "python", sh: "sh", bash: "bash", zsh: "zsh", css: "css", c: "c", h: "c", cpp: "cpp", cc: "cpp", cxx: "cpp",
  hpp: "cpp", java: "java", kt: "kotlin", kts: "kotlin", rb: "ruby", php: "php", sql: "sql", lua: "lua", graphql: "graphql", gql: "graphql",
};
export const languageOf = (name) => /^(gnu)?makefile$/i.test(name) ? "makefile" : LANGUAGES[extOf(name)];

// readTextFile's errors, in a sentence each. Gone (null) is the caller's.
export function readProblem(error) {
  const e = String(error);
  if (e.includes("exceeds 1 MiB")) return "This file is larger than 1 MB, too large to preview.";
  if (e.includes("UTF-8")) return "This is a binary file, so there's no text to show.";
  return "This file can't be read.";
}

// Can't be read is a failure, the error bar's, to retry; too large, binary, gone or not UTF-8 is what the file is.
export const failedRead = (problem) => /can't be read/.test(problem);

// A request's answer is used only if no newer one of its kind was made for the same space since (a file picked after it,
// another refresh): a started exec runs to its end however things moved meanwhile.
export function ticket(st, kind) {
  st.tickets ??= {};
  const n = st.tickets[kind] = (st.tickets[kind] ?? 0) + 1;
  return () => st.tickets[kind] === n;
}
