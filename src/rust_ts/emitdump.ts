// Subject side of the `emit` suite: runs the JSON "diagnostic scripts" of harness/corpus/emit
// through the ported `DiagCtxt` + `AnnotateSnippetEmitter` and prints the bytes the emitter writes.
//   bun src/rust_ts/emitdump.ts <case.json>...
// Script semantics, op order and output framing must match tools/probes/emitdump/main.rs (its
// header documents the case format); this file mirrors it function by function.
//
// Wiring (TODO for the lane that lands src/rustc_errors/annotate_snippet_emitter_writer.ts):
// `make_emitter` below is the only unported step. Replace its body with the port of
//
//     AnnotateSnippetEmitter::new(dst)
//         .sm(o.source_map ? Some(sm) : None)
//         .short_message(o.short_message)
//         .ui_testing(o.ui_testing)
//         .ignored_directories_in_source_blocks(o.ignored_directories)
//         .diagnostic_width(o.diagnostic_width)
//         .macro_backtrace(o.macro_backtrace)
//         .terminal_url(o.terminal_url ? TerminalUrl::Yes : TerminalUrl::No)
//         .theme(o.theme)
//
// where `dst` is the port's `Destination` (`AutoStream<Box<dyn Write + Send>>`) over `sink`:
// `AutoStream::never(sink)` for color "never" (ANSI escapes stripped, `current_choice()` =
// `Never`) and `AutoStream::new(sink, ColorChoice::AlwaysAnsi)` for color "always" (passed
// through, `current_choice()` = `AlwaysAnsi`). Every byte the emitter writes must go to
// `sink.write(bytes)` in order. Nothing else in this file changes; until then every case is
// UNPORTED (exit 70) right after its source map is built.
import { readFileSync } from "node:fs";
import { DiagArgValue, IntoDiagArg, MultiSpan, type DiagMessage } from "../rustc_error_messages/lib.ts";
import { DiagStyledString, StringPart } from "../rustc_errors/diagnostic.ts";
import {
  type Applicability,
  Diag,
  DiagCtxt,
  type DiagCtxtFlags,
  type DiagCtxtHandle,
  type Emitter,
  ErrCode,
  ExplicitBug,
  FatalErrorMarker,
  Level,
  type StashKey,
  StashKey as StashKeyC,
  type Sublevel,
  type SuggestionStyle,
  display_ErrCode,
} from "../rustc_errors/lib.ts";
import { BytePos, type FileName, Span, type SourceFile, create_default_session_globals_then } from "../rustc_span/lib.ts";
import { FilePathMapping, SourceMap } from "../rustc_span/source_map.ts";
import { DUMMY_SP } from "../rustc_span/span_encoding.ts";
import { Panic, Unported, unported } from "../std/panic.ts";
import { Str } from "../std/str.ts";

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
type Obj = { [k: string]: Json };

/** The emitter's `Destination` target: emitter writes and query lines land in one ordered buffer. */
class Shared {
  chunks: Uint8Array[] = [];
  write(buf: Uint8Array): void {
    this.chunks.push(buf.slice());
  }
  bytes(): Uint8Array {
    return Buffer.concat(this.chunks);
  }
}

interface EmitterOptions {
  source_map: boolean;
  short_message: boolean;
  ui_testing: boolean;
  ignored_directories: string[];
  diagnostic_width: number | undefined;
  macro_backtrace: boolean;
  terminal_url: boolean;
  theme: "Ascii" | "Unicode";
  color: "never" | "always";
}

/** `AnnotateSnippetEmitter::new(dst).sm(..)...theme(..)`; see the wiring note at the top. */
function make_emitter(_sink: Shared, _o: EmitterOptions, _sm: SourceMap): Emitter {
  return unported("rustc_errors::annotate_snippet_emitter_writer::AnnotateSnippetEmitter::new");
}

const encoder = new TextEncoder();

class Ctx {
  files: SourceFile[] = [];
  constructor(
    readonly path: string,
    readonly buf: Shared,
  ) {}
  fail(what: string): never {
    throw new Panic(`${this.path}: ${what}`);
  }
  print(line: string): void {
    this.buf.write(encoder.encode(line + "\n"));
  }
}

const is_obj = (v: Json | undefined): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

function obj(cx: Ctx, v: Json | undefined, what: string, allowed: string[]): Obj {
  if (!is_obj(v)) return cx.fail(`${what}: expected an object`);
  for (const k of Object.keys(v)) if (!allowed.includes(k)) cx.fail(`${what}: unknown key ${JSON.stringify(k)}`);
  return v;
}

function get_bool(cx: Ctx, o: Obj, k: string, default_: boolean): boolean {
  const v = o[k];
  if (v === undefined) return default_;
  if (typeof v === "boolean") return v;
  return cx.fail(`${k}: expected a bool`);
}

function get_str(cx: Ctx, o: Obj, k: string): string {
  const v = o[k];
  if (typeof v === "string") return v;
  return cx.fail(`${k}: expected a string`);
}

function get_arr(cx: Ctx, v: Json | undefined, what: string): Json[] {
  if (Array.isArray(v)) return v;
  return cx.fail(`${what}: expected an array`);
}

function get_usize(cx: Ctx, v: Json | undefined, what: string): number {
  if (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 0xffff_ffff) return v;
  return cx.fail(`${what}: expected a non-negative integer`);
}

function required(cx: Ctx, o: Obj, k: string, what: string): Json {
  const v = o[k];
  return v === undefined ? cx.fail(what) : v;
}

function main(): void {
  const paths = process.argv.slice(2);
  const out: Uint8Array[] = [];
  const flush = () => {
    process.stdout.write(Buffer.concat(out));
    out.length = 0;
  };
  try {
    for (const path of paths) {
      const text = readFileSync(path, "utf8");
      const kase = JSON.parse(text) as Json;
      out.push(encoder.encode(`file: ${path}\n`));
      const bytes = create_default_session_globals_then(() => run_case(path, kase));
      out.push(bytes);
      if (bytes.length !== 0 && bytes[bytes.length - 1] !== 0x0a) out.push(encoder.encode("\n= no newline at end of output\n"));
    }
    flush();
  } catch (e) {
    // Same exit-code contract as src/rust_ts/main.ts: 70 = reached unported code, 101 = ICE.
    flush();
    if (e instanceof Unported) {
      process.stderr.write(`rust-ts: unported: ${e.what}\n`);
      process.exitCode = 70;
    } else {
      const msg = e instanceof Panic ? e.message : String(e);
      process.stderr.write(`rust-ts: internal compiler error: ${msg}\n${e instanceof Error ? e.stack : ""}\n`);
      process.exitCode = 101;
    }
  }
}

function run_case(path: string, kase_: Json): Uint8Array {
  const buf = new Shared();
  const cx = new Ctx(path, buf);
  const kase = obj(cx, kase_, "case", ["files", "emitter", "flags", "ops"]);

  // Source map and files.
  const sm = SourceMap.new(FilePathMapping.empty());
  for (const f_ of kase.files === undefined ? [] : get_arr(cx, kase.files, "files")) {
    const f = obj(cx, f_, "file", ["name", "custom", "src"]);
    let name: FileName;
    if (typeof f.name === "string" && f.custom === undefined) {
      name = { $: "Real", _0: sm.path_mapping().to_real_filename(sm.working_dir(), f.name) };
    } else if (f.name === undefined && typeof f.custom === "string") {
      name = { $: "Custom", _0: f.custom };
    } else return cx.fail("file: exactly one of name/custom");
    const src = get_str(cx, f, "src");
    cx.files.push(sm.new_source_file(name, Str.from(src)));
  }

  // Emitter.
  const e: Obj =
    kase.emitter !== undefined
      ? obj(cx, kase.emitter, "emitter", [
          "source_map",
          "short_message",
          "ui_testing",
          "diagnostic_width",
          "macro_backtrace",
          "terminal_url",
          "theme",
          "color",
          "ignored_directories",
        ])
      : {};
  const diagnostic_width = e.diagnostic_width === undefined || e.diagnostic_width === null ? undefined : get_usize(cx, e.diagnostic_width, "diagnostic_width");
  const ui_testing = get_bool(cx, e, "ui_testing", false);
  if (diagnostic_width === undefined && !ui_testing) cx.fail("emitter: set ui_testing or diagnostic_width (termize width is host-dependent)");
  let color: EmitterOptions["color"];
  if (e.color === undefined || e.color === "never") color = "never";
  else if (e.color === "always") color = "always";
  else return cx.fail("color: never | always");
  let theme: EmitterOptions["theme"];
  if (e.theme === undefined || e.theme === "ascii") theme = "Ascii";
  else if (e.theme === "unicode") theme = "Unicode";
  else return cx.fail("theme: ascii | unicode");
  const ignored =
    e.ignored_directories === undefined
      ? []
      : get_arr(cx, e.ignored_directories, "ignored_directories").map((d) => (typeof d === "string" ? d : cx.fail("ignored_directories: strings")));
  const emitter = make_emitter(
    buf,
    {
      source_map: get_bool(cx, e, "source_map", true),
      short_message: get_bool(cx, e, "short_message", false),
      ui_testing,
      ignored_directories: ignored,
      diagnostic_width,
      macro_backtrace: get_bool(cx, e, "macro_backtrace", false),
      terminal_url: get_bool(cx, e, "terminal_url", false),
      theme,
      color,
    },
    sm,
  );

  // DiagCtxt.
  const fl: Obj =
    kase.flags !== undefined
      ? obj(cx, kase.flags, "flags", ["can_emit_warnings", "deduplicate_diagnostics", "macro_backtrace", "eagerly_emit_delayed_bugs"])
      : {};
  const flags: DiagCtxtFlags = {
    can_emit_warnings: get_bool(cx, fl, "can_emit_warnings", true),
    treat_err_as_bug: undefined,
    eagerly_emit_delayed_bugs: get_bool(cx, fl, "eagerly_emit_delayed_bugs", false),
    macro_backtrace: get_bool(cx, fl, "macro_backtrace", false),
    deduplicate_diagnostics: get_bool(cx, fl, "deduplicate_diagnostics", true),
    track_diagnostics: false,
  };
  const dcx_owner = DiagCtxt.new(emitter).with_flags(flags);
  const dcx = dcx_owner.handle();

  for (const op of kase.ops === undefined ? [] : get_arr(cx, kase.ops, "ops")) run_op(cx, dcx, op);
  // `drop(dcx_owner)`: `impl Drop for DiagCtxtInner` (emits stashed diagnostics, flushes delayed bugs).
  dcx_owner.inner.drop();
  return buf.bytes();
}

/**
 * Runs `f`, turning the two unwinds rustc_errors raises itself into a printed line:
 * `FatalError.raise()` (`= FatalError`) and `panic_any(ExplicitBug)` (`= ExplicitBug`).
 */
function catching(cx: Ctx, f: () => void): void {
  try {
    f();
  } catch (e) {
    if (e instanceof FatalErrorMarker) cx.print("= FatalError");
    else if (e instanceof ExplicitBug) cx.print("= ExplicitBug");
    else throw e;
  }
}

function run_op(cx: Ctx, dcx: DiagCtxtHandle, op: Json): void {
  const kind = is_obj(op) && typeof op.op === "string" ? op.op : cx.fail('op: missing "op"');
  switch (kind) {
    case "diag": {
      const o = obj(cx, op, "diag", ["op", "level", "msg", "args", "code", "span", "labels", "span_labels", "children", "suggestions", "primary_message", "then"]);
      const lvl = level(cx, get_str(cx, o, "level"));
      const msg = message(cx, required(cx, o, "msg", "diag: missing msg"));
      const diag = Diag.new(dcx, lvl, msg);
      build_diag(cx, diag, o);
      const then = o.then;
      if (then === undefined || then === "emit") catching(cx, () => diag.emit());
      else if (then === "cancel") diag.cancel();
      else if (then === "delay_as_bug") diag.delay_as_bug();
      else if (is_obj(then)) {
        const t = obj(cx, then, "then", ["stash", "span"]);
        const key = stash_key(cx, get_str(cx, t, "stash"));
        const sp = span(cx, required(cx, t, "span", "stash: span"));
        const r = diag.stash(sp, key);
        cx.print(`= stash -> ${r !== undefined ? "some" : "none"}`);
      } else cx.fail("then: emit | cancel | delay_as_bug | {stash, span}");
      return;
    }
    case "steal_non_err": {
      const o = obj(cx, op, "steal_non_err", ["op", "span", "key", "then"]);
      const sp = span(cx, required(cx, o, "span", "steal: span"));
      const key = stash_key(cx, get_str(cx, o, "key"));
      const r = dcx.steal_non_err(sp, key);
      cx.print(`= steal_non_err -> ${r !== undefined ? "some" : "none"}`);
      if (r !== undefined) {
        if (o.then === undefined || o.then === "emit") catching(cx, () => r.emit());
        else if (o.then === "cancel") r.cancel();
        else cx.fail("then: emit | cancel");
      }
      return;
    }
    case "try_steal_modify_and_emit_err": {
      const o = obj(cx, op, "try_steal_modify_and_emit_err", ["op", "span", "key", "note"]);
      const sp = span(cx, required(cx, o, "span", "steal: span"));
      const key = stash_key(cx, get_str(cx, o, "key"));
      const note = message(cx, required(cx, o, "note", "steal: note"));
      const r = dcx.try_steal_modify_and_emit_err(sp, key, (err) => {
        err.note(note);
      });
      cx.print(`= try_steal_modify_and_emit_err -> ${r !== undefined ? "some" : "none"}`);
      return;
    }
    case "emit_stashed":
      obj(cx, op, "emit_stashed", ["op"]);
      dcx.emit_stashed_diagnostics();
      return;
    case "print_error_count":
      obj(cx, op, "print_error_count", ["op"]);
      dcx.print_error_count();
      return;
    case "reset_err_count":
      obj(cx, op, "reset_err_count", ["op"]);
      dcx.reset_err_count();
      return;
    case "abort_if_errors":
      obj(cx, op, "abort_if_errors", ["op"]);
      catching(cx, () => dcx.abort_if_errors());
      return;
    case "query":
      obj(cx, op, "query", ["op"]);
      cx.print(
        `= err_count ${dcx.err_count()} has_errors ${dcx.has_errors() !== undefined} has_errors_excluding_lint_errors ${dcx.has_errors_excluding_lint_errors() !== undefined}`,
      );
      return;
    case "must_teach": {
      const o = obj(cx, op, "must_teach", ["op", "code"]);
      const code = err_code(cx, get_str(cx, o, "code"));
      cx.print(`= must_teach ${display_ErrCode(code)} ${dcx.must_teach(code)}`);
      return;
    }
    default:
      cx.fail(`unknown op ${JSON.stringify(kind)}`);
  }
}

function build_diag(cx: Ctx, diag: Diag, o: Obj): void {
  if (o.args !== undefined) {
    for (const a of get_arr(cx, o.args, "args")) {
      const pair = get_arr(cx, a, "arg");
      if (pair.length !== 2) cx.fail("arg: [name, value]");
      const name = typeof pair[0] === "string" ? pair[0] : cx.fail("arg name: string");
      diag.arg(name, IntoDiagArg.DiagArgValue(arg_value(cx, pair[1]!)));
    }
  }
  if (o.code !== undefined) diag.code(err_code(cx, typeof o.code === "string" ? o.code : cx.fail("code: string")));
  if (o.span !== undefined) diag.span(MultiSpan.from_spans(get_arr(cx, o.span, "span").map((s) => span(cx, s))));
  if (o.labels !== undefined) {
    for (const l of get_arr(cx, o.labels, "labels")) {
      const [sp, m] = span_msg(cx, l);
      diag.span_label(sp, m);
    }
  }
  if (o.span_labels !== undefined) {
    const sl = obj(cx, o.span_labels, "span_labels", ["spans", "label"]);
    const spans = get_arr(cx, required(cx, sl, "spans", "span_labels: spans"), "spans").map((s) => span(cx, s));
    diag.span_labels(spans, get_str(cx, sl, "label"));
  }
  if (o.children !== undefined) for (const c of get_arr(cx, o.children, "children")) child(cx, diag, c);
  if (o.suggestions !== undefined) for (const s of get_arr(cx, o.suggestions, "suggestions")) suggestion(cx, diag, s);
  if (o.primary_message !== undefined) diag.primary_message(message(cx, o.primary_message));
}

function child(cx: Ctx, diag: Diag, c: Json): void {
  const kind = is_obj(c) && typeof c.kind === "string" ? c.kind : cx.fail("child: kind");
  switch (kind) {
    case "note":
    case "note_once":
    case "warn":
    case "help":
    case "help_once": {
      const o = obj(cx, c, "child", ["kind", "msg", "span"]);
      const m = message(cx, required(cx, o, "msg", "child: msg"));
      const s = o.span;
      if (kind === "note") s === undefined ? diag.note(m) : diag.span_note(multispan(cx, s), m);
      else if (kind === "note_once") s === undefined ? diag.note_once(m) : diag.span_note_once(multispan(cx, s), m);
      else if (kind === "warn") s === undefined ? diag.warn(m) : diag.span_warn(multispan(cx, s), m);
      else if (kind === "help") s === undefined ? diag.help(m) : diag.span_help(multispan(cx, s), m);
      else if (s === undefined) diag.help_once(m);
      else cx.fail(`child ${kind}: no span form`);
      return;
    }
    case "sub": {
      const o = obj(cx, c, "child", ["kind", "level", "msg", "span"]);
      const l = get_str(cx, o, "level");
      const levels: Sublevel[] = ["Error", "Warning", "Note", "OnceNote", "Help", "OnceHelp"];
      const lvl = levels.find((x) => x === l) ?? cx.fail(`bad Sublevel ${JSON.stringify(l)}`);
      const m = message(cx, required(cx, o, "msg", "sub: msg"));
      const ms = o.span !== undefined ? multispan(cx, o.span) : MultiSpan.new();
      diag.sub(lvl, m, ms);
      return;
    }
    case "highlighted_note":
    case "highlighted_help": {
      const o = obj(cx, c, "child", ["kind", "parts", "span"]);
      const parts = string_parts(cx, required(cx, o, "parts", "parts"));
      if (kind === "highlighted_note") o.span === undefined ? diag.highlighted_note(parts) : diag.highlighted_span_note(multispan(cx, o.span), parts);
      else o.span === undefined ? diag.highlighted_help(parts) : diag.highlighted_span_help(multispan(cx, o.span), parts);
      return;
    }
    case "expected_found": {
      const o = obj(cx, c, "child", ["kind", "expected_label", "expected", "found_label", "found"]);
      const styled = (k: string): DiagStyledString => {
        const s = DiagStyledString.new();
        for (const [t, h] of string_parts_raw(cx, required(cx, o, k, k))) s.push(t, h);
        return s;
      };
      diag.note_expected_found(get_str(cx, o, "expected_label"), styled("expected"), get_str(cx, o, "found_label"), styled("found"));
      return;
    }
    default:
      cx.fail(`unknown child kind ${JSON.stringify(kind)}`);
  }
}

function suggestion(cx: Ctx, diag: Diag, s: Json): void {
  const kind = is_obj(s) && typeof s.kind === "string" ? s.kind : cx.fail("suggestion: kind");
  const o = obj(cx, s, "suggestion", ["kind", "msg", "applicability", "span", "code", "codes", "style", "parts", "alternatives"]);
  const m = message(cx, required(cx, o, "msg", "suggestion: msg"));
  const a = get_str(cx, o, "applicability");
  const apps: Applicability[] = ["MachineApplicable", "MaybeIncorrect", "HasPlaceholders", "Unspecified"];
  const app = apps.find((x) => x === a) ?? cx.fail(`bad Applicability ${JSON.stringify(a)}`);
  const sp = () => span(cx, required(cx, o, "span", "suggestion: span"));
  const code = () => get_str(cx, o, "code");
  const codes = () => get_arr(cx, required(cx, o, "codes", "codes"), "codes").map((c) => (typeof c === "string" ? c : cx.fail("codes: strings")));
  const style = (): SuggestionStyle => {
    const st = get_str(cx, o, "style");
    const styles: SuggestionStyle[] = ["HideCodeInline", "HideCodeAlways", "CompletelyHidden", "ShowCode", "ShowAlways"];
    return styles.find((x) => x === st) ?? cx.fail(`bad SuggestionStyle ${JSON.stringify(st)}`);
  };
  const parts = (v: Json): [Span, string][] =>
    get_arr(cx, v, "parts").map((p) => {
      const pair = get_arr(cx, p, "part");
      if (pair.length !== 2) cx.fail("part: [span, code]");
      return [span(cx, pair[0]!), typeof pair[1] === "string" ? pair[1] : cx.fail("part code")];
    });
  switch (kind) {
    case "span_suggestion":
      diag.span_suggestion(sp(), m, code(), app);
      return;
    case "span_suggestion_verbose":
      diag.span_suggestion_verbose(sp(), m, code(), app);
      return;
    case "span_suggestion_short":
      diag.span_suggestion_short(sp(), m, code(), app);
      return;
    case "span_suggestion_hidden":
      diag.span_suggestion_hidden(sp(), m, code(), app);
      return;
    case "tool_only_span_suggestion":
      diag.tool_only_span_suggestion(sp(), m, code(), app);
      return;
    case "span_suggestion_with_style":
      diag.span_suggestion_with_style(sp(), m, code(), app, style());
      return;
    case "span_suggestions":
      diag.span_suggestions(sp(), m, codes(), app);
      return;
    case "span_suggestions_with_style":
      diag.span_suggestions_with_style(sp(), m, codes(), app, style());
      return;
    case "multipart_suggestion":
      diag.multipart_suggestion(m, parts(required(cx, o, "parts", "parts")), app);
      return;
    case "tool_only_multipart_suggestion":
      diag.tool_only_multipart_suggestion(m, parts(required(cx, o, "parts", "parts")), app);
      return;
    case "multipart_suggestion_with_style":
      diag.multipart_suggestion_with_style(m, parts(required(cx, o, "parts", "parts")), app, style());
      return;
    case "multipart_suggestions":
      diag.multipart_suggestions(m, get_arr(cx, required(cx, o, "alternatives", "alternatives"), "alternatives").map(parts), app);
      return;
    default:
      cx.fail(`unknown suggestion kind ${JSON.stringify(kind)}`);
  }
}

function level(cx: Ctx, s: string): Level {
  switch (s) {
    case "bug":
      return Level.Bug;
    case "fatal":
      return Level.Fatal;
    case "error":
      return Level.Error;
    case "delayed_bug":
      return Level.DelayedBug;
    case "warning":
      return { $: "Warning", _0: undefined };
    case "force_warning":
      return { $: "Warning", _0: { $: "Forced", lint_id: undefined } };
    case "note":
      return Level.Note;
    case "help":
      return Level.Help;
    case "failure_note":
      return Level.FailureNote;
    default:
      return cx.fail(`bad level ${JSON.stringify(s)}`);
  }
}

function stash_key(cx: Ctx, s: string): StashKey {
  return (Object.values(StashKeyC) as string[]).includes(s) ? (s as StashKey) : cx.fail(`bad StashKey ${JSON.stringify(s)}`);
}

function err_code(cx: Ctx, s: string): ErrCode {
  const d = s.startsWith("E") ? s.slice(1) : undefined;
  if (d === undefined || !/^[0-9]{4}$/.test(d)) return cx.fail(`bad error code ${JSON.stringify(s)}`);
  return ErrCode.from_u32(Number(d));
}

function message(cx: Ctx, v: Json): DiagMessage {
  if (typeof v === "string") return { $: "Str", _0: v };
  if (is_obj(v) && Object.keys(v).length === 1 && "inline" in v) {
    const s = v.inline;
    return typeof s === "string" ? { $: "Inline", _0: s } : cx.fail("inline: string");
  }
  return cx.fail("msg: string | {inline: string}");
}

function arg_value(cx: Ctx, v: Json): DiagArgValue {
  if (typeof v === "string") return { $: "Str", _0: v };
  if (typeof v === "number") {
    if (Number.isInteger(v) && v >= -0x8000_0000 && v <= 0x7fff_ffff) return { $: "Number", _0: v };
    return cx.fail("arg number: i32");
  }
  if (Array.isArray(v)) return { $: "StrListSepByAnd", _0: v.map((s) => (typeof s === "string" ? s : cx.fail("arg list: strings"))) };
  return cx.fail("arg value: string | i32 | [string]");
}

function span_msg(cx: Ctx, v: Json): [Span, DiagMessage] {
  const pair = get_arr(cx, v, "label");
  if (pair.length !== 2) cx.fail("label: [span, msg]");
  return [span(cx, pair[0]!), message(cx, pair[1]!)];
}

function multispan(cx: Ctx, v: Json): MultiSpan {
  if (Array.isArray(v)) return MultiSpan.from_spans(v.map((s) => span(cx, s)));
  if (is_obj(v)) {
    const o = obj(cx, v, "multispan", ["primary", "labels"]);
    const primary = o.primary !== undefined ? get_arr(cx, o.primary, "primary").map((s) => span(cx, s)) : [];
    const ms = MultiSpan.from_spans(primary);
    if (o.labels !== undefined) {
      for (const l of get_arr(cx, o.labels, "labels")) {
        const [sp, m] = span_msg(cx, l);
        ms.push_span_label(sp, m);
      }
    }
    return ms;
  }
  return cx.fail("multispan: [span] | {primary, labels}");
}

function string_parts_raw(cx: Ctx, v: Json): [string, boolean][] {
  return get_arr(cx, v, "parts").map((p) => {
    const pair = get_arr(cx, p, "part");
    if (pair.length === 2 && typeof pair[0] === "string" && typeof pair[1] === "boolean") return [pair[0], pair[1]];
    return cx.fail("part: [text, highlighted]");
  });
}

function string_parts(cx: Ctx, v: Json): StringPart[] {
  return string_parts_raw(cx, v).map(([t, h]) => (h ? StringPart.highlighted(t) : StringPart.normal(t)));
}

function span(cx: Ctx, v: Json): Span {
  let fi: number;
  let lo: number;
  let hi: number;
  if (v === "dummy") return DUMMY_SP;
  else if (Array.isArray(v) && v.length === 3) {
    fi = get_usize(cx, v[0], "span file");
    lo = get_usize(cx, v[1], "span lo");
    hi = get_usize(cx, v[2], "span hi");
  } else if (is_obj(v)) {
    const o = obj(cx, v, "span", ["file", "find", "nth", "len"]);
    fi = get_usize(cx, required(cx, o, "file", "span: file"), "span file");
    const find = get_str(cx, o, "find");
    const needle = encoder.encode(find);
    const nth = o.nth !== undefined ? get_usize(cx, o.nth, "nth") : 0;
    const hay = file_src(cx, fi);
    let found: number | undefined;
    let seen = 0;
    if (needle.length !== 0 && needle.length <= hay.length) {
      outer: for (let i = 0; i <= hay.length - needle.length; i++) {
        for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
        if (seen === nth) {
          found = i;
          break;
        }
        seen += 1;
      }
    }
    if (found === undefined) return cx.fail(`span: ${JSON.stringify(find)} #${nth} not found`);
    lo = found;
    hi = lo + (o.len !== undefined ? get_usize(cx, o.len, "len") : needle.length);
  } else return cx.fail('span: "dummy" | [file, lo, hi] | {file, find, nth?, len?}');
  const src = file_src(cx, fi);
  const boundary = (i: number) => i === src.length || (i < src.length && (src[i]! & 0xc0) !== 0x80);
  if (!(lo <= hi && hi <= src.length && boundary(lo) && boundary(hi))) cx.fail(`span [${fi}, ${lo}, ${hi}] out of range or not on a char boundary`);
  const start = BytePos.to_u32(cx.files[fi]!.start_pos);
  return Span.with_root_ctxt(BytePos.from_u32(start + lo), BytePos.from_u32(start + hi));
}

/** The bytes of a file's normalized source (`SourceFile::src`). */
function file_src(cx: Ctx, fi: number): Uint8Array {
  const f = cx.files[fi] ?? cx.fail(`span: no file ${fi}`);
  const s = f.src ?? cx.fail("span: file has no src");
  return s.b.subarray(s.lo, s.hi);
}

main();
