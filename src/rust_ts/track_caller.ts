// rust-ts glue (not an upstream mirror): `core::panic::Location::caller()` for rustc's `#[track_caller]`
// diagnostic locations (`DiagLocation::caller`, rustc_errors/src/diagnostic.rs:75), which only show up in
// `-Ztrack-diagnostics: created at <file>:<line>:<col>` notes and in `delayed at <file>:<line>:<col>` ICE notes.
//
// In rustc the location is a compile-time constant of the oracle binary: the span of the call, in the
// innermost non-`#[track_caller]` function, that entered the chain of `#[track_caller]` functions ending in
// `Location::caller()` (rustc_middle/src/mir/mod.rs `caller_location_span`), where the span is the call's
// `fn_span` (method calls: from the method name; other calls: the whole call expression) mapped to its
// outermost macro call site (`expansion_cause`), printed as `<remapped file>:<line>:<col_display + 1>`
// (rustc_const_eval/src/const_eval/machine.rs `location_triple_for_span`).
//
// rust-ts is a line-by-line port, so that call site has a mirror in the TS source. `capture()` records the
// JS stack when the diagnostic is created; only when the location is displayed, `resolve()` walks it:
//  1. every frame is attributed to the ported fn that encloses it (its `// rustc:` / `// rustc-derive:`
//     marker); frames of upstream `#[track_caller]` fns (attribute on the fn, or on the trait method it
//     implements) and the derive(Diagnostic) `into_diag` glue are skipped; the first other frame is the
//     caller `G` (closures inside a `#[track_caller]` fn are not `#[track_caller]`, as in Rust);
//  2. every caller frame's call position must name the function of the frame below it (JSC's proper tail
//     calls drop the frame of a strict-mode `return f(..)`; a broken link is a refusal, never a guess;
//     `BUN_JSC_useTailCalls=0` keeps every frame, see `TAIL_CALLS`);
//  3. the TS call is the k-th call of that name in G's ported body; G's upstream body must contain the
//     same number of calls of it, and the k-th one is the upstream call site. With two or more calls the
//     position alone proves nothing (ports reorder arms: docs/reviews/plan-ice-report.md F3), so the k-th
//     pair must also agree on a key that is unique among the siblings: the diagnostic struct's name or the
//     full normalized message literal (`call_key`). A site with no such key refuses, unless it carries a
//     `// rustc-call: <line>:<col>` anchor on the line above, which names the upstream call directly and
//     is checked against the upstream body here and by track_caller_check.ts.
// Anything that does not check out (unmarked glue frames, native frames, count mismatch, a missing or
// differing key, a call inside a `macro_rules!` definition, non-ASCII before the column, ...) is refused,
// never a guess. A refusal stops a `DiagLocation` display `unported` (exit 70) and a panic with a visible
// reason (exit 101; std/panic.ts `panic_with_hook`).
//
// `resolve_panic_stack()` is the same walk for a panic: `Location::caller()` in the panic entry points, which
// also are `#[track_caller]`. JSC's tail calls stay on: a site a case reaches is made non-tail on demand
// (`keep_frame` in std/panic.ts, or a bare statement for a `never` call; docs/reviews/plan-ice-report.md
// D3), and no second process ever runs to find a location.
//
// PORT: the upstream sources are read from the pinned checkout (`$RUST_TS_DATA/rust`, `.env.local` as in
// scripts/lib/common.ts) at display time; the oracle build compiled them in.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve as resolve_path } from "node:path";

/** The oracle build's `--remap-path-prefix` target for `compiler/` sources (`/rustc-dev/<commit>`, as
 *  `CFG_VIRTUAL_RUSTC_DEV_SOURCE_BASE_DIR` in rustc_metadata/rmeta/decoder.ts). */
const VIRTUAL_RUSTC_DEV_SOURCE_BASE_DIR = "/rustc-dev/6f5da406b56c2db6607202b63daee73aa8c61297";
/** The same for everything else: Miri, as the oracle's own panics show (`/rustc/<commit>/src/tools/miri/src/bin/miri.rs:425:13`). */
const VIRTUAL_RUST_SOURCE_BASE_DIR = "/rustc/6f5da406b56c2db6607202b63daee73aa8c61297";

/** Prefix of the placeholder `DiagLocation::file` a capture is stored under. */
export const CAPTURE_PREFIX = "<rust-ts: #[track_caller] capture ";
const STACK_FRAMES = 64;

const captures = new Map<string, Error>();
let next_capture = 0;

/** Records the current JS stack; returns the key `resolve` takes. */
export function capture(): string {
  const limit = Error.stackTraceLimit;
  Error.stackTraceLimit = STACK_FRAMES;
  const err = new Error();
  Error.stackTraceLimit = limit;
  const key = `${CAPTURE_PREFIX}${next_capture++}>`;
  captures.set(key, err);
  return key;
}

export type Resolved = { ok: true; file: string; line: number; col: number } | { ok: false; why: string };
const resolved = new Map<string, Resolved>();

/** The JS stack, deep enough for `resolve_panic_stack`: call from the panic machinery only. */
export function panic_stack(): string {
  const limit = Error.stackTraceLimit;
  Error.stackTraceLimit = STACK_FRAMES;
  const err = new Error();
  Error.stackTraceLimit = limit;
  return err.stack ?? "";
}

export function resolve(key: string): Resolved {
  let r = resolved.get(key);
  if (r === undefined) {
    const err = captures.get(key);
    r = err === undefined ? { ok: false, why: "no capture" } : resolve_stack(err.stack ?? "");
    resolved.set(key, r);
  }
  return r;
}

// ---- stack frames ------------------------------------------------------------------------------------

interface Frame {
  file: string;
  line: number; // 1-based
  col: number; // 1-based
}

function parse_stack(stack: string): (Frame | undefined)[] {
  const out: (Frame | undefined)[] = [];
  for (const l of stack.split("\n").slice(1)) {
    const m = /^\s*at (?:.*? \()?(.+?):(\d+):(\d+)\)?$/.exec(l);
    out.push(m === null ? undefined : { file: m[1]!, line: Number(m[2]), col: Number(m[3]) });
  }
  return out;
}

const SRC_ROOT = resolve_path(import.meta.dir, "..");

/** Whether JSC eliminates frames of strict-mode `return f(..)` calls (proper tail calls, on unless
 *  `BUN_JSC_useTailCalls=0`). Then a frame of the chain can be missing; links are checked by name below. */
export const TAIL_CALLS: boolean = (() => {
  function tail_probe_inner(): string {
    return new Error().stack ?? "";
  }
  function tail_probe_outer(): string {
    return tail_probe_inner();
  }
  return !tail_probe_outer().includes("tail_probe_outer");
})();

type FrameKind =
  | { kind: "glue" } // the `X_diagnostic` vtable wrapper: transparent
  | { kind: "owned"; owner: Owner; closure: boolean; tc: boolean; up_tc: boolean };

function classify(fr: Frame): FrameKind | string {
  if (!fr.file.startsWith(SRC_ROOT)) return `frame outside src: ${fr.file}`;
  const ts = ts_file(fr.file);
  const owner = ts.owner_at(fr.line);
  if (owner === undefined) {
    if (is_into_diag_glue(ts.lines[fr.line - 1] ?? "")) return { kind: "glue" };
    return `unmarked frame ${rel(fr.file)}:${fr.line}`;
  }
  const closure = ts.in_nested_fn(owner, fr.line, fr.col);
  // A `macro_rules!` port is transparent: a `#[track_caller]` call in the macro body is located at the
  // outermost invocation (`expansion_cause`), i.e. at the call of the macro port in the frame above.
  if (owner.kind === "macro" && !up_file(owner.path)?.lines[owner.line - 1]?.includes(`macro_rules! ${owner.name} `)) {
    return `no macro_rules! ${owner.name} at ${owner.path}:${owner.line}`;
  }
  const tc = owner.kind === "fn" ? upstream_is_track_caller(owner.path, owner.line) : true;
  if (tc === undefined) return `cannot read ${owner.path}:${owner.line}`;
  return { kind: "owned", owner, closure, tc: tc && !closure, up_tc: tc };
}

/** Whether the call at `caller`'s position calls the function of frame `callee` (by name), i.e. no frame
 *  between them was dropped by a tail call. */
function linked(caller: Frame, callee: FrameKind): string | undefined {
  const y = ident_at(ts_file(caller.file).masked_lines[caller.line - 1] ?? "", caller.col - 1);
  if (y === undefined) return `no callee at ${rel(caller.file)}:${caller.line}:${caller.col}`;
  let ok: boolean;
  if (callee.kind === "glue") ok = y === "into_diag";
  else if (callee.closure) ok = !TAIL_CALLS; // a call through a value: the name says nothing
  else ok = ts_name_re(callee_name(callee), true, callee.owner.kind === "macro").test(y);
  return ok ? undefined : `\`${y}\` at ${rel(caller.file)}:${caller.line} does not call the next frame, \`${callee_name(callee)}\` (tail call?)`;
}

/** The upstream name of a frame's function (`into_diag` for the derive(Diagnostic) glue). */
function callee_name(k: FrameKind): string {
  if (k.kind === "glue" || k.owner.kind === "derive_diagnostic") return "into_diag";
  return k.owner.name;
}

/** TS identifiers that port a call of upstream `name`: `name`, `name_` (reserved words, `caller_`), and
 *  `Type_name` (methods of types realised as free functions, e.g. `X_into_diag`); not for macros. */
function ts_name_re(name: string, whole: boolean, macro = false): RegExp {
  const body = macro ? escape_re(name) : `(?:[A-Za-z][\\w$]*_)?${escape_re(name)}_?`;
  return whole ? new RegExp(`^${body}$`) : new RegExp(`(?<![\\w$])${body}(?![\\w$])`, "g");
}

function resolve_stack(stack: string): Resolved {
  const frames = parse_stack(stack);
  // frames[0] is `capture` itself; frames[1] must be `DiagLocation::caller`.
  const fr = frames[1];
  if (fr === undefined) return fail("native frame #1");
  const k = classify(fr);
  if (typeof k === "string") return fail(k);
  if (!(k.kind === "owned" && k.owner.kind === "fn" && k.owner.path === "compiler/rustc_errors/src/diagnostic.rs" && k.owner.name === "caller")) {
    return fail("capture() not called from DiagLocation::caller");
  }
  return walk(frames, 2, k, undefined);
}

/** Files of the panic machinery: their frames lead to the panic site and are `#[track_caller]` upstream or
 *  have no upstream mirror. */
const STD_PANIC = `${SRC_ROOT}/std/panic.ts`;
const STD_PANICKING = `${SRC_ROOT}/std/panicking.ts`;
const STD_RESULT = `${SRC_ROOT}/std/result.ts`;
const SPAN_MACROS = `${SRC_ROOT}/rustc_span/macros.ts`;
const SELF = `${SRC_ROOT}/rust_ts/track_caller.ts`;
/** Constructors and internals of the machinery: they name no call a port site can make. */
const PANIC_INTERNALS: ReadonlySet<string> = new Set(["Panic", "ExplicitBug", "panic_with_hook", "panic_stack", "unwrap_failed"]);
/** `Result`'s methods are free functions under other names (std/result.ts): the upstream call a TS call of one of these ports. */
export const RESULT_METHODS: ReadonlyMap<string, string> = new Map([
  ["unwrap_result", "unwrap"],
  ["expect_result", "expect"],
]);
const upstream_callee = (callee: string): string => RESULT_METHODS.get(callee) ?? callee;

function frame_fn_name(raw: string | undefined): string {
  return /^\s*at (?:new )?(\S+) \(/.exec(raw ?? "")?.[1] ?? "";
}

/** `Location::caller()` of the panic the stack was captured for. The first frame outside the machinery called one of the machinery's
 *  entry points (`bug`, `span_bug`, `panic`, `unwrap`, `assert`, ...) or threw directly (`throw new ExplicitBug()`
 *  in `Diag::emit`, `#[track_caller]` upstream; anywhere else a direct `throw` names no upstream call). */
export function resolve_panic_stack(stack: string): Resolved {
  const raw = stack.split("\n").slice(1);
  const frames = parse_stack(stack);
  const entry = new Set<string>();
  let i = 0;
  for (; i < frames.length; i++) {
    const fr = frames[i];
    if (fr === undefined) return fail(`native frame #${i}`);
    if (fr.file !== SELF && fr.file !== STD_PANIC && fr.file !== STD_PANICKING && fr.file !== STD_RESULT && fr.file !== SPAN_MACROS) break;
    const name = frame_fn_name(raw[i]);
    if (fr.file === SELF || name === "" || PANIC_INTERNALS.has(name)) continue;
    entry.add(name);
    // `bug!`/`span_bug!` are `bug_fmt`/`span_bug_fmt` -> `bug_impl`; the TS wrappers tail-call it.
    if (name === "bug_impl") {
      entry.add("bug");
      entry.add("span_bug");
    }
  }
  return walk(frames, i, undefined, entry);
}

/** Walks up from `frames[start]`: `below` is the frame under it, or the panic machinery's `entry` names. */
function walk(frames: (Frame | undefined)[], start: number, below: FrameKind | undefined, entry: ReadonlySet<string> | undefined): Resolved {
  let prev = below;
  let callee: string | undefined;
  let macro = false;
  for (let i = start; i < frames.length; i++) {
    const fr = frames[i];
    if (fr === undefined) return fail(`native frame #${i}`);
    const k = classify(fr);
    if (typeof k === "string") return fail(k);
    if (prev !== undefined) {
      const why = linked(fr, prev);
      if (why !== undefined) return fail(why);
      callee = callee_name(prev);
      macro = prev.kind === "owned" && prev.owner.kind === "macro";
    } else if (entry!.size > 0) {
      const y = ident_at(ts_file(fr.file).masked_lines[fr.line - 1] ?? "", fr.col - 1);
      if (y === undefined || !entry!.has(y)) {
        return fail(`\`${y}\` at ${rel(fr.file)}:${fr.line} does not call the panic entry ${[...entry!].join("/")} (tail call?)`);
      }
      callee = y;
    } else if (k.kind !== "owned" || !k.tc) {
      return fail(`a direct throw at ${rel(fr.file)}:${fr.line} names no upstream call`);
    }
    if (k.kind === "glue" || k.tc) {
      // A `#[track_caller]` fn's closures are not `#[track_caller]`: a call the port inlined from an upstream
      // closure would have its location there, not in this fn's caller.
      if (k.kind === "owned" && k.owner.kind === "fn" && callee !== undefined) {
        const why = tc_call_in_closure(k.owner, callee);
        if (why !== undefined) return fail(why);
      }
      prev = k;
      continue;
    }
    if (callee === undefined) return fail("no call to locate");
    return locate(fr, k, callee, macro);
  }
  return fail("no non-#[track_caller] caller within the captured frames");
}

/** Refusal when the upstream `#[track_caller]` fn calls `callee` from inside a closure. */
function tc_call_in_closure(owner: Owner, callee: string): string | undefined {
  const up = up_file(owner.path);
  const body = up?.owner_body(owner);
  if (up === undefined || body === undefined) return `cannot read ${owner.path}:${owner.line}`;
  return up.calls_in(body, upstream_callee(callee)).some((c) => up.in_closure(body, c.pos)) ? `\`${callee}\` in a closure of #[track_caller] ${owner.path}:${owner.line}` : undefined;
}

/** The upstream location of the call in the caller `G`'s frame. */
function locate(fr: Frame, k: FrameKind, callee: string, macro: boolean): Resolved {
  const ts = ts_file(fr.file);
  const owner = ts.owner_at(fr.line)!;
  if (owner.kind !== "fn") return fail(`caller is not a ported fn (${rel(fr.file)}:${fr.line})`);
  const m = map_call(ts, owner, callee, macro, fr.line, fr.col);
  if (!m.ok) return fail(m.why);
  const up = m.up;
  // A frame in a TS closure of an upstream `#[track_caller]` fn is `G` only if upstream has that closure too.
  if (k.kind === "owned" && k.up_tc && !up.in_closure(m.body, m.call.pos)) {
    return fail(`a TS closure in #[track_caller] ${owner.path}:${owner.line} has no upstream closure`);
  }
  const [line, col0] = up.line_col(m.call.pos);
  const prefix = up.lines[line - 1]!.slice(0, col0);
  // `col_display`: every char before the position is ASCII and not a tab, so it is the byte column.
  if (!/^[\x20-\x7e]*$/.test(prefix)) return fail(`non-ASCII before ${owner.path}:${line}:${col0 + 1}`);
  // Only `compiler/` is remapped to the rustc-dev component; Miri is built from the rust-src prefix.
  const base = owner.path.startsWith("compiler/") ? VIRTUAL_RUSTC_DEV_SOURCE_BASE_DIR : VIRTUAL_RUST_SOURCE_BASE_DIR;
  return { ok: true, file: `${base}/${owner.path}`, line, col: col0 + 1 };
}

export type MappedCall = { ok: true; up: UpFile; body: [number, number]; call: UpCall; anchored: boolean } | { ok: false; why: string };

/** Maps the TS call of `callee` at (line, col) in `owner` to its upstream call site, or refuses. */
export function map_call(ts: TsFile, owner: Owner, callee: string, macro: boolean, line: number, col: number): MappedCall {
  const rel_ts = `${owner.path}:${owner.line}`;
  const ts_calls = ts.calls_in(owner, callee, macro);
  const k = ts_calls.findIndex(([l, c]) => l === line && c === col);
  if (k < 0) return { ok: false, why: `call of \`${callee}\` at line ${line}:${col} of the port of ${rel_ts} not found` };
  const up = up_file(owner.path);
  if (up === undefined) return { ok: false, why: `cannot read ${owner.path}` };
  const body = up.owner_body(owner);
  if (body === undefined) return { ok: false, why: `no body at ${rel_ts}` };
  // The location of a fn generated by a `macro_rules!` is the macro's invocation.
  if (up.in_file_macro_rules(body[0])) return { ok: false, why: `${rel_ts} is inside a macro_rules!` };
  const up_callee = upstream_callee(callee);
  const up_calls = up.calls_in(body, up_callee);
  let call: UpCall;
  const anchor = ts.anchor_at(line);
  if (anchor !== undefined) {
    const at = up_calls.find((c) => {
      const [l, c0] = up.line_col(c.pos);
      return l === anchor[0] && c0 + 1 === anchor[1];
    });
    if (at === undefined) return { ok: false, why: `rustc-call ${anchor[0]}:${anchor[1]} names no call of \`${callee}\` in ${rel_ts}` };
    call = at;
  } else {
    if (up_calls.length !== ts_calls.length) {
      return { ok: false, why: `\`${callee}\` called ${ts_calls.length}x in TS, ${up_calls.length}x at ${rel_ts}` };
    }
    call = up_calls[k]!;
    const ts_key = ts.call_key(line, col, callee);
    const up_key = up.call_key(call, up_callee);
    // `.expect("..")` is ported as `unwrap(x, "..")`: that call is not the upstream `.unwrap()`, whatever the count says.
    if (callee === "unwrap" && up_key === undefined && ts_key !== undefined) {
      return { ok: false, why: `\`unwrap\` with a message at ${rel_ts} is no upstream \`.unwrap()\`` };
    }
    if (up_calls.length === 1) {
      // A single call on both sides needs no key, but keys that exist and differ show two different calls: a port's
      // `panic` for an upstream `bug!`, or a fn that lost its own call and inlined a helper's.
      if (ts_key !== undefined && up_key !== undefined && ts_key !== up_key) {
        return { ok: false, why: `\`${callee}\` at ${rel_ts}: key ${JSON.stringify(ts_key)} in TS, ${JSON.stringify(up_key)} upstream` };
      }
    } else {
      if (ts_key === undefined || up_key === undefined) return { ok: false, why: `no key for \`${callee}\` #${k} of ${up_calls.length} at ${rel_ts}` };
      if (ts_key !== up_key) return { ok: false, why: `\`${callee}\` #${k} of ${up_calls.length} at ${rel_ts}: key ${JSON.stringify(ts_key)} in TS, ${JSON.stringify(up_key)} upstream` };
      if (up_calls.filter((c) => up.call_key(c, up_callee) === up_key).length !== 1) {
        return { ok: false, why: `\`${callee}\` #${k} of ${up_calls.length} at ${rel_ts}: key ${JSON.stringify(up_key)} is not unique` };
      }
    }
  }
  if (call.in_macro_rules) return { ok: false, why: `call inside macro_rules! at ${owner.path}` };
  // Counts agreeing is no evidence here: the call is in an item nested upstream, so a port that hoisted that item left another
  // call in the owner (review ice-report-impl F1: ref_prop.ts:313 printed ref_prop.rs:339:25 for the assert at :275:17). A port
  // keeping a nested item inside its owner marks it, and `locate` uses the innermost owner, so a call there maps through that
  // marker instead; a closure in the owner is no sign of a nested item (re-check R2). track_caller_check.ts lists what this refuses.
  if (anchor === undefined && up.in_nested_item(body, call.pos)) {
    return { ok: false, why: `\`${callee}\` at ${rel_ts}: its upstream call is in a nested item` };
  }
  return { ok: true, up, body, call, anchored: anchor !== undefined };
}

function fail(why: string): Resolved {
  return { ok: false, why };
}
function rel(file: string): string {
  return file.startsWith(SRC_ROOT) ? `src${file.slice(SRC_ROOT.length)}` : file;
}

/** `return { into_diag: (dcx, level) => X_into_diag(self, dcx, level) };`: the `impl Diagnostic for X`
 *  vtable wrapper of the generated `X_diagnostic` fns (codegen of derive(Diagnostic)). */
function is_into_diag_glue(line: string): boolean {
  return /^\s*return \{ into_diag: \(dcx, level\) => \w+_into_diag\(self, dcx, level\) \};$/.test(line);
}

function ident_at(line: string, idx: number): string | undefined {
  const m = /^[A-Za-z_$][\w$]*/.exec(line.slice(idx));
  if (m === null) return undefined;
  if (idx > 0 && /[\w$]/.test(line[idx - 1]!)) return undefined;
  return m[0];
}

// ---- TS sources --------------------------------------------------------------------------------------

export type Owner =
  | { kind: "fn"; path: string; line: number; name: string; start: number; end: number }
  | { kind: "macro"; path: string; line: number; name: string; start: number; end: number }
  | { kind: "derive_diagnostic"; path: string; line: number; start: number; end: number };

export class TsFile {
  readonly lines: string[];
  readonly masked: string;
  readonly masked_lines: string[];
  readonly line_starts: number[];
  readonly owners: Owner[] = [];

  constructor(readonly src: string) {
    this.lines = src.split("\n");
    this.masked = mask_ts(src);
    this.masked_lines = this.masked.split("\n");
    this.line_starts = line_starts(src);
    for (let i = 0; i + 1 < this.lines.length; i++) {
      const l = this.lines[i]!;
      let m = /^\s*\/\/ rustc: ((?:compiler|src\/tools\/miri)\/\S+):(\d+) (\S+)\s*$/.exec(l);
      // 1-based line of the declaration: the first line after the marker that is not a comment
      let decl = i + 2;
      while (decl <= this.lines.length && /^\s*\/\//.test(this.lines[decl - 1]!)) decl++;
      if (m !== null) {
        this.owners.push({ kind: "fn", path: m[1]!, line: Number(m[2]), name: m[3]!, start: decl, end: this.body_end(decl) });
        continue;
      }
      // A `const` whose initializer holds closures (`rustc_attr_parsing`'s `ATTRIBUTES` tables): its closures
      // are the frames, and the initializer is the body the calls are looked up in.
      m = /^\s*\/\/ rustc-const: (compiler\/\S+):(\d+) (\w+)\s*$/.exec(l);
      if (m !== null) {
        this.owners.push({ kind: "fn", path: m[1]!, line: Number(m[2]), name: m[3]!, start: decl, end: this.body_end(decl) });
        continue;
      }
      m = /^\s*\/\/ rustc-macro: (compiler\/\S+):(\d+) (\w+)!\s*$/.exec(l);
      if (m !== null) {
        this.owners.push({ kind: "macro", path: m[1]!, line: Number(m[2]), name: m[3]!, start: decl, end: this.body_end(decl) });
        continue;
      }
      m = /^\s*\/\/ rustc-derive: (compiler\/\S+):(\d+) Diagnostic \S+\s*$/.exec(l);
      if (m !== null) {
        this.owners.push({ kind: "derive_diagnostic", path: m[1]!, line: Number(m[2]), start: decl, end: this.body_end(decl) });
      }
    }
  }

  /** Last line of the declaration starting at `decl`: the next line at the same indentation starting with
   *  `}` (one-line declarations end on their own line). */
  private body_end(decl: number): number {
    const first = this.masked_lines[decl - 1] ?? "";
    if (braces_balanced(first) && /\}[);,]*\s*$/.test(first)) return decl;
    const ind = indent(first);
    for (let j = decl + 1; j <= this.masked_lines.length; j++) {
      const l = this.masked_lines[j - 1]!;
      if (l.trim() !== "" && indent(l) === ind && /^[}\]]/.test(l.trimStart())) return j;
    }
    return decl;
  }

  /** The innermost marked declaration containing `line`. */
  owner_at(line: number): Owner | undefined {
    let best: Owner | undefined;
    for (const o of this.owners) {
      if (o.start <= line && line <= o.end && (best === undefined || o.start > best.start)) best = o;
    }
    return best;
  }

  /** Whether (line, col) lies in a function literal nested in `owner`'s body (a closure). */
  in_nested_fn(owner: Owner, line: number, col: number): boolean {
    const begin = this.line_starts[owner.start]! - 1; // end of the declaration's first line
    const pos = this.line_starts[line - 1]! + col - 1;
    const end = this.line_starts[owner.end]! - 1;
    const s = this.masked;
    for (let i = begin; i < pos; i++) {
      let body_start = -1;
      if (s.startsWith("=>", i)) {
        body_start = i + 2;
      } else if (s.startsWith("function", i) && !/[\w$]/.test(s[i - 1] ?? "") && !/[\w$]/.test(s[i + 8] ?? "")) {
        const open = s.indexOf("{", i);
        if (open < 0) continue;
        body_start = open;
      } else {
        continue;
      }
      while (/\s/.test(s[body_start] ?? "")) body_start++;
      const body_end = s[body_start] === "{" ? match_close(s, body_start) : expr_end(s, body_start, end);
      if (pos > body_start && pos < body_end) return true;
    }
    return false;
  }

  /** Positions (1-based line, col) of the calls of `name` in `owner`'s declaration. */
  calls_in(owner: Owner, name: string, macro: boolean): [number, number][] {
    const out: [number, number][] = [];
    const re = ts_name_re(name, false, macro);
    for (let l = owner.start; l <= owner.end; l++) {
      const text = this.masked_lines[l - 1]!;
      for (const m of text.matchAll(re)) {
        const before = text.slice(0, m.index);
        const after = text.slice(m.index + m[0].length);
        if (/\bfunction\s*$/.test(before)) continue;
        if (!/^\s*(<[^()]*>)?\s*\(/.test(after) && !/^\s*$/.test(after)) continue;
        if (/^\s*$/.test(after) && !/^\s*\(/.test(this.masked_lines[l] ?? "")) continue;
        if (l === owner.start && /^\s*(?:static\s+|async\s+)?$/.test(before)) continue; // the declaration itself
        out.push([l, m.index + 1]);
      }
    }
    return out;
  }

  /** The `// rustc-call: <line>:<col>` anchor on the line above `line`: the upstream call this one ports. */
  anchor_at(line: number): [number, number] | undefined {
    const m = /^\s*\/\/ rustc-call: (\d+):(\d+)\s*$/.exec(this.lines[line - 2] ?? "");
    return m === null ? undefined : [Number(m[1]), Number(m[2])];
  }

  /** The key of the call of `name` at (line, col): see `first_key`. */
  call_key(line: number, col: number, name: string): string | undefined {
    const s = this.masked;
    const at = this.line_starts[line - 1]! + col - 1;
    const after = at + (/^[\w$]+/.exec(s.slice(at, at + 200))?.[0].length ?? name.length);
    const open = /^\s*(?:<[^()]*>)?\s*\(/.exec(s.slice(after, after + 400));
    if (open === null) return undefined;
    const start = after + open[0].length;
    const end = match_close(s, start - 1) - 1;
    const struct = /(?<![\w$])([A-Z]\w*?)_(?:diagnostic|into_diag)(?![\w$])/.exec(s.slice(start, end));
    const struct_at = struct === null ? -1 : start + struct.index;
    let lit = -1;
    for (let i = start; i < end; i++) {
      const c = s[i];
      if (c === '"' || c === "'" || c === "`") {
        lit = i;
        break;
      }
    }
    // An enum value's tag, `{ $: "Variant", .. }`, is upstream's `Enum::Variant { .. }`, not a message.
    if (lit >= 0 && /\$\s*:\s*$/.test(s.slice(start, lit))) {
      const tag = ts_literal(this.src, lit);
      if (struct_at < 0 || lit < struct_at) return tag === undefined ? undefined : `struct ${tag}`;
    }
    return first_key(struct_at, struct?.[1], lit, () => ts_literal(this.src, lit));
  }
}

/** A call's key: whichever of the diagnostic struct's name and the first string literal comes first in its
 *  arguments (D4), or nothing when it has neither. The two kinds never compare equal. */
function first_key(struct_at: number, struct: string | undefined, lit_at: number, lit: () => string | undefined): string | undefined {
  if (struct_at >= 0 && (lit_at < 0 || struct_at < lit_at)) return `struct ${struct}`;
  if (lit_at < 0) return undefined;
  const text = lit();
  return text === undefined ? undefined : `literal ${text}`;
}

/** A TS string or template literal at `at`, with `${..}` as `{}`. */
function ts_literal(src: string, at: number): string | undefined {
  const q = src[at]!;
  let out = "";
  for (let i = at + 1; i < src.length; i++) {
    const c = src[i]!;
    if (c === q) return out;
    if (c === "\\") {
      const e = unescape_char(src, i + 1);
      if (e === undefined) return undefined;
      out += e[0];
      i = e[1] - 1;
    } else if (q === "`" && c === "$" && src[i + 1] === "{") {
      let d = 0;
      let j = i + 1;
      for (; j < src.length; j++) {
        if (src[j] === "{") d++;
        else if (src[j] === "}" && --d === 0) break;
      }
      out += "{}";
      i = j;
    } else out += c;
  }
  return undefined;
}

/** A Rust string literal at `at` (format placeholders as `{}`, `{{`/`}}` as `{`/`}`). */
function rust_literal(src: string, at: number): string | undefined {
  let i = at;
  if (src[i] === "b" || src[i] === "c") i++;
  let text = "";
  if (src[i] === "r") {
    const m = /^r(#*)"/.exec(src.slice(i, i + 300));
    if (m === null) return undefined;
    const from = i + m[0].length;
    const close = src.indexOf(`"${m[1]}`, from);
    if (close < 0) return undefined;
    text = src.slice(from, close);
  } else {
    if (src[i] !== '"') return undefined;
    for (i++; ; i++) {
      if (i >= src.length) return undefined;
      const c = src[i]!;
      if (c === '"') break;
      if (c === "\\" && src[i + 1] === "\n") {
        // A line continuation drops the newline and the leading whitespace after it.
        i += 2;
        while (/\s/.test(src[i] ?? "")) i++;
        i--;
      } else if (c === "\\") {
        const e = unescape_char(src, i + 1);
        if (e === undefined) return undefined;
        text += e[0];
        i = e[1] - 1;
      } else text += c;
    }
  }
  return text
    .replace(/\{\{|\}\}|\{[^{}]*\}/g, (m) => (m === "{{" ? "\0{" : m === "}}" ? "\0}" : "{}"))
    .replace(/\0/g, "");
}

/** The char of the escape whose letter is at `i`, and the index after it. Anything unusual has no key. */
function unescape_char(src: string, i: number): [string, number] | undefined {
  const c = src[i];
  switch (c) {
    case "n":
      return ["\n", i + 1];
    case "t":
      return ["\t", i + 1];
    case "r":
      return ["\r", i + 1];
    case "0":
      return ["\0", i + 1];
    case "\\":
    case '"':
    case "'":
    case "`":
    case "$":
    case "{":
      return [c, i + 1];
    default:
      return undefined;
  }
}

const ts_cache = new Map<string, TsFile>();
export function ts_file(file: string): TsFile {
  let f = ts_cache.get(file);
  if (f === undefined) {
    f = new TsFile(readFileSync(file, "utf8"));
    ts_cache.set(file, f);
  }
  return f;
}

// ---- upstream sources --------------------------------------------------------------------------------

export interface UpCall {
  /** Where the location points: the method name, or the start of the path or macro invocation. */
  pos: number;
  /** The name's own offset. */
  at: number;
  in_macro_rules: boolean;
}

export class UpFile {
  readonly lines: string[];
  readonly masked: string;
  readonly masked_lines: string[];
  readonly line_starts: number[];
  /** Start offsets of the string literals, ascending. */
  readonly literals: number[] = [];

  constructor(readonly src: string) {
    this.lines = src.split("\n");
    this.masked = mask_rust(src, this.literals);
    this.masked_lines = this.masked.split("\n");
    this.line_starts = line_starts(src);
  }

  line_col(pos: number): [number, number] {
    let lo = 0;
    let hi = this.line_starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.line_starts[mid]! <= pos) lo = mid;
      else hi = mid - 1;
    }
    return [lo + 1, pos - this.line_starts[lo]!];
  }

  /** [start, end) byte range of the body of the fn whose `fn` keyword is on `line`. */
  fn_body(line: number): [number, number] | undefined {
    const l = this.masked_lines[line - 1];
    if (l === undefined || !/\bfn\b/.test(l)) return undefined;
    const start = this.line_starts[line - 1]! + l.search(/\bfn\b/);
    // The body is the first `{` after the signature's parentheses (the `fn` line and those after it).
    let i = this.masked.indexOf("(", start);
    if (i < 0) return undefined;
    i = match_close(this.masked, i);
    let depth = 0;
    for (; i < this.masked.length; i++) {
      const c = this.masked[i]!;
      if (c === "<" || c === "(" || c === "[") depth++;
      else if ((c === ">" && this.masked[i - 1] !== "-") || c === ")" || c === "]") depth--;
      else if (c === ";" && depth <= 0) return undefined;
      else if (c === "{" && depth <= 0) return [start, match_close(this.masked, i)];
    }
    return undefined;
  }

  /** The body of a marked fn, or the initializer of a `rustc-const:` const. */
  owner_body(owner: Owner): [number, number] | undefined {
    const l = this.masked_lines[owner.line - 1];
    if (l === undefined) return undefined;
    if (owner.kind === "fn" && !/\bfn\b/.test(l)) {
      // `const NAME: T = <initializer>;`: the first `;` outside any bracket.
      if (!new RegExp(`\\bconst\\s+${owner.name}\\b`).test(l)) return undefined;
      const start = this.line_starts[owner.line - 1]! + l.search(/\bconst\b/);
      let d = 0;
      for (let i = start; i < this.masked.length; i++) {
        const c = this.masked[i]!;
        if (c === "(" || c === "[" || c === "{") d++;
        else if (c === ")" || c === "]" || c === "}") d--;
        else if (c === ";" && d === 0) return [start, i];
      }
      return undefined;
    }
    return this.fn_body(owner.line);
  }

  /** Whether `pos` lies in a `macro_rules!` of this file. */
  in_file_macro_rules(pos: number): boolean {
    return (this.macro_rules_ ??= this.macro_rules_ranges([0, this.masked.length])).some(([a, b]) => pos > a && pos < b);
  }
  private macro_rules_: [number, number][] | undefined;

  private macro_rules_ranges([start, end]: [number, number]): [number, number][] {
    const out: [number, number][] = [];
    for (const m of this.masked.slice(start, end).matchAll(/\bmacro_rules!\s*\w+\s*[{(\[]/g)) {
      const open = start + m.index + m[0].length - 1;
      out.push([open, match_close(this.masked, open)]);
    }
    return out;
  }

  /**
   * Whether `pos` lies in an item nested in the body (`fn name`, `impl`, `trait`, `mod`, `static`, `const NAME:`). A port may hoist such
   * an item to a marked fn of its own, or to a module-level value, so a call there says nothing about a call left in the owner. Only
   * at an item position, as `impl` is also a type (`-> impl Iterator<..> {` in the owner's own signature opens its body). A macro's
   * argument counts, `m!(fn n() { .. })`, and a `|` or a `(` that merely could open one only ever makes the caller refuse.
   */
  in_nested_item([start, end]: [number, number], pos: number): boolean {
    const s = this.masked;
    const inner = s.slice(start + 1, end);
    for (const m of inner.matchAll(/(?<![\p{L}\p{N}_])(?:fn\s+[\p{L}_][\p{L}\p{N}_]*|impl(?![\p{L}\p{N}_])|trait\s+[\p{L}_][\p{L}\p{N}_]*|mod\s+[\p{L}_][\p{L}\p{N}_]*|static\s+(?:mut\s+)?[\p{L}_][\p{L}\p{N}_]*|const\s+[\p{L}_][\p{L}\p{N}_]*\s*:)/gu)) {
      const at = start + 1 + m.index;
      if (at >= pos) break;
      if (!/[;{}\]()]\s*(?:(?:pub(?:\([^)]*\))?|const|async|unsafe|safe|gen|extern(?:\s+"[^"]*")?|default)\s+)*$/.test(s.slice(start, at))) continue;
      const span = item_span(s, at, end);
      if (span !== undefined && pos > span[0] && pos < span[1]) return true;
    }
    return false;
  }

  /** Whether `pos` lies in a closure of `body`. A `|` that merely could open one counts: the answer only ever
   *  makes the caller refuse. */
  in_closure([start, end]: [number, number], pos: number): boolean {
    const s = this.masked;
    for (let i = start; i < pos; i++) {
      if (s[i] !== "|") continue;
      let p = i - 1;
      while (p >= start && /\s/.test(s[p]!)) p--;
      const before = s[p] ?? "";
      const opens = before === "(" || before === "," || before === "{" || before === "[" || before === ";" || (before === "=" && s[p - 1] !== "=") || /\b(?:move|return)$/.test(s.slice(Math.max(start, p - 6), p + 1));
      if (!opens) continue;
      // The parameters end at the next `|` (`||`: at once).
      const close = s.indexOf("|", i + 1);
      if (close < 0 || close >= end) continue;
      let b = close + 1;
      while (/\s/.test(s[b] ?? "")) b++;
      if (s.startsWith("->", b)) {
        const brace = s.indexOf("{", b);
        if (brace < 0) continue;
        b = brace;
      }
      const stop = s[b] === "{" ? match_close(s, b) : expr_end(s, b, end);
      if (pos > close && pos < stop) return true;
      i = close;
    }
    return false;
  }

  /** The key of a call: see `first_key`. */
  call_key(call: UpCall, name: string): string | undefined {
    const s = this.masked;
    const after = call.at + name.length;
    const open = /^\s*(?:!\s*)?(?:::\s*<[^;{}]*?>\s*)?[({\[]/.exec(s.slice(after, after + 400));
    if (open === null) return undefined;
    const start = after + open[0].length;
    const end = match_close(s, start - 1) - 1;
    const args = s.slice(start, end);
    const struct = /(?<!\w)([A-Z]\w*[a-z]\w*)(?:\s*\{|\s*$)/.exec(args);
    const struct_at = struct === null ? -1 : start + struct.index;
    const lit = this.literals.find((l) => l >= start && l < end) ?? -1;
    return first_key(struct_at, struct?.[1], lit, () => rust_literal(this.src, lit));
  }

  calls_in([start, end]: [number, number], name: string): UpCall[] {
    const s = this.masked;
    const macro_rules: [number, number][] = [];
    for (const m of s.slice(start, end).matchAll(/\bmacro_rules!\s*\w+\s*[{(\[]/g)) {
      const open = start + m.index + m[0].length - 1;
      macro_rules.push([open, match_close(s, open)]);
    }
    const out: UpCall[] = [];
    const re = new RegExp(`(?<![\\w])${escape_re(name)}(?![\\w])`, "g");
    re.lastIndex = start;
    for (let m = re.exec(s); m !== null && m.index < end; m = re.exec(s)) {
      const at = m.index;
      const after = s.slice(at + name.length, at + name.length + 400);
      const before = s.slice(Math.max(start, at - 40), at);
      if (/\bfn\s+$/.test(before)) continue;
      const is_macro = /^\s*!\s*[({\[]/.test(after);
      const is_call = /^\s*(::\s*<[^;{}]*?>\s*)?\(/.test(after);
      if (!is_macro && !is_call) continue;
      const pos = is_macro || /\.\s*$/.test(before) ? (is_macro ? path_start(s, at, start) : at) : path_start(s, at, start);
      out.push({ pos, at, in_macro_rules: macro_rules.some(([a, b]) => at > a && at < b) });
    }
    return out;
  }
}

/** Start of the path expression `a::b::<T>::name` / `<T as Tr>::name` ending at `at`. */
function path_start(s: string, at: number, floor: number): number {
  let pos = at;
  for (;;) {
    let i = pos - 1;
    while (i >= floor && /\s/.test(s[i]!)) i--;
    if (!(s[i] === ":" && s[i - 1] === ":")) return pos;
    i -= 2;
    while (i >= floor && /\s/.test(s[i]!)) i--;
    if (s[i] === ">") {
      let depth = 0;
      for (; i >= floor; i--) {
        if (s[i] === ">" && s[i - 1] !== "-") depth++;
        else if (s[i] === "<") {
          depth--;
          if (depth === 0) break;
        }
      }
      // `Type::<..>::` (turbofish) or `<T as Trait>::`
      const j = i - 1;
      if (s[j] === ":" && s[j - 1] === ":") {
        pos = i;
        // continue with the segment before the turbofish
        let k = j - 2;
        while (k >= floor && /\s/.test(s[k]!)) k--;
        let b = k;
        while (b >= floor && /\w/.test(s[b]!)) b--;
        if (b === k) return pos;
        pos = b + 1;
        continue;
      }
      pos = i;
      continue;
    }
    let b = i;
    while (b >= floor && /\w/.test(s[b]!)) b--;
    if (b === i) return pos;
    pos = b + 1;
  }
}

const up_cache = new Map<string, UpFile | undefined>();
export function up_file(path: string): UpFile | undefined {
  if (!up_cache.has(path)) {
    const root = upstream_root();
    const full = root === undefined ? undefined : join(root, path);
    up_cache.set(path, full !== undefined && existsSync(full) ? new UpFile(readFileSync(full, "utf8")) : undefined);
  }
  return up_cache.get(path);
}

let upstream_root_: string | undefined | null = null;
function upstream_root(): string | undefined {
  if (upstream_root_ === null) {
    let data = process.env.RUST_TS_DATA;
    if (data === undefined) {
      const env_local = join(SRC_ROOT, "..", ".env.local");
      if (existsSync(env_local)) {
        for (const line of readFileSync(env_local, "utf8").split(/\r?\n/)) {
          const m = /^\s*RUST_TS_DATA\s*=\s*(.*?)\s*$/.exec(line);
          if (m !== null) data = m[1];
        }
      }
    }
    const root = join(resolve_path(data ?? join(SRC_ROOT, "..", ".data")), "rust");
    upstream_root_ = existsSync(join(root, "compiler")) ? root : undefined;
  }
  return upstream_root_;
}

/** Whether the upstream fn whose `fn` keyword is on `line` of `path` is `#[track_caller]`: the attribute
 *  on the fn itself, or on the method of the trait it implements. */
function upstream_is_track_caller(path: string, line: number): boolean | undefined {
  const f = up_file(path);
  if (f === undefined) return undefined;
  return fn_is_track_caller(f, line);
}

export function is_track_caller_owner(owner: Owner): boolean {
  return owner.kind !== "fn" || upstream_is_track_caller(owner.path, owner.line) === true;
}

function fn_is_track_caller(f: UpFile, line: number): boolean {
  if (has_track_caller_attr(f, line)) return true;
  const l = f.masked_lines[line - 1]!;
  const name = /\bfn\s+(\w+)/.exec(l)?.[1];
  if (name === undefined) return false;
  const trait = enclosing_impl_trait(f, line);
  return trait !== undefined && trait_track_caller_methods().get(trait)?.has(name) === true;
}

function has_track_caller_attr(f: UpFile, line: number): boolean {
  for (let j = line - 2; j >= 0 && j >= line - 40; j--) {
    const t = f.lines[j]!.trim();
    if (t === "#[track_caller]") return true;
    if (t === "" || t.endsWith("}") || t.endsWith(";") || t.endsWith("{")) {
      if (!t.startsWith("#") && !t.startsWith("//")) return false;
    }
  }
  return false;
}

/** The trait name of the `impl Trait for Type` block enclosing `line`, if any. */
function enclosing_impl_trait(f: UpFile, line: number): string | undefined {
  const ind = indent(f.masked_lines[line - 1]!);
  for (let j = line - 2; j >= 0; j--) {
    const l = f.masked_lines[j]!;
    if (l.trim() === "" || indent(l) >= ind) continue;
    // `impl<..> Trait for X\n{` and `impl Trait\n    for X\nwhere ..\n{`: the lines before the body are the header.
    if (/^\s*(?:\{|where\b|for\s)/.test(l)) continue;
    if (!/^\s*(unsafe\s+)?impl\b/.test(l)) return undefined;
    // header up to the `{`
    let header = "";
    for (let k = j; k < line - 1; k++) {
      header += ` ${f.masked_lines[k]}`;
      if (f.masked_lines[k]!.includes("{")) break;
    }
    header = header.slice(0, header.indexOf("{") < 0 ? undefined : header.indexOf("{"));
    header = header.replace(/^\s*(unsafe\s+)?impl\s*/, "");
    header = strip_leading_generics(header);
    const m = /^\s*!?\s*([\w:]+)\s*(<.*>)?\s+for\s/.exec(header);
    if (m === null) return undefined;
    return m[1]!.split("::").pop();
  }
  return undefined;
}

function strip_leading_generics(s: string): string {
  const t = s.trimStart();
  if (!t.startsWith("<")) return t;
  let depth = 0;
  for (let i = 0; i < t.length; i++) {
    if (t[i] === "<") depth++;
    else if (t[i] === ">" && t[i - 1] !== "-") {
      depth--;
      if (depth === 0) return t.slice(i + 1);
    }
  }
  return t;
}

// ---- trait index -------------------------------------------------------------------------------------

/** Trait name -> its methods declared `#[track_caller]` (which makes every impl of them `#[track_caller]`),
 *  over all upstream `compiler/` and Miri sources; built on first need. */
let trait_tc_index: Map<string, Set<string>> | undefined;

function build_trait_tc_index(): Map<string, Set<string>> {
  const trait_tc = new Map<string, Set<string>>();
  const root = upstream_root();
  const files: string[] = [];
  const walk = (rel_dir: string) => {
    for (const e of readdirSync(join(root!, rel_dir), { withFileTypes: true })) {
      const r = `${rel_dir}/${e.name}`;
      if (e.isDirectory()) {
        if (e.name !== "tests" && e.name !== "rustc_codegen_cranelift" && e.name !== "rustc_codegen_gcc") walk(r);
      } else if (e.name.endsWith(".rs")) files.push(r);
    }
  };
  if (root !== undefined) {
    walk("compiler");
    walk("src/tools/miri/src");
  }
  for (const path of files) {
    const src = readFileSync(join(root!, path), "utf8");
    if (!src.includes("#[track_caller]") || !/\btrait\s/.test(src)) continue;
    const f = up_file(path)!;
    let trait: { name: string; indent: number } | undefined;
    for (let i = 0; i < f.masked_lines.length; i++) {
      const l = f.masked_lines[i]!;
      const tm = /^(\s*)(?:pub(?:\([^)]*\))?\s+)?(?:unsafe\s+)?trait\s+(\w+)/.exec(l);
      if (tm !== null) trait = { name: tm[2]!, indent: tm[1]!.length };
      else if (trait !== undefined && l.trim().startsWith("}") && indent(l) === trait.indent) trait = undefined;
      const fm = /\bfn\s+(\w+)/.exec(l);
      if (fm === null || trait === undefined || !has_track_caller_attr(f, i + 1)) continue;
      let set = trait_tc.get(trait.name);
      if (set === undefined) trait_tc.set(trait.name, (set = new Set()));
      set.add(fm[1]!);
    }
  }
  return trait_tc;
}

function trait_track_caller_methods(): Map<string, Set<string>> {
  return (trait_tc_index ??= build_trait_tc_index());
}


// ---- lexing helpers ----------------------------------------------------------------------------------

function line_starts(src: string): number[] {
  const out = [0];
  for (let i = 0; i < src.length; i++) if (src.charCodeAt(i) === 10) out.push(i + 1);
  return out;
}

function indent(l: string): number {
  return l.length - l.trimStart().length;
}

function braces_balanced(l: string): boolean {
  let d = 0;
  for (const c of l) {
    if (c === "{") d++;
    else if (c === "}") d--;
  }
  return d === 0;
}

function escape_re(s: string): string {
  return s.replace(/[$]/g, "\\$");
}

/**
 * The part of the item at `at` that holds code: a `static`'s or `const`'s whole value, up to its `;`; else its `{ .. }` body, or `undefined`
 * if it has none (`fn f();`). A `{` in the header's brackets is no body, as a const argument is not (`[u8; { 1 }]`, `Foo<{ 1 }>`).
 * Angle brackets count only outside the others, as `1 << 3` has no partner, and `->` closes none.
 */
function item_span(s: string, at: number, end: number): [number, number] | undefined {
  const value = /^(?:static|const)\b/.test(s.slice(at, at + 7));
  let depth = 0;
  let angle = 0;
  for (let i = at; i < end; i++) {
    const c = s[i]!;
    if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth--;
    else if (depth === 0 && c === "<") angle++;
    else if (depth === 0 && c === ">" && s[i - 1] !== "-" && s[i - 1] !== "=") angle--;
    else if (c === ";" && depth === 0) return value ? [at, i] : undefined;
    else if (c === "{") {
      if (!value && depth === 0 && angle === 0) return [i, match_close(s, i)];
      i = match_close(s, i) - 1;
    }
  }
  return undefined;
}

/** Index just past the bracket matching the one at `open` (masked text). */
function match_close(s: string, open: number): number {
  const o = s[open]!;
  const c = o === "(" ? ")" : o === "[" ? "]" : "}";
  let d = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === o) d++;
    else if (s[i] === c) {
      d--;
      if (d === 0) return i + 1;
    }
  }
  return s.length;
}

/** End of an arrow function's expression body starting at `i`. */
function expr_end(s: string, i: number, limit: number): number {
  let d = 0;
  for (; i < limit; i++) {
    const c = s[i]!;
    if (c === "(" || c === "[" || c === "{") d++;
    else if (c === ")" || c === "]" || c === "}") {
      if (d === 0) return i;
      d--;
    } else if ((c === "," || c === ";") && d === 0) return i;
  }
  return limit;
}

/** Blanks out comments and string/template literal text (newlines kept, so offsets are unchanged). */
function mask_ts(src: string): string {
  const out = src.split("");
  const blank = (a: number, b: number) => {
    for (let k = a; k < b; k++) if (out[k] !== "\n") out[k] = " ";
  };
  const stack: number[] = []; // brace depths of open `${` template substitutions
  let depth = 0;
  let i = 0;
  const n = src.length;
  const template = (from: number): number => {
    // scans template text from `from` (just after "`" or "}"), returns index after the closing "`" or
    // after "${" (entering a substitution)
    let k = from;
    for (; k < n; k++) {
      if (src[k] === "\\") {
        k++;
        continue;
      }
      if (src[k] === "`") {
        blank(from, k);
        return k + 1;
      }
      if (src[k] === "$" && src[k + 1] === "{") {
        blank(from, k);
        stack.push(depth);
        depth++;
        return k + 2;
      }
    }
    blank(from, n);
    return n;
  };
  while (i < n) {
    const c = src[i]!;
    if (c === "/" && src[i + 1] === "/") {
      const e = src.indexOf("\n", i);
      const end = e < 0 ? n : e;
      blank(i, end);
      i = end;
    } else if (c === "/" && src[i + 1] === "*") {
      const e = src.indexOf("*/", i + 2);
      const end = e < 0 ? n : e + 2;
      blank(i, end);
      i = end;
    } else if (c === '"' || c === "'") {
      let k = i + 1;
      while (k < n && src[k] !== c && src[k] !== "\n") k += src[k] === "\\" ? 2 : 1;
      blank(i + 1, k);
      i = k + 1;
    } else if (c === "`") {
      i = template(i + 1);
    } else if (c === "{") {
      depth++;
      i++;
    } else if (c === "}") {
      depth--;
      if (stack.length > 0 && depth === stack[stack.length - 1]) {
        stack.pop();
        i = template(i + 1);
      } else i++;
    } else i++;
  }
  return out.join("");
}

/** Blanks out Rust comments and string/char literal text (newlines kept). */
function mask_rust(src: string, literals: number[]): string {
  const out = src.split("");
  const blank = (a: number, b: number) => {
    for (let k = a; k < b; k++) if (out[k] !== "\n") out[k] = " ";
  };
  const n = src.length;
  let i = 0;
  while (i < n) {
    const c = src[i]!;
    if (c === "/" && src[i + 1] === "/") {
      const e = src.indexOf("\n", i);
      const end = e < 0 ? n : e;
      blank(i, end);
      i = end;
    } else if (c === "/" && src[i + 1] === "*") {
      let d = 0;
      let k = i;
      for (; k < n; k++) {
        if (src[k] === "/" && src[k + 1] === "*") {
          d++;
          k++;
        } else if (src[k] === "*" && src[k + 1] === "/") {
          d--;
          k++;
          if (d === 0) {
            k++;
            break;
          }
        }
      }
      blank(i, k);
      i = k;
    } else if ((c === "r" || ((c === "b" || c === "c") && src[i + 1] === "r")) && !/\w/.test(src[i - 1] ?? "")) {
      const m = /^(?:[bc]?r)(#*)"/.exec(src.slice(i, i + 300));
      if (m === null) {
        i++;
        continue;
      }
      const close = `"${m[1]}`;
      const e = src.indexOf(close, i + m[0].length);
      const end = e < 0 ? n : e + close.length;
      literals.push(i);
      blank(i, end);
      i = end;
    } else if (c === '"') {
      let k = i + 1;
      while (k < n && src[k] !== '"') k += src[k] === "\\" ? 2 : 1;
      // `b"..."` and `c"..."` lexed as an ident plus a string: the `"` is the start either way.
      literals.push(i);
      blank(i, k + 1);
      i = k + 1;
    } else if (c === "'") {
      if (src[i + 1] === "\\") {
        const e = src.indexOf("'", i + 3);
        const end = e < 0 ? n : e + 1;
        blank(i, end);
        i = end;
      } else {
        const cp = src.codePointAt(i + 1);
        const w = cp !== undefined && cp > 0xffff ? 2 : 1;
        if (src[i + 1 + w] === "'") {
          blank(i, i + 2 + w);
          i += 2 + w;
        } else i++; // lifetime
      }
    } else i++;
  }
  return out.join("");
}
