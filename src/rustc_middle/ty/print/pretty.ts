// Port of compiler/rustc_middle/src/ty/print/pretty.rs (docs/plan-m3.md D7). Two lanes share this file:
// lane ty-print-a ports pretty.rs:1..1704, lane ty-print-b pretty.rs:1705..end. Each region has its own import
// block; edit only your own region.
//
// Extension module (docs/handoff/ty-contract.md "Init order"): rustc_middle/lib.ts loads it after the classes;
// its top-level code may touch only the classes it imports, never another extension module.

// ==== lane ty-print-a: pretty.rs:1..1704 ====

// ==== lane ty-print-b: pretty.rs:1705..end ====
// PORT decisions (docs/handoff/ty-print-b.md). This region follows lane ty-print-a's conventions (its handoff):
// `Result<(), PrintError>` is `PrintResult` and `?` is `if ((r = ..).$ === "Err") return r;`; `Printer` /
// `PrettyPrinter` are abstract classes; `write!(p, "..", args)` is one `write_str` of the formatted text; the impl
// `Print<P> for X` is the function `print_X(self, p)`, generic impls take their parameters' descriptors last.
// - The provided methods of `PrettyPrinter` in pretty.rs:1705..2055 are `PrettyPrinter.prototype` assignments
//   (declared on the class by the `declare module` below); `FmtPrinter` overrides by subclassing.
// - `FmtPrinter(Box<FmtPrinterData>)` keeps its tuple field `_0`; `Deref`/`DerefMut` to the data are realised as
//   that field (PORTING §8), so `self.empty_path` is `this._0.empty_path`.
// - `impl fmt::Display for X` (`forward_display_to_print!`) is `display_X(self): string`; a `fmt::Error` from the
//   printer panics as `ToString::to_string` does (lane ty-print-a's `IrPrint_print`).
// - `tcx.lift(x)` is the identity (rustc's `Lift` is skipped, PORTING §3).
// ---- lane ty-print-b imports ----
import { type ExternAbi, display_ExternAbi } from "../../../rustc_abi/extern_abi.ts";
import { Size } from "../../../rustc_abi/lib.ts";
import { Mutability } from "../../../rustc_ast_ir/lib.ts";
import { VisitorResult } from "../../../rustc_ast_ir/visit.ts";
import type { ExternCrate } from "../../../rustc_crate_store/cstore.ts";
import type { DiagArgValue } from "../../../rustc_error_messages/lib.ts";
import { DefKind, Namespace } from "../../../rustc_hir/def.ts";
import { ItemKind, Safety } from "../../../rustc_hir/hir.ts";
import { DefPathData, type DisambiguatedDefPathData } from "../../../rustc_hir_id/definitions.ts";
import { CrateNum, DefId, DefIdMap, DefIdSet, DefId_eq, LOCAL_CRATE, debug_DefId } from "../../../rustc_span/def_id.ts";
import { Ident, Symbol, display_Symbol, kw } from "../../../rustc_span/symbol.ts";
import { Limit } from "../../../rustc_structures/limit.ts";
import { BoundVar } from "../../../rustc_type_ir/lib.ts";
import { debug_BoundVariableKind } from "../../../rustc_type_ir/binder.gen.ts";
import { debug_BoundTy, debug_Placeholder, visit_with_Binder } from "../../../rustc_type_ir/binder.ts";
import type { AliasTerm } from "../../../rustc_type_ir/ty/alias.ts";
import type { BoundConstness, CoercePredicate, SubtypePredicate } from "../../../rustc_type_ir/predicate.ts";
import type {
  AliasTy,
  Binder,
  BoundRegion,
  BoundRegionKind,
  ClauseKind,
  ClosureArgs,
  ClosureKind,
  ConstVid,
  DebruijnIndex,
  EarlyBinder,
  ExistentialPredicate,
  ExistentialProjection,
  ExistentialTraitRef,
  HostEffectClause,
  NormalizesTo,
  OutlivesClause,
  PlaceholderType,
  PolyExistentialPredicate,
  PolyTraitClause,
  PolyTraitRef,
  PredicateKind,
  ProjectionClause,
  TraitClause,
  TraitRef,
  TyVid,
  TypeFlags as TypeFlagsT,
  Unnormalized,
  ValTreeKind,
} from "../../../rustc_type_ir/decls.ts";
import { INNERMOST, type Pending } from "../../../rustc_type_ir/decls.ts";
import { TypeFlags } from "../../../rustc_type_ir/flags.ts";
import { type FallibleTypeFolder, type PredicateProxy, type TypeFoldable, type TypeFolder, TypeFolder_provided } from "../../../rustc_type_ir/fold.ts";
import {
  fold_with_ClauseKind,
  fold_with_PredicateKind,
  try_fold_with_ClauseKind,
  try_fold_with_PredicateKind,
  visit_with_ClauseKind,
  visit_with_PredicateKind,
} from "../../../rustc_type_ir/predicate_kind.gen.ts";
import { debug_RegionVid } from "../../../rustc_type_ir/region_kind.ts";
import { Const, Region, debug_Region } from "../../../rustc_type_ir/sty/mod.ts";
import { AliasTerm as AliasTermC } from "../../../rustc_type_ir/term_kind.ts";
import { ClosureArgs as ClosureArgsC, debug_ClosureArgs } from "../../../rustc_type_ir/ty_kind/closure.ts";
import {
  Binder_map_bound,
  Binder_skip_binder,
  DebruijnIndex_shifted_in,
  DebruijnIndex_shifted_out,
  FnSig as FnSigC,
  type FnSig,
  fold_with_FnSig,
  try_fold_with_FnSig,
  type TypeAndMut,
  visit_with_FnSig,
} from "../../../rustc_type_ir/ty_kind.ts";
import { type TypeVisitable, type TypeVisitor, TypeVisitor_provided } from "../../../rustc_type_ir/visit.ts";
import { intern_key } from "../../../rust_ts/intern_key.ts";
import { KeyedMap } from "../../../rust_ts/keyed.ts";
import { type Debug, type Fmt, PLAIN, PRETTY, debug_char, debug_str, debug_struct } from "../../../std/fmt.ts";
import type { MutRef } from "../../../std/mut_ref.ts";
import { assert_eq, panic, unported, unreachable, unwrap } from "../../../std/panic.ts";
import { Err, Ok, type Result, unwrap_result } from "../../../std/result.ts";
import { utf8_len } from "../../../std/str.ts";
import type { Providers } from "../../queries.gen.ts";
import { with_ } from "../context/tls.ts";
import { TyCtxt } from "../context.ts";
import type { AdtDef, Allocation, AssocItem, ConstAllocation, Instance, Pattern, ScalarInt, Scalar, ValTree, Value } from "../decls.ts";
import { GenericArg } from "../generic_args.ts";
import type { GenericArgs } from "../generic_args.ts";
import type { Generics } from "../generics.ts";
import type { Clauses, List } from "../list.ts";
import { Term, Ty, Visibility, debug_Ty } from "../mod.ts";
import type { Clause, Predicate } from "../predicate.ts";
import type { EarlyParamRegion, LateParamRegionKind } from "../region.ts";
import type { ParamConst, ParamTy } from "../sty.ts";
import type { IntoQueryKey } from "../../query/into_query_key.ts";
import { into_query_key_DefId } from "../../query/into_query_key.ts";

// ==== DELETE AT MERGE: lane ty-print-a's items (print/mod.rs and pretty.rs:1..1704) this region uses. ====
// Same names and signatures as lane/ty-print-a's port (its module-level stand-ins included), so deleting this block is
// the whole reconciliation: lane a's region imports `Print`, `PRINT_OK`, `PrintError`, `PrintResult`, `print_Const`,
// `print_List_PolyExistentialPredicate`, `print_Region`, `print_Ty`, `Printer` from ./mod.ts into this module and
// defines the rest at module level (before this region, which needs `PrettyPrinter` at load). Bodies are lane a's
// (upstream) where this region's tests reach them, `unported` otherwise. No markers: lane a's port carries them.

/** `std::fmt::Error`. */
export type PrintError = { readonly $: "Error" };
/** `Result<(), PrintError>`. */
export type PrintResult = Result<undefined, PrintError>;
/** `Ok(())`. */
export const PRINT_OK: PrintResult = Ok(undefined);
/** `pub trait Print<P> { fn print(&self, p: &mut P) -> Result<(), PrintError>; }`: the impl for `T` is a function. */
export type Print<T, P extends Printer = PrettyPrinter> = (self: T, p: P) => PrintResult;

/** `trait Printer` (print/mod.rs:28). */
export abstract class Printer {
  abstract tcx(): TyCtxt;
  print_def_path(def_id: DefId, args: readonly GenericArg[]): PrintResult {
    return this.default_print_def_path(def_id, args);
  }
  print_impl_path(_impl_def_id: DefId, _args: readonly GenericArg[]): PrintResult {
    return unported("rustc_middle::ty::print::Printer::print_impl_path (lane ty-print-a)");
  }
  abstract print_region(region: Region): PrintResult;
  abstract print_type(ty: Ty): PrintResult;
  abstract print_dyn_existential(predicates: List<PolyExistentialPredicate>): PrintResult;
  abstract print_const(ct: Const): PrintResult;
  abstract print_crate_name(cnum: CrateNum): PrintResult;
  abstract print_path_with_simple(print_prefix: (p: this) => PrintResult, disambiguated_data: DisambiguatedDefPathData): PrintResult;
  abstract print_path_with_impl(print_prefix: (p: this) => PrintResult, self_ty: Ty, trait_ref: TraitRef | undefined): PrintResult;
  abstract print_path_with_generic_args(print_prefix: (p: this) => PrintResult, args: readonly GenericArg[]): PrintResult;
  abstract print_path_with_qualified(self_ty: Ty, trait_ref: TraitRef | undefined): PrintResult;
  print_coroutine_with_kind(_def_id: DefId, _parent_args: readonly GenericArg[], _kind: Ty): PrintResult {
    return unported("rustc_middle::ty::print::Printer::print_coroutine_with_kind (lane ty-print-a)");
  }
  reset_path(): PrintResult {
    return PRINT_OK;
  }
  should_omit_parent_def_path(_parent_def_id: DefId): boolean {
    return false;
  }
  default_print_def_path(_def_id: DefId, _args: readonly GenericArg[]): PrintResult {
    return unported("rustc_middle::ty::print::Printer::default_print_def_path (lane ty-print-a)");
  }
  default_print_impl_path(_impl_def_id: DefId, _self_ty: Ty, _impl_trait_ref: TraitRef | undefined): PrintResult {
    return unported("rustc_middle::ty::print::Printer::default_print_impl_path (lane ty-print-a)");
  }
}

/** `impl Print<P> for Region` (print/mod.rs:354). */
export function print_Region(self: Region, p: Printer): PrintResult {
  return p.print_region(self);
}
/** `impl Print<P> for Ty` (print/mod.rs:360). */
export function print_Ty(self: Ty, p: Printer): PrintResult {
  return p.print_type(self);
}
/** `impl Print<P> for &List<PolyExistentialPredicate>` (print/mod.rs:412). */
export function print_List_PolyExistentialPredicate(self: List<PolyExistentialPredicate>, p: Printer): PrintResult {
  return p.print_dyn_existential(self);
}
/** `impl Print<P> for Const` (print/mod.rs:418). */
export function print_Const(self: Const, p: Printer): PrintResult {
  return p.print_const(self);
}

/** A `thread_local!` `Cell<T>`. */
class TlCell<T> {
  constructor(private value: T) {}
  get(): T {
    return this.value;
  }
  set(v: T): void {
    this.value = v;
  }
  replace(v: T): T {
    const old = this.value;
    this.value = v;
    return old;
  }
}
const FORCE_IMPL_FILENAME_LINE = new TlCell<boolean>(false);
const SHOULD_PREFIX_WITH_CRATE_NAME = new TlCell<boolean>(false);
const SHOULD_PREFIX_WITH_CRATE = new TlCell<boolean>(false);
const FORCE_TRIMMED_PATH = new TlCell<boolean>(false);
const REDUCED_QUERIES = new TlCell<boolean>(false);
const RTN_MODE = new TlCell<RtnMode>("ForDiagnostic");

/// Rendering style for RTN types.
export type RtnMode = "ForDiagnostic" | "ForSignature" | "ForSuggestion";

/** `pub macro $name($e:expr) { { let _guard = $helper::new(); $e } }` */
function define_helper_macro<R>(tl: TlCell<boolean>, e: () => R): R {
  const old = tl.replace(true);
  try {
    return e();
  } finally {
    tl.set(old);
  }
}
export function with_reduced_queries(): boolean;
export function with_reduced_queries<R>(e: () => R): R;
export function with_reduced_queries<R>(e?: () => R): boolean | R {
  return e === undefined ? REDUCED_QUERIES.get() : define_helper_macro(REDUCED_QUERIES, e);
}
export function with_forced_impl_filename_line(): boolean;
export function with_forced_impl_filename_line<R>(e: () => R): R;
export function with_forced_impl_filename_line<R>(e?: () => R): boolean | R {
  return e === undefined ? FORCE_IMPL_FILENAME_LINE.get() : define_helper_macro(FORCE_IMPL_FILENAME_LINE, e);
}
export function with_resolve_crate_name(): boolean;
export function with_resolve_crate_name<R>(e: () => R): R;
export function with_resolve_crate_name<R>(e?: () => R): boolean | R {
  return e === undefined ? SHOULD_PREFIX_WITH_CRATE_NAME.get() : define_helper_macro(SHOULD_PREFIX_WITH_CRATE_NAME, e);
}
export function with_crate_prefix(): boolean;
export function with_crate_prefix<R>(e: () => R): R;
export function with_crate_prefix<R>(e?: () => R): boolean | R {
  return e === undefined ? SHOULD_PREFIX_WITH_CRATE.get() : define_helper_macro(SHOULD_PREFIX_WITH_CRATE, e);
}
export function with_forced_trimmed_paths(): boolean;
export function with_forced_trimmed_paths<R>(e: () => R): R;
export function with_forced_trimmed_paths<R>(e?: () => R): boolean | R {
  return e === undefined ? FORCE_TRIMMED_PATH.get() : define_helper_macro(FORCE_TRIMMED_PATH, e);
}

export type WrapBinderMode = "ForAll" | "Unsafe";
export const WrapBinderMode = {
  ForAll: "ForAll",
  Unsafe: "Unsafe",
  start_str(self: WrapBinderMode): string {
    switch (self) {
      case "ForAll":
        return "for<";
      case "Unsafe":
        return "unsafe<";
    }
  },
} as const;

/** `RegionHighlightMode` (pretty.rs:188). */
export class RegionHighlightMode {
  constructor(
    public highlight_regions: [[Region, number] | undefined, [Region, number] | undefined, [Region, number] | undefined],
    public keep_regions: boolean,
    public highlight_bound_region: [BoundRegionKind, number] | undefined,
  ) {}
  static default(): RegionHighlightMode {
    return new RegionHighlightMode([undefined, undefined, undefined], false, undefined);
  }
  clone(): RegionHighlightMode {
    return new RegionHighlightMode([...this.highlight_regions], this.keep_regions, this.highlight_bound_region);
  }
  highlighting_region(region: Region, number: number): void {
    const num_slots = this.highlight_regions.length;
    const first_avail_slot = this.highlight_regions.findIndex((s) => s === undefined);
    if (first_avail_slot === -1) {
      panic(`can only highlight ${num_slots} placeholders at a time`);
    }
    this.highlight_regions[first_avail_slot] = [region, number];
    this.keep_regions = true;
  }
  region_highlighted(region: Region): number | undefined {
    for (const h of this.highlight_regions) {
      if (h !== undefined && h[0] === region) return h[1];
    }
    return undefined;
  }
  highlighting_bound_region(br: BoundRegionKind, number: number): void {
    this.highlight_bound_region = [br, number];
  }
}

/** `trait PrettyPrinter: Printer + fmt::Write` (pretty.rs:263). */
export abstract class PrettyPrinter extends Printer {
  abstract write_str(s: string): PrintResult;
  pretty_print_value_path(def_id: DefId, args: readonly GenericArg[]): PrintResult {
    return this.print_def_path(def_id, args);
  }
  pretty_print_in_binder<T>(value: Binder<T>, print_T: Print<T, this>, _d_T: TypeFoldable<T>): PrintResult {
    return print_T(Binder_skip_binder(value), this);
  }
  wrap_binder<T>(value: Binder<T>, _mode: WrapBinderMode, f: (value: T, p: this) => PrintResult, _d_T: TypeFoldable<T>): PrintResult {
    return f(Binder_skip_binder(value), this);
  }
  comma_sep<T>(elems: Iterable<T>, print_T: Print<T, this>): PrintResult {
    let r: PrintResult;
    let first = true;
    for (const elem of elems) {
      if (first) {
        first = false;
        if ((r = print_T(elem, this)).$ === "Err") return r;
      } else {
        if ((r = this.write_str(", ")).$ === "Err") return r;
        if ((r = print_T(elem, this)).$ === "Err") return r;
      }
    }
    return PRINT_OK;
  }
  typed_value(f: (p: this) => PrintResult, t: (p: this) => PrintResult, conversion: string): PrintResult {
    let r: PrintResult;
    if ((r = this.write_str("{")).$ === "Err") return r;
    if ((r = f(this)).$ === "Err") return r;
    if ((r = this.write_str(conversion)).$ === "Err") return r;
    if ((r = t(this)).$ === "Err") return r;
    if ((r = this.write_str("}")).$ === "Err") return r;
    return PRINT_OK;
  }
  parenthesized(_f: (p: this) => PrintResult): PrintResult {
    return unported("rustc_middle::ty::print::pretty::PrettyPrinter::parenthesized (lane ty-print-a)");
  }
  maybe_parenthesized(_f: (p: this) => PrintResult, _parenthesized: boolean): PrintResult {
    return unported("rustc_middle::ty::print::pretty::PrettyPrinter::maybe_parenthesized (lane ty-print-a)");
  }
  abstract generic_delimiters(f: (p: this) => PrintResult): PrintResult;
  should_truncate(): boolean {
    return false;
  }
  abstract should_print_optional_region(region: Region): boolean;
  reset_type_limit(): void {}
  try_print_visible_def_path(_def_id: DefId): Result<boolean, PrintError> {
    return unported("rustc_middle::ty::print::pretty::PrettyPrinter::try_print_visible_def_path (lane ty-print-a)");
  }
  force_print_trimmed_def_path(_def_id: DefId): Result<boolean, PrintError> {
    return unported("rustc_middle::ty::print::pretty::PrettyPrinter::force_print_trimmed_def_path (lane ty-print-a)");
  }
  try_print_trimmed_def_path(_def_id: DefId): Result<boolean, PrintError> {
    return unported("rustc_middle::ty::print::pretty::PrettyPrinter::try_print_trimmed_def_path (lane ty-print-a)");
  }
  try_print_visible_def_path_recur(_def_id: DefId, _callers: DefId[]): Result<boolean, PrintError> {
    return unported("rustc_middle::ty::print::pretty::PrettyPrinter::try_print_visible_def_path_recur (lane ty-print-a)");
  }
  pretty_print_path_with_qualified(_self_ty: Ty, _trait_ref: TraitRef | undefined): PrintResult {
    return unported("rustc_middle::ty::print::pretty::PrettyPrinter::pretty_print_path_with_qualified (lane ty-print-a)");
  }
  pretty_print_path_with_impl(_print_prefix: (p: this) => PrintResult, _self_ty: Ty, _trait_ref: TraitRef | undefined): PrintResult {
    return unported("rustc_middle::ty::print::pretty::PrettyPrinter::pretty_print_path_with_impl (lane ty-print-a)");
  }
  pretty_print_type(_ty: Ty): PrintResult {
    return unported("rustc_middle::ty::print::pretty::PrettyPrinter::pretty_print_type (lane ty-print-a)");
  }
  pretty_print_inherent_projection(_alias_term: AliasTerm): PrintResult {
    return unported("rustc_middle::ty::print::pretty::PrettyPrinter::pretty_print_inherent_projection (lane ty-print-a)");
  }
  pretty_print_rpitit(_def_id: DefId, _args: GenericArgs): PrintResult {
    return unported("rustc_middle::ty::print::pretty::PrettyPrinter::pretty_print_rpitit (lane ty-print-a)");
  }
  ty_infer_name(_: TyVid): Symbol | undefined {
    return undefined;
  }
  const_infer_name(_: ConstVid): Symbol | undefined {
    return undefined;
  }
  pretty_print_dyn_existential(_predicates: List<PolyExistentialPredicate>): PrintResult {
    return unported("rustc_middle::ty::print::pretty::PrettyPrinter::pretty_print_dyn_existential (lane ty-print-a)");
  }
  pretty_print_fn_sig(_inputs: readonly Ty[], _c_variadic: boolean, _splatted: number | undefined, _output: Ty): PrintResult {
    return unported("rustc_middle::ty::print::pretty::PrettyPrinter::pretty_print_fn_sig (lane ty-print-a)");
  }
  pretty_print_const(_ct: Const, _print_ty: boolean): PrintResult {
    return unported("rustc_middle::ty::print::pretty::PrettyPrinter::pretty_print_const (lane ty-print-a)");
  }
}

/** Lane a's `str_cmp`: `Ord for str` (UTF-8 byte order, i.e. code point order). */
function str_cmp(a: string, b: string): number {
  const ia = a[globalThis.Symbol.iterator]();
  const ib = b[globalThis.Symbol.iterator]();
  for (;;) {
    const x = ia.next();
    const y = ib.next();
    if (x.done) return y.done ? 0 : -1;
    if (y.done) return 1;
    const cx = x.value.codePointAt(0)!;
    const cy = y.value.codePointAt(0)!;
    if (cx !== cy) return cx < cy ? -1 : 1;
  }
}
/** Lane a's `descriptor`: a D4 descriptor from the impl fns of a type. */
function descriptor<T>(
  visit_with: <R>(self: T, visitor: TypeVisitor<R>) => R,
  try_fold_with: <E>(self: T, folder: FallibleTypeFolder<E>) => Result<T, E>,
  fold_with: (self: T, folder: TypeFolder) => T,
): TypeFoldable<T> {
  return { visit_with, try_fold_with, fold_with };
}
/** Lane a's `fold_FnSig_`. */
const fold_FnSig_: TypeFoldable<FnSig> = descriptor<FnSig>(visit_with_FnSig, try_fold_with_FnSig, fold_with_FnSig);
/** Lane a's `Binder_no_bound_vars` (binder.rs; needs `has_escaping_bound_vars`). */
function Binder_no_bound_vars<T>(_self: Binder<T>): T | undefined {
  return unported("rustc_type_ir::binder::Binder::no_bound_vars (binder.rs)");
}
/** Lane a's `EarlyBinder_iter_instantiated_copied` (binder.rs). */
function EarlyBinder_iter_instantiated_copied<T>(_self: EarlyBinder<readonly T[]>, _tcx: TyCtxt, _args: readonly GenericArg[]): Unnormalized<T>[] {
  return unported("rustc_type_ir::binder::EarlyBinder::iter_instantiated_copied (binder.rs)");
}
/** Lane a's `Unnormalized_skip_norm_wip`: `self.value`. */
function Unnormalized_skip_norm_wip<T>(self: Unnormalized<T>): T {
  return self.value;
}
/** Lane a's `TraitRef_self_ty`: `self.args.type_at(0)`. */
function TraitRef_self_ty(self: TraitRef): Ty {
  return self.args.type_at(0);
}
/** Lane a's `ExistentialTraitRef_with_self_ty` (predicate.rs). */
function ExistentialTraitRef_with_self_ty(_self: ExistentialTraitRef, _tcx: TyCtxt, _self_ty: Ty): TraitRef {
  return unported("rustc_type_ir::predicate::ExistentialTraitRef::with_self_ty (predicate.rs)");
}
/** Lane a's `AssocItem_name` (ty/assoc.rs). */
function AssocItem_name(_self: AssocItem): Symbol {
  return unported("rustc_middle::ty::assoc::AssocItem::name (ty/assoc.rs)");
}
/** Lane a's `AdtDef_did` (ty/adt.rs; `AdtDef` is `Pending`). */
function AdtDef_did(_self: unknown): DefId {
  return unported("rustc_middle::ty::adt::AdtDef::did (ty/adt.rs)");
}
/** Lane a's `debug_Pattern` (ty/pattern.rs). */
function debug_Pattern(_pat: Pattern): string {
  return unported("rustc_middle::ty::pattern `impl Debug for Pattern` (ty/pattern.rs)");
}
/** Lane a's `Instance_def_id` (its mod.ts; ty/instance.rs). */
function Instance_def_id(_self: Instance): DefId {
  return unported("rustc_middle::ty::instance::Instance::def_id (ty/instance.rs)");
}
// ==== end of DELETE AT MERGE ====

// The provided methods of `trait PrettyPrinter` in pretty.rs:1705..2055, assigned to `PrettyPrinter.prototype` below.
declare module "./pretty.ts" {
  interface PrettyPrinter {
    // pretty.rs:1705
    pretty_print_const_scalar(scalar: Scalar, ty: Ty): PrintResult;
    // pretty.rs:1718
    pretty_print_const_scalar_ptr(ptr: Pointer, ty: Ty): PrintResult;
    // pretty.rs:1775
    pretty_print_const_scalar_int(int: ScalarInt, ty: Ty, print_ty: boolean): PrintResult;
    // pretty.rs:1852
    pretty_print_const_pointer(p: Pointer, ty: Ty): PrintResult;
    // pretty.rs:1867
    pretty_print_byte_str(byte_str: Uint8Array): PrintResult;
    // pretty.rs:1872
    pretty_print_const_valtree(cv: Value, print_ty: boolean): PrintResult;
    // pretty.rs:2014
    pretty_print_closure_as_impl(closure: ClosureArgs): PrintResult;
    // pretty.rs:2041
    pretty_print_bound_constness(constness: BoundConstness): PrintResult;
    // pretty.rs:2052
    should_print_verbose(): boolean;
  }
}

// rustc: compiler/rustc_middle/src/ty/print/pretty.rs:1705 pretty_print_const_scalar
PrettyPrinter.prototype.pretty_print_const_scalar = function (this: PrettyPrinter, scalar: Scalar, ty: Ty): PrintResult {
  const scalar_ = scalar as unknown as ScalarShape;
  switch (scalar_.$) {
    case "Ptr": {
      const ptr = scalar_._0;
      return this.pretty_print_const_scalar_ptr(ptr, ty);
    }
    case "Int": {
      const int = scalar_._0;
      return this.pretty_print_const_scalar_int(int, ty, /* print_ty */ true);
    }
  }
};

// rustc: compiler/rustc_middle/src/ty/print/pretty.rs:1718 pretty_print_const_scalar_ptr
PrettyPrinter.prototype.pretty_print_const_scalar_ptr = function (this: PrettyPrinter, ptr: Pointer, ty: Ty): PrintResult {
  let r: PrintResult;
  const [prov, offset] = Pointer_prov_and_relative_offset(ptr);
  const k = ty.kind();
  switch (k.$) {
    // Byte strings (&[u8; N])
    case "Ref": {
      const inner = k._1;
      const ik = inner.kind();
      if (ik.$ === "Array") {
        const elem = ik._0;
        const ct_len = ik._1;
        const ek = elem.kind();
        let len: number | undefined;
        if (ek.$ === "Uint" && ek._0 === "U8" && (len = ct_len.try_to_target_usize(this.tcx())) !== undefined) {
          const global_alloc = TyCtxt_try_get_global_alloc(this.tcx(), CtfeProvenance_alloc_id(prov));
          if (global_alloc === undefined) {
            if ((r = this.write_str("<dangling pointer>")).$ === "Err") return r;
          } else {
            switch (global_alloc.$) {
              case "Memory": {
                const alloc = global_alloc._0;
                const range: AllocRange = { start: offset, size: Size.from_bytes(len) };
                const byte_str = Allocation_get_bytes_strip_provenance(ConstAllocation_inner(alloc), this.tcx(), range);
                if (byte_str !== undefined) {
                  if ((r = this.pretty_print_byte_str(byte_str)).$ === "Err") return r;
                } else {
                  if ((r = this.write_str("<too short allocation>")).$ === "Err") return r;
                }
                break;
              }
              // FIXME: for statics, vtables, and functions, we could in principle print more detail.
              case "Static": {
                const def_id = global_alloc._0;
                if ((r = this.write_str(`<static(${debug_DefId(def_id, PLAIN)})>`)).$ === "Err") return r;
                break;
              }
              case "Function":
                if ((r = this.write_str("<function>")).$ === "Err") return r;
                break;
              case "VTable":
                if ((r = this.write_str("<vtable>")).$ === "Err") return r;
                break;
              case "TypeId":
                if ((r = this.write_str("<typeid>")).$ === "Err") return r;
                break;
            }
          }
          return PRINT_OK;
        }
      }
      break;
    }
    case "FnPtr": {
      // FIXME: We should probably have a helper method to share code with the "Byte strings"
      // printing above (which also has to handle pointers to all sorts of things).
      const global_alloc = TyCtxt_try_get_global_alloc(this.tcx(), CtfeProvenance_alloc_id(prov));
      if (global_alloc !== undefined && global_alloc.$ === "Function") {
        const instance = global_alloc.instance;
        if (
          (r = this.typed_value(
            (this_) => this_.pretty_print_value_path(Instance_def_id(instance), Instance_args(instance)),
            (this_) => this_.print_type(ty),
            " as ",
          )).$ === "Err"
        )
          return r;
        return PRINT_OK;
      }
      break;
    }
    default:
      break;
  }
  // Any pointer values not covered by a branch above
  if ((r = this.pretty_print_const_pointer(ptr, ty)).$ === "Err") return r;
  return PRINT_OK;
};

// rustc: compiler/rustc_middle/src/ty/print/pretty.rs:1775 pretty_print_const_scalar_int
PrettyPrinter.prototype.pretty_print_const_scalar_int = function (this: PrettyPrinter, int: ScalarInt, ty: Ty, print_ty: boolean): PrintResult {
  let r: PrintResult;
  const k = ty.kind();
  // Bool
  if (k.$ === "Bool" && ScalarInt_eq(int, ScalarInt_FALSE())) {
    if ((r = this.write_str("false")).$ === "Err") return r;
  } else if (k.$ === "Bool" && ScalarInt_eq(int, ScalarInt_TRUE())) {
    if ((r = this.write_str("true")).$ === "Err") return r;
  }
  // Float
  else if (k.$ === "Float") {
    const fty = k._0;
    switch (fty) {
      case "F16": {
        const val = unwrap_float(IeeeFloat_try_from_ScalarInt("Half", int));
        if ((r = this.write_str(`${display_IeeeFloat(val)}${IeeeFloat_is_finite(val) ? "" : "_"}f16`)).$ === "Err") return r;
        break;
      }
      case "F32": {
        const val = unwrap_float(IeeeFloat_try_from_ScalarInt("Single", int));
        if ((r = this.write_str(`${display_IeeeFloat(val)}${IeeeFloat_is_finite(val) ? "" : "_"}f32`)).$ === "Err") return r;
        break;
      }
      case "F64": {
        const val = unwrap_float(IeeeFloat_try_from_ScalarInt("Double", int));
        if ((r = this.write_str(`${display_IeeeFloat(val)}${IeeeFloat_is_finite(val) ? "" : "_"}f64`)).$ === "Err") return r;
        break;
      }
      case "F128": {
        const val = unwrap_float(IeeeFloat_try_from_ScalarInt("Quad", int));
        if ((r = this.write_str(`${display_IeeeFloat(val)}${IeeeFloat_is_finite(val) ? "" : "_"}f128`)).$ === "Err") return r;
        break;
      }
    }
  }
  // Int
  else if (k.$ === "Uint" || k.$ === "Int") {
    const int_ = ConstInt_new(int, k.$ === "Int", ty.is_ptr_sized_integral());
    if (print_ty) {
      if ((r = this.write_str(debug_ConstInt(int_, PRETTY))).$ === "Err") return r;
    } else {
      if ((r = this.write_str(debug_ConstInt(int_, PLAIN))).$ === "Err") return r;
    }
  }
  // Char
  else if (k.$ === "Char" && char_try_from_ScalarInt(int) !== undefined) {
    if ((r = this.write_str(debug_char(unwrap(char_try_from_ScalarInt(int))))).$ === "Err") return r;
  }
  // Pointer types
  else if (k.$ === "Ref" || k.$ === "RawPtr" || k.$ === "FnPtr") {
    const data = ScalarInt_to_bits(int, TargetDataLayout_pointer_size(this.tcx().gcx.data_layout));
    if (
      (r = this.typed_value(
        (this_) => {
          let r: PrintResult;
          if ((r = this_.write_str(`0x${data.toString(16)}`)).$ === "Err") return r;
          return PRINT_OK;
        },
        (this_) => this_.print_type(ty),
        " as ",
      )).$ === "Err"
    )
      return r;
  } else if (k.$ === "Pat" && TyCtxt_validate_scalar_in_layout(this.tcx(), int, ty)) {
    const base_ty = k._0;
    const pat = k._1;
    if ((r = this.pretty_print_const_scalar_int(int, base_ty, print_ty)).$ === "Err") return r;
    if ((r = this.write_str(` is ${debug_Pattern(pat)}`)).$ === "Err") return r;
  }
  // Nontrivial types with scalar bit representation
  else {
    const print = (this_: PrettyPrinter): PrintResult => {
      let r: PrintResult;
      if (ScalarInt_size(int).raw === Size.ZERO.raw) {
        if ((r = this_.write_str("transmute(())")).$ === "Err") return r;
      } else {
        if ((r = this_.write_str(`transmute(0x${lower_hex_ScalarInt(int)})`)).$ === "Err") return r;
      }
      return PRINT_OK;
    };
    if (print_ty) {
      if ((r = this.typed_value(print, (this_) => this_.print_type(ty), ": ")).$ === "Err") return r;
    } else {
      if ((r = print(this)).$ === "Err") return r;
    }
  }
  return PRINT_OK;
};

/// This is overridden for MIR printing because we only want to hide alloc ids from users, not
/// from MIR where it is actually useful.
// rustc: compiler/rustc_middle/src/ty/print/pretty.rs:1852 pretty_print_const_pointer
PrettyPrinter.prototype.pretty_print_const_pointer = function (this: PrettyPrinter, _: Pointer, ty: Ty): PrintResult {
  return this.typed_value(
    (this_) => {
      let r: PrintResult;
      if ((r = this_.write_str("&_")).$ === "Err") return r;
      return PRINT_OK;
    },
    (this_) => this_.print_type(ty),
    ": ",
  );
};

// rustc: compiler/rustc_middle/src/ty/print/pretty.rs:1867 pretty_print_byte_str
PrettyPrinter.prototype.pretty_print_byte_str = function (this: PrettyPrinter, byte_str: Uint8Array): PrintResult {
  let r: PrintResult;
  if ((r = this.write_str(`b"${escape_ascii(byte_str)}"`)).$ === "Err") return r;
  return PRINT_OK;
};

// rustc: compiler/rustc_middle/src/ty/print/pretty.rs:1872 pretty_print_const_valtree
PrettyPrinter.prototype.pretty_print_const_valtree = function (this: PrettyPrinter, cv: Value, print_ty: boolean): PrintResult {
  let r: PrintResult;
  const cv_ = cv as unknown as ValueShape;
  if (with_reduced_queries() || this.should_print_verbose()) {
    if ((r = this.write_str(`ValTree(${debug_ValTree(cv_.valtree, PLAIN)}: `)).$ === "Err") return r;
    if ((r = print_Ty(cv_.ty, this)).$ === "Err") return r;
    if ((r = this.write_str(")")).$ === "Err") return r;
    return PRINT_OK;
  }

  const u8_type = this.tcx().types.u8;
  const vk = ValTree_deref(cv_.valtree);
  const tk = cv_.ty.kind();
  if (vk.$ === "Branch" && tk.$ === "Ref") {
    const inner_ty = tk._1;
    const ik = inner_ty.kind();
    if (ik.$ === "Slice" && ik._0 === u8_type) {
      const t = ik._0;
      const bytes = Value_try_to_raw_bytes(cv_, this.tcx());
      if (bytes === undefined) {
        return panic(`expected to convert valtree ${debug_ValTree(cv_.valtree, PLAIN)} to raw bytes for type ${debug_Ty(t, PLAIN)}`);
      }
      return this.pretty_print_byte_str(bytes);
    } else if (ik.$ === "Str") {
      const bytes = Value_try_to_raw_bytes(cv_, this.tcx());
      if (bytes === undefined) {
        return panic(`expected to convert valtree to raw bytes for type ${debug_Ty(cv_.ty, PLAIN)}`);
      }
      if ((r = this.write_str(debug_str(String_from_utf8_lossy(bytes)))).$ === "Err") return r;
      return PRINT_OK;
    } else {
      const cv: ValueShape = { valtree: cv_.valtree, ty: inner_ty };
      if ((r = this.write_str("&")).$ === "Err") return r;
      if ((r = this.pretty_print_const_valtree(cv as unknown as Value, print_ty)).$ === "Err") return r;
      return PRINT_OK;
    }
  }
  // If it is a branch with an array, and this array can be printed as raw bytes, then dump its bytes
  let bytes: Uint8Array | undefined;
  if (vk.$ === "Branch" && tk.$ === "Array" && tk._0 === u8_type && (bytes = Value_try_to_raw_bytes(cv_, this.tcx())) !== undefined) {
    if ((r = this.write_str("*")).$ === "Err") return r;
    if ((r = this.pretty_print_byte_str(bytes)).$ === "Err") return r;
    return PRINT_OK;
  }
  // Otherwise, print the array separated by commas (or if it's a tuple)
  if (vk.$ === "Branch" && (tk.$ === "Array" || tk.$ === "Tuple")) {
    const fields = vk._0;
    const fields_iter = fields;

    const k2 = cv_.ty.kind();
    switch (k2.$) {
      case "Array": {
        if ((r = this.write_str("[")).$ === "Err") return r;
        if ((r = this.comma_sep(fields_iter, print_Const)).$ === "Err") return r;
        if ((r = this.write_str("]")).$ === "Err") return r;
        break;
      }
      case "Tuple": {
        if ((r = this.write_str("(")).$ === "Err") return r;
        if ((r = this.comma_sep(fields_iter, print_Const)).$ === "Err") return r;
        if (fields.length === 1) {
          if ((r = this.write_str(",")).$ === "Err") return r;
        }
        if ((r = this.write_str(")")).$ === "Err") return r;
        break;
      }
      default:
        unreachable();
    }
    return PRINT_OK;
  }
  if (vk.$ === "Branch" && tk.$ === "Adt") {
    const def = tk._0;
    const args = tk._1;
    const contents = Value_destructure_adt_const(cv_);
    const fields = contents.fields;

    if (AdtDef_variants(def).length === 0) {
      if (
        (r = this.typed_value(
          (this_) => {
            let r: PrintResult;
            if ((r = this_.write_str("unreachable()")).$ === "Err") return r;
            return PRINT_OK;
          },
          (this_) => this_.print_type(cv_.ty),
          ": ",
        )).$ === "Err"
      )
        return r;
    } else {
      const variant_idx = contents.variant;
      const variant_def = AdtDef_variant(def, variant_idx);
      if ((r = this.pretty_print_value_path(variant_def.def_id, args)).$ === "Err") return r;
      const ctor_kind = VariantDef_ctor_kind(variant_def);
      if (ctor_kind === "Const") {
        // nothing
      } else if (ctor_kind === "Fn") {
        if ((r = this.write_str("(")).$ === "Err") return r;
        if ((r = this.comma_sep(fields, print_Const)).$ === "Err") return r;
        if ((r = this.write_str(")")).$ === "Err") return r;
      } else {
        if ((r = this.write_str(" { ")).$ === "Err") return r;
        let first = true;
        const n = Math.min(variant_def.fields.length, fields.length);
        for (let i = 0; i < n; i++) {
          const field_def = variant_def.fields[i]!;
          const field = fields[i]!;
          if (!first) {
            if ((r = this.write_str(", ")).$ === "Err") return r;
          }
          if ((r = this.write_str(`${display_Symbol(field_def.name)}: `)).$ === "Err") return r;
          if ((r = print_Const(field, this)).$ === "Err") return r;
          first = false;
        }
        if ((r = this.write_str(" }")).$ === "Err") return r;
      }
    }
    return PRINT_OK;
  }
  if (vk.$ === "Leaf" && tk.$ === "Ref") {
    const leaf = vk._0;
    const inner_ty = tk._1;
    if ((r = this.write_str("&")).$ === "Err") return r;
    return this.pretty_print_const_scalar_int(leaf, inner_ty, print_ty);
  }
  if (vk.$ === "Leaf") {
    const leaf = vk._0;
    return this.pretty_print_const_scalar_int(leaf, cv_.ty, print_ty);
  }
  if (tk.$ === "FnDef") {
    const def_id = tk._0;
    const args = tk._1;
    // Never allowed today, but we still encounter them in invalid const args.
    // FIXME(addiesh): fix wrt late-bound stuff
    if ((r = this.pretty_print_value_path(def_id, unwrap(Binder_no_bound_vars(args)))).$ === "Err") return r;
    return PRINT_OK;
  }
  // FIXME(oli-obk): also pretty print arrays and other aggregate constants by reading
  // their fields instead of just dumping the memory.

  // fallback
  if (ValTree_is_zst(cv_.valtree)) {
    if ((r = this.write_str("<ZST>")).$ === "Err") return r;
  } else {
    if ((r = this.write_str(debug_ValTree(cv_.valtree, PLAIN))).$ === "Err") return r;
  }
  if (print_ty) {
    if ((r = this.write_str(": ")).$ === "Err") return r;
    if ((r = print_Ty(cv_.ty, this)).$ === "Err") return r;
  }
  return PRINT_OK;
};

// rustc: compiler/rustc_middle/src/ty/print/pretty.rs:2014 pretty_print_closure_as_impl
PrettyPrinter.prototype.pretty_print_closure_as_impl = function (this: PrettyPrinter, closure: ClosureArgs): PrintResult {
  let r: PrintResult;
  const sig = ClosureArgsC.sig(closure);
  const kind = ClosureArgsC.kind_ty(closure).to_opt_closure_kind() ?? "Fn";

  if ((r = this.write_str("impl ")).$ === "Err") return r;
  return this.wrap_binder(
    sig,
    WrapBinderMode.ForAll,
    (sig, p) => {
      let r: PrintResult;
      if ((r = p.write_str(`${display_ClosureKind(kind)}(`)).$ === "Err") return r;
      const fields = unwrap(FnSigC.inputs(sig)[0]).tuple_fields();
      for (let i = 0; i < fields.length; i++) {
        const arg = fields[i]!;
        if (i > 0) {
          if ((r = p.write_str(", ")).$ === "Err") return r;
        }
        if ((r = print_Ty(arg, p)).$ === "Err") return r;
      }
      if ((r = p.write_str(")")).$ === "Err") return r;

      if (!FnSigC.output(sig).is_unit()) {
        if ((r = p.write_str(" -> ")).$ === "Err") return r;
        if ((r = print_Ty(FnSigC.output(sig), p)).$ === "Err") return r;
      }

      return PRINT_OK;
    },
    fold_FnSig_,
  );
};

// rustc: compiler/rustc_middle/src/ty/print/pretty.rs:2041 pretty_print_bound_constness
PrettyPrinter.prototype.pretty_print_bound_constness = function (this: PrettyPrinter, constness: BoundConstness): PrintResult {
  let r: PrintResult;
  switch (constness) {
    case "Const":
      if ((r = this.write_str("const ")).$ === "Err") return r;
      break;
    case "Maybe":
      if ((r = this.write_str("[const] ")).$ === "Err") return r;
      break;
  }
  return PRINT_OK;
};

// rustc: compiler/rustc_middle/src/ty/print/pretty.rs:2052 should_print_verbose
PrettyPrinter.prototype.should_print_verbose = function (this: PrettyPrinter): boolean {
  return this.tcx().sess.verbose_internals();
};

// PORT: `fmt: &mut fmt::Formatter` is the output: the fn returns what it writes (the `Debug<T>` convention); a
// `fmt::Error` panics (see the region header).
// rustc: compiler/rustc_middle/src/ty/print/pretty.rs:2057 pretty_print_const
export function pretty_print_const(c: Const, fmt: Fmt, print_types: boolean): string {
  void fmt;
  return with_((tcx) => {
    const p = FmtPrinter.new(tcx, Namespace.ValueNS);
    p._0.print_alloc_ids = true;
    const r = p.pretty_print_const(/* tcx.lift */ c, print_types);
    if (r.$ === "Err") panic("a Display implementation returned an error unexpectedly: Error");
    return p.into_buffer();
  });
}

// rustc-type: compiler/rustc_middle/src/ty/print/pretty.rs:2074 FmtPrinterData
export interface FmtPrinterData {
  tcx: TyCtxt;
  fmt: string;

  empty_path: boolean;
  in_value: boolean;
  print_alloc_ids: boolean;

  // set of all named (non-anonymous) region names
  used_region_names: Set<Symbol>;

  region_index: number;
  binder_depth: number;
  printed_type_count: number;
  type_length_limit: Limit;

  region_highlight_mode: RegionHighlightMode;

  ty_infer_name_resolver: ((id: TyVid) => Symbol | undefined) | undefined;
  const_infer_name_resolver: ((id: ConstVid) => Symbol | undefined) | undefined;
}

// HACK(eddyb) boxed to avoid moving around a large struct by-value.
// PORT: every `impl` block of `FmtPrinter` (pretty.rs:2096..2953) is in this class body (PORTING §8); the markers keep
// the upstream lines. The `Printer` / `PrettyPrinter` impls override the abstract classes' methods.
// rustc-type: compiler/rustc_middle/src/ty/print/pretty.rs:2072 FmtPrinter
export class FmtPrinter extends PrettyPrinter {
  constructor(public _0: FmtPrinterData) {
    super();
  }

  // impl Deref for FmtPrinter
  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:2098 deref
  deref(): FmtPrinterData {
    return this._0;
  }

  // impl DerefMut for FmtPrinter
  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:2104 deref_mut
  deref_mut(): FmtPrinterData {
    return this._0;
  }

  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:2110 new
  static new(tcx: TyCtxt, ns: Namespace): FmtPrinter {
    const limit = with_reduced_queries() ? Limit.new(1048576) : tcx.type_length_limit();
    return FmtPrinter.new_with_limit(tcx, ns, limit);
  }

  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:2116 print_string
  static print_string(tcx: TyCtxt, ns: Namespace, f: (p: FmtPrinter) => PrintResult): Result<string, PrintError> {
    let r: PrintResult;
    const c = FmtPrinter.new(tcx, ns);
    if ((r = f(c)).$ === "Err") return r;
    return Ok(c.into_buffer());
  }

  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:2126 new_with_limit
  static new_with_limit(tcx: TyCtxt, ns: Namespace, type_length_limit: Limit): FmtPrinter {
    return new FmtPrinter({
      tcx,
      // Estimated reasonable capacity to allocate upfront based on a few
      // benchmarks.
      fmt: "",
      empty_path: false,
      in_value: ns === Namespace.ValueNS,
      print_alloc_ids: false,
      used_region_names: new Set(),
      region_index: 0,
      binder_depth: 0,
      printed_type_count: 0,
      type_length_limit,
      region_highlight_mode: RegionHighlightMode.default(),
      ty_infer_name_resolver: undefined,
      const_infer_name_resolver: undefined,
    });
  }

  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:2146 into_buffer
  into_buffer(): string {
    return this._0.fmt;
  }

  // impl fmt::Write for FmtPrinter
  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:2204 write_str
  write_str(s: string): PrintResult {
    this._0.fmt += s;
    return PRINT_OK;
  }

  // ---- impl Printer for FmtPrinter ----
  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:2211 tcx
  tcx(): TyCtxt {
    return this._0.tcx;
  }

  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:2215 reset_path
  override reset_path(): PrintResult {
    this._0.empty_path = true;
    return PRINT_OK;
  }

  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:2220 should_omit_parent_def_path
  override should_omit_parent_def_path(parent_def_id: DefId): boolean {
    if (RTN_MODE.get() !== "ForSuggestion") return false;
    const data = this.tcx().def_key(parent_def_id).disambiguated_data.data;
    return data.$ === "ValueNs" || data.$ === "Closure" || data.$ === "AnonConst";
  }

  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:2228 print_def_path
  override print_def_path(def_id: DefId, args: readonly GenericArg[]): PrintResult {
    let r: PrintResult;
    if (args.length === 0) {
      let b: Result<boolean, PrintError>;
      if ((b = this.try_print_trimmed_def_path(def_id)).$ === "Err") return Err(b._0);
      if (b._0) {
        return PRINT_OK;
      }

      if ((b = this.try_print_visible_def_path(def_id)).$ === "Err") return Err(b._0);
      if (b._0) {
        return PRINT_OK;
      }
    }

    const key = this._0.tcx.def_key(def_id);
    if (key.disambiguated_data.data.$ === "Impl") {
      // Always use types for non-local impls, where types are always
      // available, and filename/line-number is mostly uninteresting.
      let use_types: boolean;
      if (!def_id.is_local()) {
        use_types = true;
      } else {
        // Otherwise, use filename/line-number if forced.
        const force_no_types = with_forced_impl_filename_line();
        use_types = !force_no_types;
      }

      if (!use_types) {
        // If no type info is available, fall back to
        // pretty printing some span information. This should
        // only occur very early in the compiler pipeline.
        const parent_def_id = new DefId(unwrap(key.parent), def_id.krate);
        const span = this._0.tcx.def_span(def_id);

        if ((r = this.print_def_path(parent_def_id, [])).$ === "Err") return r;

        // HACK(eddyb) copy of `print_path_with_simple` to avoid
        // constructing a `DisambiguatedDefPathData`.
        if (!this._0.empty_path) {
          if ((r = this.write_str("::")).$ === "Err") return r;
        }
        if (
          (r = this.write_str(
            `<impl at ${
              // This may end up in stderr diagnostics but it may also be emitted
              // into MIR. Hence we use the remapped path if available
              this._0.tcx.sess.source_map().span_to_diagnostic_string(span)
            }>`,
          )).$ === "Err"
        )
          return r;
        this._0.empty_path = false;

        return PRINT_OK;
      }
    }

    return this.default_print_def_path(def_id, args);
  }

  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:2285 print_region
  print_region(region: Region): PrintResult {
    return this.pretty_print_region(region);
  }

  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:2289 print_type
  print_type(ty: Ty): PrintResult {
    let r: PrintResult;
    const has_regions = this._0.region_highlight_mode.keep_regions && Ty_has_type_flags(ty, TypeFlags.HAS_REGIONS);
    const k = ty.kind();
    if (k.$ === "Tuple" && k._0.length === 0) {
      // Don't truncate `()`.
      return this.pretty_print_type(ty);
    }

    if (
      k.$ === "Adt" &&
      this.should_truncate() &&
      iter_count(k._1.consts()) < 2 &&
      iter_count(k._1.types()) < 2 &&
      (() => {
        // We ensure that if there's at most a single type parameter and that type
        // *doesn't* have any parameters, to avoid printing all the names in cases
        // like `Foo<Foo<Foo<Foo<...>>>`, instead truncating those always to
        // `Foo<...>`.
        const arg = iter_next(k._1.types());
        if (arg !== undefined) {
          const ak = arg.kind();
          if (ak.$ === "Adt") {
            const arg_args = ak._1;
            if (iter_next(arg_args.terms()) === undefined) {
              // Single param type with no type or const parameters:
              // `Foo<Bar<'a>>`.
              return true;
            } else {
              // Single param type with multiple type or const parameters:
              // `Foo<Bar<Baz, Qux>>`. We don't want to recurse into those,
              // we'll replace the whole thing with `...`.
              return false;
            }
          } else {
            // Single type param that *isn't* a type with parameters, like a
            // primitive: `Foo<i32>`.
            return true;
          }
        } else {
          // No type param: `Foo`.
          return true;
        }
      })() &&
      utf8_len(Symbol.as_str(this._0.tcx.item_name(AdtDef_did(k._0)))) < 7
    ) {
      // Don't fully truncate types that have "short names" and at most one type or const
      // param. We do use the short path for them (only item name instead of full path).
      return with_forced_trimmed_paths(() => this.pretty_print_type(ty));
    }

    if (
      k.$ === "Alias" &&
      this.should_truncate() &&
      k._1.kind.$ === "Opaque" &&
      this._0.region_highlight_mode.keep_regions &&
      (() => {
        const def_id = (k._1.kind as { def_id: DefId }).def_id;
        // PORT: the `explicit_item_bounds` query value is `unknown` in queries.gen.ts.
        const bounds = this._0.tcx.explicit_item_bounds(def_id) as EarlyBinder<readonly [Clause, unknown][]>;
        for (const u of EarlyBinder_iter_instantiated_copied(bounds, this._0.tcx, k._1.args)) {
          const [value, _] = Unnormalized_skip_norm_wip(u);
          if (Clause_has_bound_vars(value)) return true;
        }
        return false;
      })()
    ) {
      // `<impl for<'a> Trait as Trait>`
      this._0.printed_type_count += 1;
      return this.pretty_print_type(ty);
    }

    if (
      (k.$ === "Adt" ||
        k.$ === "Foreign" ||
        k.$ === "Pat" ||
        k.$ === "RawPtr" ||
        k.$ === "Ref" ||
        k.$ === "FnDef" ||
        k.$ === "FnPtr" ||
        k.$ === "UnsafeBinder" ||
        k.$ === "Dynamic" ||
        k.$ === "CoroutineClosure" ||
        k.$ === "Coroutine" ||
        k.$ === "CoroutineWitness" ||
        k.$ === "Tuple" ||
        k.$ === "Alias" ||
        k.$ === "Bound" ||
        k.$ === "Placeholder" ||
        k.$ === "Error") &&
      this.should_truncate() &&
      !has_regions
    ) {
      // We only truncate types that we know are likely to be much longer than 3 chars.
      // There's no point in replacing `i32` or `!`.
      if ((r = this.write_str("_")).$ === "Err") return r;
      return PRINT_OK;
    }
    if (k.$ === "Ref" && this.should_truncate() && has_regions) return this.pretty_print_type(ty);
    if (k.$ === "Closure") return this.pretty_print_type(ty);
    this._0.printed_type_count += 1;
    return this.pretty_print_type(ty);
  }

  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:2385 print_dyn_existential
  print_dyn_existential(predicates: List<PolyExistentialPredicate>): PrintResult {
    return this.pretty_print_dyn_existential(predicates);
  }

  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:2392 print_const
  print_const(ct: Const): PrintResult {
    return this.pretty_print_const(ct, false);
  }

  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:2396 print_crate_name
  print_crate_name(cnum: CrateNum): PrintResult {
    let r: PrintResult;
    this._0.empty_path = true;
    if (cnum === LOCAL_CRATE && !with_resolve_crate_name()) {
      if (with_crate_prefix()) {
        if ((r = this.write_str(display_Symbol(kw.Crate))).$ === "Err") return r;
        this._0.empty_path = false;
      }
    } else {
      if ((r = this.write_str(display_Symbol(this._0.tcx.crate_name(cnum)))).$ === "Err") return r;
      this._0.empty_path = false;
    }
    return PRINT_OK;
  }

  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:2410 print_path_with_qualified
  print_path_with_qualified(self_ty: Ty, trait_ref: TraitRef | undefined): PrintResult {
    let r: PrintResult;
    if ((r = this.pretty_print_path_with_qualified(self_ty, trait_ref)).$ === "Err") return r;
    this._0.empty_path = false;
    return PRINT_OK;
  }

  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:2420 print_path_with_impl
  print_path_with_impl(print_prefix: (p: this) => PrintResult, self_ty: Ty, trait_ref: TraitRef | undefined): PrintResult {
    let r: PrintResult;
    if (
      (r = this.pretty_print_path_with_impl(
        (p) => {
          let r: PrintResult;
          if ((r = print_prefix(p)).$ === "Err") return r;
          if (!p._0.empty_path) {
            if ((r = p.write_str("::")).$ === "Err") return r;
          }

          return PRINT_OK;
        },
        self_ty,
        trait_ref,
      )).$ === "Err"
    )
      return r;
    this._0.empty_path = false;
    return PRINT_OK;
  }

  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:2442 print_path_with_simple
  print_path_with_simple(print_prefix: (p: this) => PrintResult, disambiguated_data: DisambiguatedDefPathData): PrintResult {
    let r: PrintResult;
    if ((r = print_prefix(this)).$ === "Err") return r;

    // Skip `::{{extern}}` blocks and `::{{constructor}}` on tuple/unit structs.
    if (disambiguated_data.data.$ === "ForeignMod" || disambiguated_data.data.$ === "Ctor") {
      return PRINT_OK;
    }

    const name = DefPathData.name(disambiguated_data.data);
    if (!this._0.empty_path) {
      if ((r = this.write_str("::")).$ === "Err") return r;
    }

    if (name.$ === "Named") {
      if (Ident.with_dummy_span(name._0).is_raw_guess()) {
        if ((r = this.write_str("r#")).$ === "Err") return r;
      }
    }

    const verbose = this.should_print_verbose();
    if ((r = this.write_str(display_Symbol(disambiguated_data.as_sym(verbose)))).$ === "Err") return r;

    this._0.empty_path = false;

    return PRINT_OK;
  }

  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:2473 print_path_with_generic_args
  print_path_with_generic_args(print_prefix: (p: this) => PrintResult, args: readonly GenericArg[]): PrintResult {
    let r: PrintResult;
    if ((r = print_prefix(this)).$ === "Err") return r;

    if (args.length !== 0) {
      if (this._0.in_value) {
        if ((r = this.write_str("::")).$ === "Err") return r;
      }
      return this.generic_delimiters((p) => p.comma_sep(args, print_GenericArg));
    } else {
      return PRINT_OK;
    }
  }

  // ---- impl PrettyPrinter for FmtPrinter ----
  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:2492 ty_infer_name
  override ty_infer_name(id: TyVid): Symbol | undefined {
    const func = this._0.ty_infer_name_resolver;
    return func === undefined ? undefined : func(id);
  }

  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:2496 reset_type_limit
  override reset_type_limit(): void {
    this._0.printed_type_count = 0;
  }

  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:2500 const_infer_name
  override const_infer_name(id: ConstVid): Symbol | undefined {
    const func = this._0.const_infer_name_resolver;
    return func === undefined ? undefined : func(id);
  }

  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:2504 pretty_print_value_path
  override pretty_print_value_path(def_id: DefId, args: readonly GenericArg[]): PrintResult {
    let r: PrintResult;
    const was_in_value = this._0.in_value;
    this._0.in_value = true;
    if ((r = this.print_def_path(def_id, args)).$ === "Err") return r;
    this._0.in_value = was_in_value;

    return PRINT_OK;
  }

  // PORT: `T: Print<Self> + TypeFoldable` are the descriptors `print_T` and `d_T`, last (D4).
  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:2516 pretty_print_in_binder
  override pretty_print_in_binder<T>(value: Binder<T>, print_T: Print<T, this>, d_T: TypeFoldable<T>): PrintResult {
    return this.wrap_binder(value, WrapBinderMode.ForAll, (new_value, this_) => print_T(new_value, this_), d_T);
  }

  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:2523 wrap_binder
  override wrap_binder<T>(value: Binder<T>, mode: WrapBinderMode, f: (value: T, p: this) => PrintResult, d_T: TypeFoldable<T>): PrintResult {
    let r: PrintResult;
    const old_region_index = this._0.region_index;
    const n = this.name_all_regions(value, mode, d_T);
    if (n.$ === "Err") return n;
    const [new_value, _] = n._0;
    if ((r = f(new_value, this)).$ === "Err") return r;
    this._0.region_index = old_region_index;
    this._0.binder_depth -= 1;
    return PRINT_OK;
  }

  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:2540 typed_value
  override typed_value(f: (p: this) => PrintResult, t: (p: this) => PrintResult, conversion: string): PrintResult {
    let r: PrintResult;
    if ((r = this.write_str("{")).$ === "Err") return r;
    if ((r = f(this)).$ === "Err") return r;
    if ((r = this.write_str(conversion)).$ === "Err") return r;
    const was_in_value = this._0.in_value;
    this._0.in_value = false;
    if ((r = t(this)).$ === "Err") return r;
    this._0.in_value = was_in_value;
    if ((r = this.write_str("}")).$ === "Err") return r;
    return PRINT_OK;
  }

  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:2556 generic_delimiters
  generic_delimiters(f: (p: this) => PrintResult): PrintResult {
    let r: PrintResult;
    if ((r = this.write_str("<")).$ === "Err") return r;

    const was_in_value = this._0.in_value;
    this._0.in_value = false;
    if ((r = f(this)).$ === "Err") return r;
    this._0.in_value = was_in_value;

    if ((r = this.write_str(">")).$ === "Err") return r;
    return PRINT_OK;
  }

  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:2570 should_truncate
  override should_truncate(): boolean {
    return !this._0.type_length_limit.value_within_limit(this._0.printed_type_count);
  }

  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:2574 should_print_optional_region
  should_print_optional_region(region: Region): boolean {
    const highlight = this._0.region_highlight_mode.clone();
    if (highlight.region_highlighted(region) !== undefined) {
      return true;
    }

    if (this.should_print_verbose()) {
      return true;
    }

    if (with_forced_trimmed_paths()) {
      return false;
    }

    const identify_regions = this._0.tcx.sess.opts.unstable_opts.identify_regions;

    const k = region.kind();
    switch (k.$) {
      case "ReEarlyParam":
        return EarlyParamRegion_is_named(k._0);

      case "ReLateParam":
        return LateParamRegionKind_is_named(k._0.kind, this._0.tcx);
      case "ReBound":
      case "RePlaceholder": {
        const br = k.$ === "ReBound" ? k._1.kind : k._0.bound.kind;
        if (BoundRegionKind_is_named(br, this._0.tcx)) {
          return true;
        }

        if (highlight.highlight_bound_region !== undefined) {
          const [region, _] = highlight.highlight_bound_region;
          if (BoundRegionKind_eq(br, region)) {
            return true;
          }
        }

        return false;
      }

      case "ReVar":
        if (identify_regions) return true;
        return false;

      case "ReErased":
      case "ReError":
        return false;

      case "ReStatic":
        return true;
    }
  }

  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:2619 pretty_print_const_pointer
  override pretty_print_const_pointer(p: Pointer, ty: Ty): PrintResult {
    const print = (this_: this): PrintResult => {
      let r: PrintResult;
      if (this_._0.print_alloc_ids) {
        if ((r = this_.write_str(debug_Pointer(p, PLAIN))).$ === "Err") return r;
      } else {
        if ((r = this_.write_str("&_")).$ === "Err") return r;
      }
      return PRINT_OK;
    };
    return this.typed_value(print, (this_) => this_.print_type(ty), ": ");
  }

  // HACK(eddyb) limited to `FmtPrinter` because of `region_highlight_mode`.
  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:2638 pretty_print_region
  pretty_print_region(region: Region): PrintResult {
    let r: PrintResult;
    // Watch out for region highlights.
    const highlight = this._0.region_highlight_mode.clone();
    const n = highlight.region_highlighted(region);
    if (n !== undefined) {
      if ((r = this.write_str(`'${n}`)).$ === "Err") return r;
      return PRINT_OK;
    }

    if (this.should_print_verbose()) {
      if ((r = this.write_str(debug_Region(region, PLAIN))).$ === "Err") return r;
      return PRINT_OK;
    }

    const identify_regions = this._0.tcx.sess.opts.unstable_opts.identify_regions;

    // These printouts are concise. They do not contain all the information
    // the user might want to diagnose an error, but there is basically no way
    // to fit that into a short string. Hence the recommendation to use
    // `explain_region()` or `note_and_explain_region()`.
    const k = region.kind();
    switch (k.$) {
      case "ReEarlyParam": {
        const data = k._0;
        if ((r = this.write_str(display_Symbol(data.name))).$ === "Err") return r;
        return PRINT_OK;
      }
      case "ReLateParam": {
        const kind = k._0.kind;
        const name = LateParamRegionKind_get_name(kind, this._0.tcx);
        if (name !== undefined) {
          if ((r = this.write_str(display_Symbol(name))).$ === "Err") return r;
          return PRINT_OK;
        }
        break;
      }
      case "ReBound":
      case "RePlaceholder": {
        const br = k.$ === "ReBound" ? k._1.kind : k._0.bound.kind;
        const name = BoundRegionKind_get_name(br, this._0.tcx);
        if (name !== undefined) {
          if ((r = this.write_str(display_Symbol(name))).$ === "Err") return r;
          return PRINT_OK;
        }

        if (highlight.highlight_bound_region !== undefined) {
          const [region, counter] = highlight.highlight_bound_region;
          if (BoundRegionKind_eq(br, region)) {
            if ((r = this.write_str(`'${counter}`)).$ === "Err") return r;
            return PRINT_OK;
          }
        }
        break;
      }
      case "ReVar": {
        if (identify_regions) {
          const region_vid = k._0;
          if ((r = this.write_str(debug_RegionVid(region_vid, PLAIN))).$ === "Err") return r;
          return PRINT_OK;
        }
        break;
      }
      case "ReErased":
        break;
      case "ReError":
        break;
      case "ReStatic": {
        if ((r = this.write_str("'static")).$ === "Err") return r;
        return PRINT_OK;
      }
    }

    if ((r = this.write_str("'_")).$ === "Err") return r;

    return PRINT_OK;
  }

  // HACK(eddyb) limited to `FmtPrinter` because of `binder_depth`,
  // `region_index` and `used_region_names`.
  // PORT: `T: TypeFoldable` is the descriptor `d_T` (D4); `UnordMap<BoundRegion, Region>` is a `KeyedMap` (D5).
  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:2778 name_all_regions
  name_all_regions<T>(value: Binder<T>, mode: WrapBinderMode, d_T: TypeFoldable<T>): Result<[T, KeyedMap<BoundRegion, Region>], PrintError> {
    let r: PrintResult;
    // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:2786 name_by_region_index
    function name_by_region_index(index: number, available_names: Symbol[], num_available: number): Symbol {
      const name = available_names.pop();
      if (name !== undefined) {
        return name;
      } else {
        return Symbol.intern(`'z${index - num_available}`);
      }
    }

    // debug!("name_all_regions");

    // Replace any anonymous late-bound regions with named
    // variants, using new unique identifiers, so that we can
    // clearly differentiate between named and unnamed regions in
    // the output. We'll probably want to tweak this over time to
    // decide just how much information to give.
    if (this._0.binder_depth === 0) {
      this.prepare_region_info(value, d_T);
    }

    // debug!("self.used_region_names: {:?}", self.used_region_names);

    let empty = true;
    const start_or_continue = (p: FmtPrinter, start: string, cont: string): void => {
      let w: string;
      if (empty) {
        empty = false;
        w = start;
      } else {
        w = cont;
      }
      void p.write_str(w);
    };
    const do_continue = (p: FmtPrinter, cont: Symbol): void => {
      void p.write_str(display_Symbol(cont));
    };

    // `('a'..='z').rev().map(|s| Symbol::intern(&format!("'{s}")))`, collected through the filter below in the
    // same order (the interning order is upstream's).
    const available_names: Symbol[] = [];
    for (let s = 0x7a; s >= 0x61; s--) {
      const name = Symbol.intern(`'${String.fromCharCode(s)}`);
      if (!this._0.used_region_names.has(name)) available_names.push(name);
    }
    // debug!(?available_names);
    const num_available = available_names.length;

    let region_index = this._0.region_index;
    const next_name = (this_: FmtPrinter): Symbol => {
      let name: Symbol;

      for (;;) {
        name = name_by_region_index(region_index, available_names, num_available);
        region_index += 1;

        if (!this_._0.used_region_names.has(name)) {
          break;
        }
      }

      return name;
    };

    // If we want to print verbosely, then print *all* binders, even if they
    // aren't named. Eventually, we might just want this as the default, but
    // this is not *quite* right and changes the ordering of some output
    // anyways.
    let new_value: T;
    let map: KeyedMap<BoundRegion, Region>;
    if (this.should_print_verbose()) {
      for (const var_ of value.bound_vars) {
        start_or_continue(this, WrapBinderMode.start_str(mode), ", ");
        if ((r = this.write_str(debug_BoundVariableKind(var_, PLAIN))).$ === "Err") return r;
      }
      // Unconditionally render `unsafe<>`.
      if (value.bound_vars.length === 0 && mode === WrapBinderMode.Unsafe) {
        start_or_continue(this, WrapBinderMode.start_str(mode), "");
      }
      start_or_continue(this, "", "> ");
      [new_value, map] = [Binder_skip_binder(value), new KeyedMap<BoundRegion, Region>(intern_key)];
    } else {
      const tcx = this._0.tcx;

      const trim_path = with_forced_trimmed_paths();
      // Closure used in `RegionFolder` to create names for anonymous late-bound
      // regions.
      const name = (br: BoundRegion): Region => {
        let name: Symbol;
        let kind: BoundRegionKind;
        const n = BoundRegionKind_get_name(br.kind, tcx);
        if (n !== undefined) {
          [name, kind] = [n, br.kind];
        } else {
          const name_ = next_name(this);
          [name, kind] = [name_, { $: "NamedForPrinting", _0: name_ }];
        }

        // Unconditionally render `unsafe<>`.
        if (!trim_path || mode === WrapBinderMode.Unsafe) {
          start_or_continue(this, WrapBinderMode.start_str(mode), ", ");
          do_continue(this, name);
        }
        return Region.new_bound(tcx, INNERMOST, { var: br.var, kind });
      };
      const folder = new RegionFolder(tcx, INNERMOST, new KeyedMap<BoundRegion, Region>(intern_key), name);
      const new_value_ = d_T.fold_with(Binder_skip_binder(value), folder);
      const region_map = folder.region_map;

      if (mode === WrapBinderMode.Unsafe && region_map.size === 0) {
        start_or_continue(this, WrapBinderMode.start_str(mode), "");
      }
      start_or_continue(this, "", "> ");

      [new_value, map] = [new_value_, region_map];
    }

    this._0.binder_depth += 1;
    this._0.region_index = region_index;
    return Ok([new_value, map]);
  }

  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:2907 prepare_region_info
  prepare_region_info<T>(value: Binder<T>, d_T: TypeFoldable<T>): void {
    // PORT: `type_collector: SsoHashSet<Ty>` is a `Set<Ty>`: only `insert` is used (never iterated), on interned keys.
    class RegionNameCollector implements TypeVisitor<undefined> {
      readonly Result = VisitorResult.unit;

      constructor(
        public tcx: TyCtxt,
        public used_region_names: Set<Symbol>,
        public type_collector: Set<Ty>,
      ) {}

      // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:2918 new
      static new(tcx: TyCtxt): RegionNameCollector {
        return new RegionNameCollector(tcx, new Set(), new Set());
      }

      // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:2928 visit_region
      visit_region(r: Region): undefined {
        // trace!("address: {:p}", r.0.0);

        // Collect all named lifetimes. These allow us to prevent duplication
        // of already existing lifetime names when introducing names for
        // anonymous late-bound regions.
        const name = r.get_name(this.tcx);
        if (name !== undefined) {
          this.used_region_names.add(name);
        }
        return undefined;
      }

      // We collect types in order to prevent really large types from compiling for
      // a really long time. See issue #83150 for why this is necessary.
      // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:2941 visit_ty
      visit_ty(ty: Ty): undefined {
        const not_previously_inserted = !this.type_collector.has(ty);
        this.type_collector.add(ty);
        if (not_previously_inserted) {
          Ty_super_visit_with(ty, this);
        }
        return undefined;
      }

      visit_binder<U>(t: Binder<U>, d: TypeVisitable<U>): undefined {
        return TypeVisitor_provided.visit_binder(this, t, d);
      }
      visit_const(c: Const): undefined {
        return TypeVisitor_provided.visit_const(this, c);
      }
      visit_predicate<P>(p: P, d: PredicateProxy<P>): undefined {
        return TypeVisitor_provided.visit_predicate(this, p, d);
      }
      visit_clauses(c: Clauses): undefined {
        return TypeVisitor_provided.visit_clauses(this, c);
      }
      visit_error(guar: Parameters<TypeVisitor<undefined>["visit_error"]>[0]): undefined {
        return TypeVisitor_provided.visit_error(this, guar);
      }
    }

    const collector = RegionNameCollector.new(this.tcx());
    visit_with_Binder(value, collector, d_T.visit_with);
    this._0.used_region_names = collector.used_region_names;
    this._0.region_index = 0;
  }
}

// rustc: compiler/rustc_middle/src/ty/print/pretty.rs:2151 guess_def_namespace
function guess_def_namespace(tcx: TyCtxt, def_id: DefId): Namespace {
  const data = tcx.def_key(def_id).disambiguated_data.data;
  switch (data.$) {
    case "TypeNs":
    case "CrateRoot":
    case "OpaqueTy":
      return Namespace.TypeNS;

    case "ValueNs":
    case "AnonConst":
    case "Closure":
    case "Ctor":
      return Namespace.ValueNS;

    case "MacroNs":
      return Namespace.MacroNS;

    default:
      return Namespace.TypeNS;
  }
}

// ---- impl TyCtxt (pretty.rs:2168) ----
// PORT: `def_path_str` replaces the placeholder method of the `TyCtxt` class body (context.ts, "ty/print/pretty.rs").

/// Returns a string identifying this `DefId`. This string is
/// suitable for user output.
// rustc: compiler/rustc_middle/src/ty/print/pretty.rs:2171 def_path_str
TyCtxt.prototype.def_path_str = function (this: TyCtxt, def_id_: IntoQueryKey<DefId>): string {
  const def_id = into_query_key_DefId(def_id_);
  return this.def_path_str_with_args(def_id, []);
};

/// For this one we determine the appropriate namespace for the `def_id`.
// rustc: compiler/rustc_middle/src/ty/print/pretty.rs:2177 def_path_str_with_args
TyCtxt.prototype.def_path_str_with_args = function (this: TyCtxt, def_id_: IntoQueryKey<DefId>, args: readonly GenericArg[]): string {
  const def_id = into_query_key_DefId(def_id_);
  const ns = guess_def_namespace(this, def_id);
  // debug!("def_path_str: def_id={:?}, ns={:?}", def_id, ns);

  return unwrap_result(
    FmtPrinter.print_string(this, ns, (p) => p.print_def_path(def_id, args)),
    debug_PrintError,
  );
};

/// For this one we always use value namespace.
// rustc: compiler/rustc_middle/src/ty/print/pretty.rs:2190 value_path_str_with_args
TyCtxt.prototype.value_path_str_with_args = function (this: TyCtxt, def_id_: IntoQueryKey<DefId>, args: readonly GenericArg[]): string {
  const def_id = into_query_key_DefId(def_id_);
  const ns = Namespace.ValueNS;
  // debug!("value_path_str: def_id={:?}, ns={:?}", def_id, ns);

  return unwrap_result(
    FmtPrinter.print_string(this, ns, (p) => p.print_def_path(def_id, args)),
    debug_PrintError,
  );
};

/** `#[derive(Debug)]` of `std::fmt::Error` (a unit struct): `Error`. */
const debug_PrintError: Debug<PrintError> = () => "Error";

/// Folds through bound vars and placeholders, naming them
// rustc-type: compiler/rustc_middle/src/ty/print/pretty.rs:2704 RegionFolder
class RegionFolder implements TypeFolder {
  constructor(
    public tcx: TyCtxt,
    public current_index: DebruijnIndex,
    /// Regions bound by the binder being named (and placeholders) that have
    /// already been named.
    public region_map: KeyedMap<BoundRegion, Region>,
    public name: (br: BoundRegion) => Region,
  ) {}

  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:2714 cx
  cx(): TyCtxt {
    return this.tcx;
  }

  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:2718 fold_binder
  fold_binder<T>(t: Binder<T>, d: TypeFoldable<T>): Binder<T> {
    this.current_index = DebruijnIndex_shifted_in(this.current_index, 1);
    const t_ = Binder_super_fold_with(t, this, d);
    this.current_index = DebruijnIndex_shifted_out(this.current_index, 1);
    return t_;
  }

  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:2728 fold_ty
  fold_ty(t: Ty): Ty {
    if (Ty_has_vars_bound_at_or_above(t, this.current_index) || Ty_has_placeholders(t)) {
      return Ty_super_fold_with(t, this);
    }
    return t;
  }

  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:2738 fold_region
  fold_region(r: Region): Region {
    const name = this.name;
    let region: Region;
    const k = r.kind();
    // Only name regions bound by the binder being named. Regions bound by an
    // enclosing binder that merely escape through this one keep their name
    // (they were named when that binder was folded) and their index, and must
    // not end up in `region_map`, which callers use to build `for<...>` lists
    // (#102392, #134410).
    if (k.$ === "ReBound" && k._0.$ === "Bound" && k._0._0 === this.current_index) {
      const br = k._1;
      region = map_entry_or_insert_with(this.region_map, br, () => name(br));
    } else if (k.$ === "RePlaceholder") {
      const kind = k._0.bound.kind;
      // If this is an anonymous placeholder, don't rename. Otherwise, in some
      // async fns, we get a `for<'r> Send` bound
      switch (kind.$) {
        case "Anon":
        case "ClosureEnv":
          region = r;
          break;
        default: {
          // Index doesn't matter, since this is just for naming and these never get bound
          const br: BoundRegion = { var: BoundVar.ZERO, kind };
          region = map_entry_or_insert_with(this.region_map, br, () => name(br));
        }
      }
    } else {
      return r;
    }
    const rk = region.kind();
    if (rk.$ === "ReBound" && rk._0.$ === "Bound") {
      const debruijn1 = rk._0._0;
      const br = rk._1;
      assert_eq(debruijn1, INNERMOST, (v) => `DebruijnIndex(${v})`);
      return Region.new_bound(this.tcx, this.current_index, br);
    } else {
      return region;
    }
  }

  fold_const(c: Const): Const {
    return TypeFolder_provided.fold_const(this, c);
  }
  fold_predicate<P>(p: P, d: PredicateProxy<P>): P {
    return TypeFolder_provided.fold_predicate(this, p, d);
  }
  fold_clauses(c: Clauses): Clauses {
    return TypeFolder_provided.fold_clauses(this, c);
  }
}

/** `*map.entry(k).or_insert_with(f)` */
function map_entry_or_insert_with<K, V>(map: Map<K, V>, k: K, f: () => V): V {
  if (map.has(k)) return map.get(k) as V;
  const v = f();
  map.set(k, v);
  return v;
}

// impl<'tcx, T, P: PrettyPrinter<'tcx>> Print<P> for ty::Binder<'tcx, T> where T: Print<P> + TypeFoldable
// rustc: compiler/rustc_middle/src/ty/print/pretty.rs:2960 print
export function print_Binder<T, P extends PrettyPrinter>(self: Binder<T>, p: P, print_T: Print<T, P>, d_T: TypeFoldable<T>): PrintResult {
  return p.pretty_print_in_binder(self, print_T as Print<T, PrettyPrinter>, d_T);
}

// impl<'tcx, T, P: PrettyPrinter<'tcx>> Print<P> for ty::OutlivesClause<'tcx, T> where T: Print<P>
// rustc: compiler/rustc_middle/src/ty/print/pretty.rs:2969 print
export function print_OutlivesClause<T, P extends PrettyPrinter>(self: OutlivesClause<T>, p: P, print_T: Print<T, P>): PrintResult {
  let r: PrintResult;
  if ((r = print_T(self._0, p)).$ === "Err") return r;
  if ((r = p.write_str(": ")).$ === "Err") return r;
  if ((r = print_Region(self._1, p)).$ === "Err") return r;
  return PRINT_OK;
}

/// Wrapper type for `ty::TraitRef` which opts-in to pretty printing only
/// the trait path. That is, it will print `Trait<U>` instead of
/// `<T as Trait<U>>`.
// rustc-type: compiler/rustc_middle/src/ty/print/pretty.rs:2981 TraitRefPrintOnlyTraitPath
export interface TraitRefPrintOnlyTraitPath {
  _0: TraitRef;
}

// rustc: compiler/rustc_middle/src/ty/print/pretty.rs:2984 into_diag_arg
export function TraitRefPrintOnlyTraitPath_into_diag_arg(self: TraitRefPrintOnlyTraitPath, path: MutRef<string | undefined>): DiagArgValue {
  return with_((tcx) => {
    const trait_ref = tcx.short_string(/* tcx.lift */ self, path, as_decls_print(print_TraitRefPrintOnlyTraitPath));
    return { $: "Str", _0: trait_ref };
  });
}

// rustc: compiler/rustc_middle/src/ty/print/pretty.rs:2993 fmt
export const debug_TraitRefPrintOnlyTraitPath: Debug<TraitRefPrintOnlyTraitPath> = (v, _f) => display_TraitRefPrintOnlyTraitPath(v);

/// Wrapper type for `ty::TraitRef` which opts-in to pretty printing only
/// the trait path, and additionally tries to "sugar" `Fn(...)` trait bounds.
// rustc-type: compiler/rustc_middle/src/ty/print/pretty.rs:3001 TraitRefPrintSugared
export interface TraitRefPrintSugared {
  _0: TraitRef;
}

// rustc: compiler/rustc_middle/src/ty/print/pretty.rs:3004 into_diag_arg
export function TraitRefPrintSugared_into_diag_arg(self: TraitRefPrintSugared, path: MutRef<string | undefined>): DiagArgValue {
  return with_((tcx) => {
    const trait_ref = tcx.short_string(/* tcx.lift */ self, path, as_decls_print(print_TraitRefPrintSugared));
    return { $: "Str", _0: trait_ref };
  });
}

// rustc: compiler/rustc_middle/src/ty/print/pretty.rs:3013 fmt
export const debug_TraitRefPrintSugared: Debug<TraitRefPrintSugared> = (v, _f) => display_TraitRefPrintSugared(v);

/// Wrapper type for `ty::TraitRef` which opts-in to pretty printing only
/// the trait name. That is, it will print `Trait` instead of
/// `<T as Trait<U>>`.
// rustc-type: compiler/rustc_middle/src/ty/print/pretty.rs:3022 TraitRefPrintOnlyTraitName
export interface TraitRefPrintOnlyTraitName {
  _0: TraitRef;
}

// rustc: compiler/rustc_middle/src/ty/print/pretty.rs:3025 fmt
export const debug_TraitRefPrintOnlyTraitName: Debug<TraitRefPrintOnlyTraitName> = (v, _f) => display_TraitRefPrintOnlyTraitName(v);

// #[extension(pub trait PrintTraitRefExt<'tcx>)] impl<'tcx> ty::TraitRef<'tcx>
// rustc: compiler/rustc_middle/src/ty/print/pretty.rs:3032 print_only_trait_path
export function TraitRef_print_only_trait_path(self: TraitRef): TraitRefPrintOnlyTraitPath {
  return { _0: self };
}

// rustc: compiler/rustc_middle/src/ty/print/pretty.rs:3036 print_trait_sugared
export function TraitRef_print_trait_sugared(self: TraitRef): TraitRefPrintSugared {
  return { _0: self };
}

// rustc: compiler/rustc_middle/src/ty/print/pretty.rs:3040 print_only_trait_name
export function TraitRef_print_only_trait_name(self: TraitRef): TraitRefPrintOnlyTraitName {
  return { _0: self };
}

// #[extension(pub trait PrintPolyTraitRefExt<'tcx>)] impl<'tcx> ty::Binder<'tcx, ty::TraitRef<'tcx>>
// rustc: compiler/rustc_middle/src/ty/print/pretty.rs:3047 print_only_trait_path
export function PolyTraitRef_print_only_trait_path(self: PolyTraitRef): Binder<TraitRefPrintOnlyTraitPath> {
  return Binder_map_bound(self, (tr) => TraitRef_print_only_trait_path(tr));
}

// rustc: compiler/rustc_middle/src/ty/print/pretty.rs:3051 print_trait_sugared
export function PolyTraitRef_print_trait_sugared(self: PolyTraitRef): Binder<TraitRefPrintSugared> {
  return Binder_map_bound(self, (tr) => TraitRef_print_trait_sugared(tr));
}

// rustc-type: compiler/rustc_middle/src/ty/print/pretty.rs:3057 TraitClausePrintModifiersAndPath
export interface TraitClausePrintModifiersAndPath {
  _0: TraitClause;
}

// rustc: compiler/rustc_middle/src/ty/print/pretty.rs:3060 fmt
export const debug_TraitClausePrintModifiersAndPath: Debug<TraitClausePrintModifiersAndPath> = (v, _f) => display_TraitClausePrintModifiersAndPath(v);

// #[extension(pub trait PrintTraitClauseExt<'tcx>)] impl<'tcx> ty::TraitClause<'tcx>
// rustc: compiler/rustc_middle/src/ty/print/pretty.rs:3067 print_modifiers_and_trait_path
export function TraitClause_print_modifiers_and_trait_path(self: TraitClause): TraitClausePrintModifiersAndPath {
  return { _0: self };
}

// rustc-type: compiler/rustc_middle/src/ty/print/pretty.rs:3073 TraitClausePrintWithBoundConstness
export interface TraitClausePrintWithBoundConstness {
  _0: TraitClause;
  _1: BoundConstness | undefined;
}

// rustc: compiler/rustc_middle/src/ty/print/pretty.rs:3079 fmt
export const debug_TraitClausePrintWithBoundConstness: Debug<TraitClausePrintWithBoundConstness> = (v, _f) => display_TraitClausePrintWithBoundConstness(v);

// #[extension(pub trait PrintPolyTraitClauseExt<'tcx>)] impl<'tcx> ty::PolyTraitClause<'tcx>
// rustc: compiler/rustc_middle/src/ty/print/pretty.rs:3086 print_modifiers_and_trait_path
export function PolyTraitClause_print_modifiers_and_trait_path(self: PolyTraitClause): Binder<TraitClausePrintModifiersAndPath> {
  return Binder_map_bound(self, (_0): TraitClausePrintModifiersAndPath => ({ _0 }));
}

// rustc: compiler/rustc_middle/src/ty/print/pretty.rs:3092 print_with_bound_constness
export function PolyTraitClause_print_with_bound_constness(self: PolyTraitClause, constness: BoundConstness | undefined): Binder<TraitClausePrintWithBoundConstness> {
  return Binder_map_bound(self, (trait_pred): TraitClausePrintWithBoundConstness => ({ _0: trait_pred, _1: constness }));
}

// rustc-type: compiler/rustc_middle/src/ty/print/pretty.rs:3101 PrintClosureAsImpl
export interface PrintClosureAsImpl {
  closure: ClosureArgs;
}
/** `#[derive(Debug)]` */
export const debug_PrintClosureAsImpl: Debug<PrintClosureAsImpl> = (v, f) => debug_struct(f, "PrintClosureAsImpl", [["closure", debug_ClosureArgs(v.closure, f)]]);

/** `macro_rules! forward_display_to_print`: the body of each `impl fmt::Display for $ty`. */
function forward_display_to_print<T>(self: T, print_T: Print<T, FmtPrinter>): string {
  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:3110 fmt
  return with_((tcx) => {
    const p = FmtPrinter.new(tcx, Namespace.TypeNS);
    const r = print_T(/* tcx.lift */ self, p);
    if (r.$ === "Err") panic("a Display implementation returned an error unexpectedly: Error");
    return p.into_buffer();
  });
}

// `define_print!` (pretty.rs:3124): each `$ty $print` block is `print_<T>`, the macro's
// `fn print(&$self, $p: &mut P) -> Result<(), PrintError> { let _: () = $print; Ok(()) }`.

// forward_display_to_print! { Ty<'tcx>, &'tcx ty::List<ty::PolyExistentialPredicate<'tcx>> } (pretty.rs:3142)
export function display_Ty(self: Ty): string {
  return forward_display_to_print(self, print_Ty);
}
export function display_List_PolyExistentialPredicate(self: List<PolyExistentialPredicate>): string {
  return forward_display_to_print(self, print_List_PolyExistentialPredicate);
}

// ---- define_print! (pretty.rs:3147) ----
// rustc: compiler/rustc_middle/src/ty/print/pretty.rs:3127 print
export function print_FnSig(self: FnSig, p: PrettyPrinter): PrintResult {
  let r: PrintResult;
  if ((r = p.write_str(Safety.prefix_str(FnSigC.safety(self)))).$ === "Err") return r;

  const abi: ExternAbi = FnSigC.abi(self);
  if (abi.$ !== "Rust") {
    if ((r = p.write_str(`extern ${display_ExternAbi(abi)} `)).$ === "Err") return r;
  }

  if ((r = p.write_str("fn")).$ === "Err") return r;
  if ((r = p.pretty_print_fn_sig(FnSigC.inputs(self), FnSigC.c_variadic(self), FnSigC.splatted(self), FnSigC.output(self))).$ === "Err") return r;
  return PRINT_OK;
}

// rustc: compiler/rustc_middle/src/ty/print/pretty.rs:3127 print
export function print_TraitRef(self: TraitRef, p: PrettyPrinter): PrintResult {
  let r: PrintResult;
  if ((r = p.write_str(`<${display_Ty(TraitRef_self_ty(self))} as ${display_TraitRefPrintOnlyTraitPath(TraitRef_print_only_trait_path(self))}>`)).$ === "Err") return r;
  return PRINT_OK;
}

// rustc: compiler/rustc_middle/src/ty/print/pretty.rs:3127 print
export function print_AliasTy(self: AliasTy, p: PrettyPrinter): PrintResult {
  let r: PrintResult;
  const alias_term: AliasTerm = AliasTermC.from_AliasTy(self);
  if ((r = print_AliasTerm(alias_term, p)).$ === "Err") return r;
  return PRINT_OK;
}

// rustc: compiler/rustc_middle/src/ty/print/pretty.rs:3127 print
export function print_AliasTerm(self: AliasTerm, p: PrettyPrinter): PrintResult {
  let r: PrintResult;
  const kind = self.kind;
  switch (kind.$) {
    case "InherentTy":
    case "InherentConstSelf": {
      if ((r = p.pretty_print_inherent_projection(self)).$ === "Err") return r;
      break;
    }
    case "ProjectionTy": {
      const def_id = kind.def_id;
      if (!(p.should_print_verbose() || with_reduced_queries()) && p.tcx().is_impl_trait_in_trait(def_id)) {
        if ((r = p.pretty_print_rpitit(def_id, self.args)).$ === "Err") return r;
      } else {
        if ((r = p.print_def_path(def_id, self.args)).$ === "Err") return r;
      }
      break;
    }
    case "FreeTy":
    case "FreeConst":
    case "OpaqueTy":
    case "AnonConst":
    case "ProjectionConst":
    case "InherentConstImpl": {
      const def_id = kind.def_id;
      if ((r = p.print_def_path(def_id, self.args)).$ === "Err") return r;
      break;
    }
  }
  return PRINT_OK;
}

// rustc: compiler/rustc_middle/src/ty/print/pretty.rs:3127 print
export function print_TraitClause(self: TraitClause, p: PrettyPrinter): PrintResult {
  let r: PrintResult;
  if ((r = print_Ty(TraitRef_self_ty(self.trait_ref), p)).$ === "Err") return r;
  if ((r = p.write_str(": ")).$ === "Err") return r;
  if (self.polarity === "Negative") {
    if ((r = p.write_str("!")).$ === "Err") return r;
  }
  if ((r = print_TraitRefPrintSugared(TraitRef_print_trait_sugared(self.trait_ref), p)).$ === "Err") return r;
  return PRINT_OK;
}

// rustc: compiler/rustc_middle/src/ty/print/pretty.rs:3127 print
export function print_HostEffectClause(self: HostEffectClause, p: PrettyPrinter): PrintResult {
  let r: PrintResult;
  let constness: string;
  switch (self.constness) {
    case "Const":
      constness = "const";
      break;
    case "Maybe":
      constness = "[const]";
      break;
  }
  if ((r = print_Ty(TraitRef_self_ty(self.trait_ref), p)).$ === "Err") return r;
  if ((r = p.write_str(`: ${constness} `)).$ === "Err") return r;
  if ((r = print_TraitRefPrintSugared(TraitRef_print_trait_sugared(self.trait_ref), p)).$ === "Err") return r;
  return PRINT_OK;
}

// rustc: compiler/rustc_middle/src/ty/print/pretty.rs:3127 print
export function print_TypeAndMut(self: TypeAndMut, p: PrettyPrinter): PrintResult {
  let r: PrintResult;
  if ((r = p.write_str(Mutability.prefix_str(self.mutbl))).$ === "Err") return r;
  if ((r = print_Ty(self.ty, p)).$ === "Err") return r;
  return PRINT_OK;
}

// rustc: compiler/rustc_middle/src/ty/print/pretty.rs:3127 print
export function print_ClauseKind(self: ClauseKind, p: PrettyPrinter): PrintResult {
  let r: PrintResult;
  switch (self.$) {
    case "Trait":
      if ((r = print_TraitClause(self._0, p)).$ === "Err") return r;
      break;
    case "RegionOutlives":
      if ((r = print_OutlivesClause(self._0, p, print_Region)).$ === "Err") return r;
      break;
    case "TypeOutlives":
      if ((r = print_OutlivesClause(self._0, p, print_Ty)).$ === "Err") return r;
      break;
    case "Projection":
      if ((r = print_ProjectionClause(self._0, p)).$ === "Err") return r;
      break;
    case "HostEffect":
      if ((r = print_HostEffectClause(self._0, p)).$ === "Err") return r;
      break;
    case "ConstArgHasType": {
      const ct = self._0;
      const ty = self._1;
      if ((r = p.write_str("the constant `")).$ === "Err") return r;
      if ((r = print_Const(ct, p)).$ === "Err") return r;
      if ((r = p.write_str("` has type `")).$ === "Err") return r;
      if ((r = print_Ty(ty, p)).$ === "Err") return r;
      if ((r = p.write_str("`")).$ === "Err") return r;
      break;
    }
    case "WellFormed": {
      const term = self._0;
      if ((r = print_Term(term, p)).$ === "Err") return r;
      if ((r = p.write_str(" well-formed")).$ === "Err") return r;
      break;
    }
    case "ConstEvaluatable": {
      const ct = self._0;
      if ((r = p.write_str("the constant `")).$ === "Err") return r;
      if ((r = print_Const(ct, p)).$ === "Err") return r;
      if ((r = p.write_str("` can be evaluated")).$ === "Err") return r;
      break;
    }
    case "UnstableFeature": {
      const symbol = self._0;
      if ((r = p.write_str(`feature(${display_Symbol(symbol)}) is enabled`)).$ === "Err") return r;
      break;
    }
  }
  return PRINT_OK;
}

// rustc: compiler/rustc_middle/src/ty/print/pretty.rs:3127 print
export function print_PredicateKind(self: PredicateKind, p: PrettyPrinter): PrintResult {
  let r: PrintResult;
  switch (self.$) {
    case "Clause":
      if ((r = print_ClauseKind(self._0, p)).$ === "Err") return r;
      break;
    case "Subtype":
      if ((r = print_SubtypePredicate(self._0, p)).$ === "Err") return r;
      break;
    case "Coerce":
      if ((r = print_CoercePredicate(self._0, p)).$ === "Err") return r;
      break;
    case "DynCompatible": {
      const trait_def_id = self._0;
      if ((r = p.write_str("the trait `")).$ === "Err") return r;
      if ((r = p.print_def_path(trait_def_id, [])).$ === "Err") return r;
      if ((r = p.write_str("` is dyn-compatible")).$ === "Err") return r;
      break;
    }
    case "ConstEquate": {
      const c1 = self._0;
      const c2 = self._1;
      if ((r = p.write_str("the constant `")).$ === "Err") return r;
      if ((r = print_Const(c1, p)).$ === "Err") return r;
      if ((r = p.write_str("` equals `")).$ === "Err") return r;
      if ((r = print_Const(c2, p)).$ === "Err") return r;
      if ((r = p.write_str("`")).$ === "Err") return r;
      break;
    }
    case "Ambiguous":
      if ((r = p.write_str("ambiguous")).$ === "Err") return r;
      break;
    case "NormalizesTo":
      if ((r = print_NormalizesTo(self._0, p)).$ === "Err") return r;
      break;
  }
  return PRINT_OK;
}

// rustc: compiler/rustc_middle/src/ty/print/pretty.rs:3127 print
export function print_ExistentialPredicate(self: ExistentialPredicate, p: PrettyPrinter): PrintResult {
  let r: PrintResult;
  switch (self.$) {
    case "Trait":
      if ((r = print_ExistentialTraitRef(self._0, p)).$ === "Err") return r;
      break;
    case "Projection":
      if ((r = print_ExistentialProjection(self._0, p)).$ === "Err") return r;
      break;
    case "AutoTrait":
      if ((r = p.print_def_path(self._0, [])).$ === "Err") return r;
      break;
  }
  return PRINT_OK;
}

// rustc: compiler/rustc_middle/src/ty/print/pretty.rs:3127 print
export function print_ExistentialTraitRef(self: ExistentialTraitRef, p: PrettyPrinter): PrintResult {
  let r: PrintResult;
  // Dummy Self is safe to use as it can't appear in generic param defaults which is important
  // later on for correctly eliding generic args that coincide with their default.
  const trait_ref = ExistentialTraitRef_with_self_ty(self, p.tcx(), p.tcx().types.trait_object_dummy_self);
  if ((r = print_TraitRefPrintOnlyTraitPath(TraitRef_print_only_trait_path(trait_ref), p)).$ === "Err") return r;
  return PRINT_OK;
}

// rustc: compiler/rustc_middle/src/ty/print/pretty.rs:3127 print
export function print_ExistentialProjection(self: ExistentialProjection, p: PrettyPrinter): PrintResult {
  let r: PrintResult;
  // PORT: the `associated_item` / `generics_of` query values are `unknown` in queries.gen.ts.
  const name = AssocItem_name(p.tcx().associated_item(self.def_id) as AssocItem);
  // The args don't contain the self ty (as it has been erased) but the corresp.
  // generics do as the trait always has a self ty param. We need to offset.
  const args = self.args.slice((p.tcx().generics_of(self.def_id) as Generics).parent_count - 1);
  if ((r = p.print_path_with_generic_args((p) => p.write_str(display_Symbol(name)), args)).$ === "Err") return r;
  if ((r = p.write_str(" = ")).$ === "Err") return r;
  if ((r = print_Term(self.term, p)).$ === "Err") return r;
  return PRINT_OK;
}

// rustc: compiler/rustc_middle/src/ty/print/pretty.rs:3127 print
export function print_ProjectionClause(self: ProjectionClause, p: PrettyPrinter): PrintResult {
  let r: PrintResult;
  if ((r = print_AliasTerm(self.projection_term, p)).$ === "Err") return r;
  if ((r = p.write_str(" == ")).$ === "Err") return r;
  p.reset_type_limit();
  if ((r = print_Term(self.term, p)).$ === "Err") return r;
  return PRINT_OK;
}

// rustc: compiler/rustc_middle/src/ty/print/pretty.rs:3127 print
export function print_SubtypePredicate(self: SubtypePredicate, p: PrettyPrinter): PrintResult {
  let r: PrintResult;
  if ((r = print_Ty(self.a, p)).$ === "Err") return r;
  if ((r = p.write_str(" <: ")).$ === "Err") return r;
  p.reset_type_limit();
  if ((r = print_Ty(self.b, p)).$ === "Err") return r;
  return PRINT_OK;
}

// rustc: compiler/rustc_middle/src/ty/print/pretty.rs:3127 print
export function print_CoercePredicate(self: CoercePredicate, p: PrettyPrinter): PrintResult {
  let r: PrintResult;
  if ((r = print_Ty(self.a, p)).$ === "Err") return r;
  if ((r = p.write_str(" -> ")).$ === "Err") return r;
  p.reset_type_limit();
  if ((r = print_Ty(self.b, p)).$ === "Err") return r;
  return PRINT_OK;
}

// rustc: compiler/rustc_middle/src/ty/print/pretty.rs:3127 print
export function print_NormalizesTo(self: NormalizesTo, p: PrettyPrinter): PrintResult {
  let r: PrintResult;
  if ((r = print_AliasTerm(self.alias, p)).$ === "Err") return r;
  if ((r = p.write_str(" normalizes-to ")).$ === "Err") return r;
  p.reset_type_limit();
  if ((r = print_Term(self.term, p)).$ === "Err") return r;
  return PRINT_OK;
}

// rustc: compiler/rustc_middle/src/ty/print/pretty.rs:3127 print
export function print_PlaceholderType(self: PlaceholderType, p: PrettyPrinter): PrintResult {
  let r: PrintResult;
  const kind = self.bound.kind;
  switch (kind.$) {
    case "Anon":
      if ((r = p.write_str(debug_Placeholder(self, PLAIN, debug_BoundTy))).$ === "Err") return r;
      break;
    case "Param": {
      const def_id = kind._0;
      switch (p.should_print_verbose()) {
        case true:
          if ((r = p.write_str(debug_Placeholder(self, PLAIN, debug_BoundTy))).$ === "Err") return r;
          break;
        case false:
          if ((r = p.write_str(display_Symbol(p.tcx().item_name(def_id)))).$ === "Err") return r;
          break;
      }
      break;
    }
  }
  return PRINT_OK;
}

// ---- define_print_and_forward_display! (pretty.rs:3334) ----
// rustc: compiler/rustc_middle/src/ty/print/pretty.rs:3127 print
export function print_List_Ty(self: List<Ty>, p: PrettyPrinter): PrintResult {
  let r: PrintResult;
  if ((r = p.write_str("{")).$ === "Err") return r;
  if ((r = p.comma_sep(self, print_Ty)).$ === "Err") return r;
  if ((r = p.write_str("}")).$ === "Err") return r;
  return PRINT_OK;
}

// rustc: compiler/rustc_middle/src/ty/print/pretty.rs:3127 print
export function print_TraitRefPrintOnlyTraitPath(self: TraitRefPrintOnlyTraitPath, p: PrettyPrinter): PrintResult {
  let r: PrintResult;
  if ((r = p.print_def_path(self._0.def_id, self._0.args)).$ === "Err") return r;
  return PRINT_OK;
}

// rustc: compiler/rustc_middle/src/ty/print/pretty.rs:3127 print
export function print_TraitRefPrintSugared(self: TraitRefPrintSugared, p: PrettyPrinter): PrintResult {
  let r: PrintResult;
  let args_ty: Ty | undefined;
  let tk;
  if (
    !with_reduced_queries() &&
    // PORT: the `trait_def` query value is `unknown` in queries.gen.ts.
    TraitDef_paren_sugar(p.tcx().trait_def(self._0.def_id)) &&
    (args_ty = self._0.args[1] === undefined ? undefined : GenericArg.as_type(self._0.args[1])) !== undefined &&
    (tk = args_ty.kind()).$ === "Tuple"
  ) {
    const args = tk._0;
    if ((r = p.write_str(`${display_Symbol(p.tcx().item_name(self._0.def_id))}(`)).$ === "Err") return r;
    for (let i = 0; i < args.length; i++) {
      const arg = args[i]!;
      if (i > 0) {
        if ((r = p.write_str(", ")).$ === "Err") return r;
      }
      if ((r = print_Ty(arg, p)).$ === "Err") return r;
    }
    if ((r = p.write_str(")")).$ === "Err") return r;
  } else {
    if ((r = p.print_def_path(self._0.def_id, self._0.args)).$ === "Err") return r;
  }
  return PRINT_OK;
}

// rustc: compiler/rustc_middle/src/ty/print/pretty.rs:3127 print
export function print_TraitRefPrintOnlyTraitName(self: TraitRefPrintOnlyTraitName, p: PrettyPrinter): PrintResult {
  let r: PrintResult;
  if ((r = p.print_def_path(self._0.def_id, [])).$ === "Err") return r;
  return PRINT_OK;
}

// rustc: compiler/rustc_middle/src/ty/print/pretty.rs:3127 print
export function print_TraitClausePrintModifiersAndPath(self: TraitClausePrintModifiersAndPath, p: PrettyPrinter): PrintResult {
  let r: PrintResult;
  if (self._0.polarity === "Negative") {
    if ((r = p.write_str("!")).$ === "Err") return r;
  }
  if ((r = print_TraitRefPrintSugared(TraitRef_print_trait_sugared(self._0.trait_ref), p)).$ === "Err") return r;
  return PRINT_OK;
}

// rustc: compiler/rustc_middle/src/ty/print/pretty.rs:3127 print
export function print_TraitClausePrintWithBoundConstness(self: TraitClausePrintWithBoundConstness, p: PrettyPrinter): PrintResult {
  let r: PrintResult;
  if ((r = print_Ty(TraitRef_self_ty(self._0.trait_ref), p)).$ === "Err") return r;
  if ((r = p.write_str(": ")).$ === "Err") return r;
  if (self._1 !== undefined) {
    const constness = self._1;
    if ((r = p.pretty_print_bound_constness(constness)).$ === "Err") return r;
  }
  if (self._0.polarity === "Negative") {
    if ((r = p.write_str("!")).$ === "Err") return r;
  }
  if ((r = print_TraitRefPrintSugared(TraitRef_print_trait_sugared(self._0.trait_ref), p)).$ === "Err") return r;
  return PRINT_OK;
}

// rustc: compiler/rustc_middle/src/ty/print/pretty.rs:3127 print
export function print_PrintClosureAsImpl(self: PrintClosureAsImpl, p: PrettyPrinter): PrintResult {
  let r: PrintResult;
  if ((r = p.pretty_print_closure_as_impl(self.closure)).$ === "Err") return r;
  return PRINT_OK;
}

// rustc: compiler/rustc_middle/src/ty/print/pretty.rs:3127 print
export function print_ParamTy(self: ParamTy, p: PrettyPrinter): PrintResult {
  let r: PrintResult;
  if ((r = p.write_str(display_Symbol(self.name))).$ === "Err") return r;
  return PRINT_OK;
}

// rustc: compiler/rustc_middle/src/ty/print/pretty.rs:3127 print
export function print_ParamConst(self: ParamConst, p: PrettyPrinter): PrintResult {
  let r: PrintResult;
  if ((r = p.write_str(display_Symbol(self.name))).$ === "Err") return r;
  return PRINT_OK;
}

// rustc: compiler/rustc_middle/src/ty/print/pretty.rs:3127 print
export function print_Term(self: Term, p: PrettyPrinter): PrintResult {
  let r: PrintResult;
  const k = Term.kind(self);
  switch (k.$) {
    case "Ty":
      if ((r = print_Ty(k._0, p)).$ === "Err") return r;
      break;
    case "Const":
      if ((r = print_Const(k._0, p)).$ === "Err") return r;
      break;
  }
  return PRINT_OK;
}

// rustc: compiler/rustc_middle/src/ty/print/pretty.rs:3127 print
export function print_Predicate(self: Predicate, p: PrettyPrinter): PrintResult {
  let r: PrintResult;
  if ((r = print_Binder(self.kind(), p, print_PredicateKind, fold_PredicateKind_)).$ === "Err") return r;
  return PRINT_OK;
}

// rustc: compiler/rustc_middle/src/ty/print/pretty.rs:3127 print
export function print_Clause(self: Clause, p: PrettyPrinter): PrintResult {
  let r: PrintResult;
  if ((r = print_Binder(self.kind(), p, print_ClauseKind, fold_ClauseKind_)).$ === "Err") return r;
  return PRINT_OK;
}

// rustc: compiler/rustc_middle/src/ty/print/pretty.rs:3127 print
export function print_UserTypeKind(self: UserTypeKind, p: PrettyPrinter): PrintResult {
  let r: PrintResult;
  switch (self.$) {
    case "Ty": {
      const ty = self._0;
      if ((r = p.write_str("Ty(")).$ === "Err") return r;
      if ((r = print_Ty(ty, p)).$ === "Err") return r;
      break;
    }
    case "TypeOf": {
      const def_id = self._0;
      const { args, user_self_ty } = self._1;
      if ((r = p.write_str("TypeOf(")).$ === "Err") return r;
      if ((r = p.print_def_path(def_id, args)).$ === "Err") return r;
      if (user_self_ty !== undefined) {
        const { impl_def_id, self_ty } = user_self_ty;
        if ((r = p.write_str(" at <impl ")).$ === "Err") return r;
        const key = p.tcx().def_key(impl_def_id);
        const parent_def_id = new DefId(unwrap(key.parent), impl_def_id.krate);
        if ((r = p.print_def_path(parent_def_id, [])).$ === "Err") return r;
        if ((r = p.write_str(`::<${display_Symbol(key.disambiguated_data.as_sym(false))}> for `)).$ === "Err") return r;
        if ((r = print_Ty(self_ty, p)).$ === "Err") return r;
        if ((r = p.write_str(">")).$ === "Err") return r;
      }
      break;
    }
  }
  if ((r = p.write_str(")")).$ === "Err") return r;
  return PRINT_OK;
}

// rustc: compiler/rustc_middle/src/ty/print/pretty.rs:3127 print
export function print_GenericArg(self: GenericArg, p: PrettyPrinter): PrintResult {
  let r: PrintResult;
  const k = GenericArg.kind(self);
  switch (k.$) {
    case "Lifetime":
      if ((r = print_Region(k._0, p)).$ === "Err") return r;
      break;
    case "Type":
      if ((r = print_Ty(k._0, p)).$ === "Err") return r;
      break;
    case "Const":
      if ((r = print_Const(k._0, p)).$ === "Err") return r;
      break;
  }
  return PRINT_OK;
}

// The `forward_display_to_print!` half of `define_print_and_forward_display!` (pretty.rs:3138).
export function display_List_Ty(self: List<Ty>): string {
  return forward_display_to_print(self, print_List_Ty);
}
export function display_TraitRefPrintOnlyTraitPath(self: TraitRefPrintOnlyTraitPath): string {
  return forward_display_to_print(self, print_TraitRefPrintOnlyTraitPath);
}
export function display_TraitRefPrintSugared(self: TraitRefPrintSugared): string {
  return forward_display_to_print(self, print_TraitRefPrintSugared);
}
export function display_TraitRefPrintOnlyTraitName(self: TraitRefPrintOnlyTraitName): string {
  return forward_display_to_print(self, print_TraitRefPrintOnlyTraitName);
}
export function display_TraitClausePrintModifiersAndPath(self: TraitClausePrintModifiersAndPath): string {
  return forward_display_to_print(self, print_TraitClausePrintModifiersAndPath);
}
export function display_TraitClausePrintWithBoundConstness(self: TraitClausePrintWithBoundConstness): string {
  return forward_display_to_print(self, print_TraitClausePrintWithBoundConstness);
}
export function display_PrintClosureAsImpl(self: PrintClosureAsImpl): string {
  return forward_display_to_print(self, print_PrintClosureAsImpl);
}
export function display_ParamTy(self: ParamTy): string {
  return forward_display_to_print(self, print_ParamTy);
}
export function display_ParamConst(self: ParamConst): string {
  return forward_display_to_print(self, print_ParamConst);
}
export function display_Term(self: Term): string {
  return forward_display_to_print(self, print_Term);
}
export function display_Predicate(self: Predicate): string {
  return forward_display_to_print(self, print_Predicate);
}
export function display_Clause(self: Clause): string {
  return forward_display_to_print(self, print_Clause);
}
export function display_UserTypeKind(self: UserTypeKind): string {
  return forward_display_to_print(self, print_UserTypeKind);
}
export function display_GenericArg(self: GenericArg): string {
  return forward_display_to_print(self, print_GenericArg);
}

// rustc: compiler/rustc_middle/src/ty/print/pretty.rs:3448 for_each_def
function for_each_def(tcx: TyCtxt, collect_fn: (ident: Ident, ns: Namespace, def_id: DefId) => void): void {
  // Iterate all (non-anonymous) local crate items no matter where they are defined.
  for (const id of tcx.hir_free_items()) {
    if (tcx.def_kind(id.owner_id).$ === "Use") {
      continue;
    }

    const item = tcx.hir_item(id);
    const ident = ItemKind.ident(item.kind);
    if (ident === undefined) continue;

    const def_id = item.owner_id.to_def_id();
    const ns = DefKind.ns(tcx.def_kind(def_id)) ?? Namespace.TypeNS;
    collect_fn(ident, ns, def_id);
  }

  // Now take care of extern crate items.
  const queue: DefId[] = [];
  const seen_defs = new DefIdSet();

  for (const cnum of tcx.crates(null)) {
    // Ignore crates that are not direct dependencies.
    // PORT: the `extern_crate` query value is `unknown` in queries.gen.ts.
    const extern_crate = tcx.extern_crate(cnum) as ExternCrate | undefined;
    if (extern_crate === undefined) {
      continue;
    } else {
      if (!extern_crate.is_direct()) {
        continue;
      }
    }

    queue.push(CrateNum.as_def_id(cnum));
  }

  // Iterate external crate defs but be mindful about visibility
  for (let def = queue.pop(); def !== undefined; def = queue.pop()) {
    for (const child of tcx.module_children(def)) {
      if (!Visibility.is_public(child.vis)) {
        continue;
      }

      const res = child.res;
      if (res.$ !== "Def") continue;
      const defkind = res._0;
      const def_id = res._1;
      if (defkind.$ === "AssocTy") continue;
      if (defkind.$ === "TyAlias") continue;
      // Ignore external `#[doc(hidden)]` items and their descendants.
      // They shouldn't prevent other items from being considered
      // unique, and should be printed with a full path if necessary.
      if (tcx.is_doc_hidden(def_id)) {
        continue;
      }

      const ns = DefKind.ns(defkind);
      if (ns !== undefined) {
        collect_fn(child.ident, ns, def_id);
      }

      if (DefKind.is_module_like(defkind) && !seen_defs.has(def_id)) {
        seen_defs.add(def_id);
        queue.push(def_id);
      }
    }
  }
}

/// The purpose of this function is to collect public symbols names that are unique across all
/// crates in the build. Later, when printing about types we can use those names instead of the
/// full exported path to them.
///
/// So essentially, if a symbol name can only be imported from one place for a type, and as
/// long as it was not glob-imported anywhere in the current crate, we can trim its printed
/// path and print only the name.
///
/// This has wide implications on error messages with types, for example, shortening
/// `std::vec::Vec` to just `Vec`, as long as there is no other `Vec` importable anywhere.
///
/// The implementation uses similar import discovery logic to that of 'use' suggestions.
///
/// See also [`with_no_trimmed_paths!`].
// this is pub to be able to intra-doc-link it
// rustc: compiler/rustc_middle/src/ty/print/pretty.rs:3528 trimmed_def_paths
export function trimmed_def_paths(tcx: TyCtxt, _: null): DefIdMap<Symbol> {
  // Trimming paths is expensive and not optimized, since we expect it to only be used for error
  // reporting. Record the fact that we did it, so we can abort if we later found it was
  // unnecessary.
  //
  // The `rustc_middle::ty::print::with_no_trimmed_paths` wrapper can be used to suppress this
  // checking, in exchange for full paths being formatted.
  tcx.sess.record_trimmed_def_paths();

  // Once constructed, unique namespace+symbol pairs will have a `Some(_)` entry, while
  // non-unique pairs will have a `None` entry.
  // PORT: `FxIndexMap<(Namespace, Symbol), Option<DefId>>`: an insertion-ordered `KeyedMap`; `None` is `undefined`
  // (an occupied entry is told apart with `has`).
  const unique_symbols_rev = new KeyedMap<[Namespace, Symbol], DefId | undefined>(([ns, symbol]) => `${ns}:${symbol}`);

  for (const symbol_set of tcx.resolutions(null).glob_map.values()) {
    for (const symbol of symbol_set) {
      unique_symbols_rev.set([Namespace.TypeNS, symbol], undefined);
      unique_symbols_rev.set([Namespace.ValueNS, symbol], undefined);
      unique_symbols_rev.set([Namespace.MacroNS, symbol], undefined);
    }
  }

  for_each_def(tcx, (ident, ns, def_id) => {
    const key: [Namespace, Symbol] = [ns, ident.name];
    if (unique_symbols_rev.has(key)) {
      const v = unique_symbols_rev.get(key);
      if (v === undefined) {
        // nothing
      } else {
        const existing = v;
        if (!DefId_eq(existing, def_id)) {
          unique_symbols_rev.set(key, undefined);
        }
      }
    } else {
      unique_symbols_rev.set(key, def_id);
    }
  });

  // Put the symbol from all the unique namespace+symbol pairs into `map`.
  const map = new DefIdMap<Symbol>();
  for (const [[_, symbol], opt_def_id] of unique_symbols_rev) {
    if (opt_def_id !== undefined) {
      const def_id = opt_def_id;
      if (map.has(def_id)) {
        const v = map.get(def_id)!;
        // A single DefId can be known under multiple names (e.g.,
        // with a `pub use ... as ...;`). We need to ensure that the
        // name placed in this map is chosen deterministically, so
        // if we find multiple names (`symbol`) resolving to the
        // same `def_id`, we prefer the lexicographically smallest
        // name.
        //
        // Any stable ordering would be fine here though.
        if (v !== symbol && str_cmp(Symbol.as_str(v), Symbol.as_str(symbol)) > 0) {
          map.set(def_id, symbol);
        }
      } else {
        map.set(def_id, symbol);
      }
    }
  }
  unique_symbols_rev.clear();

  return map;
}

// rustc: compiler/rustc_middle/src/ty/print/pretty.rs:3594 provide
export function provide(providers: Providers): void {
  providers.trimmed_def_paths = trimmed_def_paths;
}

// rustc-type: compiler/rustc_middle/src/ty/print/pretty.rs:3598 OpaqueFnEntry
export interface OpaqueFnEntry {
  kind: ClosureKind;
  return_ty: Binder<Term> | undefined;
}

// ---- helpers of this region (not upstream fns) ----

/** `iter.count()` */
function iter_count<T>(it: Iterable<T>): number {
  let n = 0;
  for (const _ of it) n++;
  return n;
}

/** `iter.next()` on a fresh iterator */
function iter_next<T>(it: Iterable<T>): T | undefined {
  for (const x of it) return x;
  return undefined;
}

/** PORT: `<[u8]>::escape_ascii`'s Display (core `ascii::escape_default` per byte), not in src/std yet. */
function escape_ascii(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) {
    switch (b) {
      case 0x09:
        s += "\\t";
        break;
      case 0x0d:
        s += "\\r";
        break;
      case 0x0a:
        s += "\\n";
        break;
      case 0x5c:
        s += "\\\\";
        break;
      case 0x27:
        s += "\\'";
        break;
      case 0x22:
        s += '\\"';
        break;
      default:
        if (b >= 0x20 && b <= 0x7e) s += String.fromCharCode(b);
        else s += "\\x" + b.toString(16).padStart(2, "0");
    }
  }
  return s;
}

/** PORT: `String::from_utf8_lossy` (WHATWG decoding replaces maximal invalid subparts with U+FFFD, as std does). */
function String_from_utf8_lossy(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: false, ignoreBOM: true }).decode(bytes);
}

/** The `TypeFoldable` descriptors of `PredicateKind` / `ClauseKind` from their generated impl fns (D4). */
const fold_PredicateKind_: TypeFoldable<PredicateKind> = descriptor<PredicateKind>(visit_with_PredicateKind, try_fold_with_PredicateKind, fold_with_PredicateKind);
const fold_ClauseKind_: TypeFoldable<ClauseKind> = descriptor<ClauseKind>(visit_with_ClauseKind, try_fold_with_ClauseKind, fold_with_ClauseKind);

/** `TyCtxt::short_string` takes ty/decls.ts's pending `Print<T>` (`Pending1`); this region's `Print` is lane a's. */
function as_decls_print<T>(d: Print<T>): import("../decls.ts").Print<T> {
  return d as unknown as import("../decls.ts").Print<T>;
}

// ==== stand-ins (PORT: pending other lanes). Root deletes each when its owner lands and points the uses at the
// real port; bodies are upstream's where they only read fields / call ported code, `unported` otherwise. ====

// PORT(decls): pending root / ty-ctxt: `TyCtxt::is_impl_trait_in_trait` (context.rs:2847) is not declared on the class
// yet (merge-w14 installed an `unported` placeholder).
declare module "../context.ts" {
  interface TyCtxt {
    is_impl_trait_in_trait(def_id: DefId): boolean;
  }
}

// ---- pending tyir-binder / tyir-misc (rustc_type_ir binder.rs, visit.rs, lib.rs) ----
/** PORT: pending tyir-binder: `BoundRegionKind::is_named` (binder.rs:1037). */
function BoundRegionKind_is_named(self: BoundRegionKind, tcx: TyCtxt): boolean {
  return BoundRegionKind_get_name(self, tcx) !== undefined;
}
/** PORT: pending tyir-binder: `BoundRegionKind::get_name` (binder.rs:1041). */
function BoundRegionKind_get_name(self: BoundRegionKind, tcx: TyCtxt): Symbol | undefined {
  switch (self.$) {
    case "Named": {
      const name = tcx.item_name(self._0);
      return name === kw.UnderscoreLifetime ? undefined : name;
    }
    case "NamedForPrinting":
      return self._0;
    default:
      return undefined;
  }
}
/** PORT: pending tyir-binder: the derived `PartialEq` of `BoundRegionKind` (binder.rs). */
function BoundRegionKind_eq(a: BoundRegionKind, b: BoundRegionKind): boolean {
  if (a.$ !== b.$) return false;
  if (a.$ === "NamedForPrinting" && b.$ === "NamedForPrinting") return a._0 === b._0;
  if (a.$ === "Named" && b.$ === "Named") return DefId_eq(a._0, b._0);
  return true;
}
/** PORT: pending tyir-binder: `impl TypeSuperFoldable for Binder` (binder.rs): `self.map_bound(|t| t.fold_with(folder))`. */
function Binder_super_fold_with<T>(self: Binder<T>, folder: TypeFolder, d: TypeFoldable<T>): Binder<T> {
  return Binder_map_bound(self, (t) => d.fold_with(t, folder));
}
/** PORT: pending tyir-binder: `TypeVisitableExt::has_bound_vars` on `Clause`. */
function Clause_has_bound_vars(_c: Clause): boolean {
  return unported("rustc_type_ir::visit::TypeVisitableExt::has_bound_vars (lane tyir-binder)");
}
/**
 * PORT: pending tyir-binder: `TypeVisitableExt::has_type_flags` (visit.rs) on a `Ty`: `ty.visit_with(HasTypeFlagsVisitor)`
 * is `visit_ty`, which breaks iff `t.flags().intersects(self.flags)`.
 */
function Ty_has_type_flags(t: Ty, flags: TypeFlagsT): boolean {
  return TypeFlags.intersects(t.flags(), flags);
}
/** PORT: pending tyir-binder: `TypeVisitableExt::has_placeholders` (visit.rs): `self.has_type_flags(HAS_PLACEHOLDER)`. */
function Ty_has_placeholders(t: Ty): boolean {
  return Ty_has_type_flags(t, TypeFlags.HAS_PLACEHOLDER);
}
/**
 * PORT: pending tyir-binder: `TypeVisitableExt::has_vars_bound_at_or_above` (visit.rs) on a `Ty`: `HasEscapingVarsVisitor`'s
 * `visit_ty` breaks iff `t.outer_exclusive_binder() > outer_index`.
 */
function Ty_has_vars_bound_at_or_above(t: Ty, binder: DebruijnIndex): boolean {
  return t.outer_exclusive_binder() > binder;
}
/** PORT: pending tyir-misc: `ClosureKind`'s `Display` (lib.rs): `self.as_str()`. */
function display_ClosureKind(self: ClosureKind): string {
  switch (self) {
    case "Fn":
      return "Fn";
    case "FnMut":
      return "FnMut";
    case "FnOnce":
      return "FnOnce";
  }
}

// ---- pending ty-results / ty-adt-assoc (rustc_middle ty/*) ----
/** PORT: pending ty-results: `impl TypeSuperFoldable for Ty` (structural_impls.rs). */
function Ty_super_fold_with(_t: Ty, _folder: TypeFolder): Ty {
  return unported("rustc_middle::ty::structural_impls::<Ty as TypeSuperFoldable>::super_fold_with (lane ty-results)");
}
/** PORT: pending ty-results: `impl TypeSuperVisitable for Ty` (structural_impls.rs). */
function Ty_super_visit_with<R>(_t: Ty, _visitor: TypeVisitor<R>): R {
  return unported("rustc_middle::ty::structural_impls::<Ty as TypeSuperVisitable>::super_visit_with (lane ty-results)");
}
/** PORT: pending ty-results: `EarlyParamRegion::is_named` (region.rs:31). */
function EarlyParamRegion_is_named(self: EarlyParamRegion): boolean {
  return self.name !== kw.UnderscoreLifetime;
}
/** PORT: pending ty-results: `LateParamRegionKind::is_named` (region.rs:103). */
function LateParamRegionKind_is_named(self: LateParamRegionKind, tcx: TyCtxt): boolean {
  return LateParamRegionKind_get_name(self, tcx) !== undefined;
}
/** PORT: pending ty-results: `LateParamRegionKind::get_name` (region.rs:107). */
function LateParamRegionKind_get_name(self: LateParamRegionKind, tcx: TyCtxt): Symbol | undefined {
  switch (self.$) {
    case "Named": {
      const name = tcx.item_name(self._0);
      return name !== kw.UnderscoreLifetime ? name : undefined;
    }
    case "NamedAnon":
      return self._1;
    default:
      return undefined;
  }
}
/** PORT: pending ty-adt-assoc: `AdtDef::variants` (adt.rs). */
function AdtDef_variants(_def: AdtDef): readonly VariantDefShape[] {
  return unported("rustc_middle::ty::adt::AdtDef::variants (lane ty-adt-assoc)");
}
/** PORT: pending ty-adt-assoc: `AdtDef::variant` (adt.rs). */
function AdtDef_variant(_def: AdtDef, _idx: number): VariantDefShape {
  return unported("rustc_middle::ty::adt::AdtDef::variant (lane ty-adt-assoc)");
}
/** PORT: pending ty-adt-assoc: `VariantDef::ctor_kind` (mod.rs). */
function VariantDef_ctor_kind(_v: VariantDefShape): "Fn" | "Const" | undefined {
  return unported("rustc_middle::ty::VariantDef::ctor_kind (lane ty-adt-assoc)");
}
/** PORT: pending ty-adt-assoc: the fields of `VariantDef` read here (ty/mod.rs). */
interface VariantDefShape {
  def_id: DefId;
  fields: readonly { name: Symbol }[];
}
/** PORT: pending ty-adt-assoc: `TraitDef::paren_sugar` (trait_def.rs; the `trait_def` query value is `unknown`). */
function TraitDef_paren_sugar(trait_def: unknown): boolean {
  return (trait_def as { paren_sugar: boolean }).paren_sugar;
}
// `ty::Value` (valtree.rs:103) is `Pending` in decls.ts; its fields read here.
interface ValueShape {
  valtree: ValTree;
  ty: Ty;
}
/** PORT: pending ty-results: `Deref for ValTree` (valtree.rs). */
function ValTree_deref(_v: ValTree): ValTreeKind {
  return unported("rustc_middle::ty::consts::valtree::ValTree: Deref (lane ty-results)");
}
/** PORT: pending ty-results: `ValTree::is_zst` (valtree.rs). */
function ValTree_is_zst(_v: ValTree): boolean {
  return unported("rustc_middle::ty::consts::valtree::ValTree::is_zst (lane ty-results)");
}
/** PORT: pending ty-results: `Debug for ValTree` (valtree.rs). */
function debug_ValTree(_v: ValTree, _f: Fmt): string {
  return unported("rustc_middle::ty::consts::valtree::ValTree: Debug (lane ty-results)");
}
/** PORT: pending ty-results: `Value::try_to_raw_bytes` (valtree.rs). */
function Value_try_to_raw_bytes(_cv: ValueShape, _tcx: TyCtxt): Uint8Array | undefined {
  return unported("rustc_middle::ty::consts::valtree::Value::try_to_raw_bytes (lane ty-results)");
}
/** PORT: pending ty-results: `Value::destructure_adt_const` (valtree.rs). */
function Value_destructure_adt_const(_cv: ValueShape): { variant: number; fields: readonly Const[] } {
  return unported("rustc_middle::ty::consts::valtree::Value::destructure_adt_const (lane ty-results)");
}
/** PORT: pending ty-results: `ScalarInt == ScalarInt` (int.rs, derived). */
function ScalarInt_eq(_a: ScalarInt, _b: ScalarInt): boolean {
  return unported("rustc_middle::ty::consts::int::ScalarInt: PartialEq (lane ty-results)");
}
/** PORT: pending ty-results: `ScalarInt::FALSE` (int.rs). */
function ScalarInt_FALSE(): ScalarInt {
  return unported("rustc_middle::ty::consts::int::ScalarInt::FALSE (lane ty-results)");
}
/** PORT: pending ty-results: `ScalarInt::TRUE` (int.rs). */
function ScalarInt_TRUE(): ScalarInt {
  return unported("rustc_middle::ty::consts::int::ScalarInt::TRUE (lane ty-results)");
}
/** PORT: pending ty-results: `ScalarInt::size` (int.rs). */
function ScalarInt_size(_int: ScalarInt): Size {
  return unported("rustc_middle::ty::consts::int::ScalarInt::size (lane ty-results)");
}
/** PORT: pending ty-results: `ScalarInt::to_bits` (int.rs). */
function ScalarInt_to_bits(_int: ScalarInt, _size: Size): bigint {
  return unported("rustc_middle::ty::consts::int::ScalarInt::to_bits (lane ty-results)");
}
/** PORT: pending ty-results: `LowerHex for ScalarInt` (int.rs). */
function lower_hex_ScalarInt(_int: ScalarInt): string {
  return unported("rustc_middle::ty::consts::int::ScalarInt: LowerHex (lane ty-results)");
}
/** PORT: pending ty-results: `char::try_from(ScalarInt)` (int.rs); `Err` is `undefined`. */
function char_try_from_ScalarInt(_int: ScalarInt): number | undefined {
  return unported("rustc_middle::ty::consts::int::<char as TryFrom<ScalarInt>>::try_from (lane ty-results)");
}
/** PORT: pending ty-results: `ConstInt` (int.rs). */
type ConstInt = Pending<"ConstInt">;
/** PORT: pending ty-results: `ConstInt::new` (int.rs). */
function ConstInt_new(_int: ScalarInt, _signed: boolean, _is_ptr_sized_integral: boolean): ConstInt {
  return unported("rustc_middle::ty::consts::int::ConstInt::new (lane ty-results)");
}
/** PORT: pending ty-results: `Debug for ConstInt` (int.rs). */
function debug_ConstInt(_v: ConstInt, _f: Fmt): string {
  return unported("rustc_middle::ty::consts::int::ConstInt: Debug (lane ty-results)");
}
/** PORT: pending (rustc_apfloat, not ported): `Half`/`Single`/`Double`/`Quad::try_from(ScalarInt)` (int.rs). */
type IeeeFloat = Pending<"rustc_apfloat::ieee::IeeeFloat">;
function IeeeFloat_try_from_ScalarInt(_kind: "Half" | "Single" | "Double" | "Quad", _int: ScalarInt): IeeeFloat | undefined {
  return unported("rustc_middle::ty::consts::int::<IeeeFloat as TryFrom<ScalarInt>>::try_from (rustc_apfloat, not ported)");
}
/** `.unwrap()` of a `Result<IeeeFloat, Size>` (`Err` is `undefined`). */
function unwrap_float(v: IeeeFloat | undefined): IeeeFloat {
  return v === undefined ? panic("called `Result::unwrap()` on an `Err` value") : v;
}
/** PORT: pending (rustc_apfloat, not ported): `Float::is_finite`. */
function IeeeFloat_is_finite(_v: IeeeFloat): boolean {
  return unported("rustc_apfloat::Float::is_finite (not ported)");
}
/** PORT: pending (rustc_apfloat, not ported): `Display for IeeeFloat`. */
function display_IeeeFloat(_v: IeeeFloat): string {
  return unported("rustc_apfloat::ieee::IeeeFloat: Display (not ported)");
}
/** PORT: pending (rustc_const_eval, not ported): `TyCtxt::validate_scalar_in_layout` (check_validity_requirement.rs:183). */
function TyCtxt_validate_scalar_in_layout(_tcx: TyCtxt, _int: ScalarInt, _ty: Ty): boolean {
  return unported("rustc_const_eval::util::check_validity_requirement::validate_scalar_in_layout (not ported)");
}
/** PORT: pending (rustc_abi / target data layout): `TargetDataLayout::pointer_size` of `tcx.data_layout`. */
function TargetDataLayout_pointer_size(_dl: unknown): Size {
  return unported("rustc_abi::TargetDataLayout::pointer_size (tcx.data_layout is pending)");
}
/** PORT: pending ty-results (`UserTypeKind`, typeck_results.rs): the shape per PORTING §5. */
export type UserTypeKind = { readonly $: "Ty"; _0: Ty } | { readonly $: "TypeOf"; _0: DefId; _1: UserArgs };
interface UserArgs {
  args: GenericArgs;
  user_self_ty: UserSelfTy | undefined;
}
interface UserSelfTy {
  impl_def_id: DefId;
  self_ty: Ty;
}

// ---- pending mir-interpret (M4): mir/interpret's `Scalar`, `Pointer`, `GlobalAlloc`, `AllocRange` ----
// `Scalar` is `Pending` in decls.ts; `ScalarShape` is mir/interpret/value.rs:25 per PORTING §5.
type ScalarShape = { readonly $: "Int"; _0: ScalarInt } | { readonly $: "Ptr"; _0: Pointer; _1: number };
type Pointer = Pending<"mir::interpret::Pointer">;
type CtfeProvenance = Pending<"mir::interpret::CtfeProvenance">;
type AllocId = Pending<"mir::interpret::AllocId">;
/** mir/interpret/mod.rs:255 per PORTING §5. */
type GlobalAlloc =
  | { readonly $: "Function"; instance: Instance }
  | { readonly $: "VTable"; _0: Ty; _1: List<PolyExistentialPredicate> }
  | { readonly $: "Static"; _0: DefId }
  | { readonly $: "Memory"; _0: ConstAllocation }
  | { readonly $: "TypeId"; ty: Ty };
/** mir/interpret/allocation.rs:334 */
interface AllocRange {
  start: Size;
  size: Size;
}
function Pointer_prov_and_relative_offset(_ptr: Pointer): [CtfeProvenance, Size] {
  return unported("rustc_middle::mir::interpret::Pointer::prov_and_relative_offset (M4)");
}
function debug_Pointer(_ptr: Pointer, _f: Fmt): string {
  return unported("rustc_middle::mir::interpret::Pointer: Debug (M4)");
}
function CtfeProvenance_alloc_id(_prov: CtfeProvenance): AllocId {
  return unported("rustc_middle::mir::interpret::CtfeProvenance::alloc_id (M4)");
}
function TyCtxt_try_get_global_alloc(_tcx: TyCtxt, _id: AllocId): GlobalAlloc | undefined {
  return unported("rustc_middle::mir::interpret::TyCtxt::try_get_global_alloc (M4)");
}
function ConstAllocation_inner(_alloc: ConstAllocation): Allocation {
  return unported("rustc_middle::mir::interpret::ConstAllocation::inner (M4)");
}
/** `Ok(bytes)` is the bytes, `Err(_)` is `undefined`. */
function Allocation_get_bytes_strip_provenance(_alloc: Allocation, _tcx: TyCtxt, _range: AllocRange): Uint8Array | undefined {
  return unported("rustc_middle::mir::interpret::Allocation::get_bytes_strip_provenance (M4)");
}
function Instance_args(_instance: Instance): GenericArgs {
  return unported("rustc_middle::ty::instance::Instance::args (M4)");
}
