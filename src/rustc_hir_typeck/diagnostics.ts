// Port of compiler/rustc_hir_typeck/src/diagnostics.rs (lane wave 19; contract stub, hand-kept): see docs/handoff/fnctxt-contract.md "How to
// fill a stub".
//
// The types and every `#[derive(Diagnostic)]` / `#[derive(Subdiagnostic)]` / `#[derive(LintDiagnostic)]` impl
// (`<T>_into_diag` + `<T>_diagnostic`, `<T>_add_to_diag` + `<T>_subdiagnostic`) are generated into diagnostics.gen.ts by
// tools/codegen/types.ts (set `rustc_hir_typeck`). This module holds the hand-written impls of the file (decls.ts,
// comment-only section, `diagnostics.rs:<line>`), as stubs with their final names and signatures (precedent:
// rustc_ast_passes / rustc_hir_analysis diagnostics.ts): fill each body in place, add the marker
// `// rustc: compiler/rustc_hir_typeck/src/diagnostics.rs:<line> <name>` and drop the `(stub ..)` comment.
// Init order: top-level code here may touch only ./decls.ts, this file's .gen.ts and other crates.
export * from "./diagnostics.gen.ts";
import type { DiagArgValue } from "../rustc_error_messages/lib.ts";
import type { Diag, DiagCtxtHandle, Diagnostic, Level, Subdiagnostic } from "../rustc_errors/lib.ts";
import type { AssignOpKind } from "../rustc_ast/lib.ts";
import type * as hir from "../rustc_hir/lib.ts";
import type { PathBuf, Span, Spanned } from "../rustc_span/lib.ts";
import type { MutRef } from "../std/mut_ref.ts";
import { unported } from "../std/panic.ts";
import type { Result } from "../std/result.ts";
import type { FnCtxt } from "./decls.ts";
import type {
  BreakNonLoop,
  CastUnknownPointerSub,
  ExprParenthesesNeeded,
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

// diagnostics.rs:278 (stub) `impl Subdiagnostic for SuggestAnnotations`
export function SuggestAnnotations_add_to_diag(_self: SuggestAnnotations, _diag: Diag): void {
  return unported("rustc_hir_typeck::diagnostics::<SuggestAnnotations as Subdiagnostic>::add_to_diag");
}
/** `SuggestAnnotations` as a `Subdiagnostic` trait object. */
export function SuggestAnnotations_subdiagnostic(self: SuggestAnnotations): Subdiagnostic {
  return { add_to_diag: (diag) => SuggestAnnotations_add_to_diag(self, diag) };
}

// diagnostics.rs:341 (stub) `impl Subdiagnostic for TypeMismatchFruTypo`
export function TypeMismatchFruTypo_add_to_diag(_self: TypeMismatchFruTypo, _diag: Diag): void {
  return unported("rustc_hir_typeck::diagnostics::<TypeMismatchFruTypo as Subdiagnostic>::add_to_diag");
}
/** `TypeMismatchFruTypo` as a `Subdiagnostic` trait object. */
export function TypeMismatchFruTypo_subdiagnostic(self: TypeMismatchFruTypo): Subdiagnostic {
  return { add_to_diag: (diag) => TypeMismatchFruTypo_add_to_diag(self, diag) };
}

// diagnostics.rs:403 (stub) `HelpUseLatestEdition::new`
export function HelpUseLatestEdition_new(): HelpUseLatestEdition {
  return unported("rustc_hir_typeck::diagnostics::HelpUseLatestEdition::new");
}

// diagnostics.rs:564 (stub) `impl Subdiagnostic for RemoveSemiForCoerce`
export function RemoveSemiForCoerce_add_to_diag(_self: RemoveSemiForCoerce, _diag: Diag): void {
  return unported("rustc_hir_typeck::diagnostics::<RemoveSemiForCoerce as Subdiagnostic>::add_to_diag");
}
/** `RemoveSemiForCoerce` as a `Subdiagnostic` trait object. */
export function RemoveSemiForCoerce_subdiagnostic(self: RemoveSemiForCoerce): Subdiagnostic {
  return { add_to_diag: (diag) => RemoveSemiForCoerce_add_to_diag(self, diag) };
}

// diagnostics.rs:741 (stub) `impl Diagnostic for BreakNonLoop`
export function BreakNonLoop_into_diag(_self: BreakNonLoop, _dcx: DiagCtxtHandle, _level: Level): Diag {
  return unported("rustc_hir_typeck::diagnostics::<BreakNonLoop as Diagnostic>::into_diag");
}
/** `BreakNonLoop` as a `Diagnostic` trait object. */
export function BreakNonLoop_diagnostic(self: BreakNonLoop): Diagnostic {
  return { into_diag: (dcx, level) => BreakNonLoop_into_diag(self, dcx, level) };
}

// diagnostics.rs:941 (stub) `impl Subdiagnostic for CastUnknownPointerSub`
export function CastUnknownPointerSub_add_to_diag(_self: CastUnknownPointerSub, _diag: Diag): void {
  return unported("rustc_hir_typeck::diagnostics::<CastUnknownPointerSub as Subdiagnostic>::add_to_diag");
}
/** `CastUnknownPointerSub` as a `Subdiagnostic` trait object. */
export function CastUnknownPointerSub_subdiagnostic(self: CastUnknownPointerSub): Subdiagnostic {
  return { add_to_diag: (diag) => CastUnknownPointerSub_add_to_diag(self, diag) };
}

// diagnostics.rs:1239 (stub) `impl Diagnostic for NakedFunctionsAsmBlock`
export function NakedFunctionsAsmBlock_into_diag(_self: NakedFunctionsAsmBlock, _dcx: DiagCtxtHandle, _level: Level): Diag {
  return unported("rustc_hir_typeck::diagnostics::<NakedFunctionsAsmBlock as Diagnostic>::into_diag");
}
/** `NakedFunctionsAsmBlock` as a `Diagnostic` trait object. */
export function NakedFunctionsAsmBlock_diagnostic(self: NakedFunctionsAsmBlock): Diagnostic {
  return { into_diag: (dcx, level) => NakedFunctionsAsmBlock_into_diag(self, dcx, level) };
}

// diagnostics.rs:1260 (stub; final signature: decls.ts `Fns_diagnostics`)
export function maybe_emit_plus_equals_diagnostic(fnctxt: FnCtxt, assign_op: Spanned<AssignOpKind>, lhs_expr: hir.Expr): Result<undefined, Diag> {
  return unported("rustc_hir_typeck::diagnostics::maybe_emit_plus_equals_diagnostic");
}

// diagnostics.rs:1368 (stub) `ExprParenthesesNeeded::surrounding`
export function ExprParenthesesNeeded_surrounding(_s: Span): ExprParenthesesNeeded {
  return unported("rustc_hir_typeck::diagnostics::ExprParenthesesNeeded::surrounding");
}
