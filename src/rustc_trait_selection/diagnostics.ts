// Port of compiler/rustc_trait_selection/src/diagnostics.rs (lane errrep-infer-b; contract stub of lane errctxt-contract).
//
// The types and every `#[derive(Diagnostic)]` / `#[derive(Subdiagnostic)]` / `#[derive(LintDiagnostic)]` impl
// (`<T>_into_diag` + `<T>_diagnostic`, `<T>_add_to_diag` + `<T>_subdiagnostic`) are generated into diagnostics.gen.ts by
// tools/codegen/types.ts (set `rustc_trait_selection_error_reporting`). This module holds the hand-written impls of the file
// (decls.ts, comment-only section, `diagnostics.rs:<line>`), as stubs with their final names and signatures (precedent:
// rustc_hir_typeck diagnostics.ts): fill each body in place, add the marker
// `// rustc: compiler/rustc_trait_selection/src/diagnostics.rs:<line> <name>` and drop the `(stub ..)` comment.
// - `impl SourceKindSubdiag { fn new_fully_qualified, fn new_closure_return }` and `impl ActualImplExplNotes { fn
//   new_expected }` are the companions `SourceKindSubdiag` / `ActualImplExplNotes` (PORTING §8).
// - The free fn `impl_trait_overcapture_suggestion` has the signature of decls.ts `Fns_diagnostics`.
// - `hir_Ty` is rustc_hir's `Ty` under the name the generated file imports (tools/codegen/error_reporting.typemap.json).
// Init order: top-level code here may touch only the crate decls.ts, this file's .gen.ts and other crates.
export * from "./diagnostics.gen.ts";
export type { Ty as hir_Ty } from "../rustc_hir/lib.ts";
import type { DiagArgValue } from "../rustc_error_messages/lib.ts";
import type { Diag, DiagCtxtHandle, Diagnostic, Level, Subdiagnostic } from "../rustc_errors/lib.ts";
import type * as hir from "../rustc_hir/lib.ts";
import type { BytePos, PathBuf, Span } from "../rustc_span/lib.ts";
import type { MutRef } from "../std/mut_ref.ts";
import { unported } from "../std/panic.ts";
import type { Fns_diagnostics } from "./decls.ts";
import type * as gen from "./diagnostics.gen.ts";
import type {
  ActualImplExpectedKind,
  ActualImplExpectedLifetimeKind,
  AddLifetimeParamsSuggestion,
  AddPreciseCapturingAndParams,
  AddPreciseCapturingForOvercapture,
  AdjustSignatureBorrow,
  ConsiderBorrowingParamHelp,
  IntroducesStaticBecauseUnmetLifetimeReq,
  LifetimeMismatchLabels,
  NegativePositiveConflict,
  RegionOriginNote,
  SuggestTuplePatternMany,
  TyOrSig,
} from "./diagnostics.gen.ts";
import type { Highlighted } from "./error_reporting/infer/nice_region_error/placeholder_error.ts";
import type { TraitRefPrintOnlyTraitPath } from "../rustc_middle/ty/print/pretty.ts";

// diagnostics.rs:41 (stub) `impl Diagnostic<'_> for NegativePositiveConflict<'_>`
export function NegativePositiveConflict_into_diag(_self: NegativePositiveConflict, _dcx: DiagCtxtHandle, _level: Level): Diag {
  return unported("rustc_trait_selection::diagnostics::<NegativePositiveConflict as Diagnostic>::into_diag");
}
/** `NegativePositiveConflict` as a `Diagnostic` trait object. */
export function NegativePositiveConflict_diagnostic(self: NegativePositiveConflict): Diagnostic {
  return { into_diag: (dcx, level) => NegativePositiveConflict_into_diag(self, dcx, level) };
}

// diagnostics.rs:92 (stub) `impl Subdiagnostic for AdjustSignatureBorrow`
export function AdjustSignatureBorrow_add_to_diag(_self: AdjustSignatureBorrow, _diag: Diag): void {
  return unported("rustc_trait_selection::diagnostics::<AdjustSignatureBorrow as Subdiagnostic>::add_to_diag");
}
/** `AdjustSignatureBorrow` as a `Subdiagnostic` trait object. */
export function AdjustSignatureBorrow_subdiagnostic(self: AdjustSignatureBorrow): Subdiagnostic {
  return { add_to_diag: (diag) => AdjustSignatureBorrow_add_to_diag(self, diag) };
}

export type SourceKindSubdiag = gen.SourceKindSubdiag;
/** `impl<'a> SourceKindSubdiag<'a>` (PORTING §8: on the companion). */
export const SourceKindSubdiag = {
  // diagnostics.rs:345 (stub)
  new_fully_qualified(_span: Span, _def_path: string, _adjustment: string, _successor: [string, BytePos]): SourceKindSubdiag {
    return unported("rustc_trait_selection::diagnostics::SourceKindSubdiag::new_fully_qualified");
  },
  // diagnostics.rs:360 (stub)
  new_closure_return(_ty_info: string, _data: hir.FnRetTy, _should_wrap_expr: Span | undefined): SourceKindSubdiag {
    return unported("rustc_trait_selection::diagnostics::SourceKindSubdiag::new_closure_return");
  },
};

// diagnostics.rs:440 (stub) `impl Subdiagnostic for RegionOriginNote<'_>`
export function RegionOriginNote_add_to_diag(_self: RegionOriginNote, _diag: Diag): void {
  return unported("rustc_trait_selection::diagnostics::<RegionOriginNote as Subdiagnostic>::add_to_diag");
}
/** `RegionOriginNote` as a `Subdiagnostic` trait object. */
export function RegionOriginNote_subdiagnostic(self: RegionOriginNote): Subdiagnostic {
  return { add_to_diag: (diag) => RegionOriginNote_add_to_diag(self, diag) };
}

// diagnostics.rs:535 (stub) `impl Subdiagnostic for LifetimeMismatchLabels`
export function LifetimeMismatchLabels_add_to_diag(_self: LifetimeMismatchLabels, _diag: Diag): void {
  return unported("rustc_trait_selection::diagnostics::<LifetimeMismatchLabels as Subdiagnostic>::add_to_diag");
}
/** `LifetimeMismatchLabels` as a `Subdiagnostic` trait object. */
export function LifetimeMismatchLabels_subdiagnostic(self: LifetimeMismatchLabels): Subdiagnostic {
  return { add_to_diag: (diag) => LifetimeMismatchLabels_add_to_diag(self, diag) };
}

// diagnostics.rs:608 (stub) `impl Subdiagnostic for AddLifetimeParamsSuggestion<'_>` (its body defines the visitor
// `ImplicitLifetimeFinder`, diagnostics.rs:675)
export function AddLifetimeParamsSuggestion_add_to_diag(_self: AddLifetimeParamsSuggestion, _diag: Diag): void {
  return unported("rustc_trait_selection::diagnostics::<AddLifetimeParamsSuggestion as Subdiagnostic>::add_to_diag");
}
/** `AddLifetimeParamsSuggestion` as a `Subdiagnostic` trait object. */
export function AddLifetimeParamsSuggestion_subdiagnostic(self: AddLifetimeParamsSuggestion): Subdiagnostic {
  return { add_to_diag: (diag) => AddLifetimeParamsSuggestion_add_to_diag(self, diag) };
}

// diagnostics.rs:792 (stub) `impl Subdiagnostic for IntroducesStaticBecauseUnmetLifetimeReq`
export function IntroducesStaticBecauseUnmetLifetimeReq_add_to_diag(_self: IntroducesStaticBecauseUnmetLifetimeReq, _diag: Diag): void {
  return unported("rustc_trait_selection::diagnostics::<IntroducesStaticBecauseUnmetLifetimeReq as Subdiagnostic>::add_to_diag");
}
/** `IntroducesStaticBecauseUnmetLifetimeReq` as a `Subdiagnostic` trait object. */
export function IntroducesStaticBecauseUnmetLifetimeReq_subdiagnostic(self: IntroducesStaticBecauseUnmetLifetimeReq): Subdiagnostic {
  return { add_to_diag: (diag) => IntroducesStaticBecauseUnmetLifetimeReq_add_to_diag(self, diag) };
}

// diagnostics.rs:905 (stub) `impl IntoDiagArg for TyOrSig<'_>`
export function TyOrSig_into_diag_arg(_self: TyOrSig, _path: MutRef<PathBuf | undefined>): DiagArgValue {
  return unported("rustc_trait_selection::diagnostics::<TyOrSig as IntoDiagArg>::into_diag_arg");
}

export type ActualImplExplNotes = gen.ActualImplExplNotes;
/** `impl<'tcx> ActualImplExplNotes<'tcx>` (PORTING §8: on the companion). */
export const ActualImplExplNotes = {
  // diagnostics.rs:1088 (stub)
  new_expected(
    _kind: ActualImplExpectedKind,
    _lt_kind: ActualImplExpectedLifetimeKind,
    _ty_or_sig: TyOrSig,
    _trait_path: Highlighted<TraitRefPrintOnlyTraitPath>,
    _lifetime_1: number,
    _lifetime_2: number,
    _satisfy_span: Span | undefined,
    _item_span: Span | undefined,
    _outer_span: Span | undefined,
    _item_name: string,
  ): ActualImplExplNotes {
    return unported("rustc_trait_selection::diagnostics::ActualImplExplNotes::new_expected");
  },
};

// diagnostics.rs:1183 (stub) `impl Subdiagnostic for ConsiderBorrowingParamHelp`
export function ConsiderBorrowingParamHelp_add_to_diag(_self: ConsiderBorrowingParamHelp, _diag: Diag): void {
  return unported("rustc_trait_selection::diagnostics::<ConsiderBorrowingParamHelp as Subdiagnostic>::add_to_diag");
}
/** `ConsiderBorrowingParamHelp` as a `Subdiagnostic` trait object. */
export function ConsiderBorrowingParamHelp_subdiagnostic(self: ConsiderBorrowingParamHelp): Subdiagnostic {
  return { add_to_diag: (diag) => ConsiderBorrowingParamHelp_add_to_diag(self, diag) };
}

// diagnostics.rs:1664 (stub) `impl Subdiagnostic for SuggestTuplePatternMany`
export function SuggestTuplePatternMany_add_to_diag(_self: SuggestTuplePatternMany, _diag: Diag): void {
  return unported("rustc_trait_selection::diagnostics::<SuggestTuplePatternMany as Subdiagnostic>::add_to_diag");
}
/** `SuggestTuplePatternMany` as a `Subdiagnostic` trait object. */
export function SuggestTuplePatternMany_subdiagnostic(self: SuggestTuplePatternMany): Subdiagnostic {
  return { add_to_diag: (diag) => SuggestTuplePatternMany_add_to_diag(self, diag) };
}

// diagnostics.rs:1910 (stub) `impl Subdiagnostic for AddPreciseCapturingAndParams`
export function AddPreciseCapturingAndParams_add_to_diag(_self: AddPreciseCapturingAndParams, _diag: Diag): void {
  return unported("rustc_trait_selection::diagnostics::<AddPreciseCapturingAndParams as Subdiagnostic>::add_to_diag");
}
/** `AddPreciseCapturingAndParams` as a `Subdiagnostic` trait object. */
export function AddPreciseCapturingAndParams_subdiagnostic(self: AddPreciseCapturingAndParams): Subdiagnostic {
  return { add_to_diag: (diag) => AddPreciseCapturingAndParams_add_to_diag(self, diag) };
}

// diagnostics.rs:1928 (stub; lane errrep-infer-b)
export const impl_trait_overcapture_suggestion = ((): never =>
  unported("rustc_trait_selection::diagnostics::impl_trait_overcapture_suggestion")) as Fns_diagnostics["impl_trait_overcapture_suggestion"];

// diagnostics.rs:2060 (stub) `impl Subdiagnostic for AddPreciseCapturingForOvercapture`
export function AddPreciseCapturingForOvercapture_add_to_diag(_self: AddPreciseCapturingForOvercapture, _diag: Diag): void {
  return unported("rustc_trait_selection::diagnostics::<AddPreciseCapturingForOvercapture as Subdiagnostic>::add_to_diag");
}
/** `AddPreciseCapturingForOvercapture` as a `Subdiagnostic` trait object. */
export function AddPreciseCapturingForOvercapture_subdiagnostic(self: AddPreciseCapturingForOvercapture): Subdiagnostic {
  return { add_to_diag: (diag) => AddPreciseCapturingForOvercapture_add_to_diag(self, diag) };
}
