// Port of compiler/rustc_trait_selection/src/error_reporting/infer/need_type_info.rs (lane errrep-need-type-info; contract stub of lane errctxt-contract).
//
// How to fill this stub (docs/handoff/errctxt-contract.md "How to fill a stub"):
// - Every fn of this file is declared in src/rustc_trait_selection/decls.ts under `// error_reporting/infer/need_type_info.rs:<line>`:
//   `interface TypeErrCtxt` (methods), `NiceRegionError` (methods / statics), `Fns_<module>` (free fns) or a comment-only
//   declaration (trait impls, helper types: pick the TS form). Do not change a real signature; write a needed change in
//   your handoff (or a local `declare module` marked `// PORT(decls): pending root`).
// - Methods: in upstream order, `TypeErrCtxt.prototype.<name> = function (this: TypeErrCtxt, ..): R { .. };` with
//   `// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/need_type_info.rs:<line> <name>` directly above, then delete the name from the
//   `unported_methods(..)` list below (and the call when the list is empty). In a split file edit only your lane's list.
// - Free fns: replace `export const f = ((): never => unported(..)) as Fns_..["f"]` by `export function f(..)` with the
//   declared signature and the marker. `self.tcx` / `self.infcx` / InferCtxt methods are read through the Deref forwarders
//   (`this.tcx`, `this.next_ty_var(..)`); a `&TypeErrCtxt` passed as `&InferCtxt` is `this.infcx`.
// Init order: top-level code here may touch only the crate decls.ts (TypeErrCtxt), this file's .gen.ts and other
// crates; other rustc_trait_selection modules are read inside function bodies only.
//
// need_type_info.rs is not in the codegen set (the typedefs probe, syn, cannot parse its `do yeet ()`): its types are
// written here by hand, fields in declaration order (`// rustc-type:` markers). The lane adds the derived `Debug` of
// `InferSource` / `InferSourceKind` / `InsertableGenericArgs` (only `debug!`) and writes the hand classes `ClosureEraser`
// (a `TypeFolder`) and `FindInferSourceVisitor` (an intravisit `Visitor`), now `unknown` aliases.
import type { DiagArgValue } from "../../../rustc_error_messages/lib.ts";
import type * as hir from "../../../rustc_hir/lib.ts";
import type { HirId } from "../../../rustc_hir_id/lib.ts";
import type { PatKind } from "../../../rustc_hir/lib.ts";
import type { GenericArg, GenericArgs } from "../../../rustc_middle/ty/generic_args.ts";
import type { Ty } from "../../../rustc_middle/ty/decls.ts";
import type { DefId } from "../../../rustc_span/def_id.ts";
import type { BytePos, PathBuf, Span } from "../../../rustc_span/lib.ts";
import type { Ident } from "../../../rustc_span/symbol.ts";
import { unported_methods } from "../../../rust_ts/stubs.ts";
import type { MutRef } from "../../../std/mut_ref.ts";
import { unported } from "../../../std/panic.ts";
import { TypeErrCtxt } from "../../decls.ts";
import type { Fns_error_reporting_infer_need_type_info } from "../../decls.ts";

// rustc-type: compiler/rustc_trait_selection/src/error_reporting/infer/need_type_info.rs:33 TypeAnnotationNeeded
export type TypeAnnotationNeeded =
  /// ```compile_fail,E0282
  /// let x;
  /// ```
  | "E0282"
  /// An implementation cannot be chosen unambiguously because of lack of information.
  /// ```compile_fail,E0790
  /// let _ = Default::default();
  /// ```
  | "E0283"
  /// ```compile_fail,E0284
  /// let mut d: u64 = 2;
  /// d = d % 1u32.into();
  /// ```
  | "E0284";
export const TypeAnnotationNeeded = { E0282: "E0282", E0283: "E0283", E0284: "E0284" } as const;

// rustc-type: compiler/rustc_trait_selection/src/error_reporting/infer/need_type_info.rs:61 InferenceDiagnosticsData
/// Information about a constant or a type containing inference variables.
export interface InferenceDiagnosticsData {
  name: string;
  span: Span | undefined;
  kind: UnderspecifiedArgKind;
  parent: InferenceDiagnosticsParentData | undefined;
}

// rustc-type: compiler/rustc_trait_selection/src/error_reporting/infer/need_type_info.rs:69 InferenceDiagnosticsParentData
/// Data on the parent definition where a generic argument was declared.
export interface InferenceDiagnosticsParentData {
  prefix: string;
  name: string;
}

// rustc-type: compiler/rustc_trait_selection/src/error_reporting/infer/need_type_info.rs:75 UnderspecifiedArgKind
// PORT: `prefix: Cow<'static, str>` is a `string`.
export type UnderspecifiedArgKind = { readonly $: "Type"; prefix: string } | { readonly $: "Const"; is_parameter: boolean };

/** `#[derive(Clone)]` on `UnderspecifiedArgKind`. */
export function clone_UnderspecifiedArgKind(v: UnderspecifiedArgKind): UnderspecifiedArgKind {
  switch (v.$) {
    case "Type":
      return { $: "Type", prefix: v.prefix };
    case "Const":
      return { $: "Const", is_parameter: v.is_parameter };
  }
}

// error_reporting/infer/need_type_info.rs:155 (stub) `impl IntoDiagArg for UnderspecifiedArgKind`
export function UnderspecifiedArgKind_into_diag_arg(_self: UnderspecifiedArgKind, _: MutRef<PathBuf | undefined>): DiagArgValue {
  return unported("rustc_trait_selection::error_reporting::infer::need_type_info::<UnderspecifiedArgKind as IntoDiagArg>::into_diag_arg");
}

/** PORT(hand type): `struct ClosureEraser<'a, 'tcx> { infcx, depth }` (need_type_info.rs:174), a `TypeFolder`: lane errrep-need-type-info. */
export type ClosureEraser = unknown;

// rustc-type: compiler/rustc_trait_selection/src/error_reporting/infer/need_type_info.rs:627 InferSource
export interface InferSource {
  span: Span;
  kind: InferSourceKind;
}

// rustc-type: compiler/rustc_trait_selection/src/error_reporting/infer/need_type_info.rs:633 InferSourceKind
export type InferSourceKind =
  | { readonly $: "LetBinding"; insert_span: Span; pattern_name: Ident | undefined; ty: Ty; def_id: DefId | undefined }
  | { readonly $: "ClosureArg"; insert_span: Span; ty: Ty; kind: PatKind }
  | {
      readonly $: "GenericArg";
      insert_span: Span;
      argument_index: number;
      generics_def_id: DefId;
      def_id: DefId;
      generic_args: readonly GenericArg[];
      have_turbofish: boolean;
      hir_id: HirId;
    }
  | {
      readonly $: "FullyQualifiedMethodCall";
      receiver: hir.Expr;
      /// If the method has other arguments, this is ", " and the start of the first argument,
      /// while for methods without arguments this is ")" and the end of the method call.
      successor: [string, BytePos];
      args: GenericArgs;
      def_id: DefId;
    }
  | { readonly $: "ClosureReturn"; ty: Ty; data: hir.FnRetTy; should_wrap_expr: Span | undefined };

// rustc-type: compiler/rustc_trait_selection/src/error_reporting/infer/need_type_info.rs:904 InsertableGenericArgs
export interface InsertableGenericArgs {
  insert_span: Span;
  args: GenericArgs;
  generics_def_id: DefId;
  def_id: DefId;
  have_turbofish: boolean;
  hir_id: HirId;
}

/**
 * PORT(hand type): `struct FindInferSourceVisitor<'a, 'tcx> { tecx, typeck_results, target, ty, attempt, infer_source_cost,
 * infer_source }` (need_type_info.rs:920), an intravisit `Visitor`: lane errrep-need-type-info.
 */
export type FindInferSourceVisitor = unknown;

// error_reporting/infer/need_type_info.rs:270 (stub; lane errrep-need-type-info)
export const fmt_printer = ((): never => unported("rustc_trait_selection::error_reporting::infer::need_type_info::fmt_printer")) as Fns_error_reporting_infer_need_type_info["fmt_printer"];
// error_reporting/infer/need_type_info.rs:304 (stub; lane errrep-need-type-info)
export const ty_to_string = ((): never => unported("rustc_trait_selection::error_reporting::infer::need_type_info::ty_to_string")) as Fns_error_reporting_infer_need_type_info["ty_to_string"];
// error_reporting/infer/need_type_info.rs:339 (stub; lane errrep-need-type-info)
export const closure_as_fn_str = ((): never => unported("rustc_trait_selection::error_reporting::infer::need_type_info::closure_as_fn_str")) as Fns_error_reporting_infer_need_type_info["closure_as_fn_str"];

unported_methods(TypeErrCtxt.prototype, "rustc_trait_selection::error_reporting::infer::need_type_info::TypeErrCtxt", [
  "extract_inference_diagnostics_data", "bad_inference_failure_err", "emit_inference_failure_err", "emit_inference_failure_err_with_type_hint",
]);
