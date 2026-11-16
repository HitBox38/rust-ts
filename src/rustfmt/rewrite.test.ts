// Checks of src/tools/rustfmt/src/rewrite.rs (lane rustfmt-contract-2). rewrite.rs has no `#[cfg(test)]` tests upstream;
// these are "not upstream" checks of `RewriteError`'s Display/Debug, `RewriteErrorExt` and `RewriteContext`'s helpers.
import { expect, test } from "bun:test";
import { install_serde_stubs } from "./config/serde_stubs.test_support.ts";
import type { FormatReport } from "./lib.ts";
import type { ParseSess } from "../rustfmt/parse/session.ts";
import type { SkipContext } from "../rustfmt/skip.ts";
import type { SnippetProvider } from "../rustfmt/visitor.ts";
import { PLAIN, PRETTY } from "../std/fmt.ts";
import { Panic } from "../std/panic.ts";
import { Indent, Shape } from "./shape.ts";
import {
  type Rewrite,
  RewriteContext,
  RewriteError,
  RewriteErrorExt_Option,
  Rewrite_for_Box,
  Rewrite_provided,
  debug_RewriteError,
  display_MacroErrorKind,
  display_RewriteError,
} from "./rewrite.ts";
import { BytePos, Span, create_default_session_globals_then as with_session_globals } from "../rustc_span/lib.ts";
import { SyntaxContext } from "../rustc_span/hygiene.ts";

install_serde_stubs();
const { default_Config } = await import("./config/mod.ts");

/** Runs `f` under default session globals (no source map), with a maker of root-context spans. */
function create_default_session_globals_then(f: (span: (lo: number, hi: number) => Span) => void): void {
  with_session_globals(() => f((lo, hi) => Span.new(BytePos(lo), BytePos(hi), SyntaxContext.root(), undefined)));
}

/** A `RewriteContext` over a `SnippetProvider` stand-in that serves `text` from byte 0 (the fields no helper here reads
 *  are left out; test only). */
function context(text: string | undefined): RewriteContext {
  const snippet_provider = { span_to_snippet: () => text } as unknown as SnippetProvider;
  return new RewriteContext(
    undefined as unknown as ParseSess,
    default_Config(),
    { value: false },
    false,
    false,
    false,
    false,
    snippet_provider,
    false,
    false,
    undefined as unknown as FormatReport,
    undefined as unknown as SkipContext,
    [],
  );
}

test("MacroErrorKind and RewriteError Display (not upstream)", () => {
  expect(display_MacroErrorKind("ParseFailure")).toBe("(parse failure)");
  expect(display_MacroErrorKind("ReplaceMacroVariable")).toBe("(replacing macro variables with $)");
  expect(display_MacroErrorKind("Unknown")).toBe("");
  expect(display_RewriteError(RewriteError.SkipFormatting)).toBe("Formatting was skipped due to skip attribute or out of file range.");
  expect(display_RewriteError(RewriteError.Unknown)).toBe("An unknown error occurred during formatting.");
  create_default_session_globals_then((span) => {
    const sp = span(3, 7);
    // no source map: `Span`'s Debug falls back to the raw values (rustc_span lib.rs:1644)
    const dbg = "Span { lo: BytePos(3), hi: BytePos(7), ctxt: #0 }";
    expect(display_RewriteError({ $: "ExceedsMaxWidth", configured_width: 100, span: sp })).toBe(
      `It exceeds the required width of 100 for the span: ${dbg}`,
    );
    expect(display_RewriteError({ $: "MacroFailure", kind: "ParseFailure", span: sp })).toBe(
      `Failed to format given macro(parse failure) at: ${dbg}`,
    );
    expect(display_RewriteError({ $: "MacroFailure", kind: "Unknown", span: sp })).toBe(`Failed to format given macro at: ${dbg}`);
    expect(debug_RewriteError({ $: "MacroFailure", kind: "ReplaceMacroVariable", span: sp }, PLAIN)).toBe(
      `MacroFailure { kind: ReplaceMacroVariable, span: ${dbg} }`,
    );
    expect(debug_RewriteError({ $: "ExceedsMaxWidth", configured_width: 9, span: sp }, PLAIN)).toBe(
      `ExceedsMaxWidth { configured_width: 9, span: ${dbg} }`,
    );
    expect(debug_RewriteError(RewriteError.SkipFormatting, PRETTY)).toBe("SkipFormatting");
    // `impl From<ExceedsMaxWidthError> for RewriteError`
    expect(RewriteError.from({ configured_width: 5, span: sp })).toEqual({ $: "ExceedsMaxWidth", configured_width: 5, span: sp });
  });
});

test("RewriteErrorExt for Option (not upstream)", () => {
  create_default_session_globals_then((span) => {
    const sp = span(1, 2);
    expect(RewriteErrorExt_Option.max_width_error("s", 10, sp)).toEqual({ $: "Ok", _0: "s" } as never);
    expect(RewriteErrorExt_Option.max_width_error<string>(undefined, 10, sp)).toEqual({
      $: "Err",
      _0: { $: "ExceedsMaxWidth", configured_width: 10, span: sp },
    } as never);
    expect(RewriteErrorExt_Option.macro_error<string>(undefined, "ParseFailure", sp)).toEqual({
      $: "Err",
      _0: { $: "MacroFailure", kind: "ParseFailure", span: sp },
    } as never);
    expect(RewriteErrorExt_Option.unknown_error("")).toEqual({ $: "Ok", _0: "" } as never);
    expect(RewriteErrorExt_Option.unknown_error<string>(undefined)).toEqual({ $: "Err", _0: RewriteError.Unknown } as never);
  });
});

test("Rewrite's provided rewrite_result and the Box impl (not upstream)", () => {
  // An impl whose own `rewrite_result` differs from the provided one: the Box impl must not use it.
  const inner: Rewrite<number> = {
    rewrite: (n) => (n > 0 ? `x${n}` : undefined),
    rewrite_result: () => ({ $: "Err", _0: RewriteError.SkipFormatting }) as never,
  };
  const ctx = context("");
  const shape = Shape.legacy(10, Indent.empty());
  const provided: Rewrite<number> = { rewrite: inner.rewrite, rewrite_result: Rewrite_provided.rewrite_result };
  expect(provided.rewrite_result(2, ctx, shape)).toEqual({ $: "Ok", _0: "x2" } as never);
  expect(provided.rewrite_result(0, ctx, shape)).toEqual({ $: "Err", _0: RewriteError.Unknown } as never);
  const boxed = Rewrite_for_Box(inner);
  expect(boxed.rewrite(3, ctx, shape)).toBe("x3");
  expect(boxed.rewrite_result(0, ctx, shape)).toEqual({ $: "Err", _0: RewriteError.Unknown } as never);
});

test("RewriteContext helpers (not upstream)", () => {
  const ctx = context("abc");
  // `budget` saturates (default max_width 100)
  expect(ctx.budget(30)).toBe(70);
  expect(ctx.budget(130)).toBe(0);
  // indent_style defaults to Block
  expect(ctx.use_block_indent()).toBe(true);
  ctx.config.set().indent_style("Visual");
  expect(ctx.use_block_indent()).toBe(false);
  ctx.use_block = true;
  expect(ctx.use_block_indent()).toBe(true);

  // enter_macro / InsideMacroGuard::drop restore the shared cell; leave_macro clears it
  expect(ctx.inside_macro_()).toBe(false);
  const outer = ctx.enter_macro();
  expect(outer.is_nested()).toBe(false);
  expect(ctx.inside_macro_()).toBe(true);
  const nested = ctx.enter_macro();
  expect(nested.is_nested()).toBe(true);
  nested.drop();
  expect(ctx.inside_macro_()).toBe(true);
  outer.drop();
  expect(ctx.inside_macro_()).toBe(false);
  ctx.enter_macro();
  ctx.leave_macro();
  expect(ctx.inside_macro_()).toBe(false);

  expect(ctx.is_if_else_block_()).toBe(false);
  ctx.is_if_else_block = true;
  expect(ctx.is_if_else_block_()).toBe(true);
  expect(ctx.is_loop_block_()).toBe(false);

  // `snippet` unwraps `span_to_snippet`
  create_default_session_globals_then((span) => {
    expect(ctx.snippet(span(0, 3))).toBe("abc");
    expect(() => context(undefined).snippet(span(0, 3))).toThrow(Panic);
  });
});
