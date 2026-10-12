// Scenario tests for the human emitter (emitter.rs + annotate_snippet_emitter_writer.rs).
//
// Every expectation is the real output of the pinned nightly rustc (the oracle). Each test cites
// the program and command; the programs live in the test as `SRC_*`. The diagnostics are
// recreated by hand through the port with the same spans, messages, labels, children and
// suggestions that rustc builds for them, then emitted through `AnnotateSnippetEmitter` into a
// byte buffer, followed by `print_error_count` (the "aborting due to ..." summary).
//
// Commands (run in a scratch dir, `--emit=metadata --out-dir out` only avoids writing a binary):
//   rustc +nightly --error-format=human -Zui-testing --edition 2021 --emit=metadata --out-dir out <file>
//   rustc +nightly --error-format=human --edition 2021 --emit=metadata --out-dir out <file>       ("plain")
//   rustc +nightly --error-format=short --edition 2021 --emit=metadata --out-dir out <file>       ("short")
//   rustc +nightly --error-format=human -Zui-testing --color=always ... <file>                   ("color")
import { expect, test } from "bun:test";
import { AutoStream, ColorChoice } from "../vendor/anstream/lib.ts";
import { VecU8, dyn_write } from "../vendor/anstream/stream.ts";
import { BytePos, type FileName, type SourceFile, Span, create_default_session_globals_then } from "../rustc_span/lib.ts";
import { FilePathMapping, SourceMap } from "../rustc_span/source_map.ts";
import { Str } from "../std/str.ts";
import { AnnotateSnippetEmitter } from "./annotate_snippet_emitter_writer.ts";
import {
  ColorConfig,
  ConfusionType,
  Emitter,
  OUTPUT_REPLACEMENTS,
  type Destination,
  detect_confusion_type,
  get_stderr_color_choice,
  normalize_whitespace,
} from "./emitter.ts";
import { stderr } from "../vendor/anstream/stream.ts";
import {
  Applicability,
  DiagCtxt,
  type DiagCtxtHandle,
  DiagCtxtFlags_default,
  DiagStyledString,
  E0061,
  E0308,
  E0425,
  MultiSpan,
} from "./lib.ts";
import { TimingRecord, TimingSectionHandler } from "./timings.ts";

const test_ = (name: string, f: () => void): void => {
  test(name, () => create_default_session_globals_then(f));
};

interface Opts {
  ui_testing?: boolean;
  short_message?: boolean;
  color?: ColorChoice;
}

/** A source map holding `files`, a `DiagCtxt` whose emitter writes to a byte buffer, and span helpers. */
function setup(files: [string, string][], opts: Opts = {}) {
  const sm = SourceMap.new(FilePathMapping.empty());
  const sfs: SourceFile[] = [];
  for (const [path, src] of files) {
    const name: FileName = { $: "Real", _0: sm.path_mapping().to_real_filename(sm.working_dir(), path) };
    sfs.push(sm.new_source_file(name, Str.from(src)));
  }
  const buf = new VecU8();
  const dst: Destination = AutoStream.new(dyn_write(buf), opts.color ?? ColorChoice.Never);
  let em = AnnotateSnippetEmitter.new(dst);
  em = AnnotateSnippetEmitter.sm(em, sm);
  em = AnnotateSnippetEmitter.ui_testing(em, opts.ui_testing ?? false);
  em = AnnotateSnippetEmitter.short_message(em, opts.short_message ?? false);
  const dcx = DiagCtxt.new(em).with_flags({ ...DiagCtxtFlags_default(), can_emit_warnings: true });
  const h: DiagCtxtHandle = dcx.handle();
  /** Span of the `nth` occurrence of `needle` in file `file`. */
  const sp = (needle: string, file = 0, nth = 0): Span => {
    const src = files[file]![1];
    let at = -1;
    for (let i = 0; i <= nth; i++) at = src.indexOf(needle, at + 1);
    if (at < 0) throw new Error(`no ${needle}`);
    const base = sfs[file]!.start_pos;
    return Span.with_root_ctxt(BytePos(base + at), BytePos(base + at + needle.length));
  };
  /** Span from the start of `a` to the end of `b` (first occurrences) in file `file`. */
  const range = (a: string, b: string, file = 0): Span => Span.to(sp(a, file), sp(b, file));
  const out = (): string => new TextDecoder().decode(buf.bytes());
  return { h, sp, range, out, sm };
}

// t1.rs
const SRC_T1 = `fn main() {
    let x: i32 = "hello";
}
`;

/** E0308 as rustc builds it for t1.rs: primary label + "expected due to this". */
function emit_t1(h: DiagCtxtHandle, sp: (n: string) => Span): void {
  h.struct_span_err(sp(`"hello"`), "mismatched types")
    .with_code(E0308)
    .with_span_label(sp(`"hello"`), "expected `i32`, found `&str`")
    .with_span_label(sp("i32"), "expected due to this")
    .emit();
}

test_("single-span error with code header and secondary label (-Zui-testing)", () => {
  const { h, sp, out } = setup([["t1.rs", SRC_T1]], { ui_testing: true });
  emit_t1(h, sp);
  h.print_error_count();
  expect(out()).toBe(
    "error[E0308]: mismatched types\n" +
      "  --> t1.rs:2:18\n" +
      "   |\n" +
      'LL |     let x: i32 = "hello";\n' +
      "   |            ---   ^^^^^^^ expected `i32`, found `&str`\n" +
      "   |            |\n" +
      "   |            expected due to this\n" +
      "\n" +
      "error: aborting due to 1 previous error\n" +
      "\n" +
      "For more information about this error, try `rustc --explain E0308`.\n",
  );
});

test_("single-span error without -Zui-testing (real line numbers)", () => {
  const { h, sp, out } = setup([["t1.rs", SRC_T1]]);
  emit_t1(h, sp);
  h.print_error_count();
  expect(out()).toBe(
    "error[E0308]: mismatched types\n" +
      " --> t1.rs:2:18\n" +
      "  |\n" +
      '2 |     let x: i32 = "hello";\n' +
      "  |            ---   ^^^^^^^ expected `i32`, found `&str`\n" +
      "  |            |\n" +
      "  |            expected due to this\n" +
      "\n" +
      "error: aborting due to 1 previous error\n" +
      "\n" +
      "For more information about this error, try `rustc --explain E0308`.\n",
  );
});

test_("short message (--error-format=short): no blank lines, no --explain note", () => {
  const { h, sp, out } = setup([["t1.rs", SRC_T1]], { short_message: true });
  emit_t1(h, sp);
  h.print_error_count();
  expect(out()).toBe("t1.rs:2:18: error[E0308]: mismatched types: expected `i32`, found `&str`\nerror: aborting due to 1 previous error\n");
});

// t2.rs
const SRC_T2 = `fn main() {
    let x = 1;
}
`;

test_("warning with inline suggestion label and note child", () => {
  const { h, sp, out } = setup([["t2.rs", SRC_T2]], { ui_testing: true });
  h.struct_span_warn(sp("x"), "unused variable: `x`")
    .with_span_suggestion(sp("x"), "if this is intentional, prefix it with an underscore", "_x", Applicability.MachineApplicable)
    .with_note("`#[warn(unused_variables)]` (part of `#[warn(unused)]`) on by default")
    .emit();
  h.print_error_count();
  expect(out()).toBe(
    "warning: unused variable: `x`\n" +
      "  --> t2.rs:2:9\n" +
      "   |\n" +
      "LL |     let x = 1;\n" +
      "   |         ^ help: if this is intentional, prefix it with an underscore: `_x`\n" +
      "   |\n" +
      "   = note: `#[warn(unused_variables)]` (part of `#[warn(unused)]`) on by default\n" +
      "\n" +
      "warning: 1 warning emitted\n" +
      "\n",
  );
});

// t3.rs
const SRC_T3 = `fn f() -> i32 {
    match 1 {
        0 => 1,
        _ => "two",
    }
}
fn main() { f(); }
`;

test_("multi-line span label", () => {
  const { h, sp, range, out } = setup([["t3.rs", SRC_T3]], { ui_testing: true });
  const ms = MultiSpan.from_span(sp(`"two"`));
  ms.push_span_label(sp(`"two"`), "expected `i32`, found `&str`");
  ms.push_span_label(Span.with_hi(sp("1,"), BytePos(Span.lo(sp("1,")) + 1)), "this is found to be of type `i32`");
  ms.push_span_label(range("match", "}"), "`match` arms have incompatible types");
  h.struct_span_err(ms, "`match` arms have incompatible types").with_code(E0308).emit();
  h.print_error_count();
  expect(out()).toBe(
    "error[E0308]: `match` arms have incompatible types\n" +
      "  --> t3.rs:4:14\n" +
      "   |\n" +
      "LL | /     match 1 {\n" +
      "LL | |         0 => 1,\n" +
      "   | |              - this is found to be of type `i32`\n" +
      'LL | |         _ => "two",\n' +
      "   | |              ^^^^^ expected `i32`, found `&str`\n" +
      "LL | |     }\n" +
      "   | |_____- `match` arms have incompatible types\n" +
      "\n" +
      "error: aborting due to 1 previous error\n" +
      "\n" +
      "For more information about this error, try `rustc --explain E0308`.\n",
  );
});

// t4/main.rs + t4/m.rs
const SRC_T4_MAIN = `mod m;
fn main() {
    m::takes_one();
}
`;
const SRC_T4_M = `pub fn takes_one(a: u8) -> u8 {
    a
}
`;

function emit_t4(h: DiagCtxtHandle, sp: (n: string, file?: number, nth?: number) => Span): void {
  const ms = MultiSpan.from_span(sp("m::takes_one"));
  ms.push_span_label(sp("()", 0, 1), "argument #1 of type `u8` is missing");
  const note = MultiSpan.from_span(sp("takes_one", 1));
  note.push_span_label(sp("a: u8", 1), "");
  h.struct_span_err(ms, "this function takes 1 argument but 0 arguments were supplied")
    .with_code(E0061)
    .with_span_note(note, "function defined here")
    .with_span_suggestion_verbose(sp("()", 0, 1), "provide the argument", "(/* u8 */)", Applicability.HasPlaceholders)
    .emit();
}

test_("multiple files: span note in another file, verbose insertion suggestion (-Zui-testing)", () => {
  const { h, sp, out } = setup(
    [
      ["t4/main.rs", SRC_T4_MAIN],
      ["t4/m.rs", SRC_T4_M],
    ],
    { ui_testing: true },
  );
  emit_t4(h, sp);
  h.print_error_count();
  expect(out()).toBe(
    "error[E0061]: this function takes 1 argument but 0 arguments were supplied\n" +
      "  --> t4/main.rs:3:5\n" +
      "   |\n" +
      "LL |     m::takes_one();\n" +
      "   |     ^^^^^^^^^^^^-- argument #1 of type `u8` is missing\n" +
      "   |\n" +
      "note: function defined here\n" +
      "  --> t4/m.rs:1:8\n" +
      "   |\n" +
      "LL | pub fn takes_one(a: u8) -> u8 {\n" +
      "   |        ^^^^^^^^^ -----\n" +
      "help: provide the argument\n" +
      "   |\n" +
      "LL |     m::takes_one(/* u8 */);\n" +
      "   |                  ++++++++\n" +
      "\n" +
      "error: aborting due to 1 previous error\n" +
      "\n" +
      "For more information about this error, try `rustc --explain E0061`.\n",
  );
});

test_("multiple files without -Zui-testing", () => {
  const { h, sp, out } = setup([
    ["t4/main.rs", SRC_T4_MAIN],
    ["t4/m.rs", SRC_T4_M],
  ]);
  emit_t4(h, sp);
  h.print_error_count();
  expect(out()).toBe(
    "error[E0061]: this function takes 1 argument but 0 arguments were supplied\n" +
      " --> t4/main.rs:3:5\n" +
      "  |\n" +
      "3 |     m::takes_one();\n" +
      "  |     ^^^^^^^^^^^^-- argument #1 of type `u8` is missing\n" +
      "  |\n" +
      "note: function defined here\n" +
      " --> t4/m.rs:1:8\n" +
      "  |\n" +
      "1 | pub fn takes_one(a: u8) -> u8 {\n" +
      "  |        ^^^^^^^^^ -----\n" +
      "help: provide the argument\n" +
      "  |\n" +
      "3 |     m::takes_one(/* u8 */);\n" +
      "  |                  ++++++++\n" +
      "\n" +
      "error: aborting due to 1 previous error\n" +
      "\n" +
      "For more information about this error, try `rustc --explain E0061`.\n",
  );
});

// t8.rs
const SRC_T8 = `fn main() {
    let v: Vec<u8> = Vec::<u16>::new();
}
`;

test_("highlighted note (note_expected_found): styled parts are stripped on a plain stream", () => {
  const { h, sp, out } = setup([["t8.rs", SRC_T8]], { ui_testing: true });
  const expected = DiagStyledString.new();
  expected.push_normal("Vec<");
  expected.push_highlighted("u8");
  expected.push_normal(">");
  const found = DiagStyledString.new();
  found.push_normal("Vec<");
  found.push_highlighted("u16");
  found.push_normal(">");
  h.struct_span_err(sp("Vec::<u16>::new()"), "mismatched types")
    .with_code(E0308)
    .with_span_label(sp("Vec::<u16>::new()"), "expected `Vec<u8>`, found `Vec<u16>`")
    .with_span_label(sp("Vec<u8>"), "expected due to this")
    .note_expected_found("struct", expected, "struct", found)
    .emit();
  h.print_error_count();
  expect(out()).toBe(
    "error[E0308]: mismatched types\n" +
      "  --> t8.rs:2:22\n" +
      "   |\n" +
      "LL |     let v: Vec<u8> = Vec::<u16>::new();\n" +
      "   |            -------   ^^^^^^^^^^^^^^^^^ expected `Vec<u8>`, found `Vec<u16>`\n" +
      "   |            |\n" +
      "   |            expected due to this\n" +
      "   |\n" +
      "   = note: expected struct `Vec<u8>`\n" +
      "              found struct `Vec<u16>`\n" +
      "\n" +
      "error: aborting due to 1 previous error\n" +
      "\n" +
      "For more information about this error, try `rustc --explain E0308`.\n",
  );
});

// t9.rs
const SRC_T9 = `fn main() {
    let a = 1;
    let b = c;
}
`;

function emit_t9(h: DiagCtxtHandle, sp: (n: string, file?: number, nth?: number) => Span): void {
  h.struct_span_err(sp("c"), "cannot find value `c` in this scope")
    .with_code(E0425)
    .with_span_label(sp("c"), "not found in this scope")
    .with_span_suggestion_verbose(sp("c"), "a local variable with a similar name exists", "a", Applicability.MaybeIncorrect)
    .emit();
}

test_("suggestion with replacement (removed and added lines)", () => {
  const { h, sp, out } = setup([["t9.rs", SRC_T9]], { ui_testing: true });
  emit_t9(h, sp);
  h.print_error_count();
  expect(out()).toBe(
    "error[E0425]: cannot find value `c` in this scope\n" +
      "  --> t9.rs:3:13\n" +
      "   |\n" +
      "LL |     let b = c;\n" +
      "   |             ^ not found in this scope\n" +
      "   |\n" +
      "help: a local variable with a similar name exists\n" +
      "   |\n" +
      "LL -     let b = c;\n" +
      "LL +     let b = a;\n" +
      "   |\n" +
      "\n" +
      "error: aborting due to 1 previous error\n" +
      "\n" +
      "For more information about this error, try `rustc --explain E0425`.\n",
  );
});

test_("styled output on an AlwaysAnsi stream (--color=always)", () => {
  const { h, sp, out } = setup([["t9.rs", SRC_T9]], { ui_testing: true, color: ColorChoice.AlwaysAnsi });
  emit_t9(h, sp);
  h.print_error_count();
  const E = "\x1b";
  expect(out()).toBe(
    `${E}[1m${E}[91merror[E0425]${E}[0m${E}[1m: cannot find value \`c\` in this scope${E}[0m\n` +
      `  ${E}[1m${E}[94m--> ${E}[0mt9.rs:3:13\n` +
      `   ${E}[1m${E}[94m|${E}[0m\n` +
      `${E}[1m${E}[94mLL${E}[0m ${E}[1m${E}[94m|${E}[0m     let b = c;\n` +
      `   ${E}[1m${E}[94m|${E}[0m             ${E}[1m${E}[91m^${E}[0m ${E}[1m${E}[91mnot found in this scope${E}[0m\n` +
      `   ${E}[1m${E}[94m|${E}[0m\n` +
      `${E}[1m${E}[96mhelp${E}[0m: a local variable with a similar name exists\n` +
      `   ${E}[1m${E}[94m|${E}[0m\n` +
      `${E}[1m${E}[94mLL${E}[0m ${E}[91m- ${E}[0m    let b = ${E}[91mc${E}[0m;\n` +
      `${E}[1m${E}[94mLL${E}[0m ${E}[92m+ ${E}[0m    let b = ${E}[92ma${E}[0m;\n` +
      `   ${E}[1m${E}[94m|${E}[0m\n` +
      `\n` +
      `${E}[1m${E}[91merror${E}[0m${E}[1m: aborting due to 1 previous error${E}[0m\n` +
      `\n` +
      `${E}[1mFor more information about this error, try \`rustc --explain E0425\`.${E}[0m\n`,
  );
});

// ---- unit checks of emitter.rs helpers ----------------------------------------------------------

test("OUTPUT_REPLACEMENTS is sorted (the const assertion in normalize_whitespace)", () => {
  for (let i = 1; i < OUTPUT_REPLACEMENTS.length; i++) {
    expect(OUTPUT_REPLACEMENTS[i - 1]![0] < OUTPUT_REPLACEMENTS[i]![0]).toBe(true);
  }
  // emitter.rs:468-509: tabs are four spaces, ZWJ is dropped, control chars become pictures.
  expect(normalize_whitespace("a\tb‍c\u0007‮")).toBe("a    bc␇�");
});

test_("detect_confusion_type / ConfusionType (emitter.rs:610-713)", () => {
  const { sp, sm } = setup([["c.rs", "fn Foo0() {}\n"]]);
  expect(detect_confusion_type(sm, "foo0", sp("Foo0"))).toBe(ConfusionType.Case);
  expect(detect_confusion_type(sm, "FooO", sp("Foo0"))).toBe(ConfusionType.DigitLetter);
  expect(detect_confusion_type(sm, "fooO", sp("Foo0"))).toBe(ConfusionType.Both);
  // 'o' vs '0' is not one of the digit/letter pairs ('0'/'O' is): an "other diff".
  expect(detect_confusion_type(sm, "Fo00", sp("Foo0"))).toBe(ConfusionType.None);
  // 'o' vs 'O' differs only in case and 'o' is an ascii confusable.
  expect(detect_confusion_type(sm, "FOo0", sp("Foo0"))).toBe(ConfusionType.Case);
  expect(detect_confusion_type(sm, "Bar0", sp("Foo0"))).toBe(ConfusionType.None);
  expect(ConfusionType.combine("Case", "DigitLetter")).toBe("Both");
  expect(ConfusionType.combine("None", "Case")).toBe("Case");
  expect(ConfusionType.has_confusion("None")).toBe(false);
});

test("ColorConfig::to_color_choice / get_stderr_color_choice when stderr is not a terminal", () => {
  if (stderr().is_terminal()) return; // the harness never runs on a TTY
  expect(ColorConfig.to_color_choice("Never")).toBe(ColorChoice.Never);
  expect(ColorConfig.to_color_choice("Auto")).toBe(ColorChoice.Never);
  expect(ColorConfig.to_color_choice("Always")).toBe(ColorChoice.AlwaysAnsi);
  expect(get_stderr_color_choice("Auto", stderr())).toBe(ColorChoice.Never);
});

test_("timings: disabled handler emits nothing; enabled handler emits start/end", () => {
  const seen: string[] = [];
  class Rec extends Emitter {
    emit_diagnostic(): void {}
    source_map(): undefined {
      return undefined;
    }
    override emit_timing_section(record: TimingRecord, event: "Start" | "End"): void {
      seen.push(`${event}:${record.section}`);
    }
  }
  const dcx = DiagCtxt.new(new Rec());
  TimingSectionHandler.new(false).section_guard(dcx.handle(), "Linking").drop();
  expect(seen).toEqual([]);
  const t = TimingSectionHandler.new(true);
  const g = t.section_guard(dcx.handle(), "Codegen");
  g.drop();
  t.start_section(dcx.handle(), "Linking");
  t.end_section(dcx.handle(), "Linking");
  expect(seen).toEqual(["Start:Codegen", "End:Codegen", "Start:Linking", "End:Linking"]);
});
