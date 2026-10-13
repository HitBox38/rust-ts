// Port of compiler/rustc_attr_parsing/src/safety.rs
// `impl AttributeParser { fn check_attribute_safety }`: an extension module of interface.ts
// (PORTING §5 "Methods defined in another file"); lib.ts loads it after interface.ts.
//
// PORT: `snippet.retain(|c| !c.is_whitespace())` filters by `char::is_whitespace` (std/char.ts).
import type { Safety } from "../rustc_ast/lib.ts";
import type { AttrPath } from "../rustc_attr_ir/lib.ts";
import { clone_AttrPath } from "../rustc_attr_ir/lib.ts";
import { Edition_discriminant } from "../rustc_span/edition.ts";
import { LintId } from "../rustc_errors/lib.ts";
import { UNSAFE_ATTR_OUTSIDE_UNSAFE, UNSAFE_CODE } from "../rustc_lint_defs/builtin.ts";
import { MultiSpan } from "../rustc_errors/lib.ts";
import { Span } from "../rustc_span/lib.ts";
import { is_whitespace } from "../std/char.ts";
import type { AttributeSafety } from "./attributes/mod.ts";
import * as diagnostics from "./diagnostics.ts";
import { AttributeParser, EmitAttribute, type EmitLintFn } from "./interface.ts";

declare module "./interface.ts" {
  interface AttributeParser {
    check_attribute_safety(
      attr_path: AttrPath,
      attr_span: Span,
      attr_safety: Safety,
      expected_safety: AttributeSafety,
      emit_lint: EmitLintFn,
    ): void;
  }
}

// rustc: compiler/rustc_attr_parsing/src/safety.rs:12 check_attribute_safety
AttributeParser.prototype.check_attribute_safety = function (
  this: AttributeParser,
  attr_path: AttrPath,
  attr_span: Span,
  attr_safety: Safety,
  expected_safety: AttributeSafety,
  emit_lint: EmitLintFn,
): void {
  if (this.should_emit.$ === "Nothing") {
    return;
  }

  // Check if expected & actual safety match
  if (
    // - An unsafe builtin attribute, where the user wrote `#[unsafe(..)]`,
    // which is permitted on any edition
    // - A normal builtin attribute, where no explicit `#[unsafe(..)]` was written.
    (expected_safety.$ === "Unsafe" && attr_safety.$ === "Unsafe") ||
    (expected_safety.$ === "Normal" && attr_safety.$ === "Default")
  ) {
    // OK
  } else if (expected_safety.$ === "Unsafe" && attr_safety.$ === "Default") {
    // - Unsafe builtin attribute
    // - User did not write `#[unsafe(..)]`
    const { unsafe_since } = expected_safety;
    const path_span = attr_path.span;

    // If the `attr_item`'s span is not from a macro, then just suggest
    // wrapping it in `unsafe(...)`. Otherwise, we suggest putting the
    // `unsafe(`, `)` right after and right before the opening and closing
    // square bracket respectively.
    const diag_span = attr_span;

    // Attributes can be safe in earlier editions, and become unsafe in later ones.
    //
    // Use the span of the attribute's name to determine the edition: the span of the
    // attribute as a whole may be inaccurate if it was emitted by a macro.
    //
    // See https://github.com/rust-lang/rust/issues/142182.
    const emit_error =
      unsafe_since === undefined ? true : Edition_discriminant[Span.edition(path_span)] >= Edition_discriminant[unsafe_since];

    let not_from_proc_macro = true;
    if (Span.from_expansion(diag_span)) {
      const r = this.sess_.source_map().span_to_snippet(diag_span);
      if (r.$ === "Ok") {
        let snippet = r._0.toString();
        snippet = [...snippet].filter((c) => !is_whitespace(c.codePointAt(0)!)).join("");
        if (snippet.includes("!(") || (snippet.startsWith("#[") && snippet.endsWith("]"))) {
          not_from_proc_macro = false;
        }
      }
    }

    if (emit_error) {
      this.emit_err(
        diagnostics.UnsafeAttrOutsideUnsafe_diagnostic({
          span: path_span,
          suggestion: not_from_proc_macro
            ? { left: Span.shrink_to_lo(diag_span), right: Span.shrink_to_hi(diag_span) }
            : undefined,
        }),
      );
    } else {
      emit_lint(
        LintId.of(UNSAFE_ATTR_OUTSIDE_UNSAFE),
        MultiSpan.from_span(path_span),
        new EmitAttribute((dcx, level, _) => {
          const lr = not_from_proc_macro
            ? ([Span.shrink_to_lo(diag_span), Span.shrink_to_hi(diag_span)] as const)
            : undefined;
          return diagnostics.UnsafeAttrOutsideUnsafeLint_into_diag(
            {
              span: path_span,
              suggestion: lr === undefined ? undefined : { left: lr[0], right: lr[1] },
            },
            dcx,
            level,
          );
        }),
      );
    }
  } else if (expected_safety.$ === "Normal" && attr_safety.$ === "Unsafe") {
    // - Normal builtin attribute
    // - Writing `#[unsafe(..)]` is not permitted on normal builtin attributes
    const unsafe_span = attr_safety._0;
    this.emit_err(
      diagnostics.InvalidAttrUnsafe_diagnostic({
        span: unsafe_span,
        name: clone_AttrPath(attr_path),
      }),
    );
  } else {
    // (_, Safety::Safe(..))
    this.sess_.dcx().span_delayed_bug(attr_span, "`check_attribute_safety` does not expect `Safety::Safe` on attributes");
  }

  // Emit `unsafe_code` lint
  if (expected_safety.$ === "Unsafe") {
    const { note } = expected_safety;
    const attr_path_ = clone_AttrPath(attr_path);
    emit_lint(
      LintId.of(UNSAFE_CODE),
      MultiSpan.from_span(attr_span),
      new EmitAttribute((dcx, level, _) => diagnostics.UnsafeAttribute_into_diag({ attr_path: attr_path_, note }, dcx, level)),
    );
  }
};
