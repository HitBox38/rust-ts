// What `bun scripts/coverage.ts --check` adds for the markers that are not `// rustc:` (lane harness-w40;
// docs/handoff/ice-report-impl.md 5.3, docs/reviews/ice-report-impl.md N3), and the order report for the ones that are
// (docs/reviews/mono-wire.md W5). No import of common.ts, so its tests run in-process.
//
// `// rustc-const: compiler/<path>:<line> <NAME>`: line <line> of the file must hold `const <NAME>`. Not a ported fn: it
// counts for nothing in the tables.
// `// rustc-call: <line>:<col>`, the line directly above a TS call inside a marked fn: the anchor the resolver trusts
// instead of counting calls (src/rust_ts/track_caller.ts `map_call`). Checked here, each failure one `ERROR:` line:
// - it stands inside a marked fn;
// - <line>:<col> is inside that fn's upstream body, where a call starts (the same `pos` `map_call` compares);
// - the TS line below it calls the same name, so a call that moved away from its anchor or an anchor left behind fails;
// - where both calls have a discriminating key of one kind (`call_key`: both a literal, or both a struct), the keys are equal.
// What this cannot see: among sibling calls of one name with no key, an anchor on the wrong sibling (review N3).
// `map_call` does the same lookup at run time, so a stale anchor there refuses, and this finds it before anything reaches it.
import { readFileSync } from "node:fs";
import { ts_file, up_file } from "../../src/rust_ts/track_caller.ts";

/** Whether a TS source can hold markers these checks read (the resolver and its tests quote the syntax). */
export const hasAnchorSyntax = (text: string): boolean => /^\s*\/\/\s*rustc-(?:call|const):/m.test(text);

/** The last path segment of the upstream call that starts at `text` (`a::b::<T>::name(`, `name(`, `name!(`). */
function calleeAt(text: string): string | undefined {
  const m = /^(?:(?:<[^;{}()]*>|\w+)(?:::<[^;{}()]*>)?\s*::\s*)*(\w+)/.exec(text);
  return m?.[1];
}

/** One message per stale or malformed anchor or const marker of the TS file at `file`; `rel` names it in the message. */
export function anchorErrors(file: string, rel: string): string[] {
  const text = readFileSync(file, "utf8");
  if (!hasAnchorSyntax(text)) return [];
  const out: string[] = [];
  const ts = ts_file(file);
  ts.lines.forEach((l, i) => {
    const line = i + 1;
    // Any spacing reaches the strict patterns: `//rustc-call: 1:2` is no anchor to the resolver, so it is a typo to report (review harness-w40 N3).
    if (/^\s*\/\/\s*rustc-const:/.test(l)) {
      const c = /^\s*\/\/ rustc-const: (compiler\/\S+):(\d+) (\w+)(?:\s|$)/.exec(l);
      if (c === null) return void out.push(`${rel}:${line}: malformed rustc-const marker: ${l.trim().slice(0, 100)}`);
      const up = up_file(c[1]!);
      if (up === undefined) return void out.push(`${rel}:${line}: rustc-const names ${c[1]}, which is no upstream file`);
      if (!new RegExp(`\\bconst\\s+${c[3]}\\b`).test(up.lines[Number(c[2]) - 1] ?? "")) out.push(`${rel}:${line}: rustc-const: no \`const ${c[3]}\` at ${c[1]}:${c[2]}`);
      return;
    }
    if (!/^\s*\/\/\s*rustc-call:/.test(l)) return;
    const a = /^\s*\/\/ rustc-call: (\d+):(\d+)\s*$/.exec(l);
    if (a === null) return void out.push(`${rel}:${line}: malformed rustc-call anchor: ${l.trim().slice(0, 100)}`);
    const [ul, uc] = [Number(a[1]), Number(a[2])];
    const at = `rustc-call ${ul}:${uc}`;
    const owner = ts.owner_at(line + 1);
    if (owner === undefined) return void out.push(`${rel}:${line}: ${at} is outside any marked fn`);
    const up = up_file(owner.path);
    if (up === undefined) return void out.push(`${rel}:${line}: ${at}: its fn's marker names ${owner.path}, which is no upstream file`);
    const body = up.owner_body(owner);
    if (body === undefined) return void out.push(`${rel}:${line}: ${at}: ${owner.path}:${owner.line} has no body`);
    const name = calleeAt((up.lines[ul - 1] ?? "").slice(uc - 1));
    if (name === undefined) return void out.push(`${rel}:${line}: ${at} names nothing in ${owner.path}`);
    const call = up.calls_in(body, name).find((c) => {
      const [cl, c0] = up.line_col(c.pos);
      return cl === ul && c0 + 1 === uc;
    });
    if (call === undefined) return void out.push(`${rel}:${line}: ${at}: no call of \`${name}\` starts there in the body of ${owner.path}:${owner.line}`);
    for (const macro of [false, true]) {
      for (const [tl, tc] of ts.calls_in(owner, name, macro)) {
        if (tl !== line + 1) continue;
        const tk = ts.call_key(tl, tc, name);
        const uk = up.call_key(call, name);
        // (A literal on one side and a struct on the other say nothing: `assert(.., "msg")` for a bare `assert!(..)`.)
        if (tk !== undefined && uk !== undefined && tk !== uk && tk.split(" ")[0] === uk.split(" ")[0]) out.push(`${rel}:${line}: ${at}: key ${JSON.stringify(tk)} in TS, ${JSON.stringify(uk)} upstream`);
        return;
      }
    }
    out.push(`${rel}:${line}: ${at} is \`${name}\` upstream, but the next line calls no \`${name}\``);
  });
  return out;
}

export interface OrderMarker {
  file: string;
  path: string;
  line: number;
  name: string;
}

/** One TS file's markers of one upstream file, in TS order, against upstream's. */
export interface OrderRow {
  file: string;
  path: string;
  markers: number;
  /** Markers whose upstream line is below the marker before them. */
  descents: number;
  /** How many markers would have to move to restore upstream's order: all of them but a longest ascending run. */
  outOfOrder: number;
  /** The first descent, as `<name>:<line> after <name>:<line>`. */
  first?: string;
}

/**
 * The order report (review mono-wire W5): PORTING section 3 says upstream order, and nothing automated checks it. Markers come
 * in the order each file holds them. PORTING section 8 allows some inversions (a method from a later `impl` block inside the
 * class body), so this is a report, not a check. Rows with an inversion, worst first.
 */
export function orderRows(ms: readonly OrderMarker[]): OrderRow[] {
  const groups = new Map<string, OrderMarker[]>();
  for (const m of ms) {
    const k = `${m.file}\0${m.path}`;
    const g = groups.get(k);
    if (g) g.push(m);
    else groups.set(k, [m]);
  }
  const rows: OrderRow[] = [];
  for (const g of groups.values()) {
    let descents = 0;
    let first: string | undefined;
    // Patience sorting: `tails[k]` is the smallest last line of an ascending run of length k + 1.
    const tails: number[] = [];
    g.forEach((m, i) => {
      const prev = g[i - 1];
      if (prev && m.line < prev.line) {
        descents++;
        first ??= `${m.name}:${m.line} after ${prev.name}:${prev.line}`;
      }
      let lo = 0;
      let hi = tails.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (tails[mid]! <= m.line) lo = mid + 1;
        else hi = mid;
      }
      tails[lo] = m.line;
    });
    if (descents) rows.push({ file: g[0]!.file, path: g[0]!.path, markers: g.length, descents, outOfOrder: g.length - tails.length, ...(first ? { first } : {}) });
  }
  return rows.sort((a, b) => b.outOfOrder - a.outOfOrder || b.descents - a.descents || (a.file < b.file ? -1 : 1));
}
