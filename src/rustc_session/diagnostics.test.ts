// Scenario tests for rustc_session diagnostics.rs (feature_err / feature_warn / create_lit_error) and
// the ParseSess construction contract (parse.rs).
//
// Every expected text is the real output of the pinned nightly rustc (the oracle), byte for byte.
// Programs are the `SRC_*` constants; commands (in a scratch dir; `--emit=metadata` only avoids a binary):
//   rustc +nightly -Zui-testing --edition 2021 --emit=metadata --out-dir out <file>        ("ui")
//   rustc +nightly --edition 2021 --emit=metadata --out-dir out <file>                     ("plain")
// The diagnostics are rebuilt through the port the way rustc_ast_passes::feature_gate builds them
// (`gate_all!` -> `feature_err(..).emit()`, `soft_gate_all_legacy_dont_use!` -> `feature_warn`), or
// from the lexer's token literal through `LitKind::from_token_lit` + `report_lit_error` (rustc_parse),
// emitted by an `AnnotateSnippetEmitter` into a byte buffer, then `print_error_count`.
import { expect, test } from "bun:test";
import { ast, token } from "../rustc_ast/lib.ts";
import { AnnotateSnippetEmitter } from "../rustc_errors/annotate_snippet_emitter_writer.ts";
import { DecorateDiagCompat, Diag, DiagCtxt, DiagCtxtFlags_default } from "../rustc_errors/lib.ts";
import { UnstableFeatures } from "../rustc_feature/lib.ts";
import { UNSTABLE_SYNTAX_PRE_EXPANSION } from "../rustc_lint_defs/builtin.ts";
import { LintId } from "../rustc_lint_defs/lib.ts";
import { BytePos, type FileName, Span, create_default_session_globals_then } from "../rustc_span/lib.ts";
import { FilePathMapping, SourceMap } from "../rustc_span/source_map.ts";
import { Symbol, sym } from "../rustc_span/symbol.ts";
import { Str } from "../std/str.ts";
import { AutoStream, ColorChoice } from "../vendor/anstream/lib.ts";
import { VecU8, dyn_write } from "../vendor/anstream/stream.ts";
import { feature_err, feature_warn, report_lit_error, SuggestUpgradeCompiler } from "./diagnostics.ts";
import type { Session } from "./lib.ts";
import { GatedSpans, ParseSess, SymbolGallery } from "./parse.ts";
import { extra_compiler_flags, was_invoked_from_cargo } from "./utils.ts";

const test_ = (name: string, f: () => void): void => {
  test(name, () => create_default_session_globals_then(f));
};

/**
 * The test-side ParseSess contract: a `SourceMap` with `file`, an `AnnotateSnippetEmitter` writing
 * into a byte buffer, `DiagCtxt` -> `ParseSess::with_dcx`, and a `Session` stand-in over it.
 */
function setup(path: string, src: string, ui_testing: boolean) {
  const sm = SourceMap.new(FilePathMapping.empty());
  const name: FileName = { $: "Real", _0: sm.path_mapping().to_real_filename(sm.working_dir(), path) };
  const sf = sm.new_source_file(name, Str.from(src));
  const buf = new VecU8();
  let em = AnnotateSnippetEmitter.new(AutoStream.new(dyn_write(buf), ColorChoice.Never));
  em = AnnotateSnippetEmitter.sm(em, sm);
  em = AnnotateSnippetEmitter.ui_testing(em, ui_testing);
  const dcx = DiagCtxt.new(em).with_flags({ ...DiagCtxtFlags_default(), can_emit_warnings: true });
  const psess = ParseSess.with_dcx(dcx, sm);
  // PORT: pending session.rs: the nightly oracle has `UnstableFeatures::Allow`.
  const sess: Session = {
    dcx: () => psess.dcx(),
    unstable_features: UnstableFeatures.Allow,
    opts: { unstable_opts: { ui_testing } },
  };
  /** Span of the first occurrence of `needle`. */
  const sp = (needle: string): Span => {
    const at = src.indexOf(needle);
    if (at < 0) throw new Error(`no ${needle}`);
    return Span.with_root_ctxt(BytePos(sf.start_pos + at), BytePos(sf.start_pos + at + needle.length));
  };
  const out = (): string => new TextDecoder().decode(buf.bytes());
  return { psess, sess, sp, out };
}

// auto_trait.rs
const SRC_AUTO_TRAIT = "auto trait Foo {}\n\nfn main() {}\n";

test_("feature_err: auto traits (ui)", () => {
  const { psess, sess, sp, out } = setup("auto_trait.rs", SRC_AUTO_TRAIT, true);
  // rustc_ast_passes: gate_all!(auto_traits, "auto traits are experimental and possibly buggy") on the item span
  feature_err(sess, sym.auto_traits, sp("auto trait Foo {}"), "auto traits are experimental and possibly buggy").emit();
  psess.dcx().print_error_count();
  expect(out()).toBe(
    "error[E0658]: auto traits are experimental and possibly buggy\n" +
      "  --> auto_trait.rs:1:1\n" +
      "   |\n" +
      "LL | auto trait Foo {}\n" +
      "   | ^^^^^^^^^^^^^^^^^\n" +
      "   |\n" +
      "   = note: see issue #13231 <https://github.com/rust-lang/rust/issues/13231> for more information\n" +
      "   = help: add `#![feature(auto_traits)]` to the crate attributes to enable\n" +
      "   = note: this compiler was built on YYYY-MM-DD; consider upgrading it if it is out of date\n" +
      "\n" +
      "error: aborting due to 1 previous error\n" +
      "\n" +
      "For more information about this error, try `rustc --explain E0658`.\n",
  );
});

test_("feature_err: auto traits (plain: real line numbers and CFG_VER_DATE)", () => {
  const { psess, sess, sp, out } = setup("auto_trait.rs", SRC_AUTO_TRAIT, false);
  feature_err(sess, sym.auto_traits, sp("auto trait Foo {}"), "auto traits are experimental and possibly buggy").emit();
  psess.dcx().print_error_count();
  expect(out()).toBe(
    "error[E0658]: auto traits are experimental and possibly buggy\n" +
      " --> auto_trait.rs:1:1\n" +
      "  |\n" +
      "1 | auto trait Foo {}\n" +
      "  | ^^^^^^^^^^^^^^^^^\n" +
      "  |\n" +
      "  = note: see issue #13231 <https://github.com/rust-lang/rust/issues/13231> for more information\n" +
      "  = help: add `#![feature(auto_traits)]` to the crate attributes to enable\n" +
      "  = note: this compiler was built on 2026-10-10; consider upgrading it if it is out of date\n" +
      "\n" +
      "error: aborting due to 1 previous error\n" +
      "\n" +
      "For more information about this error, try `rustc --explain E0658`.\n",
  );
});

// try_block.rs
const SRC_TRY_BLOCK = "#![allow(unused)]\nfn main() {\n    let x: Result<i32, ()> = try { 1 };\n}\n";

test_("feature_err: try blocks (ui)", () => {
  const { psess, sess, sp, out } = setup("try_block.rs", SRC_TRY_BLOCK, true);
  feature_err(sess, sym.try_blocks, sp("try { 1 }"), "`try` expression is experimental").emit();
  psess.dcx().print_error_count();
  expect(out()).toBe(
    "error[E0658]: `try` expression is experimental\n" +
      "  --> try_block.rs:3:30\n" +
      "   |\n" +
      "LL |     let x: Result<i32, ()> = try { 1 };\n" +
      "   |                              ^^^^^^^^^\n" +
      "   |\n" +
      "   = note: see issue #154391 <https://github.com/rust-lang/rust/issues/154391> for more information\n" +
      "   = help: add `#![feature(try_blocks)]` to the crate attributes to enable\n" +
      "   = note: this compiler was built on YYYY-MM-DD; consider upgrading it if it is out of date\n" +
      "\n" +
      "error: aborting due to 1 previous error\n" +
      "\n" +
      "For more information about this error, try `rustc --explain E0658`.\n",
  );
});

// soft_auto.rs: the item is cfg'd out, so only the pre-expansion soft gate fires.
const SRC_SOFT_AUTO = "#[cfg(false)]\nauto trait Foo {}\n\nfn main() {}\n";

test_("feature_warn: stashed soft gate, emitted with the stashed diagnostics (ui)", () => {
  const { psess, sess, sp, out } = setup("soft_auto.rs", SRC_SOFT_AUTO, true);
  // soft_gate_all_legacy_dont_use!(auto_traits, "`auto` traits are unstable") on the `auto` span
  feature_warn(sess, sym.auto_traits, sp("auto"), "`auto` traits are unstable");
  expect(out()).toBe(""); // stashed (StashKey::EarlySyntaxWarning)
  psess.dcx().emit_stashed_diagnostics();
  psess.dcx().print_error_count();
  expect(out()).toBe(
    "warning: `auto` traits are unstable\n" +
      "  --> soft_auto.rs:2:1\n" +
      "   |\n" +
      "LL | auto trait Foo {}\n" +
      "   | ^^^^\n" +
      "   |\n" +
      "   = note: see issue #13231 <https://github.com/rust-lang/rust/issues/13231> for more information\n" +
      "   = help: add `#![feature(auto_traits)]` to the crate attributes to enable\n" +
      "   = note: this compiler was built on YYYY-MM-DD; consider upgrading it if it is out of date\n" +
      "   = warning: unstable syntax can change at any point in the future, causing a hard error!\n" +
      "   = note: for more information, see issue #154045 <https://github.com/rust-lang/rust/issues/154045>\n" +
      "\n" +
      "warning: 1 warning emitted\n" +
      "\n",
  );
});

test_("feature_err steals and cancels an earlier feature_warn on the same span", () => {
  const { psess, sess, sp, out } = setup("auto_trait.rs", SRC_AUTO_TRAIT, true);
  feature_warn(sess, sym.auto_traits, sp("auto trait Foo {}"), "`auto` traits are unstable");
  feature_err(sess, sym.auto_traits, sp("auto trait Foo {}"), "auto traits are experimental and possibly buggy").emit();
  psess.dcx().emit_stashed_diagnostics();
  expect(out().startsWith("error[E0658]: auto traits are experimental and possibly buggy\n")).toBe(true);
  expect(out()).not.toContain("warning");
});

test_("SuggestUpgradeCompiler: ui_testing date and the build date", () => {
  expect(SuggestUpgradeCompiler.ui_testing()).toEqual({ date: "YYYY-MM-DD" });
  expect(SuggestUpgradeCompiler.new()).toEqual({ date: "2026-10-10" });
});

// lits.rs
const SRC_LITS =
  "fn main() {\n" +
  "    let _ = 0B101;\n" +
  "    let _ = 1u7;\n" +
  "    let _ = 1.0f7;\n" +
  "    let _ = 0xffff_ffff_ffff_ffff_ffff_ffff_ffff_ffff_f;\n" +
  "    let _ = 1foo;\n" +
  '    let _ = "a"x;\n' +
  "}\n";

test_("report_lit_error: the literal errors of lits.rs (ui)", () => {
  const { psess, sp, out } = setup("lits.rs", SRC_LITS, true);
  const I = token.LitKind.Integer;
  // The token literals rustc_lexer/rustc_parse build for each literal: (kind, symbol, suffix, source text).
  const lits: [token.LitKind, string, string | undefined, string][] = [
    [I, "0", "B101", "0B101"],
    [I, "1", "u7", "1u7"],
    [token.LitKind.Float, "1.0", "f7", "1.0f7"],
    [I, "0xffff_ffff_ffff_ffff_ffff_ffff_ffff_ffff_f", undefined, "0xffff_ffff_ffff_ffff_ffff_ffff_ffff_ffff_f"],
    [I, "1", "foo", "1foo"],
    [token.LitKind.Str, "a", "x", '"a"x'],
  ];
  for (const [kind, symbol, suffix, text] of lits) {
    const lit = new token.Lit(kind, Symbol.intern(symbol), suffix === undefined ? undefined : Symbol.intern(suffix));
    const r = ast.LitKind.from_token_lit(lit);
    if (r.$ !== "Err") throw new Error(`expected a LitError for ${text}`);
    report_lit_error(psess, r._0, lit, sp(text));
  }
  psess.dcx().print_error_count();
  expect(out()).toBe(
    "error: invalid base prefix for number literal\n" +
      "  --> lits.rs:2:13\n" +
      "   |\n" +
      "LL |     let _ = 0B101;\n" +
      "   |             ^^^^^ help: try making the prefix lowercase: `0b101`\n" +
      "   |\n" +
      "   = note: base prefixes (`0xff`, `0b1010`, `0o755`) are lowercase\n" +
      "\n" +
      "error: invalid width `7` for integer literal\n" +
      "  --> lits.rs:3:13\n" +
      "   |\n" +
      "LL |     let _ = 1u7;\n" +
      "   |             ^^^\n" +
      "   |\n" +
      "   = help: valid widths are 8, 16, 32, 64 and 128\n" +
      "\n" +
      "error: invalid width `7` for float literal\n" +
      "  --> lits.rs:4:13\n" +
      "   |\n" +
      "LL |     let _ = 1.0f7;\n" +
      "   |             ^^^^^\n" +
      "   |\n" +
      "   = help: valid widths are 32 and 64\n" +
      "\n" +
      "error: integer literal is too large\n" +
      "  --> lits.rs:5:13\n" +
      "   |\n" +
      "LL |     let _ = 0xffff_ffff_ffff_ffff_ffff_ffff_ffff_ffff_f;\n" +
      "   |             ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^\n" +
      "   |\n" +
      "   = note: value exceeds limit of `0xffffffffffffffffffffffffffffffff`\n" +
      "\n" +
      "error: invalid suffix `foo` for float literal\n" +
      "  --> lits.rs:6:13\n" +
      "   |\n" +
      "LL |     let _ = 1foo;\n" +
      "   |             ^^^^ invalid suffix `foo`\n" +
      "   |\n" +
      "   = help: valid suffixes are `f32` and `f64`\n" +
      "\n" +
      "error: suffixes on string literals are invalid\n" +
      "  --> lits.rs:7:13\n" +
      "   |\n" +
      'LL |     let _ = "a"x;\n' +
      "   |             ^^^^ invalid suffix `x`\n" +
      "\n" +
      "error: aborting due to 6 previous errors\n" +
      "\n",
  );
});

// ---- parse.rs ----

test_("GatedSpans: gate, ungate_last, merge prepends", () => {
  const g = GatedSpans.default();
  const s = (n: number) => Span.with_root_ctxt(BytePos(n), BytePos(n + 1));
  g.gate(sym.auto_traits, s(1));
  g.gate(sym.auto_traits, s(2));
  g.gate(sym.try_blocks, s(3));
  g.ungate_last(sym.auto_traits, s(2));
  expect(g.spans.get(sym.auto_traits)).toEqual([s(1)]);
  const earlier = new Map([[sym.auto_traits, [s(0)]]]);
  g.merge(earlier);
  expect(g.spans.get(sym.auto_traits)).toEqual([s(0), s(1)]);
  expect(g.spans.get(sym.try_blocks)).toEqual([s(3)]);
  expect(() => g.ungate_last(sym.yield_expr, s(9))).toThrow();
});

test_("SymbolGallery keeps the first occurrence", () => {
  const g = SymbolGallery.default();
  const a = Span.with_root_ctxt(BytePos(1), BytePos(2));
  const b = Span.with_root_ctxt(BytePos(3), BytePos(4));
  g.insert(sym.auto_traits, a);
  g.insert(sym.auto_traits, b);
  expect(g.symbols.get(sym.auto_traits)).toBe(a);
});

test_("ParseSess: with_dcx defaults, buffer_lint / buffer_crate_lint", () => {
  const { psess, sp } = setup("auto_trait.rs", SRC_AUTO_TRAIT, true);
  expect(psess.edition).toBe("Edition2015"); // ExpnId::root().expn_data().edition of the default globals
  expect(psess.raw_identifier_spans).toEqual([]);
  expect(psess.clone_source_map()).toBe(psess.source_map());
  const d = new DecorateDiagCompat((dcx, level) => Diag.new(dcx, level, "x"));
  psess.buffer_lint(UNSTABLE_SYNTAX_PRE_EXPANSION, sp("auto"), ast.DUMMY_NODE_ID, d);
  psess.buffer_crate_lint(UNSTABLE_SYNTAX_PRE_EXPANSION, d);
  expect(psess.buffered_lints.length).toBe(2);
  expect(psess.buffered_lints[0]!.lint_id).toBe(LintId.of(UNSTABLE_SYNTAX_PRE_EXPANSION));
  expect(psess.buffered_lints[0]!.span?.primary_span()).toBe(sp("auto"));
  expect(psess.buffered_lints[1]!.span).toBeUndefined();
  expect(psess.buffered_lints[1]!.node_id).toBe(ast.CRATE_NODE_ID);
});

test_("ParseSess::new / emitter_with_note construct (stderr emitters)", () => {
  expect(ParseSess.new().source_map()).toBeInstanceOf(SourceMap);
  expect(ParseSess.emitter_with_note("note").dcx()).toBeDefined();
});

test("utils: extra_compiler_flags / was_invoked_from_cargo", () => {
  // `bun test` is invoked without -Z/-C/--crate-type flags.
  expect(extra_compiler_flags()).toBeUndefined();
  expect(was_invoked_from_cargo()).toBe(process.env["CARGO_CRATE_NAME"] !== undefined);
});
