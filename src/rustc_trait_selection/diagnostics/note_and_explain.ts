// Port of compiler/rustc_trait_selection/src/diagnostics/note_and_explain.rs (lane errrep-infer-b; contract stub of lane
// errctxt-contract).
//
// The types are generated (note_and_explain.gen.ts, set `rustc_trait_selection_error_reporting`; `DescriptionCtx` and
// `RegionExplanation` are classes). The hand-written fns are stubs with their final names and signatures (decls.ts
// comment-only section, `diagnostics/note_and_explain.rs:<line>`): the associated fns `DescriptionCtx.new` /
// `RegionExplanation.new` (statics assigned below), the `IntoDiagArg` impls of `PrefixKind` / `SuffixKind` and the
// `Subdiagnostic` impl of `RegionExplanation` (imported by ../diagnostics.gen.ts). Fill each body in place, add the marker
// `// rustc: compiler/rustc_trait_selection/src/diagnostics/note_and_explain.rs:<line> <name>` and drop the `(stub ..)`.
// Init order: top-level code here may touch only this file's .gen.ts and other crates.
export * from "./note_and_explain.gen.ts";
import type { DiagArgValue } from "../../rustc_error_messages/lib.ts";
import type { Diag, Subdiagnostic } from "../../rustc_errors/lib.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { Region } from "../../rustc_middle/ty/decls.ts";
import type { LocalDefId } from "../../rustc_span/def_id.ts";
import type { PathBuf, Span } from "../../rustc_span/lib.ts";
import type { MutRef } from "../../std/mut_ref.ts";
import { unported } from "../../std/panic.ts";
import { DescriptionCtx, type PrefixKind, RegionExplanation, type SuffixKind } from "./note_and_explain.gen.ts";

declare module "./note_and_explain.gen.ts" {
  namespace DescriptionCtx {
    // diagnostics/note_and_explain.rs:16
    function new_(tcx: TyCtxt, generic_param_scope: LocalDefId, region: Region, alt_span: Span | undefined): DescriptionCtx | undefined;
    export { new_ as new };
  }
  namespace RegionExplanation {
    // diagnostics/note_and_explain.rs:148
    function new_(
      tcx: TyCtxt,
      generic_param_scope: LocalDefId,
      region: Region,
      alt_span: Span | undefined,
      prefix: PrefixKind,
      suffix: SuffixKind,
    ): RegionExplanation | undefined;
    export { new_ as new };
  }
}

// diagnostics/note_and_explain.rs:16 (stub)
(DescriptionCtx as unknown as { new: typeof DescriptionCtx.new }).new = function (
  _tcx: TyCtxt,
  _generic_param_scope: LocalDefId,
  _region: Region,
  _alt_span: Span | undefined,
): DescriptionCtx | undefined {
  return unported("rustc_trait_selection::diagnostics::note_and_explain::DescriptionCtx::new");
};

// diagnostics/note_and_explain.rs:108 (stub) `impl IntoDiagArg for PrefixKind`
export function PrefixKind_into_diag_arg(_self: PrefixKind, _: MutRef<PathBuf | undefined>): DiagArgValue {
  return unported("rustc_trait_selection::diagnostics::note_and_explain::<PrefixKind as IntoDiagArg>::into_diag_arg");
}

// diagnostics/note_and_explain.rs:130 (stub) `impl IntoDiagArg for SuffixKind`
export function SuffixKind_into_diag_arg(_self: SuffixKind, _: MutRef<PathBuf | undefined>): DiagArgValue {
  return unported("rustc_trait_selection::diagnostics::note_and_explain::<SuffixKind as IntoDiagArg>::into_diag_arg");
}

// diagnostics/note_and_explain.rs:148 (stub)
(RegionExplanation as unknown as { new: typeof RegionExplanation.new }).new = function (
  _tcx: TyCtxt,
  _generic_param_scope: LocalDefId,
  _region: Region,
  _alt_span: Span | undefined,
  _prefix: PrefixKind,
  _suffix: SuffixKind,
): RegionExplanation | undefined {
  return unported("rustc_trait_selection::diagnostics::note_and_explain::RegionExplanation::new");
};

// diagnostics/note_and_explain.rs:165 (stub) `impl Subdiagnostic for RegionExplanation<'_>`
export function RegionExplanation_add_to_diag(_self: RegionExplanation, _diag: Diag): void {
  return unported("rustc_trait_selection::diagnostics::note_and_explain::<RegionExplanation as Subdiagnostic>::add_to_diag");
}
/** `RegionExplanation` as a `Subdiagnostic` trait object. */
export function RegionExplanation_subdiagnostic(self: RegionExplanation): Subdiagnostic {
  return { add_to_diag: (diag) => RegionExplanation_add_to_diag(self, diag) };
}
