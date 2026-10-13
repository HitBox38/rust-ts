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
//     same number of calls of it, and the k-th one is the upstream call site.
// Anything that does not check out (unmarked glue frames, native frames, count mismatch, a call inside a
// `macro_rules!` definition, non-ASCII before the column, ...) is `unported`, never a guess.
//
// PORT: the upstream sources are read from the pinned checkout (`$RUST_TS_DATA/rust`, `.env.local` as in
// scripts/lib/common.ts) at display time; the oracle build compiled them in.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve as resolve_path } from "node:path";

/** The oracle build's `--remap-path-prefix` target for `compiler/` sources (`/rustc-dev/<commit>`, as
 *  `CFG_VIRTUAL_RUSTC_DEV_SOURCE_BASE_DIR` in rustc_metadata/rmeta/decoder.ts). */
const VIRTUAL_RUSTC_DEV_SOURCE_BASE_DIR = "/rustc-dev/6f5da406b56c2db6607202b63daee73aa8c61297";

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
  | { kind: "owned"; owner: Owner; closure: boolean; tc: boolean };

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
  return { kind: "owned", owner, closure, tc: tc && !closure };
}

/** Whether the call at `caller`'s position calls the function of frame `callee` (by name), i.e. no frame
 *  between them was dropped by a tail call. */
function linked(caller: Frame, callee: FrameKind): string | undefined {
  const y = ident_at(ts_file(caller.file).masked_lines[caller.line - 1] ?? "", caller.col - 1);
  if (y === undefined) return `no callee at ${rel(caller.file)}:${caller.line}:${caller.col}`;
  let ok: boolean;
  if (callee.kind === "glue") ok = y === "into_diag";
  else if (callee.closure) ok = !TAIL_CALLS; // a call through a value: the name says nothing
  else if (callee.owner.kind === "derive_diagnostic") ok = y === "into_diag" || y.endsWith("_into_diag");
  else if (callee.owner.kind === "macro") ok = y === callee.owner.name;
  else {
    const n = callee.owner.name;
    ok = y === n || y === `${n}_` || y.endsWith(`_${n}`);
  }
  return ok ? undefined : `\`${y}\` at ${rel(caller.file)}:${caller.line} does not call the next frame (tail call?)`;
}

function resolve_stack(stack: string): Resolved {
  const frames = parse_stack(stack);
  // frames[0] is `capture` itself; frames[1] must be `DiagLocation::caller`.
  let g = -1;
  let prev: FrameKind | undefined;
  for (let i = 1; i < frames.length; i++) {
    const fr = frames[i];
    if (fr === undefined) return fail(`native frame #${i}`);
    const k = classify(fr);
    if (typeof k === "string") return fail(k);
    if (i === 1) {
      if (!(k.kind === "owned" && k.owner.kind === "fn" && k.owner.path === "compiler/rustc_errors/src/diagnostic.rs" && k.owner.name === "caller")) {
        return fail("capture() not called from DiagLocation::caller");
      }
    } else {
      const why = linked(fr, prev!);
      if (why !== undefined) return fail(why);
    }
    prev = k;
    if (k.kind === "glue" || k.tc) continue;
    g = i;
    break;
  }
  if (g < 0) return fail("no non-#[track_caller] caller within the captured frames");
  const fr = frames[g]!;
  const ts = ts_file(fr.file);
  const owner = ts.owner_at(fr.line)!;
  if (owner.kind !== "fn") return fail(`caller is not a ported fn (${rel(fr.file)}:${fr.line})`);
  const callee_ts = ident_at(ts.masked_lines[fr.line - 1] ?? "", fr.col - 1)!;
  const callee = callee_ts.replace(/_$/, "");

  // 3. k-th call of `callee` in G's TS body <-> k-th call in G's upstream body.
  const ts_calls = ts.calls_in(owner, callee_ts);
  const k = ts_calls.findIndex(([l, c]) => l === fr.line && c === fr.col);
  if (k < 0) return fail(`call at ${rel(fr.file)}:${fr.line}:${fr.col} not found`);
  const up = up_file(owner.path);
  if (up === undefined) return fail(`cannot read ${owner.path}`);
  const body = up.fn_body(owner.line);
  if (body === undefined) return fail(`no fn body at ${owner.path}:${owner.line}`);
  const up_calls = up.calls_in(body, callee);
  if (up_calls.length !== ts_calls.length) {
    return fail(`\`${callee}\` called ${ts_calls.length}x in TS, ${up_calls.length}x at ${owner.path}:${owner.line}`);
  }
  const call = up_calls[k]!;
  if (call.in_macro_rules) return fail(`call inside macro_rules! at ${owner.path}`);
  const [line, col0] = up.line_col(call.pos);
  const prefix = up.lines[line - 1]!.slice(0, col0);
  // `col_display`: every char before the position is ASCII and not a tab, so it is the byte column.
  if (!/^[\x20-\x7e]*$/.test(prefix)) return fail(`non-ASCII before ${owner.path}:${line}:${col0 + 1}`);
  return { ok: true, file: `${VIRTUAL_RUSTC_DEV_SOURCE_BASE_DIR}/${owner.path}`, line, col: col0 + 1 };
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

type Owner =
  | { kind: "fn"; path: string; line: number; name: string; start: number; end: number }
  | { kind: "macro"; path: string; line: number; name: string; start: number; end: number }
  | { kind: "derive_diagnostic"; path: string; line: number; start: number; end: number };

class TsFile {
  readonly lines: string[];
  readonly masked: string;
  readonly masked_lines: string[];
  readonly line_starts: number[];
  readonly owners: Owner[] = [];

  constructor(src: string) {
    this.lines = src.split("\n");
    this.masked = mask_ts(src);
    this.masked_lines = this.masked.split("\n");
    this.line_starts = line_starts(src);
    for (let i = 0; i + 1 < this.lines.length; i++) {
      const l = this.lines[i]!;
      let m = /^\s*\/\/ rustc: (compiler\/\S+):(\d+) (\S+)\s*$/.exec(l);
      // 1-based line of the declaration: the first line after the marker that is not a comment
      let decl = i + 2;
      while (decl <= this.lines.length && /^\s*\/\//.test(this.lines[decl - 1]!)) decl++;
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
      if (l.trim() !== "" && indent(l) === ind && l.trimStart().startsWith("}")) return j;
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
  calls_in(owner: Owner, name: string): [number, number][] {
    const out: [number, number][] = [];
    const re = new RegExp(`(?<![\\w$])${escape_re(name)}(?![\\w$])`, "g");
    for (let l = owner.start; l <= owner.end; l++) {
      const text = this.masked_lines[l - 1]!;
      for (const m of text.matchAll(re)) {
        const before = text.slice(0, m.index);
        const after = text.slice(m.index + name.length);
        if (/\bfunction\s*$/.test(before)) continue;
        if (!/^\s*(<[^()]*>)?\s*\(/.test(after) && !/^\s*$/.test(after)) continue;
        if (/^\s*$/.test(after) && !/^\s*\(/.test(this.masked_lines[l] ?? "")) continue;
        if (l === owner.start && /^\s*(?:static\s+|async\s+)?$/.test(before)) continue; // the declaration itself
        out.push([l, m.index + 1]);
      }
    }
    return out;
  }
}

const ts_cache = new Map<string, TsFile>();
function ts_file(file: string): TsFile {
  let f = ts_cache.get(file);
  if (f === undefined) {
    f = new TsFile(readFileSync(file, "utf8"));
    ts_cache.set(file, f);
  }
  return f;
}

// ---- upstream sources --------------------------------------------------------------------------------

interface UpCall {
  pos: number;
  in_macro_rules: boolean;
}

class UpFile {
  readonly lines: string[];
  readonly masked: string;
  readonly masked_lines: string[];
  readonly line_starts: number[];

  constructor(readonly src: string) {
    this.lines = src.split("\n");
    this.masked = mask_rust(src);
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
      out.push({ pos, in_macro_rules: macro_rules.some(([a, b]) => at > a && at < b) });
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
function up_file(path: string): UpFile | undefined {
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
 *  over all upstream `compiler/` sources; built on first need. */
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
  if (root !== undefined) walk("compiler");
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
function mask_rust(src: string): string {
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
      blank(i, end);
      i = end;
    } else if (c === '"') {
      let k = i + 1;
      while (k < n && src[k] !== '"') k += src[k] === "\\" ? 2 : 1;
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
