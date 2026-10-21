// Port of compiler/rustc_hir_typeck/src/diagnostics.rs (manual impls: lane typeck-fnsugg-b).
//
// The types and every `#[derive(Diagnostic)]` / `#[derive(Subdiagnostic)]` / `#[derive(LintDiagnostic)]` impl
// (`<T>_into_diag` + `<T>_diagnostic`, `<T>_add_to_diag` + `<T>_subdiagnostic`) are generated into diagnostics.gen.ts by
// tools/codegen/types.ts (set `rustc_hir_typeck`). This module holds the hand-written impls of the file (decls.ts,
// comment-only section, `diagnostics.rs:<line>`), as stubs with their final names and signatures (precedent:
// rustc_ast_passes / rustc_hir_analysis diagnostics.ts).
// Init order: top-level code here may touch only ./decls.ts, this file's .gen.ts and other crates.
export * from "./diagnostics.gen.ts";
import { type DiagArgValue, IntoDiagArg, MultiSpan } from "../rustc_error_messages/lib.ts";
import { str_into_diag_arg } from "../rustc_error_messages/diagnostic_impls.ts";
import { Diag, type DiagCtxtHandle, type Diagnostic, E0571, E0787, type Level, msg, type Subdiagnostic } from "../rustc_errors/lib.ts";
import type { AssignOpKind } from "../rustc_ast/lib.ts";
import type * as hir from "../rustc_hir/lib.ts";
import { LATEST_STABLE_EDITION } from "../rustc_span/edition.ts";
import { type PathBuf, Span, type Spanned } from "../rustc_span/lib.ts";
import { display_Ident } from "../rustc_span/symbol.ts";
import { was_invoked_from_cargo } from "../rustc_session/utils.ts";
import type { MutRef } from "../std/mut_ref.ts";
import { Err, Ok, type Result } from "../std/result.ts";
import type { FnCtxt } from "./decls.ts";
import { ExprParenthesesNeeded } from "./diagnostics.gen.ts";
import type {
  BreakNonLoop,
  CastUnknownPointerSub,
  HelpUseLatestEdition,
  NakedFunctionsAsmBlock,
  RemoveSemiForCoerce,
  ReturnLikeStatementKind,
  SuggestAnnotations,
  TypeMismatchFruTypo,
} from "./diagnostics.gen.ts";

// `impl IntoDiagArg for ReturnLikeStatementKind`
// rustc: compiler/rustc_hir_typeck/src/diagnostics.rs:99 into_diag_arg
export function ReturnLikeStatementKind_into_diag_arg(self: ReturnLikeStatementKind, _: MutRef<PathBuf | undefined>): DiagArgValue {
  let kind: string;
  switch (self) {
    case "Return":
      kind = "return";
      break;
    case "Become":
      kind = "become";
      break;
  }

  return { $: "Str", _0: kind };
}

// `impl Subdiagnostic for SuggestAnnotations`
// rustc: compiler/rustc_hir_typeck/src/diagnostics.rs:278 add_to_diag
export function SuggestAnnotations_add_to_diag(self: SuggestAnnotations, diag: Diag): void {
  if (self.suggestions.length === 0) {
    return;
  }

  const suggestions: [Span, string][] = [];
  for (const suggestion of self.suggestions) {
    switch (suggestion.$) {
      case "Unit": {
        const span = suggestion._0;
        suggestions.push([span, "()"]);
        break;
      }
      case "Path": {
        const span = suggestion._0;
        suggestions.push([Span.shrink_to_lo(span), "<() as "]);
        suggestions.push([Span.shrink_to_hi(span), ">"]);
        break;
      }
      case "Local": {
        const span = suggestion._0;
        suggestions.push([span, ": ()"]);
        break;
      }
      case "Turbo": {
        const [span, n_args, idx] = [suggestion._0, suggestion._1, suggestion._2];
        const args: string[] = [];
        for (let i = 0; i < n_args; i++) {
          args.push(i === idx ? "()" : "_");
        }
        suggestions.push([span, `::<${args.join(", ")}>`]);
        break;
      }
    }
  }

  diag.multipart_suggestion("use `()` annotations to avoid fallback changes", suggestions, "MachineApplicable");
}
/** `SuggestAnnotations` as a `Subdiagnostic` trait object. */
export function SuggestAnnotations_subdiagnostic(self: SuggestAnnotations): Subdiagnostic {
  return { add_to_diag: (diag) => SuggestAnnotations_add_to_diag(self, diag) };
}

// `impl Subdiagnostic for TypeMismatchFruTypo`
// rustc: compiler/rustc_hir_typeck/src/diagnostics.rs:341 add_to_diag
export function TypeMismatchFruTypo_add_to_diag(self: TypeMismatchFruTypo, diag: Diag): void {
  diag.arg("expr", IntoDiagArg.of(self.expr ?? "NONE", str_into_diag_arg));

  // Only explain that `a ..b` is a range if it's split up
  if (Span.is_empty(Span.between(self.expr_span, self.fru_span))) {
    diag.span_note(Span.to(self.expr_span, self.fru_span), msg("this expression may have been misinterpreted as a `..` range expression"));
  } else {
    const multispan: MultiSpan = MultiSpan.from_Vec([self.expr_span, self.fru_span]);
    multispan.push_span_label(self.expr_span, msg("this expression does not end in a comma..."));
    multispan.push_span_label(self.fru_span, msg("... so this is interpreted as a `..` range expression, instead of functional record update syntax"));
    diag.span_note(multispan, msg("this expression may have been misinterpreted as a `..` range expression"));
  }

  diag.span_suggestion_verbose(
    Span.shrink_to_hi(self.expr_span),
    msg(
      "to set the remaining fields{$expr ->\n                    [NONE]{\"\"}\n                    *[other] {\" \"}from `{$expr}`\n                }, separate the last named field with a comma",
    ),
    ", ",
    "MaybeIncorrect",
  );
}
/** `TypeMismatchFruTypo` as a `Subdiagnostic` trait object. */
export function TypeMismatchFruTypo_subdiagnostic(self: TypeMismatchFruTypo): Subdiagnostic {
  return { add_to_diag: (diag) => TypeMismatchFruTypo_add_to_diag(self, diag) };
}

// `HelpUseLatestEdition::new`
// rustc: compiler/rustc_hir_typeck/src/diagnostics.rs:403 new
export function HelpUseLatestEdition_new(): HelpUseLatestEdition {
  const edition = LATEST_STABLE_EDITION;
  if (was_invoked_from_cargo()) {
    return { $: "Cargo", edition };
  } else {
    return { $: "Standalone", edition };
  }
}

// `impl Subdiagnostic for RemoveSemiForCoerce`
// rustc: compiler/rustc_hir_typeck/src/diagnostics.rs:564 add_to_diag
export function RemoveSemiForCoerce_add_to_diag(self: RemoveSemiForCoerce, diag: Diag): void {
  const multispan: MultiSpan = MultiSpan.from_Span(self.semi);
  multispan.push_span_label(self.expr, msg("this could be implicitly returned but it is a statement, not a tail expression"));
  multispan.push_span_label(self.ret, msg("the `match` arms can conform to this return type"));
  multispan.push_span_label(self.semi, msg("the `match` is a statement because of this semicolon, consider removing it"));
  diag.span_note(multispan, msg("you might have meant to return the `match` expression"));

  diag.tool_only_span_suggestion(self.semi, msg("remove this semicolon"), "", "MaybeIncorrect");
}
/** `RemoveSemiForCoerce` as a `Subdiagnostic` trait object. */
export function RemoveSemiForCoerce_subdiagnostic(self: RemoveSemiForCoerce): Subdiagnostic {
  return { add_to_diag: (diag) => RemoveSemiForCoerce_add_to_diag(self, diag) };
}

// `impl Diagnostic for BreakNonLoop`
// #[track_caller]
// rustc: compiler/rustc_hir_typeck/src/diagnostics.rs:741 into_diag
export function BreakNonLoop_into_diag(self: BreakNonLoop, dcx: DiagCtxtHandle, level: Level): Diag {
  const diag = Diag.new(dcx, level, msg("`break` with value from a `{$kind}` loop"));
  diag.span(self.span);
  diag.code(E0571);
  diag.arg("kind", IntoDiagArg.of(self.kind, str_into_diag_arg));
  diag.span_label(self.span, msg("can only break with a value inside `loop` or breakable block"));
  if (self.head !== undefined) {
    const head = self.head;
    diag.span_label(head, msg("you can't `break` with a value in a `{$kind}` loop"));
  }
  diag.span_suggestion_verbose(self.span, msg("use `break` on its own without a value inside this `{$kind}` loop"), self.suggestion, "MaybeIncorrect");
  if (self.loop_label !== undefined && self.break_label === undefined) {
    const label = self.loop_label;
    const k = self.break_expr_kind;
    const segment =
      k.$ === "Path" && k._0.$ === "Resolved" && k._0._0 === undefined && k._0._1.segments.length === 1 && k._0._1.res.$ === "Err"
        ? k._0._1.segments[0]!
        : undefined;
    if (segment !== undefined && display_Ident(label.ident) === `'${display_Ident(segment.ident)}`) {
      // This error is redundant, we will have already emitted a
      // suggestion to use the label when `segment` wasn't found
      // (hence the `Res::Err` check).
      diag.downgrade_to_delayed_bug();
    } else {
      diag.span_suggestion_verbose(
        self.break_expr_span,
        msg("alternatively, you might have meant to use the available loop label"),
        display_Ident(label.ident),
        "MaybeIncorrect",
      );
    }
  }
  return diag;
}
/** `BreakNonLoop` as a `Diagnostic` trait object. */
export function BreakNonLoop_diagnostic(self: BreakNonLoop): Diagnostic {
  return { into_diag: (dcx, level) => BreakNonLoop_into_diag(self, dcx, level) };
}

// `impl Subdiagnostic for CastUnknownPointerSub`
// rustc: compiler/rustc_hir_typeck/src/diagnostics.rs:941 add_to_diag
export function CastUnknownPointerSub_add_to_diag(self: CastUnknownPointerSub, diag: Diag): void {
  switch (self.$) {
    case "To": {
      const span = self._0;
      let msg_ = msg("needs more type information");
      diag.span_label(span, msg_);
      msg_ = msg("the type information given here is insufficient to check whether the pointer cast is valid");
      diag.note(msg_);
      break;
    }
    case "From": {
      const span = self._0;
      const msg_ = msg("the type information given here is insufficient to check whether the pointer cast is valid");
      diag.span_label(span, msg_);
      break;
    }
  }
}
/** `CastUnknownPointerSub` as a `Subdiagnostic` trait object. */
export function CastUnknownPointerSub_subdiagnostic(self: CastUnknownPointerSub): Subdiagnostic {
  return { add_to_diag: (diag) => CastUnknownPointerSub_add_to_diag(self, diag) };
}

// `impl Diagnostic for NakedFunctionsAsmBlock`
// #[track_caller]
// rustc: compiler/rustc_hir_typeck/src/diagnostics.rs:1239 into_diag
export function NakedFunctionsAsmBlock_into_diag(self: NakedFunctionsAsmBlock, dcx: DiagCtxtHandle, level: Level): Diag {
  const diag = Diag.new(dcx, level, msg("naked functions must contain a single `naked_asm!` invocation"));
  diag.span(self.span);
  diag.code(E0787);
  for (const span of self.multiple_asms) {
    diag.span_label(span, msg("multiple `naked_asm!` invocations are not allowed in naked functions"));
  }
  for (const span of self.non_asms) {
    diag.span_label(span, msg("not allowed in naked functions"));
  }
  return diag;
}
/** `NakedFunctionsAsmBlock` as a `Diagnostic` trait object. */
export function NakedFunctionsAsmBlock_diagnostic(self: NakedFunctionsAsmBlock): Diagnostic {
  return { into_diag: (dcx, level) => NakedFunctionsAsmBlock_into_diag(self, dcx, level) };
}

// rustc: compiler/rustc_hir_typeck/src/diagnostics.rs:1260 maybe_emit_plus_equals_diagnostic
export function maybe_emit_plus_equals_diagnostic(fnctxt: FnCtxt, assign_op: Spanned<AssignOpKind>, lhs_expr: hir.Expr): Result<undefined, Diag> {
  const k = lhs_expr.kind;
  if (assign_op.node === "AddAssign" && k.$ === "Binary") {
    const [bin_op, left, right] = [k._0, k._1, k._2];
    if (bin_op.node === "And" && op_mod().contains_let_in_chain(left) && right.kind.$ === "Path" && right.kind._0.$ === "Resolved" && right.kind._0._1.res.$ === "Local") {
      const err = fnctxt.dcx().struct_span_err(assign_op.span, "binary assignment operation `+=` cannot be used in a let chain");

      err.span_label(lhs_expr.span, "you are add-assigning the right-hand side expression to the result of this let-chain");

      err.span_label(assign_op.span, "cannot use `+=` in a let chain");

      err.span_suggestion_short(assign_op.span, "you might have meant to compare with `==` instead of assigning with `+=`", "==", "MaybeIncorrect");

      return Err(err);
    }
  }
  return Ok(undefined);
}

// `ExprParenthesesNeeded::surrounding`
// rustc: compiler/rustc_hir_typeck/src/diagnostics.rs:1368 surrounding
export function ExprParenthesesNeeded_surrounding(s: Span): ExprParenthesesNeeded {
  return new ExprParenthesesNeeded(Span.shrink_to_lo(s), Span.shrink_to_hi(s));
}

// PORT: `crate::op::contains_let_in_chain` is read through a lazy `require` (overflow.ts `traits_mod()` precedent): a static
// import of ./op.ts closes a load cycle (-> rustc_middle traits/mod.ts TDZ) when this module is loaded as the entry point.
function op_mod(): typeof import("./op.ts") {
  return require("./op.ts") as typeof import("./op.ts");
}
