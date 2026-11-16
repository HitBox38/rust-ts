// Port of src/tools/rustfmt/src/rewrite.rs (lane rustfmt-contract-2).
// A generic trait to abstract the rewriting of an element (of the AST).
//
// The modules this file uses that later lanes port (`parse/session.rs`, `skip.rs`, `visitor.rs`) are imported as
// `../rustfmt/<path>` and declared in contract_lib.d.ts until they exist.
import type { FormatReport } from "./lib.ts";
import type { Config } from "./config/mod.ts";
import type { ParseSess } from "../rustfmt/parse/session.ts";
import type { Shape } from "./shape.ts";
import type { SkipContext } from "../rustfmt/skip.ts";
import type { SnippetProvider } from "../rustfmt/visitor.ts";
import { type Span, debug_Span } from "../rustc_span/lib.ts";
import { type Debug, PLAIN, debug_int, debug_struct } from "../std/fmt.ts";
import type { MutRef } from "../std/mut_ref.ts";
import { unwrap } from "../std/panic.ts";
import { Err, Ok, type Result } from "../std/result.ts";

export type RewriteResult = Result<string, RewriteError>;

// PORT: `trait Rewrite` is implemented for AST types (generated classes and unions) and rustfmt's own types, so it is an
// impl table over its `Self` (`Rewrite<T>`, as rustc_attr_ir's `PrintAttribute<T>`): `x.rewrite(context, shape)` is
// `Rewrite_X.rewrite(x, context, shape)`. The provided method lives in `Rewrite_provided` (PORTING §8): an impl that does
// not override it assigns `rewrite_result: Rewrite_provided.rewrite_result`.
export interface Rewrite<T> {
  /// Rewrite self into shape.
  // rustc: src/tools/rustfmt/src/rewrite.rs:19 rewrite
  rewrite(self: T, context: RewriteContext, shape: Shape): string | undefined;

  // (provided) rewrite.rs:21 rewrite_result -> Rewrite_provided.rewrite_result
  rewrite_result(self: T, context: RewriteContext, shape: Shape): RewriteResult;
}

export const Rewrite_provided = {
  // rustc: src/tools/rustfmt/src/rewrite.rs:21 rewrite_result
  rewrite_result<T>(this: Rewrite<T>, self: T, context: RewriteContext, shape: Shape): RewriteResult {
    return RewriteErrorExt_Option.unknown_error(this.rewrite(self, context, shape));
  },
};

// impl<T: Rewrite> Rewrite for Box<T>
// PORT: `Box<T>` is `T` (PORTING §5); the impl keeps upstream's dispatch: its `rewrite_result` is the provided one over
// the box's `rewrite`, not `T`'s own `rewrite_result`.
export function Rewrite_for_Box<T>(inner: Rewrite<T>): Rewrite<T> {
  return {
    // rustc: src/tools/rustfmt/src/rewrite.rs:27 rewrite
    rewrite(self: T, context: RewriteContext, shape: Shape): string | undefined {
      return inner.rewrite(self, context, shape);
    },
    rewrite_result: Rewrite_provided.rewrite_result,
  };
}

// `#[derive(Clone, Debug, PartialEq)]`
export type MacroErrorKind = "ParseFailure" | "ReplaceMacroVariable" | "Unknown";
export const MacroErrorKind = {
  ParseFailure: "ParseFailure",
  ReplaceMacroVariable: "ReplaceMacroVariable",
  Unknown: "Unknown",
} as const;
export const debug_MacroErrorKind: Debug<MacroErrorKind> = (v) => v;

// impl std::fmt::Display for MacroErrorKind
// rustc: src/tools/rustfmt/src/rewrite.rs:40 fmt
export function display_MacroErrorKind(self: MacroErrorKind): string {
  switch (self) {
    case "ParseFailure":
      return "(parse failure)";
    case "ReplaceMacroVariable":
      return "(replacing macro variables with $)";
    case "Unknown":
      return "";
  }
}

// `#[derive(Clone, Error, Debug)]`
export type RewriteError =
  | { readonly $: "SkipFormatting" }
  | { readonly $: "ExceedsMaxWidth"; configured_width: number; span: Span }
  | { readonly $: "MacroFailure"; kind: MacroErrorKind; span: Span }
  /// Format failure that does not fit to above categories.
  | { readonly $: "Unknown" };
export const RewriteError = {
  SkipFormatting: Object.freeze({ $: "SkipFormatting" as const }),
  Unknown: Object.freeze({ $: "Unknown" as const }),

  // impl From<ExceedsMaxWidthError> for RewriteError
  // rustc: src/tools/rustfmt/src/rewrite.rs:71 from
  from(error: ExceedsMaxWidthError): RewriteError {
    return {
      $: "ExceedsMaxWidth",
      configured_width: error.configured_width,
      span: error.span,
    };
  },
};
export const debug_RewriteError: Debug<RewriteError> = (v, f) => {
  switch (v.$) {
    case "ExceedsMaxWidth":
      return debug_struct(f, "ExceedsMaxWidth", [
        ["configured_width", debug_int(v.configured_width, f)],
        ["span", debug_Span(v.span, f)],
      ]);
    case "MacroFailure":
      return debug_struct(f, "MacroFailure", [
        ["kind", debug_MacroErrorKind(v.kind, f)],
        ["span", debug_Span(v.span, f)],
      ]);
    default:
      return v.$;
  }
};
/** thiserror's `Display` (the `#[error(..)]` texts). */
export function display_RewriteError(v: RewriteError): string {
  switch (v.$) {
    case "SkipFormatting":
      return "Formatting was skipped due to skip attribute or out of file range.";
    case "ExceedsMaxWidth":
      return `It exceeds the required width of ${v.configured_width} for the span: ${debug_Span(v.span, PLAIN)}`;
    case "MacroFailure":
      return `Failed to format given macro${display_MacroErrorKind(v.kind)} at: ${debug_Span(v.span, PLAIN)}`;
    case "Unknown":
      return "An unknown error occurred during formatting.";
  }
}

// PORT: a data-only struct (PORTING §5); shape.ts builds it as an object literal.
export interface ExceedsMaxWidthError {
  configured_width: number;
  span: Span;
}

/// Extension trait used to conveniently convert to RewriteError
// PORT: the trait's one impl is `Option<T>` (`T | undefined`), so the interface is written for that `Self`, generic over
// `T` per method; `opt.max_width_error(w, span)` is `RewriteErrorExt_Option.max_width_error(opt, w, span)`.
export interface RewriteErrorExt {
  // rustc: src/tools/rustfmt/src/rewrite.rs:81 max_width_error
  max_width_error<T>(self: T | undefined, width: number, span: Span): Result<T, RewriteError>;
  // rustc: src/tools/rustfmt/src/rewrite.rs:82 macro_error
  macro_error<T>(self: T | undefined, kind: MacroErrorKind, span: Span): Result<T, RewriteError>;
  // rustc: src/tools/rustfmt/src/rewrite.rs:83 unknown_error
  unknown_error<T>(self: T | undefined): Result<T, RewriteError>;
}

// impl<T> RewriteErrorExt<T> for Option<T>
export const RewriteErrorExt_Option: RewriteErrorExt = {
  // rustc: src/tools/rustfmt/src/rewrite.rs:87 max_width_error
  max_width_error<T>(self: T | undefined, width: number, span: Span): Result<T, RewriteError> {
    // `ok_or_else`
    return self !== undefined
      ? Ok(self)
      : Err({
          $: "ExceedsMaxWidth",
          configured_width: width,
          span: span,
        });
  },

  // rustc: src/tools/rustfmt/src/rewrite.rs:94 macro_error
  macro_error<T>(self: T | undefined, kind: MacroErrorKind, span: Span): Result<T, RewriteError> {
    return self !== undefined
      ? Ok(self)
      : Err({
          $: "MacroFailure",
          kind: kind,
          span: span,
        });
  },

  // rustc: src/tools/rustfmt/src/rewrite.rs:101 unknown_error
  unknown_error<T>(self: T | undefined): Result<T, RewriteError> {
    return self !== undefined ? Ok(self) : Err(RewriteError.Unknown);
  },
};

// `#[derive(Clone)]`
// PORT: `Cell<bool>` fields are plain mutable fields (PORTING §5: `.get()` reads, `.set(v)` assigns). `inside_macro:
// Rc<Cell<bool>>` is shared with every clone and with `InsideMacroGuard`, so it is a shared `MutRef<boolean>` box;
// `skipped_range: Rc<RefCell<Vec<..>>>` is a shared array. The derived `Clone` is not written: nothing in rustfmt clones a
// `RewriteContext` (visitor.rs:1070 builds each one); tools/codegen owns derives (PORTING §5).
export class RewriteContext {
  constructor(
    public psess: ParseSess,
    public config: Config,
    public inside_macro: MutRef<boolean>,
    // Force block indent style even if we are using visual indent style.
    public use_block: boolean,
    // When `is_if_else_block` is true, unindent the comment on top
    // of the `else` or `else if`.
    public is_if_else_block: boolean,
    // When `is_loop_block` is true, we can more aggressively end the
    // last statement of the block with a semicolon.
    public is_loop_block: boolean,
    // When rewriting chain, veto going multi line except the last element
    public force_one_line_chain: boolean,
    public snippet_provider: SnippetProvider,
    // Used for `format_snippet`
    public macro_rewrite_failure: boolean,
    public is_macro_def: boolean,
    public report: FormatReport,
    public skip_context: SkipContext,
    public skipped_range: [number, number][],
  ) {}

  // rustc: src/tools/rustfmt/src/rewrite.rs:148 snippet
  snippet(span: Span): string {
    return unwrap(this.snippet_provider.span_to_snippet(span));
  }

  /// Returns `true` if we should use block indent style for rewriting function call.
  // rustc: src/tools/rustfmt/src/rewrite.rs:153 use_block_indent
  use_block_indent(): boolean {
    return this.config.indent_style() === "Block" || this.use_block;
  }

  // rustc: src/tools/rustfmt/src/rewrite.rs:157 budget
  budget(used_width: number): number {
    // `saturating_sub`
    const max_width = this.config.max_width();
    return max_width > used_width ? max_width - used_width : 0;
  }

  // rustc: src/tools/rustfmt/src/rewrite.rs:161 inside_macro
  inside_macro_(): boolean {
    // PORT: renamed `inside_macro_`: the class has a field `inside_macro` (as shape.ts's `block_indent_`).
    return this.inside_macro.value;
  }

  // rustc: src/tools/rustfmt/src/rewrite.rs:165 enter_macro
  enter_macro(): InsideMacroGuard {
    // `Cell::replace`
    const is_nested_macro_context = this.inside_macro.value;
    this.inside_macro.value = true;
    return new InsideMacroGuard(is_nested_macro_context, this.inside_macro);
  }

  // rustc: src/tools/rustfmt/src/rewrite.rs:173 leave_macro
  leave_macro(): void {
    this.inside_macro.value = false;
  }

  // rustc: src/tools/rustfmt/src/rewrite.rs:177 is_if_else_block
  is_if_else_block_(): boolean {
    // PORT: renamed `is_if_else_block_`: the class has a field `is_if_else_block`.
    return this.is_if_else_block;
  }

  // rustc: src/tools/rustfmt/src/rewrite.rs:181 is_loop_block
  is_loop_block_(): boolean {
    // PORT: renamed `is_loop_block_`: the class has a field `is_loop_block`.
    return this.is_loop_block;
  }
}

// PORT: `Drop` is `drop()`, called where the guard leaves scope (as lib.ts's `Session`).
export class InsideMacroGuard {
  constructor(
    private is_nested_macro_context: boolean,
    private inside_macro_ref: MutRef<boolean>,
  ) {}

  // rustc: src/tools/rustfmt/src/rewrite.rs:136 is_nested
  is_nested(): boolean {
    return this.is_nested_macro_context;
  }

  // impl Drop for InsideMacroGuard
  // rustc: src/tools/rustfmt/src/rewrite.rs:142 drop
  drop(): void {
    this.inside_macro_ref.value = this.is_nested_macro_context;
  }
}
