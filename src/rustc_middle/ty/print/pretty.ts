// Port of compiler/rustc_middle/src/ty/print/pretty.rs (docs/plan-m3.md D7). Two lanes share this file:
// lane ty-print-a ports pretty.rs:1..1704, lane ty-print-b pretty.rs:1705..end. Each region has its own import
// block; edit only your own region.
//
// Extension module (docs/handoff/ty-contract.md "Init order"): rustc_middle/lib.ts loads it after the classes;
// its top-level code may touch only the classes it imports, never another extension module. It imports
// ./mod.ts (the `Printer` base class) first; see the header of ./mod.ts.

// ==== lane ty-print-a: pretty.rs:1..1704 ====
// PORT decisions (docs/handoff/ty-print-a.md):
// - The `thread_local!` cells are module-level `TlCell`s (PORTING §5 "Global state"). Each `define_helper!` fn
//   `$name` is one overloaded function: `$name()` reads the flag (`pub fn $name() -> bool`), `$name(() => e)`
//   is the macro `$name!(e)`: it sets the flag through the `$helper` guard, runs `e`, and restores the flag in
//   `finally` (the guard's `Drop`).
// - `trait PrettyPrinter: Printer + fmt::Write` is the abstract class `PrettyPrinter extends Printer` with the
//   abstract `write_str` of `fmt::Write`; `write!(self, "..", args)` is one `write_str` of the formatted text
//   (the same bytes: `FmtPrinter::write_str` appends). The provided methods of pretty.rs:1705.. are lane
//   ty-print-b's (prototype assignments in its region).
// - Methods generic over `T: Print<Self>` / `T: TypeFoldable` take the descriptors last: `print_T`, then `d_T`
//   (D4). `comma_sep(elems: impl Iterator)` takes an `Iterable`.
import { display_ExternAbi, type ExternAbi } from "../../../rustc_abi/extern_abi.ts";
import { BinOpKind } from "../../../rustc_ast/lib.ts";
import { ExprPrecedence_discriminant } from "../../../rustc_ast/util/parser.gen.ts";
import { FloatTy, IntTy, Mutability, UintTy } from "../../../rustc_ast_ir/lib.ts";
import { LangItem } from "../../../rustc_attr_ir/lang_items.ts";
import type { ExternCrate } from "../../../rustc_crate_store/cstore.gen.ts";
import { DefKind, Namespace, Res } from "../../../rustc_hir/def.ts";
import { CoroutineKind, type CoroutineKind as CoroutineKindT, display_CoroutineDesugaring, display_CoroutineKind, ItemKind, Safety } from "../../../rustc_hir/hir.ts";
import { type DefKey, DefPathData, DisambiguatedDefPathData } from "../../../rustc_hir_id/definitions.ts";
import { CrateNum, debug_DefId, DefId, DefId_eq, DefId_key, DefIdMap, DefIdSet, LOCAL_CRATE, ModId } from "../../../rustc_span/def_id.ts";
import { RemapPathScopeComponents, Span } from "../../../rustc_span/lib.ts";
import { bug } from "../../../rustc_span/macros.ts";
import { display_Ident, display_Symbol, Ident, kw, sym, Symbol } from "../../../rustc_span/symbol.ts";
import { Binder, BoundRegionKind, debug_BoundConst, debug_BoundTy, debug_Placeholder, EarlyBinder, fold_Binder, visit_with_Binder } from "../../../rustc_type_ir/binder.ts";
import { type AliasConst, type AliasTy, type BoundRegion, type ClauseKind, type ClosureArgs, type ConstVid, type ExistentialPredicate, type HostEffectClause, INNERMOST, type NormalizesTo, type OutlivesClause, type Pending, type PlaceholderType, type PolyExistentialPredicate, type PolyFnSig, type PolyTraitClause, type PolyTraitRef, type PredicateKind, type ProjectionClause, type RegionVid, type TyVid, type ValTreeKind } from "../../../rustc_type_ir/decls.ts";
import { Elaboratable_Clause, elaborate } from "../../../rustc_type_ir/elaborate.ts";
import { fold_with_trivial, try_fold_with_trivial, visit_with_trivial } from "../../../rustc_type_ir/macros.ts";
import { Unnormalized } from "../../../rustc_type_ir/unnormalized.ts";
import { type FallibleTypeFolder, fold_tuple2, fold_with_tuple2, type PredicateProxy, standin_fold_Ty, try_fold_with_tuple2, type TypeFoldable, type TypeFolder, TypeFolder_provided, visit_with_tuple2 } from "../../../rustc_type_ir/fold.ts";
import { BoundVar, ClosureKind, DebruijnIndex, debug_bound_var, debug_BoundVar, display_ClosureKind, type FieldInfo } from "../../../rustc_type_ir/lib.ts";
import { as_interner, type BoundConstness, Clause_upcast_from_PolyTraitRef, type CoercePredicate, ExistentialProjection, ExistentialTraitRef, fold_with_ExistentialProjection, fold_with_ExistentialTraitRef, fold_with_TraitClause, PolyExistentialTraitRef, PolyProjectionClause, type SubtypePredicate, TraitClause, TraitRef, try_fold_with_ExistentialProjection, try_fold_with_ExistentialTraitRef, try_fold_with_TraitClause, visit_with_ExistentialProjection, visit_with_ExistentialTraitRef, visit_with_TraitClause } from "../../../rustc_type_ir/predicate.ts";
import { Const, debug_Const, debug_Region, Region } from "../../../rustc_type_ir/sty/mod.ts";
import { AliasTerm, AliasTerm as AliasTermC, type AliasTermKind } from "../../../rustc_type_ir/term_kind.ts";
import type { Alias, AliasTerm as AliasTermT } from "../../../rustc_type_ir/ty/alias.ts";
import { AliasTy as AliasTy_, debug_TyKind, display_InferTy, type FnSig, FnSig as FnSigC, FnSigKind, fold_with_FnSig, PolyFnSig as PolyFnSig_, PolyFnSigTys, try_fold_with_FnSig, type TypeAndMut, UnsafeBinderInner_deref, visit_with_FnSig } from "../../../rustc_type_ir/ty_kind.ts";
import { ClosureArgs as ClosureArgs_, ClosureArgs as ClosureArgsC, CoroutineArgs as CoroutineArgs_, CoroutineClosureArgs as CoroutineClosureArgs_, debug_ClosureArgs } from "../../../rustc_type_ir/ty_kind/closure.ts";
import { type TypeVisitable, TypeVisitableExt, type TypeVisitor, TypeVisitor_provided } from "../../../rustc_type_ir/visit.ts";
import type { Interner } from "../../../rustc_type_ir/interner.ts";
import { intern_key } from "../../../rust_ts/intern_key.ts";
import { KeyedMap } from "../../../rust_ts/keyed.ts";
import { type Debug, debug_char, debug_str, debug_struct, type Fmt, PLAIN, PRETTY } from "../../../std/fmt.ts";
import { assert, assert_eq, panic, unported, unreachable, unwrap } from "../../../std/panic.ts";
import { Err, Ok, type Result, unwrap_result } from "../../../std/result.ts";
import { type Str, utf8_len } from "../../../std/str.ts";
import { TyCtxt } from "../context.ts";
import type { AdtDef, Allocation, AssocItem, BinOp, ConstAllocation, Expr, Instance, Pattern, Scalar, ScalarInt, ValTree, Value, VariantIdx } from "../decls.ts";
import type { TraitDef } from "../trait_def.ts";
import { fold_GenericArgs, fold_with_Tys, GenericArg, type GenericArgs, try_fold_with_Tys, visit_with_Tys } from "../generic_args.ts";
import type { Generics } from "../generics.ts";
import type { Clauses, List } from "../list.ts";
import { debug_Ty, fold_with_Term, fold_with_Ty, Term, try_fold_with_Term, try_fold_with_Ty, Ty, Visibility, visit_with_Term, visit_with_Ty } from "../mod.ts";
import { type Clause, fold_with_Clause, type Predicate, try_fold_with_Clause, visit_with_Clause } from "../predicate.ts";
import { type Print, print_Const, print_List_PolyExistentialPredicate, PRINT_OK, print_Region, print_Ty, Printer, type PrintError, type PrintResult } from "./mod.ts";
import { Size } from "../../../rustc_abi/lib.ts";
import { VisitorResult } from "../../../rustc_ast_ir/visit.ts";
import type { DiagArgValue } from "../../../rustc_error_messages/lib.ts";
import { Limit } from "../../../rustc_structures/limit.ts";
import { debug_BoundVariableKind } from "../../../rustc_type_ir/binder.gen.ts";
import { TypeFlags } from "../../../rustc_type_ir/flags.ts";
import { fold_with_ClauseKind, fold_with_PredicateKind, try_fold_with_ClauseKind, try_fold_with_PredicateKind, visit_with_ClauseKind, visit_with_PredicateKind } from "../../../rustc_type_ir/predicate_kind.gen.ts";
import { debug_RegionVid } from "../../../rustc_type_ir/region_kind.ts";
import type { MutRef } from "../../../std/mut_ref.ts";
import type { Providers } from "../../queries.gen.ts";
import { with_ } from "../context/tls.ts";
import type { EarlyParamRegion, LateParamRegionKind } from "../region.ts";
import type { ParamConst, ParamTy } from "../sty.ts";
import { into_query_key_DefId, type IntoQueryKey } from "../../query/into_query_key.ts";

/** A `thread_local!` `Cell<T>` (PORTING §5 "Global state": module-level state; `get`/`set`/`replace` as `Cell`). */
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

// thread_local! {
const FORCE_IMPL_FILENAME_LINE = new TlCell<boolean>(false);
const SHOULD_PREFIX_WITH_CRATE_NAME = new TlCell<boolean>(false);
const SHOULD_PREFIX_WITH_CRATE = new TlCell<boolean>(false);
const NO_TRIMMED_PATH = new TlCell<boolean>(false);
const FORCE_TRIMMED_PATH = new TlCell<boolean>(false);
const REDUCED_QUERIES = new TlCell<boolean>(false);
const NO_VISIBLE_PATH = new TlCell<boolean>(false);
const NO_VISIBLE_PATH_IF_DOC_HIDDEN = new TlCell<boolean>(false);
const RTN_MODE = new TlCell<RtnMode>("ForDiagnostic");
// }

/// Rendering style for RTN types.
export type RtnMode =
  /// Print the RTN type as an impl trait with its path, i.e.e `impl Sized { T::method(..) }`.
  | "ForDiagnostic"
  /// Print the RTN type as an impl trait, i.e. `impl Sized`.
  | "ForSignature"
  /// Print the RTN type as a value path, i.e. `T::method(..): ...`.
  | "ForSuggestion";
export const RtnMode = { ForDiagnostic: "ForDiagnostic", ForSignature: "ForSignature", ForSuggestion: "ForSuggestion" } as const;
export const debug_RtnMode: Debug<RtnMode> = (v) => v;

// macro_rules! define_helper: each `$helper` is a `DefineHelperGuard` over its thread-local (`pub struct
// $helper(bool)`, `#[must_use]`); each `$name` is the overloaded function below its invocation line.
export class DefineHelperGuard {
  private constructor(
    readonly _0: boolean,
    private readonly tl: TlCell<boolean>,
  ) {}

  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:63 new
  static new(tl: TlCell<boolean>): DefineHelperGuard {
    return new DefineHelperGuard(tl.replace(true), tl);
  }

  // impl Drop for $helper
  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:77 drop
  drop(): void {
    this.tl.set(this._0);
  }
}

/** `pub macro $name($e:expr) { { let _guard = $helper::new(); $e } }` */
function define_helper_macro<R>(tl: TlCell<boolean>, e: () => R): R {
  const _guard = DefineHelperGuard.new(tl);
  try {
    return e();
  } finally {
    _guard.drop();
  }
}

/// Avoids running select queries during any prints that occur
/// during the closure. This may alter the appearance of some
/// types (e.g. forcing verbose printing for opaque types).
/// This method is used during some queries (e.g. `explicit_item_bounds`
/// for opaque types), to ensure that any debug printing that
/// occurs during the query computation does not end up recursively
/// calling the same query.
// rustc: compiler/rustc_middle/src/ty/print/pretty.rs:97 with_reduced_queries
export function with_reduced_queries(): boolean;
export function with_reduced_queries<R>(e: () => R): R;
export function with_reduced_queries<R>(e?: () => R): boolean | R {
  return e === undefined ? REDUCED_QUERIES.get() : define_helper_macro(REDUCED_QUERIES, e);
}
/// Force us to name impls with just the filename/line number. We
/// normally try to use types. But at some points, notably while printing
/// cycle errors, this can result in extra or suboptimal error output,
/// so this variable disables that check.
// rustc: compiler/rustc_middle/src/ty/print/pretty.rs:102 with_forced_impl_filename_line
export function with_forced_impl_filename_line(): boolean;
export function with_forced_impl_filename_line<R>(e: () => R): R;
export function with_forced_impl_filename_line<R>(e?: () => R): boolean | R {
  return e === undefined ? FORCE_IMPL_FILENAME_LINE.get() : define_helper_macro(FORCE_IMPL_FILENAME_LINE, e);
}
/// Adds the crate name prefix to paths where appropriate.
/// Unlike `with_crate_prefix`, this unconditionally uses `tcx.crate_name` instead of sometimes
/// using `crate::` for local items.
///
/// Overrides `with_crate_prefix`.

// This function is used by `rustc_public` and downstream rustc-driver in
// Ferrocene. Please check with them before removing it.
// rustc: compiler/rustc_middle/src/ty/print/pretty.rs:111 with_resolve_crate_name
export function with_resolve_crate_name(): boolean;
export function with_resolve_crate_name<R>(e: () => R): R;
export function with_resolve_crate_name<R>(e?: () => R): boolean | R {
  return e === undefined ? SHOULD_PREFIX_WITH_CRATE_NAME.get() : define_helper_macro(SHOULD_PREFIX_WITH_CRATE_NAME, e);
}
/// Adds the `crate::` prefix to paths where appropriate.
///
/// Ignored if `with_resolve_crate_name` is active.
// rustc: compiler/rustc_middle/src/ty/print/pretty.rs:115 with_crate_prefix
export function with_crate_prefix(): boolean;
export function with_crate_prefix<R>(e: () => R): R;
export function with_crate_prefix<R>(e?: () => R): boolean | R {
  return e === undefined ? SHOULD_PREFIX_WITH_CRATE.get() : define_helper_macro(SHOULD_PREFIX_WITH_CRATE, e);
}
/// Prevent path trimming if it is turned on. Path trimming affects `Display` impl
/// of various rustc types, for example `std::vec::Vec` would be trimmed to `Vec`,
/// if no other `Vec` is found.
// rustc: compiler/rustc_middle/src/ty/print/pretty.rs:119 with_no_trimmed_paths
export function with_no_trimmed_paths(): boolean;
export function with_no_trimmed_paths<R>(e: () => R): R;
export function with_no_trimmed_paths<R>(e?: () => R): boolean | R {
  return e === undefined ? NO_TRIMMED_PATH.get() : define_helper_macro(NO_TRIMMED_PATH, e);
}
// rustc: compiler/rustc_middle/src/ty/print/pretty.rs:120 with_forced_trimmed_paths
export function with_forced_trimmed_paths(): boolean;
export function with_forced_trimmed_paths<R>(e: () => R): R;
export function with_forced_trimmed_paths<R>(e?: () => R): boolean | R {
  return e === undefined ? FORCE_TRIMMED_PATH.get() : define_helper_macro(FORCE_TRIMMED_PATH, e);
}
/// Prevent selection of visible paths. `Display` impl of DefId will prefer
/// visible (public) reexports of types as paths.
// rustc: compiler/rustc_middle/src/ty/print/pretty.rs:123 with_no_visible_paths
export function with_no_visible_paths(): boolean;
export function with_no_visible_paths<R>(e: () => R): R;
export function with_no_visible_paths<R>(e?: () => R): boolean | R {
  return e === undefined ? NO_VISIBLE_PATH.get() : define_helper_macro(NO_VISIBLE_PATH, e);
}
/// Prevent selection of visible paths if the paths are through a doc hidden path.
// rustc: compiler/rustc_middle/src/ty/print/pretty.rs:125 with_no_visible_paths_if_doc_hidden
export function with_no_visible_paths_if_doc_hidden(): boolean;
export function with_no_visible_paths_if_doc_hidden<R>(e: () => R): R;
export function with_no_visible_paths_if_doc_hidden<R>(e?: () => R): boolean | R {
  return e === undefined ? NO_VISIBLE_PATH_IF_DOC_HIDDEN.get() : define_helper_macro(NO_VISIBLE_PATH_IF_DOC_HIDDEN, e);
}

// #[must_use]
export class RtnModeHelper {
  private constructor(readonly _0: RtnMode) {}

  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:132 with
  static with(mode: RtnMode): RtnModeHelper {
    return new RtnModeHelper(RTN_MODE.replace(mode));
  }

  // impl Drop for RtnModeHelper
  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:138 drop
  drop(): void {
    RTN_MODE.set(this._0);
  }
}

/// Print types for the purposes of a suggestion.
///
/// Specifically, this will render RPITITs as `T::method(..)` which is suitable for
/// things like where-clauses.
// pub macro with_types_for_suggestion($e:expr)
export function with_types_for_suggestion<R>(e: () => R): R {
  const _guard = RtnModeHelper.with("ForSuggestion");
  try {
    return e();
  } finally {
    _guard.drop();
  }
}

/// Print types for the purposes of a signature suggestion.
///
/// Specifically, this will render RPITITs as `impl Trait` rather than `T::method(..)`.
// pub macro with_types_for_signature($e:expr)
export function with_types_for_signature<R>(e: () => R): R {
  const _guard = RtnModeHelper.with("ForSignature");
  try {
    return e();
  } finally {
    _guard.drop();
  }
}

/// Avoids running any queries during prints.
// pub macro with_no_queries($e:expr)
export function with_no_queries<R>(e: () => R): R {
  return with_reduced_queries(() => with_forced_impl_filename_line(() => with_no_trimmed_paths(() => with_no_visible_paths(e))));
}

export type WrapBinderMode = "ForAll" | "Unsafe";
export const WrapBinderMode = {
  ForAll: "ForAll",
  Unsafe: "Unsafe",

  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:173 start_str
  start_str(self: WrapBinderMode): string {
    switch (self) {
      case "ForAll":
        return "for<";
      case "Unsafe":
        return "unsafe<";
    }
  },
} as const;
export const debug_WrapBinderMode: Debug<WrapBinderMode> = (v) => v;

/// The "region highlights" are used to control region printing during
/// specific error messages. When a "region highlight" is enabled, it
/// gives an alternate way to print specific regions. For now, we
/// always print those regions using a number, so something like "`'0`".
///
/// Regions not selected by the region highlight mode are presently
/// unaffected.
// #[derive(Copy, Clone, Default)]
export class RegionHighlightMode {
  constructor(
    /// If enabled, when we see the selected region, use "`'N`"
    /// instead of the ordinary behavior.
    public highlight_regions: [[Region, number] | undefined, [Region, number] | undefined, [Region, number] | undefined],

    /// If set to `true`, types that include regions will always be included in the output, while
    /// other types will be free to be trimmed.
    public keep_regions: boolean,

    /// If enabled, when printing a "free region" that originated from
    /// the given `ty::BoundRegionKind`, print it as "`'1`". Free regions that would ordinarily
    /// have names print as normal.
    ///
    /// This is used when you have a signature like `fn foo(x: &u32,
    /// y: &'a u32)` and we want to give a name to the region of the
    /// reference `x`.
    public highlight_bound_region: [BoundRegionKind, number] | undefined,
  ) {}

  /** `#[derive(Default)]` */
  static default(): RegionHighlightMode {
    return new RegionHighlightMode([undefined, undefined, undefined], false, undefined);
  }

  /** `#[derive(Copy, Clone)]`: the struct is copied by value (`let highlight = self.region_highlight_mode;`). */
  clone(): RegionHighlightMode {
    return new RegionHighlightMode([...this.highlight_regions], this.keep_regions, this.highlight_bound_region);
  }

  /// If `region` and `number` are both `Some`, invokes
  /// `highlighting_region`.
  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:211 maybe_highlighting_region
  maybe_highlighting_region(region: Region | undefined, number: number | undefined): void {
    this.keep_regions = true;
    if (region !== undefined && number !== undefined) {
      const k = region;
      const n = number;
      this.highlighting_region(k, n);
    }
  }

  /// Highlights the region inference variable `vid` as `'N`.
  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:225 highlighting_region
  highlighting_region(region: Region, number: number): void {
    const num_slots = this.highlight_regions.length;
    const first_avail_slot = this.highlight_regions.findIndex((s) => s === undefined);
    if (first_avail_slot === -1) {
      bug(`can only highlight ${num_slots} placeholders at a time`);
    }
    this.highlight_regions[first_avail_slot] = [region, number];
    this.keep_regions = true;
  }

  /// Convenience wrapper for `highlighting_region`.
  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:236 highlighting_region_vid
  highlighting_region_vid(tcx: TyCtxt, vid: RegionVid, number: number): void {
    this.highlighting_region(Region.new_var(tcx, vid), number);
  }

  /// Returns `Some(n)` with the number to use for the given region, if any.
  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:246 region_highlighted
  region_highlighted(region: Region): number | undefined {
    for (const h of this.highlight_regions) {
      if (h !== undefined && h[0] === region) return h[1];
    }
    return undefined;
  }

  /// Highlight the given bound region.
  /// We can only highlight one bound region at a time. See
  /// the field `highlight_bound_region` for more detailed notes.
  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:256 highlighting_bound_region
  highlighting_bound_region(br: BoundRegionKind, number: number): void {
    assert(this.highlight_bound_region === undefined, "assertion failed: self.highlight_bound_region.is_none()");
    this.highlight_bound_region = [br, number];
  }
}

/// Trait for printers that pretty-print using `fmt::Write` to the printer.
export abstract class PrettyPrinter extends Printer {
  /** `fmt::Write::write_str` (the `fmt::Write` supertrait). */
  abstract write_str(s: string): PrintResult;

  /// Like `print_def_path` but for value paths.
  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:265 pretty_print_value_path
  pretty_print_value_path(def_id: DefId, args: readonly GenericArg[]): PrintResult {
    return this.print_def_path(def_id, args);
  }

  // PORT: D4 descriptors (`T: Print<Self> + TypeFoldable<TyCtxt>`) last; `value.as_ref()` is the identity.
  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:273 pretty_print_in_binder
  pretty_print_in_binder<T>(value: Binder<T>, print_T: Print<T, this>, _d_T: TypeFoldable<T>): PrintResult {
    return print_T(Binder.skip_binder(value), this);
  }

  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:280 wrap_binder
  wrap_binder<T>(value: Binder<T>, _mode: WrapBinderMode, f: (value: T, p: this) => PrintResult, _d_T: TypeFoldable<T>): PrintResult {
    return f(Binder.skip_binder(value), this);
  }

  /// Prints comma-separated elements.
  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:293 comma_sep
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

  /// Prints `{f: t}` or `{f as t}` depending on the `cast` argument
  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:308 typed_value
  typed_value(f: (p: this) => PrintResult, t: (p: this) => PrintResult, conversion: string): PrintResult {
    let r: PrintResult;
    if ((r = this.write_str("{")).$ === "Err") return r;
    if ((r = f(this)).$ === "Err") return r;
    if ((r = this.write_str(conversion)).$ === "Err") return r;
    if ((r = t(this)).$ === "Err") return r;
    if ((r = this.write_str("}")).$ === "Err") return r;
    return PRINT_OK;
  }

  /// Prints `(...)` around what `f` prints.
  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:323 parenthesized
  parenthesized(f: (p: this) => PrintResult): PrintResult {
    let r: PrintResult;
    if ((r = this.write_str("(")).$ === "Err") return r;
    if ((r = f(this)).$ === "Err") return r;
    if ((r = this.write_str(")")).$ === "Err") return r;
    return PRINT_OK;
  }

  /// Prints `(...)` around what `f` prints if `parenthesized` is true, otherwise just prints `f`.
  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:334 maybe_parenthesized
  maybe_parenthesized(f: (p: this) => PrintResult, parenthesized: boolean): PrintResult {
    let r: PrintResult;
    if (parenthesized) {
      if ((r = this.parenthesized(f)).$ === "Err") return r;
    } else {
      if ((r = f(this)).$ === "Err") return r;
    }
    return PRINT_OK;
  }

  /// Prints `<...>` around what `f` prints.
  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:348 generic_delimiters
  abstract generic_delimiters(f: (p: this) => PrintResult): PrintResult;

  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:353 should_truncate
  should_truncate(): boolean {
    return false;
  }

  /// Returns `true` if the region should be printed in optional positions,
  /// e.g., `&'a T` or `dyn Tr + 'b`. (Regions like the one in `Cow<'static, T>`
  /// will always be printed.)
  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:360 should_print_optional_region
  abstract should_print_optional_region(region: Region): boolean;

  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:362 reset_type_limit
  reset_type_limit(): void {}

  // Defaults (should not be overridden):

  /// If possible, this returns a global path resolving to `def_id` that is visible
  /// from at least one local module, and returns `true`. If the crate defining `def_id` is
  /// declared with an `extern crate`, the path is guaranteed to use the `extern crate`.
  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:369 try_print_visible_def_path
  try_print_visible_def_path(def_id: DefId): Result<boolean, PrintError> {
    if (with_no_visible_paths()) {
      return Ok(false);
    }

    const callers: DefId[] = [];
    return this.try_print_visible_def_path_recur(def_id, callers);
  }

  // Given a `DefId`, produce a short name. For types and traits, it prints *only* its name,
  // For associated items on traits it prints out the trait's name and the associated item's name.
  // For enum variants, if they have an unique name, then we only print the name, otherwise we
  // print the enum name and the variant name. Otherwise, we do not print anything and let the
  // caller use the `print_def_path` fallback.
  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:383 force_print_trimmed_def_path
  force_print_trimmed_def_path(def_id: DefId): Result<boolean, PrintError> {
    let r: PrintResult;
    const key = this.tcx().def_key(def_id);
    const visible_parent_map = this.tcx().visible_parent_map(null);
    const kind = this.tcx().def_kind(def_id);

    const get_local_name = (this_: this, name: Symbol, def_id: DefId, key: DefKey): Symbol => {
      const visible_parent = visible_parent_map.get(def_id);
      let actual_parent: DefId | undefined;
      if (
        visible_parent !== undefined &&
        ((actual_parent = this_.tcx().opt_parent(def_id)), true) &&
        key.disambiguated_data.data.$ === "TypeNs" &&
        !(actual_parent !== undefined && DefId_eq(visible_parent, actual_parent))
      ) {
        const child = this_
          .tcx()
          .module_children(ModId.new_unchecked(visible_parent))
          .filter((child) => opt_def_id_eq(Res.opt_def_id(child.res), def_id))
          .find((child) => Visibility.is_public(child.vis) && child.ident.name !== kw.Underscore);
        return child !== undefined ? child.ident.name : name;
      } else {
        return name;
      }
    };
    let symbol: Symbol | undefined;
    if (kind.$ === "Variant" && (symbol = this.tcx().trimmed_def_paths(null).get(def_id)) !== undefined) {
      // If `Assoc` is unique, we don't want to talk about `Trait::Assoc`.
      if ((r = this.write_str(Symbol.as_str(get_local_name(this, symbol, def_id, key)))).$ === "Err") return r;
      return Ok(true);
    }
    symbol = key.get_opt_name();
    if (symbol !== undefined) {
      let parent: DefId | undefined;
      let parent_key: DefKey;
      let parent_symbol: Symbol | undefined;
      if (
        (kind.$ === "AssocConst" || kind.$ === "AssocFn" || kind.$ === "AssocTy") &&
        (parent = this.tcx().opt_parent(def_id)) !== undefined &&
        ((parent_key = this.tcx().def_key(parent)), true) &&
        (parent_symbol = parent_key.get_opt_name()) !== undefined
      ) {
        // Trait
        if ((r = this.write_str(Symbol.as_str(get_local_name(this, parent_symbol, parent, parent_key)))).$ === "Err") return r;
        if ((r = this.write_str("::")).$ === "Err") return r;
      } else if (
        kind.$ === "Variant" &&
        (parent = this.tcx().opt_parent(def_id)) !== undefined &&
        ((parent_key = this.tcx().def_key(parent)), true) &&
        (parent_symbol = parent_key.get_opt_name()) !== undefined
      ) {
        // Enum

        // For associated items and variants, we want the "full" path, namely, include
        // the parent type in the path. For example, `Iterator::Item`.
        if ((r = this.write_str(Symbol.as_str(get_local_name(this, parent_symbol, parent, parent_key)))).$ === "Err") return r;
        if ((r = this.write_str("::")).$ === "Err") return r;
      } else if (
        kind.$ === "Struct" ||
        kind.$ === "Union" ||
        kind.$ === "Enum" ||
        kind.$ === "Trait" ||
        kind.$ === "TyAlias" ||
        kind.$ === "Fn" ||
        kind.$ === "Const" ||
        kind.$ === "Static"
      ) {
      } else {
        // If not covered above, like for example items out of `impl` blocks, fallback.
        return Ok(false);
      }
      if ((r = this.write_str(Symbol.as_str(get_local_name(this, symbol, def_id, key)))).$ === "Err") return r;
      return Ok(true);
    }
    return Ok(false);
  }

  /// Try to see if this path can be trimmed to a unique symbol name.
  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:452 try_print_trimmed_def_path
  try_print_trimmed_def_path(def_id: DefId): Result<boolean, PrintError> {
    if (with_forced_trimmed_paths()) {
      const r = this.force_print_trimmed_def_path(def_id);
      if (r.$ === "Err") return r;
      if (r._0) {
        return Ok(true);
      }
    }
    let symbol: Symbol | undefined;
    if (
      this.tcx().sess.opts.unstable_opts.trim_diagnostic_paths &&
      this.tcx().sess.opts.trimmed_def_paths &&
      !with_no_trimmed_paths() &&
      !with_crate_prefix() &&
      (symbol = this.tcx().trimmed_def_paths(null).get(def_id)) !== undefined
    ) {
      const r = this.write_str(display_Ident(Ident.with_dummy_span(symbol)));
      if (r.$ === "Err") return r;
      return Ok(true);
    } else {
      return Ok(false);
    }
  }

  /// Does the work of `try_print_visible_def_path`, building the
  /// full definition path recursively before attempting to
  /// post-process it into the valid and visible version that
  /// accounts for re-exports.
  ///
  /// This method should only be called by itself or
  /// `try_print_visible_def_path`.
  ///
  /// `callers` is a chain of visible_parent's leading to `def_id`,
  /// to support cycle detection during recursion.
  ///
  /// This method returns false if we can't print the visible path, so
  /// `print_def_path` can fall back on the item's real definition path.
  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:482 try_print_visible_def_path_recur
  try_print_visible_def_path_recur(def_id: DefId, callers: DefId[]): Result<boolean, PrintError> {
    let r: PrintResult;
    // debug!("try_print_visible_def_path: def_id={:?}", def_id);

    // If `def_id` is a direct or injected extern crate, return the
    // path to the crate followed by the path to the item within the crate.
    const cnum = def_id.as_crate_root();
    if (cnum !== undefined) {
      if (cnum === LOCAL_CRATE) {
        if ((r = this.print_crate_name(cnum)).$ === "Err") return r;
        return Ok(true);
      }

      // In local mode, when we encounter a crate other than
      // LOCAL_CRATE, execution proceeds in one of two ways:
      //
      // 1. For a direct dependency, where user added an
      //    `extern crate` manually, we put the `extern
      //    crate` as the parent. So you wind up with
      //    something relative to the current crate.
      // 2. For an extern inferred from a path or an indirect crate,
      //    where there is no explicit `extern crate`, we just prepend
      //    the crate name.
      // PORT: the `extern_crate` query value is `unknown` in queries.gen.ts.
      const extern_crate = this.tcx().extern_crate(cnum) as ExternCrate | undefined;
      if (extern_crate !== undefined) {
        const { src, dependency_of, span } = extern_crate;
        if (src.$ === "Extern" && dependency_of === LOCAL_CRATE) {
          const def_id_ = src._0;
          // NOTE(eddyb) the only reason `span` might be dummy,
          // that we're aware of, is that it's the `std`/`core`
          // `extern crate` injected by default.
          // FIXME(eddyb) find something better to key this on,
          // or avoid ending up with `ExternCrateSource::Extern`,
          // for the injected `std`/`core`.
          if (Span.is_dummy(span)) {
            if ((r = this.print_crate_name(cnum)).$ === "Err") return r;
            return Ok(true);
          }

          // Disable `try_print_trimmed_def_path` behavior within
          // the `print_def_path` call, to avoid infinite recursion
          // in cases where the `extern crate foo` has non-trivial
          // parents, e.g. it's nested in `impl foo::Trait for Bar`
          // (see also issues #55779 and #87932).
          if ((r = with_no_visible_paths(() => this.print_def_path(def_id_, []))).$ === "Err") return r;

          return Ok(true);
        } else if (src.$ === "Path" && dependency_of === LOCAL_CRATE) {
          if ((r = this.print_crate_name(cnum)).$ === "Err") return r;
          return Ok(true);
        } else {
        }
      } else {
        if ((r = this.print_crate_name(cnum)).$ === "Err") return r;
        return Ok(true);
      }
    }

    if (def_id.is_local()) {
      return Ok(false);
    }

    const visible_parent_map = this.tcx().visible_parent_map(null);

    let cur_def_key = this.tcx().def_key(def_id);
    // debug!("try_print_visible_def_path: cur_def_key={:?}", cur_def_key);

    // For a constructor, we want the name of its parent rather than <unnamed>.
    if (cur_def_key.disambiguated_data.data.$ === "Ctor") {
      const parent = new DefId(unwrap(cur_def_key.parent, "`DefPathData::Ctor` / `VariantData` missing a parent"), def_id.krate);

      cur_def_key = this.tcx().def_key(parent);
    }

    const visible_parent = visible_parent_map.get(def_id);
    if (visible_parent === undefined) {
      return Ok(false);
    }

    if (this.tcx().is_doc_hidden(visible_parent) && with_no_visible_paths_if_doc_hidden()) {
      return Ok(false);
    }

    const actual_parent = this.tcx().opt_parent(def_id);
    // debug!(
    //     "try_print_visible_def_path: visible_parent={:?} actual_parent={:?}",
    //     visible_parent, actual_parent,
    // );

    // PORT: `DefPathData` is `Copy`: `data` is a local copy, so `*name = new_name` builds a new value.
    let data: DefPathData = cur_def_key.disambiguated_data.data;
    // debug!(
    //     "try_print_visible_def_path: data={:?} visible_parent={:?} actual_parent={:?}",
    //     data, visible_parent, actual_parent,
    // );

    // In order to output a path that could actually be imported (valid and visible),
    // we need to handle re-exports correctly.
    //
    // For example, take `std::os::unix::process::CommandExt`, this trait is actually
    // defined at `std::sys::unix::ext::process::CommandExt` (at time of writing).
    //
    // `std::os::unix` reexports the contents of `std::sys::unix::ext`. `std::sys` is
    // private so the "true" path to `CommandExt` isn't accessible.
    //
    // In this case, the `visible_parent_map` will look something like this:
    //
    // (child) -> (parent)
    // `std::sys::unix::ext::process::CommandExt` -> `std::sys::unix::ext::process`
    // `std::sys::unix::ext::process` -> `std::sys::unix::ext`
    // `std::sys::unix::ext` -> `std::os`
    //
    // This is correct, as the visible parent of `std::sys::unix::ext` is in fact
    // `std::os`.
    //
    // When printing the path to `CommandExt` and looking at the `cur_def_key` that
    // corresponds to `std::sys::unix::ext`, we would normally print `ext` and then go
    // to the parent - resulting in a mangled path like
    // `std::os::ext::process::CommandExt`.
    //
    // Instead, we must detect that there was a re-export and instead print `unix`
    // (which is the name `std::sys::unix::ext` was re-exported as in `std::os`). To
    // do this, we compare the parent of `std::sys::unix::ext` (`std::sys::unix`) with
    // the visible parent (`std::os`). If these do not match, then we iterate over
    // the children of the visible parent (as was done when computing
    // `visible_parent_map`), looking for the specific child we currently have and then
    // have access to the re-exported name.
    if (data.$ === "TypeNs" && !(actual_parent !== undefined && DefId_eq(visible_parent, actual_parent))) {
      // Item might be re-exported several times, but filter for the one
      // that's public and whose identifier isn't `_`.
      const reexport = this.tcx()
        .module_children(ModId.new_unchecked(visible_parent))
        .filter((child) => opt_def_id_eq(Res.opt_def_id(child.res), def_id))
        .find((child) => Visibility.is_public(child.vis) && child.ident.name !== kw.Underscore);

      if (reexport !== undefined) {
        const new_name = reexport.ident.name;
        data = { $: "TypeNs", _0: new_name };
      } else {
        // There is no name that is public and isn't `_`, so bail.
        return Ok(false);
      }
    }
    // Re-exported `extern crate` (#43189).
    else if (data.$ === "CrateRoot") {
      data = { $: "TypeNs", _0: this.tcx().crate_name(def_id.krate) };
    } else {
    }
    // debug!("try_print_visible_def_path: data={:?}", data);

    if (callers.some((c) => DefId_eq(c, visible_parent))) {
      return Ok(false);
    }
    callers.push(visible_parent);
    // HACK(eddyb) this bypasses `print_path_with_simple`'s prefix printing to avoid
    // knowing ahead of time whether the entire path will succeed or not.
    // To support printers that do not implement `PrettyPrinter`, a `Vec` or
    // linked list on the stack would need to be built, before any printing.
    const rr = this.try_print_visible_def_path_recur(visible_parent, callers);
    if (rr.$ === "Err") return rr;
    switch (rr._0) {
      case false:
        return Ok(false);
      case true:
        break;
    }
    callers.pop();
    if ((r = this.print_path_with_simple((_) => PRINT_OK, new DisambiguatedDefPathData(data, 0))).$ === "Err") return r;
    return Ok(true);
  }

  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:662 pretty_print_path_with_qualified
  pretty_print_path_with_qualified(self_ty: Ty, trait_ref: TraitRef | undefined): PrintResult {
    if (trait_ref === undefined) {
      // Inherent impls. Try to print `Foo::bar` for an inherent
      // impl on `Foo`, but fallback to `<Foo>::bar` if self-type is
      // anything other than a simple path.
      switch (self_ty.kind().$) {
        case "Adt":
        case "Foreign":
        case "Bool":
        case "Char":
        case "Str":
        case "Int":
        case "Uint":
        case "Float": {
          return print_Ty(self_ty, this);
        }

        default: {
        }
      }
    }

    return this.generic_delimiters((p) => {
      let r: PrintResult;
      if ((r = print_Ty(self_ty, p)).$ === "Err") return r;
      if (trait_ref !== undefined) {
        if ((r = p.write_str(" as ")).$ === "Err") return r;
        if ((r = print_TraitRefPrintOnlyTraitPath(TraitRef_print_only_trait_path(trait_ref), p)).$ === "Err") return r;
      }
      return PRINT_OK;
    });
  }

  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:697 pretty_print_path_with_impl
  pretty_print_path_with_impl(print_prefix: (p: this) => PrintResult, self_ty: Ty, trait_ref: TraitRef | undefined): PrintResult {
    let r: PrintResult;
    if ((r = print_prefix(this)).$ === "Err") return r;

    return this.generic_delimiters((p) => {
      let r: PrintResult;
      if ((r = p.write_str("impl ")).$ === "Err") return r;
      if (trait_ref !== undefined) {
        if ((r = print_TraitRefPrintOnlyTraitPath(TraitRef_print_only_trait_path(trait_ref), p)).$ === "Err") return r;
        if ((r = p.write_str(" for ")).$ === "Err") return r;
      }
      if ((r = print_Ty(self_ty, p)).$ === "Err") return r;

      return PRINT_OK;
    });
  }

  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:717 pretty_print_closure_inner
  pretty_print_closure_inner(did: DefId, args: GenericArgs): PrintResult {
    let r: PrintResult;
    let did_local;
    if (this.should_truncate()) {
      return this.write_str("@...");
    } else if (this.tcx().sess.opts.unstable_opts.span_free_formats) {
      if ((r = this.write_str("@")).$ === "Err") return r;
      return this.print_def_path(did, args);
    } else if ((did_local = did.as_local()) !== undefined) {
      const span = this.tcx().def_span(did_local);
      const loc = with_forced_trimmed_paths()
        ? this.tcx().sess.source_map().span_to_short_string(span, RemapPathScopeComponents.DIAGNOSTICS)
        : this.tcx().sess.source_map().span_to_diagnostic_string(span);
      return this.write_str(
        `@${
          // This may end up in stderr diagnostics but it may also be
          // emitted into MIR. Hence we use the remapped path if
          // available
          loc
        }`,
      );
    } else {
      if ((r = this.write_str("@")).$ === "Err") return r;
      return this.print_def_path(did, args);
    }
  }

  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:751 pretty_print_type
  pretty_print_type(ty: Ty): PrintResult {
    let r: PrintResult;
    const kind = ty.kind();
    switch (kind.$) {
      case "Bool":
        if ((r = this.write_str("bool")).$ === "Err") return r;
        break;
      case "Char":
        if ((r = this.write_str("char")).$ === "Err") return r;
        break;
      case "Int":
        if ((r = this.write_str(IntTy.name_str(kind._0))).$ === "Err") return r;
        break;
      case "Uint":
        if ((r = this.write_str(UintTy.name_str(kind._0))).$ === "Err") return r;
        break;
      case "Float":
        if ((r = this.write_str(FloatTy.name_str(kind._0))).$ === "Err") return r;
        break;
      case "Pat": {
        const [ty, pat] = [kind._0, kind._1];
        if ((r = this.write_str("pattern_type!(")).$ === "Err") return r;
        if ((r = print_Ty(ty, this)).$ === "Err") return r;
        if ((r = this.write_str(` is ${debug_Pattern(pat)})`)).$ === "Err") return r;
        break;
      }
      case "RawPtr": {
        const [ty, mutbl] = [kind._0, kind._1];
        if ((r = this.write_str(`*${Mutability.ptr_str(mutbl)} `)).$ === "Err") return r;
        if ((r = print_Ty(ty, this)).$ === "Err") return r;
        break;
      }
      case "Ref": {
        const [rg, ty, mutbl] = [kind._0, kind._1, kind._2];
        if ((r = this.write_str("&")).$ === "Err") return r;
        if (this.should_print_optional_region(rg)) {
          if ((r = print_Region(rg, this)).$ === "Err") return r;
          if ((r = this.write_str(" ")).$ === "Err") return r;
        }
        if ((r = print_TypeAndMut({ ty, mutbl }, this)).$ === "Err") return r;
        break;
      }
      case "Never":
        if ((r = this.write_str("!")).$ === "Err") return r;
        break;
      case "Tuple": {
        const tys = kind._0;
        if ((r = this.write_str("(")).$ === "Err") return r;
        if ((r = this.comma_sep(tys, print_Ty)).$ === "Err") return r;
        if (tys.length === 1) {
          if ((r = this.write_str(",")).$ === "Err") return r;
        }
        if ((r = this.write_str(")")).$ === "Err") return r;
        break;
      }
      case "FnDef": {
        const def_id = kind._0;
        const args = unwrap(Binder.no_bound_vars(kind._1, fold_GenericArgs));
        if (with_reduced_queries()) {
          if ((r = this.print_def_path(def_id, args)).$ === "Err") return r;
        } else {
          // PORT: the `fn_sig` / `codegen_fn_attrs` query values are `unknown` in queries.gen.ts.
          let sig = Unnormalized.skip_norm_wip(EarlyBinder.instantiate(this.tcx().fn_sig(def_id) as EarlyBinder<PolyFnSig>, this.tcx(), args, fold_Binder(fold_FnSig_)));
          if ((this.tcx().codegen_fn_attrs(def_id) as CodegenFnAttrsView).safe_target_features) {
            if ((r = this.write_str("#[target_feature(..)] ")).$ === "Err") return r;
            sig = Binder.map_bound(sig, (sig_) => {
              const sig = { ...sig_ };
              sig.fn_sig_kind = FnSigKind.set_safety(sig.fn_sig_kind, "Safe" satisfies Safety);
              return sig;
            });
          }
          if ((r = print_Binder(sig, this, print_FnSig, fold_FnSig_)).$ === "Err") return r;
          if ((r = this.write_str(" {")).$ === "Err") return r;
          if ((r = this.pretty_print_value_path(def_id, args)).$ === "Err") return r;
          if ((r = this.write_str("}")).$ === "Err") return r;
        }
        break;
      }
      case "FnPtr": {
        const [sig_tys, hdr] = [kind._0, kind._1];
        if ((r = print_Binder(PolyFnSigTys.with(sig_tys, hdr), this, print_FnSig, fold_FnSig_)).$ === "Err") return r;
        break;
      }
      case "UnsafeBinder": {
        const bound_ty = kind._0;
        // PORT: `&UnsafeBinderInner` derefs to its `Binder<Ty>` (`UnsafeBinderInner_deref`).
        if ((r = this.wrap_binder(UnsafeBinderInner_deref(bound_ty), "Unsafe", (ty, p) => p.pretty_print_type(ty), fold_Ty_)).$ === "Err") return r;
        break;
      }
      case "Infer": {
        const infer_ty = kind._0;
        if (this.should_print_verbose()) {
          if ((r = this.write_str(debug_TyKind(ty.kind(), PLAIN))).$ === "Err") return r;
          return PRINT_OK;
        }

        if (infer_ty.$ === "TyVar") {
          const ty_vid = infer_ty._0;
          const name = this.ty_infer_name(ty_vid);
          if (name !== undefined) {
            if ((r = this.write_str(display_Symbol(name))).$ === "Err") return r;
          } else {
            if ((r = this.write_str(display_InferTy(infer_ty))).$ === "Err") return r;
          }
        } else {
          if ((r = this.write_str(display_InferTy(infer_ty))).$ === "Err") return r;
        }
        break;
      }
      case "Error":
        if ((r = this.write_str("{type error}")).$ === "Err") return r;
        break;
      case "Param": {
        const param_ty = kind._0;
        if ((r = print_ParamTy(param_ty, this)).$ === "Err") return r;
        break;
      }
      case "Bound": {
        const [debruijn, bound_ty] = [kind._0, kind._1];
        switch (bound_ty.kind.$) {
          case "Anon":
            if ((r = this.write_str(debug_bound_var(debruijn, bound_ty.var, debug_BoundVar))).$ === "Err") return r;
            break;
          case "Param": {
            const def_id = bound_ty.kind._0;
            switch (this.should_print_verbose()) {
              case true:
                if ((r = this.write_str(debug_TyKind(ty.kind(), PLAIN))).$ === "Err") return r;
                break;
              case false:
                if ((r = this.write_str(display_Symbol(this.tcx().item_name(def_id)))).$ === "Err") return r;
                break;
            }
            break;
          }
        }
        break;
      }
      case "Adt": {
        const [def, args] = [kind._0, kind._1];
        const field_info = def.field_representing_type_info(this.tcx(), args);
        if (field_info !== undefined) {
          const { base, variant, name } = field_info;
          if (variant !== undefined) {
            if ((r = this.write_str(`field_of!(${display_Ty(base)}, ${display_Symbol(variant)}.${display_Symbol(name)})`)).$ === "Err") return r;
          } else {
            if ((r = this.write_str(`field_of!(${display_Ty(base)}, ${display_Symbol(name)})`)).$ === "Err") return r;
          }
        } else {
          if ((r = this.print_def_path(def.did(), args)).$ === "Err") return r;
        }
        break;
      }
      case "Dynamic": {
        const [data, rg] = [kind._0, kind._1];
        const print_r = this.should_print_optional_region(rg);
        if (print_r) {
          if ((r = this.write_str("(")).$ === "Err") return r;
        }
        if ((r = this.write_str("dyn ")).$ === "Err") return r;
        if ((r = print_List_PolyExistentialPredicate(data, this)).$ === "Err") return r;
        if (print_r) {
          if ((r = this.write_str(" + ")).$ === "Err") return r;
          if ((r = print_Region(rg, this)).$ === "Err") return r;
          if ((r = this.write_str(")")).$ === "Err") return r;
        }
        break;
      }
      case "Foreign": {
        const def_id = kind._0;
        if ((r = this.print_def_path(def_id, [])).$ === "Err") return r;
        break;
      }
      case "Alias": {
        const data = kind._1;
        const k = data.kind;
        if (k.$ === "Projection" || k.$ === "Inherent" || k.$ === "Free") {
          if ((r = print_AliasTy(data, this)).$ === "Err") return r;
          break;
        }
        // ty::Alias(_, ty::AliasTy { kind: ty::Opaque { def_id }, args, .. })
        const def_id = k.def_id;
        const args = data.args;
        // We use verbose printing in 'NO_QUERIES' mode, to
        // avoid needing to call `clauses_of`. This should
        // only affect certain debug messages (e.g. messages printed
        // from `rustc_middle::ty` during the computation of `tcx.clauses_of`),
        // and should have no effect on any compiler output.
        // [Unless `-Zverbose-internals` is used, e.g. in the output of
        // `tests/ui/nll/ty-outlives/impl-trait-captures.rs`, for
        // example.]
        if (this.should_print_verbose()) {
          // FIXME(eddyb) print this with `print_def_path`.
          if ((r = this.write_str(`Opaque(${debug_DefId(def_id, PLAIN)}, ${args.print_as_list()})`)).$ === "Err") return r;
          return PRINT_OK;
        }

        const parent = this.tcx().parent(def_id);
        const parent_kind: DefKind = this.tcx().def_kind(parent);
        switch (parent_kind.$) {
          case "TyAlias":
          case "AssocTy": {
            // NOTE: I know we should check for NO_QUERIES here, but it's alright.
            // `type_of` on a type alias or assoc type should never cause a cycle.
            // PORT: the `type_of` query value is `unknown` in queries.gen.ts.
            const parent_ty_kind = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(this.tcx().type_of(parent) as EarlyBinder<Ty>)).kind();
            if (parent_ty_kind.$ === "Alias" && parent_ty_kind._1.kind.$ === "Opaque") {
              const d = parent_ty_kind._1.kind.def_id;
              if (DefId_eq(d, def_id)) {
                // If the type alias directly starts with the `impl` of the
                // opaque type we're printing, then skip the `::{opaque#1}`.
                if ((r = this.print_def_path(parent, args)).$ === "Err") return r;
                return PRINT_OK;
              }
            }
            // Complex opaque type, e.g. `type Foo = (i32, impl Debug);`
            if ((r = this.print_def_path(def_id, args)).$ === "Err") return r;
            return PRINT_OK;
          }
          default: {
            if (with_reduced_queries()) {
              if ((r = this.print_def_path(def_id, [])).$ === "Err") return r;
              return PRINT_OK;
            } else {
              return this.pretty_print_opaque_impl_type(def_id, args);
            }
          }
        }
      }
      case "Placeholder": {
        const placeholder = kind._0;
        if ((r = print_PlaceholderType(placeholder, this)).$ === "Err") return r;
        break;
      }
      case "Str":
        if ((r = this.write_str("str")).$ === "Err") return r;
        break;
      case "Coroutine": {
        const [did, args] = [kind._0, kind._1];
        if ((r = this.write_str("{")).$ === "Err") return r;
        // PORT: the `coroutine_kind` query value is `unknown` in queries.gen.ts.
        const coroutine_kind = unwrap(this.tcx().coroutine_kind(did) as CoroutineKindT | undefined);
        const should_print_movability = this.should_print_verbose() || coroutine_kind.$ === "Coroutine";

        if (should_print_movability) {
          switch (CoroutineKind.movability(coroutine_kind)) {
            case "Movable":
              break;
            case "Static":
              if ((r = this.write_str("static ")).$ === "Err") return r;
              break;
          }
        }

        if (!this.should_print_verbose()) {
          if ((r = this.write_str(display_CoroutineKind(coroutine_kind))).$ === "Err") return r;
          if (CoroutineKind.is_fn_like(coroutine_kind)) {
            // If we are printing an `async fn` coroutine type, then give the path
            // of the fn, instead of its span, because that will in most cases be
            // more helpful for the reader than just a source location.
            //
            // This will look like:
            //    {async fn body of some_fn()}
            if ((r = this.write_str(" of ")).$ === "Err") return r;
            const did_of_the_fn_item = this.tcx().parent(did);
            if ((r = this.print_def_path(did_of_the_fn_item, args)).$ === "Err") return r;
            if ((r = this.write_str("()")).$ === "Err") return r;
          } else {
            if ((r = this.pretty_print_closure_inner(did, args)).$ === "Err") return r;
          }
        } else {
          if ((r = this.print_def_path(did, args)).$ === "Err") return r;
          if ((r = this.write_str(" upvar_tys=")).$ === "Err") return r;
          if ((r = print_Ty(CoroutineArgs_.tupled_upvars_ty(args.as_coroutine()), this)).$ === "Err") return r;
          if ((r = this.write_str(" resume_ty=")).$ === "Err") return r;
          if ((r = print_Ty(CoroutineArgs_.resume_ty(args.as_coroutine()), this)).$ === "Err") return r;
          if ((r = this.write_str(" yield_ty=")).$ === "Err") return r;
          if ((r = print_Ty(CoroutineArgs_.yield_ty(args.as_coroutine()), this)).$ === "Err") return r;
          if ((r = this.write_str(" return_ty=")).$ === "Err") return r;
          if ((r = print_Ty(CoroutineArgs_.return_ty(args.as_coroutine()), this)).$ === "Err") return r;
        }

        if ((r = this.write_str("}")).$ === "Err") return r;
        break;
      }
      case "CoroutineWitness": {
        const [did, args] = [kind._0, kind._1];
        if ((r = this.write_str("{")).$ === "Err") return r;
        if (!this.should_print_verbose()) {
          if ((r = this.write_str("coroutine witness")).$ === "Err") return r;
          if ((r = this.pretty_print_closure_inner(did, args)).$ === "Err") return r;
        } else {
          if ((r = this.print_def_path(did, args)).$ === "Err") return r;
        }
        if ((r = this.write_str("}")).$ === "Err") return r;
        break;
      }
      case "Closure": {
        const [did, args] = [kind._0, kind._1];
        if ((r = this.write_str("{")).$ === "Err") return r;
        if (!this.should_print_verbose()) {
          if ((r = this.write_str("closure")).$ === "Err") return r;
          if ((r = this.pretty_print_closure_inner(did, args)).$ === "Err") return r;
        } else {
          if ((r = this.print_def_path(did, args)).$ === "Err") return r;
          if ((r = this.write_str(" closure_kind_ty=")).$ === "Err") return r;
          if ((r = print_Ty(ClosureArgs_.kind_ty(args.as_closure()), this)).$ === "Err") return r;
          if ((r = this.write_str(" closure_sig_as_fn_ptr_ty=")).$ === "Err") return r;
          if ((r = print_Ty(ClosureArgs_.sig_as_fn_ptr_ty(args.as_closure()), this)).$ === "Err") return r;
          if ((r = this.write_str(" upvar_tys=")).$ === "Err") return r;
          if ((r = print_Ty(ClosureArgs_.tupled_upvars_ty(args.as_closure()), this)).$ === "Err") return r;
        }
        if ((r = this.write_str("}")).$ === "Err") return r;
        break;
      }
      case "CoroutineClosure": {
        const [did, args] = [kind._0, kind._1];
        if ((r = this.write_str("{")).$ === "Err") return r;
        if (!this.should_print_verbose()) {
          // PORT: the `coroutine_kind` query value is `unknown` in queries.gen.ts.
          const ck = unwrap(this.tcx().coroutine_kind(this.tcx().coroutine_for_closure(did)) as CoroutineKindT | undefined);
          if (ck.$ === "Desugared" && ck._1 === "Closure") {
            const desugaring = ck._0;
            if ((r = this.write_str(`${display_CoroutineDesugaring(desugaring)}closure`)).$ === "Err") return r;
          } else {
            unreachable("coroutine from coroutine-closure should have CoroutineSource::Closure");
          }
          if ((r = this.pretty_print_closure_inner(did, args)).$ === "Err") return r;
        } else {
          if ((r = this.print_def_path(did, args)).$ === "Err") return r;
          if ((r = this.write_str(" closure_kind_ty=")).$ === "Err") return r;
          if ((r = print_Ty(CoroutineClosureArgs_.kind_ty(args.as_coroutine_closure()), this)).$ === "Err") return r;
          if ((r = this.write_str(" signature_parts_ty=")).$ === "Err") return r;
          if ((r = print_Ty(CoroutineClosureArgs_.signature_parts_ty(args.as_coroutine_closure()), this)).$ === "Err") return r;
          if ((r = this.write_str(" upvar_tys=")).$ === "Err") return r;
          if ((r = print_Ty(CoroutineClosureArgs_.tupled_upvars_ty(args.as_coroutine_closure()), this)).$ === "Err") return r;
          if ((r = this.write_str(" coroutine_captures_by_ref_ty=")).$ === "Err") return r;
          if ((r = print_Ty(CoroutineClosureArgs_.coroutine_captures_by_ref_ty(args.as_coroutine_closure()), this)).$ === "Err") return r;
        }
        if ((r = this.write_str("}")).$ === "Err") return r;
        break;
      }
      case "Array": {
        const [ty, sz] = [kind._0, kind._1];
        if ((r = this.write_str("[")).$ === "Err") return r;
        if ((r = print_Ty(ty, this)).$ === "Err") return r;
        if ((r = this.write_str("; ")).$ === "Err") return r;
        if ((r = print_Const(sz, this)).$ === "Err") return r;
        if ((r = this.write_str("]")).$ === "Err") return r;
        break;
      }
      case "Slice": {
        const ty = kind._0;
        if ((r = this.write_str("[")).$ === "Err") return r;
        if ((r = print_Ty(ty, this)).$ === "Err") return r;
        if ((r = this.write_str("]")).$ === "Err") return r;
        break;
      }
    }

    return PRINT_OK;
  }

  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:1033 pretty_print_opaque_impl_type
  pretty_print_opaque_impl_type(def_id: DefId, args: GenericArgs): PrintResult {
    let r: PrintResult;
    const tcx = this.tcx();

    // Grab the "TraitA + TraitB" from `impl TraitA + TraitB`,
    // by looking up the projections associated with the def_id.
    // PORT: the `explicit_item_bounds` query value is `unknown` in queries.gen.ts.
    const bounds = tcx.explicit_item_bounds(def_id) as EarlyBinder<readonly [Clause, Span][]>;

    // PORT: `FxIndexMap`s keyed by structural values: `KeyedMap`s on the intern key (insertion-ordered).
    const traits: TraitsMap = new KeyedMap<PolyTraitClause, KeyedMap<DefId, Binder<Term>>>(intern_key);
    const fn_traits: FnTraitsMap = new KeyedMap<FnTraitsKey, OpaqueFnEntry>(intern_key);
    const lifetimes: Region[] = [];

    let has_sized_bound = false;
    let has_negative_sized_bound = false;
    let has_meta_sized_bound = false;

    for (const [predicate, _] of iter_map(EarlyBinder.iter_instantiated_copied(bounds, tcx, args, fold_Clause_Span_), Unnormalized.skip_norm_wip)) {
      const bound_predicate = predicate.kind();

      const sb = Binder.skip_binder(bound_predicate);
      switch (sb.$) {
        case "Trait": {
          const pred = sb._0;
          // With `feature(sized_hierarchy)`, don't print `?Sized` as an alias for
          // `MetaSized`, and skip sizedness bounds to be added at the end.
          const lang_item = tcx.as_lang_item(TraitClause.def_id(pred));
          if (lang_item === LangItem.Sized) {
            switch (pred.polarity) {
              case "Positive": {
                has_sized_bound = true;
                continue;
              }
              case "Negative":
                has_negative_sized_bound = true;
                break;
            }
          } else if (lang_item === LangItem.MetaSized) {
            has_meta_sized_bound = true;
            continue;
          } else if (lang_item === LangItem.PointeeSized) {
            bug("`PointeeSized` is removed during lowering");
          } else {
          }

          this.insert_trait_and_projection(Binder.rebind(bound_predicate, pred), undefined, traits, fn_traits);
          break;
        }
        case "Projection": {
          const pred = sb._0;
          const proj = Binder.rebind(bound_predicate, pred);
          const trait_ref = Binder.map_bound(proj, (proj): TraitClause => ({
            // PORT: `TyCtxt` lacks 14 `Interner` methods until lane ty-ctxt lands (docs/handoff/ty-contract.md).
            trait_ref: AliasTerm.trait_ref(proj.projection_term, tcx as unknown as Interner),
            polarity: "Positive",
          }));

          this.insert_trait_and_projection(trait_ref, [PolyProjectionClause.item_def_id(proj), PolyProjectionClause.term(proj)], traits, fn_traits);
          break;
        }
        case "TypeOutlives": {
          const outlives = sb._0;
          lifetimes.push(outlives._1);
          break;
        }
        default: {
        }
      }
    }

    if ((r = this.write_str("impl ")).$ === "Err") return r;

    let first = true;
    // Insert parenthesis around (Fn(A, B) -> C) if the opaque ty has more than one other trait
    const paren_needed = fn_traits.size > 1 || traits.size > 0 || !has_sized_bound;

    for (const [[bound_args_and_self_ty, is_async], entry] of fn_traits) {
      if ((r = this.write_str(first ? "" : " + ")).$ === "Err") return r;
      if ((r = this.write_str(paren_needed ? "(" : "")).$ === "Err") return r;

      const trait_def_id = is_async
        ? unwrap(tcx.async_fn_trait_kind_to_def_id(entry.kind), "expected AsyncFn lang items")
        : unwrap(tcx.fn_trait_kind_to_def_id(entry.kind), "expected Fn lang items");

      const return_ty = entry.return_ty;
      if (return_ty !== undefined) {
        if (
          (r = this.wrap_binder(
            bound_args_and_self_ty,
            "ForAll",
            ([args, _], p) => {
              let r: PrintResult;
              if ((r = p.write_str(display_Symbol(tcx.item_name(trait_def_id)))).$ === "Err") return r;
              if ((r = p.write_str("(")).$ === "Err") return r;

              for (const [idx, ty] of args.entries()) {
                if (idx > 0) {
                  if ((r = p.write_str(", ")).$ === "Err") return r;
                }
                if ((r = print_Ty(ty, p)).$ === "Err") return r;
              }

              if ((r = p.write_str(")")).$ === "Err") return r;
              const ty = Term.as_type(Binder.skip_binder(return_ty));
              if (ty !== undefined) {
                if (!ty.is_unit()) {
                  if ((r = p.write_str(" -> ")).$ === "Err") return r;
                  if ((r = print_Binder(return_ty, p, print_Term, fold_Term_)).$ === "Err") return r;
                }
              }
              if ((r = p.write_str(paren_needed ? ")" : "")).$ === "Err") return r;

              first = false;
              return PRINT_OK;
            },
            fold_ListTy_Ty_,
          )).$ === "Err"
        )
          return r;
      } else {
        // Otherwise, render this like a regular trait.
        traits.set(
          Binder.map_bound(bound_args_and_self_ty, ([args, self_ty]): TraitClause => ({
            polarity: "Positive",
            trait_ref: TraitRef.new(as_interner(tcx), trait_def_id, [self_ty, Ty.new_tup(tcx, args)]),
          })),
          new KeyedMap(DefId_key_),
        );
      }
    }

    // Print the rest of the trait types (that aren't Fn* family of traits)
    for (const [trait_pred, assoc_items] of traits) {
      if ((r = this.write_str(first ? "" : " + ")).$ === "Err") return r;

      if (
        (r = this.wrap_binder(
          trait_pred,
          "ForAll",
          (trait_pred, p) => {
            let r: PrintResult;
            if (trait_pred.polarity === "Negative") {
              if ((r = p.write_str("!")).$ === "Err") return r;
            }
            if ((r = print_TraitRefPrintOnlyTraitName(TraitRef_print_only_trait_name(trait_pred.trait_ref), p)).$ === "Err") return r;

            const generics = tcx.generics_of(TraitClause.def_id(trait_pred)) as Generics;
            const own_args = generics.own_args_no_defaults(tcx, trait_pred.trait_ref.args);

            if (own_args.length !== 0 || assoc_items.size !== 0) {
              let first = true;

              for (const ty of own_args) {
                if (first) {
                  if ((r = p.write_str("<")).$ === "Err") return r;
                  first = false;
                } else {
                  if ((r = p.write_str(", ")).$ === "Err") return r;
                }
                if ((r = print_GenericArg(ty, p)).$ === "Err") return r;
              }

              for (const [assoc_item_def_id, term] of assoc_items) {
                if (first) {
                  if ((r = p.write_str("<")).$ === "Err") return r;
                  first = false;
                } else {
                  if ((r = p.write_str(", ")).$ === "Err") return r;
                }

                // PORT: the `associated_item` query value is `unknown` in queries.gen.ts.
                if ((r = p.write_str(`${display_Symbol(middle_assoc().AssocItem.name(tcx.associated_item(assoc_item_def_id) as AssocItem))} = `)).$ === "Err") return r;

                const tk = Term.kind(Binder.skip_binder(term));
                switch (tk.$) {
                  case "Ty":
                    if ((r = print_Ty(tk._0, p)).$ === "Err") return r;
                    break;
                  case "Const":
                    if ((r = print_Const(tk._0, p)).$ === "Err") return r;
                    break;
                }
              }

              if (!first) {
                if ((r = p.write_str(">")).$ === "Err") return r;
              }
            }

            first = false;
            return PRINT_OK;
          },
          fold_TraitClause_,
        )).$ === "Err"
      )
        return r;
    }

    const using_sized_hierarchy = this.tcx().features().sized_hierarchy();
    const add_sized = has_sized_bound && (first || has_negative_sized_bound);
    const add_maybe_sized = has_meta_sized_bound && !has_negative_sized_bound && !using_sized_hierarchy;
    // Set `has_pointee_sized_bound` if there were no `Sized` or `MetaSized` bounds.
    const has_pointee_sized_bound = !has_sized_bound && !has_meta_sized_bound && !has_negative_sized_bound;
    if (add_sized || add_maybe_sized) {
      if (!first) {
        if ((r = this.write_str(" + ")).$ === "Err") return r;
      }
      if (add_maybe_sized) {
        if ((r = this.write_str("?")).$ === "Err") return r;
      }
      if ((r = this.write_str("Sized")).$ === "Err") return r;
    } else if (has_meta_sized_bound && using_sized_hierarchy) {
      if (!first) {
        if ((r = this.write_str(" + ")).$ === "Err") return r;
      }
      if ((r = this.write_str("MetaSized")).$ === "Err") return r;
    } else if (has_pointee_sized_bound && using_sized_hierarchy) {
      if (!first) {
        if ((r = this.write_str(" + ")).$ === "Err") return r;
      }
      if ((r = this.write_str("PointeeSized")).$ === "Err") return r;
    }

    if (!with_forced_trimmed_paths()) {
      for (const re of lifetimes) {
        if ((r = this.write_str(" + ")).$ === "Err") return r;
        if ((r = this.print_region(re)).$ === "Err") return r;
      }
    }

    return PRINT_OK;
  }

  /// Insert the trait ref and optionally a projection type associated with it into either the
  /// traits map or fn_traits map, depending on if the trait is in the Fn* family of traits.
  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:1258 insert_trait_and_projection
  insert_trait_and_projection(trait_pred: PolyTraitClause, proj_ty: [DefId, Binder<Term>] | undefined, traits: TraitsMap, fn_traits: FnTraitsMap): void {
    const tcx = this.tcx();
    const trait_def_id = TraitClause.def_id(Binder.skip_binder(trait_pred));

    let fn_trait_and_async: [ClosureKind, boolean] | undefined;
    let kind_: ClosureKind | undefined;
    if ((kind_ = tcx.fn_trait_kind_from_def_id(trait_def_id)) !== undefined) {
      fn_trait_and_async = [kind_, false];
    } else if ((kind_ = tcx.async_fn_trait_kind_from_def_id(trait_def_id)) !== undefined) {
      fn_trait_and_async = [kind_, true];
    } else {
      fn_trait_and_async = undefined;
    }

    let arg1_kind;
    if (
      Binder.skip_binder(trait_pred).polarity === "Positive" &&
      fn_trait_and_async !== undefined &&
      (arg1_kind = Binder.skip_binder(trait_pred).trait_ref.args.type_at(1).kind()).$ === "Tuple"
    ) {
      const [kind, is_async] = fn_trait_and_async;
      const types = arg1_kind._0;
      const key: FnTraitsKey = [Binder.rebind(trait_pred, [types, TraitRef.self_ty(Binder.skip_binder(trait_pred).trait_ref)]), is_async];
      let entry = fn_traits.get(key);
      if (entry === undefined) {
        entry = { kind, return_ty: undefined };
        fn_traits.set(key, entry);
      }
      if (ClosureKind.extends(kind, entry.kind)) {
        entry.kind = kind;
      }
      if (proj_ty !== undefined && tcx.item_name(proj_ty[0]) === sym.Output) {
        const [_proj_def_id, proj_ty_] = proj_ty;
        entry.return_ty = proj_ty_;
      }
      return;
    }

    // Otherwise, just group our traits and projection types.
    let m = traits.get(trait_pred);
    if (m === undefined) {
      m = new KeyedMap(DefId_key_);
      traits.set(trait_pred, m);
    }
    if (proj_ty !== undefined) m.set(proj_ty[0], proj_ty[1]);
  }

  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:1304 pretty_print_inherent_projection
  pretty_print_inherent_projection(alias_term: Alias<AliasTermKind>): PrintResult {
    const alias_def_id = AliasTerm.expect_inherent_def_id(alias_term);
    const def_key = this.tcx().def_key(alias_def_id);
    return this.print_path_with_generic_args(
      (p) => p.print_path_with_simple((p) => p.print_path_with_qualified(AliasTerm.self_ty(alias_term), undefined), def_key.disambiguated_data),
      alias_term.args.slice(1),
    );
  }

  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:1321 pretty_print_rpitit
  pretty_print_rpitit(def_id: DefId, args: GenericArgs): PrintResult {
    let r: PrintResult;
    // PORT: the `let` chain as nested `if`s; `fn_args` stays `None` unless every condition holds.
    let fn_args: [DefId, readonly GenericArg[]] | undefined = undefined;
    if (this.tcx().features().return_type_notation()) {
      // PORT: the `fn_sig` query value is `unknown`.
      const rpitit_info = this.tcx().opt_rpitit_info(def_id);
      if (rpitit_info !== undefined && rpitit_info.$ === "Trait") {
        const fn_def_id = rpitit_info.fn_def_id;
        const output_kind = Binder.skip_binder(PolyFnSig_.output(EarlyBinder.skip_binder(this.tcx().fn_sig(fn_def_id) as EarlyBinder<PolyFnSig>))).kind();
        if (output_kind.$ === "Alias") {
          const alias_ty = output_kind._1;
          const projection_ty = AliasTy_.try_to_projection(alias_ty);
          if (projection_ty !== undefined && DefId_eq(projection_ty.kind, def_id)) {
            const generics = this.tcx().generics_of(fn_def_id) as Generics;
            // FIXME(return_type_notation): We only support lifetime params for now.
            if (generics.own_params.every((param) => param.kind.$ === "Lifetime")) {
              const num_args = generics.count();
              fn_args = [fn_def_id, args.slice(0, num_args)];
            }
          }
        }
      }
    }

    const mode = RTN_MODE.get();
    if (fn_args !== undefined && mode === "ForDiagnostic") {
      const [fn_def_id, fn_args_] = fn_args;
      if ((r = this.pretty_print_opaque_impl_type(def_id, args)).$ === "Err") return r;
      if ((r = this.write_str(" { ")).$ === "Err") return r;
      if ((r = this.print_def_path(fn_def_id, fn_args_)).$ === "Err") return r;
      if ((r = this.write_str("(..) }")).$ === "Err") return r;
    } else if (fn_args !== undefined && mode === "ForSuggestion") {
      const [fn_def_id, fn_args_] = fn_args;
      if ((r = this.print_def_path(fn_def_id, fn_args_)).$ === "Err") return r;
      if ((r = this.write_str("(..)")).$ === "Err") return r;
    } else {
      if ((r = this.pretty_print_opaque_impl_type(def_id, args)).$ === "Err") return r;
    }

    return PRINT_OK;
  }

  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:1365 ty_infer_name
  ty_infer_name(_: TyVid): Symbol | undefined {
    return undefined;
  }

  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:1369 const_infer_name
  const_infer_name(_: ConstVid): Symbol | undefined {
    return undefined;
  }

  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:1373 pretty_print_dyn_existential
  pretty_print_dyn_existential(predicates: List<PolyExistentialPredicate>): PrintResult {
    let r: PrintResult;
    // Generate the main trait ref, including associated types.
    let first = true;

    const bound_principal = predicates.principal();
    if (bound_principal !== undefined) {
      if (
        (r = this.wrap_binder(
          bound_principal,
          "ForAll",
          (principal, p) => {
            let r: PrintResult;
            if ((r = p.print_def_path(principal.def_id, [])).$ === "Err") return r;

            let resugared = false;

            // Special-case `Fn(...) -> ...` and re-sugar it.
            const fn_trait_kind = p.tcx().fn_trait_kind_from_def_id(principal.def_id);
            if (!p.should_print_verbose() && fn_trait_kind !== undefined) {
              const k = principal.args.type_at(0).kind();
              if (k.$ === "Tuple") {
                const tys = k._0;
                const projections = predicates.projection_bounds()[globalThis.Symbol.iterator]();
                const n1 = projections.next();
                const n2 = projections.next();
                if (!n1.done && n2.done) {
                  const proj = n1.value;
                  if (
                    (r = p.pretty_print_fn_sig(
                      tys,
                      false,
                      // FIXME(splat): support splatted arguments here?
                      undefined,
                      unwrap(Term.as_type(Binder.skip_binder(proj).term), "Return type was a const"),
                    )).$ === "Err"
                  )
                    return r;
                  resugared = true;
                }
              }
            }

            // HACK(eddyb) this duplicates `FmtPrinter`'s `print_path_with_generic_args`,
            // in order to place the projections inside the `<...>`.
            if (!resugared) {
              const principal_with_self = ExistentialTraitRef.with_self_ty(principal, as_interner(p.tcx()), p.tcx().types.trait_object_dummy_self);

              const args = (p.tcx().generics_of(principal_with_self.def_id) as Generics).own_args_no_defaults(p.tcx(), principal_with_self.args);

              const bound_principal_with_self = PolyExistentialTraitRef.with_self_ty(bound_principal, as_interner(p.tcx()), p.tcx().types.trait_object_dummy_self);

              const clause: Clause = Clause_upcast_from_PolyTraitRef(bound_principal_with_self, p.tcx());
              const super_projections: Binder<ProjectionClause>[] = [];
              for (const clause_ of elaborate(p.tcx(), [clause], Elaboratable_Clause).filter_only_self()) {
                const pc = clause_.as_projection_clause();
                if (pc !== undefined) super_projections.push(pc);
              }

              const projections: ExistentialProjection[] = [];
              for (const proj of predicates.projection_bounds()) {
                // Filter out projections that are implied by the super predicates.
                const proj_is_implied = super_projections.some((super_proj_) => {
                  let super_proj = Binder.map_bound(super_proj_, (super_proj) => ExistentialProjection.erase_self_ty(as_interner(p.tcx()), super_proj));

                  // This function is sometimes called on types with erased and
                  // anonymized regions, but the super projections can still
                  // contain named regions. So we erase and anonymize everything
                  // here to compare the types modulo regions below.
                  const proj_ = p.tcx().erase_and_anonymize_regions(proj, fold_PolyExistentialProjection_);
                  super_proj = p.tcx().erase_and_anonymize_regions(super_proj, fold_PolyExistentialProjection_);

                  return intern_key(proj_) === intern_key(super_proj);
                });
                if (!proj_is_implied) {
                  // Skip the binder, because we don't want to print the binder in
                  // front of the associated item.
                  projections.push(Binder.skip_binder(proj));
                }
              }

              sort_by_cached_key(projections, (proj) => Symbol.as_str(p.tcx().item_name(proj.def_id)));

              if (args.length !== 0 || projections.length !== 0) {
                if (
                  (r = p.generic_delimiters((p) => {
                    let r: PrintResult;
                    if ((r = p.comma_sep(args, print_GenericArg)).$ === "Err") return r;
                    if (args.length !== 0 && projections.length !== 0) {
                      if ((r = p.write_str(", ")).$ === "Err") return r;
                    }
                    return p.comma_sep(projections, print_ExistentialProjection);
                  })).$ === "Err"
                )
                  return r;
              }
            }
            return PRINT_OK;
          },
          fold_ExistentialTraitRef_,
        )).$ === "Err"
      )
        return r;

      first = false;
    }

    // Builtin bounds.
    // FIXME(eddyb) avoid printing twice (needed to ensure
    // that the auto traits are sorted *and* printed via p).
    const auto_traits: DefId[] = [...predicates.auto_traits()];

    // The auto traits come ordered by `DefPathHash`. While
    // `DefPathHash` is *stable* in the sense that it depends on
    // neither the host nor the phase of the moon, it depends
    // "pseudorandomly" on the compiler version and the target.
    //
    // To avoid causing instabilities in compiletest
    // output, sort the auto-traits alphabetically.
    sort_by_cached_key(auto_traits, (did) => with_no_trimmed_paths(() => this.tcx().def_path_str(did)));

    for (const def_id of auto_traits) {
      if (!first) {
        if ((r = this.write_str(" + ")).$ === "Err") return r;
      }
      first = false;

      if ((r = this.print_def_path(def_id, [])).$ === "Err") return r;
    }

    return PRINT_OK;
  }

  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:1496 pretty_print_fn_sig
  pretty_print_fn_sig(inputs: readonly Ty[], c_variadic: boolean, splatted: number | undefined, output: Ty): PrintResult {
    let r: PrintResult;
    if ((r = this.write_str("(")).$ === "Err") return r;
    const splatted_arg_index = splatted;
    // PORT: `input_iter` is a by-ref iterator: `take(index)` then the rest is the two slices.
    if (splatted_arg_index !== undefined) {
      const index = splatted_arg_index;
      if ((r = this.comma_sep(inputs.slice(0, index), print_Ty)).$ === "Err") return r;
      if ((r = this.write_str(", #[rustc_splat]")).$ === "Err") return r;
      if ((r = this.comma_sep(inputs.slice(index), print_Ty)).$ === "Err") return r;
    } else {
      if ((r = this.comma_sep(inputs, print_Ty)).$ === "Err") return r;
    }
    if (c_variadic) {
      if (inputs.length !== 0) {
        if ((r = this.write_str(", ")).$ === "Err") return r;
      }
      if ((r = this.write_str("...")).$ === "Err") return r;
    }
    if ((r = this.write_str(")")).$ === "Err") return r;
    if (!output.is_unit()) {
      if ((r = this.write_str(" -> ")).$ === "Err") return r;
      if ((r = print_Ty(output, this)).$ === "Err") return r;
    }

    return PRINT_OK;
  }

  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:1528 pretty_print_const
  pretty_print_const(ct: Const, print_ty: boolean): PrintResult {
    let r: PrintResult;
    if (this.should_print_verbose()) {
      if ((r = this.write_str(debug_Const(ct, PLAIN))).$ === "Err") return r;
      return PRINT_OK;
    }

    const kind = ct.kind();
    switch (kind.$) {
      case "Alias": {
        const { kind: k, args } = kind._1 as AliasConst;
        switch (k.$) {
          case "Projection":
          case "InherentSelf":
          case "InherentImpl":
          case "Free": {
            const def_id = k.def_id;
            if ((r = this.pretty_print_value_path(def_id, args)).$ === "Err") return r;
            break;
          }
          case "Anon": {
            const def_id = k.def_id;
            let span: Span;
            let snip: Result<Str, unknown>;
            if (
              def_id.is_local() &&
              ((span = this.tcx().def_span(def_id)), true) &&
              (snip = this.tcx().sess.source_map().span_to_snippet(span)).$ === "Ok"
            ) {
              if ((r = this.write_str(snip._0.toString())).$ === "Err") return r;
            } else {
              // Do not call `pretty_print_value_path` as if a parent of this anon
              // const is an impl it will attempt to print out the impl trait ref
              // i.e. `<T as Trait>::{constant#0}`. This would cause printing to
              // enter an infinite recursion if the anon const is in the self type
              // i.e. `impl<T: Default> Default for [T; 32 - 1 - 1 - 1] {` where we
              // would try to print `<[T; /* print constant#0 again */] as //
              // Default>::{constant#0}`.
              if (
                (r = this.write_str(`${display_Symbol(this.tcx().crate_name(def_id.krate))}::${this.tcx().def_path(def_id).to_string_no_crate_verbose()}`)).$ ===
                "Err"
              )
                return r;
            }
            break;
          }
        }
        break;
      }
      case "Infer": {
        const infer_ct = kind._0;
        let name: Symbol | undefined;
        if (infer_ct.$ === "Var" && (name = this.const_infer_name(infer_ct._0)) !== undefined) {
          if ((r = this.write_str(display_Symbol(name))).$ === "Err") return r;
        } else {
          if ((r = this.write_str("_")).$ === "Err") return r;
        }
        break;
      }
      case "Param": {
        const { name } = kind._0;
        if ((r = this.write_str(display_Symbol(name))).$ === "Err") return r;
        break;
      }
      case "Value": {
        const cv = kind._0;
        return this.pretty_print_const_valtree(cv, print_ty);
      }

      case "Bound": {
        const [debruijn, bound_var] = [kind._0, kind._1];
        if ((r = this.write_str(debug_bound_var(debruijn, bound_var, debug_BoundConst))).$ === "Err") return r;
        break;
      }
      case "Placeholder": {
        const placeholder = kind._0;
        if ((r = this.write_str(debug_Placeholder(placeholder, PLAIN, debug_BoundConst))).$ === "Err") return r;
        break;
      }
      // FIXME(generic_const_exprs):
      // write out some legible representation of an abstract const?
      case "Expr": {
        const expr = kind._0;
        if ((r = this.pretty_print_const_expr(expr, print_ty)).$ === "Err") return r;
        break;
      }
      case "Error":
        if ((r = this.write_str("{const error}")).$ === "Err") return r;
        break;
    }
    return PRINT_OK;
  }

  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:1594 pretty_print_const_expr
  pretty_print_const_expr(expr: Expr, print_ty: boolean): PrintResult {
    let r: PrintResult;
    const ek = expr.kind;
    switch (ek.$) {
      case "Binop": {
        const op = ek._0;
        const [_a, _b, c1, c2] = Expr_binop_args(expr);

        // PORT: `ExprPrecedence` compares by its discriminant (derived `PartialOrd`).
        const precedence = (binop: BinOp): number => ExprPrecedence_discriminant[BinOpKind.precedence(BinOp_to_hir_binop(binop))];
        const op_precedence = precedence(op);
        const formatted_op = BinOpKind.as_str(BinOp_to_hir_binop(op));
        const [k1, k2] = [c1.kind(), c2.kind()];
        let lhs_parenthesized: boolean;
        let rhs_parenthesized: boolean;
        if (k1.$ === "Expr" && k1._0.kind.$ === "Binop" && k2.$ === "Expr" && k2._0.kind.$ === "Binop") {
          [lhs_parenthesized, rhs_parenthesized] = [precedence(k1._0.kind._0) < op_precedence, precedence(k2._0.kind._0) < op_precedence];
        } else if (k1.$ === "Expr" && k1._0.kind.$ === "Binop" && k2.$ === "Expr") {
          [lhs_parenthesized, rhs_parenthesized] = [precedence(k1._0.kind._0) < op_precedence, true];
        } else if (k1.$ === "Expr" && k2.$ === "Expr" && k2._0.kind.$ === "Binop") {
          [lhs_parenthesized, rhs_parenthesized] = [true, precedence(k2._0.kind._0) < op_precedence];
        } else if (k1.$ === "Expr" && k2.$ === "Expr") {
          [lhs_parenthesized, rhs_parenthesized] = [true, true];
        } else if (k1.$ === "Expr" && k1._0.kind.$ === "Binop") {
          [lhs_parenthesized, rhs_parenthesized] = [precedence(k1._0.kind._0) < op_precedence, false];
        } else if (k2.$ === "Expr" && k2._0.kind.$ === "Binop") {
          [lhs_parenthesized, rhs_parenthesized] = [false, precedence(k2._0.kind._0) < op_precedence];
        } else if (k1.$ === "Expr") {
          [lhs_parenthesized, rhs_parenthesized] = [true, false];
        } else if (k2.$ === "Expr") {
          [lhs_parenthesized, rhs_parenthesized] = [false, true];
        } else {
          [lhs_parenthesized, rhs_parenthesized] = [false, false];
        }

        if ((r = this.maybe_parenthesized((this_) => this_.pretty_print_const(c1, print_ty), lhs_parenthesized)).$ === "Err") return r;
        if ((r = this.write_str(` ${formatted_op} `)).$ === "Err") return r;
        if ((r = this.maybe_parenthesized((this_) => this_.pretty_print_const(c2, print_ty), rhs_parenthesized)).$ === "Err") return r;
        break;
      }
      case "UnOp": {
        const op = ek._0;
        const [_a, ct] = Expr_unop_args(expr);

        // use crate::mir::UnOp;
        let formatted_op: string;
        switch (op as unknown as UnOpT) {
          case "Not":
            formatted_op = "!";
            break;
          case "Neg":
            formatted_op = "-";
            break;
          case "PtrMetadata":
            formatted_op = "PtrMetadata";
            break;
        }
        const ck = ct.kind();
        let parenthesized: boolean;
        if ((op as unknown as UnOpT) === "PtrMetadata") {
          parenthesized = true;
        } else if (ck.$ === "Expr" && ck._0.kind.$ === "UnOp") {
          const c_op = ck._0.kind._0;
          parenthesized = (c_op as unknown as UnOpT) !== (op as unknown as UnOpT);
        } else if (ck.$ === "Expr") {
          parenthesized = true;
        } else {
          parenthesized = false;
        }
        if ((r = this.write_str(formatted_op)).$ === "Err") return r;
        if ((r = this.maybe_parenthesized((this_) => this_.pretty_print_const(ct, print_ty), parenthesized)).$ === "Err") return r;
        break;
      }
      case "FunctionCall": {
        const [_a, fn_def, fn_args] = Expr_call_args(expr);

        if ((r = this.write_str("(")).$ === "Err") return r;
        if ((r = this.pretty_print_const(fn_def, print_ty)).$ === "Err") return r;
        if ((r = this.write_str(")(")).$ === "Err") return r;
        if ((r = this.comma_sep(fn_args, print_Const)).$ === "Err") return r;
        if ((r = this.write_str(")")).$ === "Err") return r;
        break;
      }
      case "Cast": {
        const kind = ek._0 as unknown as CastKindT;
        const [_a, value, to_ty] = Expr_cast_args(expr);

        // use ty::abstract_const::CastKind;
        if (kind === "As" || (kind === "Use" && this.should_print_verbose())) {
          const vk = value.kind();
          let parenthesized: boolean;
          if (vk.$ === "Expr" && vk._0.kind.$ === "Cast") {
            parenthesized = false;
          } else if (vk.$ === "Expr") {
            parenthesized = true;
          } else {
            parenthesized = false;
          }
          if (
            (r = this.maybe_parenthesized(
              (this_) =>
                this_.typed_value(
                  (this_) => this_.pretty_print_const(value, print_ty),
                  (this_) => this_.pretty_print_type(to_ty),
                  " as ",
                ),
              parenthesized,
            )).$ === "Err"
          )
            return r;
        } else {
          if ((r = this.pretty_print_const(value, print_ty)).$ === "Err") return r;
        }
        break;
      }
    }
    return PRINT_OK;
  }
}

/** `FxIndexMap<ty::PolyTraitClause, FxIndexMap<DefId, ty::Binder<Term>>>` (pretty_print_opaque_impl_type). */
type TraitsMap = KeyedMap<PolyTraitClause, KeyedMap<DefId, Binder<Term>>>;
/** The key of `fn_traits`: `(ty::Binder<(&List<Ty>, Ty)>, bool)`. */
type FnTraitsKey = [Binder<[List<Ty>, Ty]>, boolean];
/** `FxIndexMap<(ty::Binder<(&List<Ty>, Ty)>, bool), OpaqueFnEntry>`. */
type FnTraitsMap = KeyedMap<FnTraitsKey, OpaqueFnEntry>;

/** `DefId` as a `KeyedMap` key (D5). */
function DefId_key_(d: DefId): number {
  return DefId_key(d);
}

/** `slice::sort_by_cached_key` with `String` keys (stable; the keys are computed once per element, in order). */
function sort_by_cached_key<T>(v: T[], f: (x: T) => string): void {
  const keyed = v.map((x, i) => [f(x), i, x] as const);
  keyed.sort((a, b) => str_cmp(a[0], b[0]) || a[1] - b[1]);
  for (let i = 0; i < v.length; i++) v[i] = keyed[i]![2];
}

/** `Ord for str`: UTF-8 byte order, i.e. code point order (JS `<` compares UTF-16 code units). */
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

/** `Option<DefId> == Some(def_id)`. */
function opt_def_id_eq(a: DefId | undefined, b: DefId): boolean {
  return a !== undefined && DefId_eq(a, b);
}

// ---- PORT(stand-in): upstream fns and types of files not ported yet that this region calls. ----
// Each is replaced by a call to the real port when its file lands (docs/handoff/ty-print-a.md lists them). Bodies
// are upstream's where the upstream fn is a field read or a one-liner over ported API; otherwise `unported`.

/** The `CodegenFnAttrs` field read here (middle/codegen_fn_attrs.rs; the query value is `unknown`). */
interface CodegenFnAttrsView {
  safe_target_features: boolean;
}
/** `mir::UnOp` (mir/syntax.rs; `Pending` in ty/decls.ts): fieldless. */
type UnOpT = "Not" | "Neg" | "PtrMetadata";
/** `ty::abstract_const::CastKind` (ty/abstract_const.rs; `Pending` in ty/decls.ts): fieldless. */
type CastKindT = "As" | "Use";

/** A D4 descriptor from the impl fns of a type (`fold_<T>`, fold.ts header). */
function descriptor<T>(
  visit_with: <R>(self: T, visitor: TypeVisitor<R>) => R,
  try_fold_with: <E>(self: T, folder: FallibleTypeFolder<E>) => Result<T, E>,
  fold_with: (self: T, folder: TypeFolder) => T,
): TypeFoldable<T> {
  return { visit_with, try_fold_with, fold_with };
}
// merge-w15a: `Ty`'s descriptor is fold.ts's `standin_fold_Ty` (the one-line impls are upstream's; the super impls are
// structural_impls.rs's, not ported); `Binder<T>`'s is binder.ts's `fold_Binder`.
const fold_Ty_: TypeFoldable<Ty> = standin_fold_Ty;
const fold_Clause_: TypeFoldable<Clause> = descriptor<Clause>(visit_with_Clause, try_fold_with_Clause, fold_with_Clause);
/** `(Clause, Span): TypeFoldable` (fold.rs's tuple impl; `Span` is trivially traversable). */
const fold_Clause_Span_: TypeFoldable<[Clause, Span]> = fold_tuple2(
  fold_Clause_,
  descriptor<Span>(visit_with_trivial, try_fold_with_trivial, fold_with_trivial),
);
/** `iter.map(f)` over a lazy iterator. */
function* iter_map<T, U>(it: Iterable<T>, f: (t: T) => U): Generator<U> {
  for (const t of it) yield f(t);
}
const fold_Term_: TypeFoldable<Term> = descriptor<Term>(visit_with_Term, try_fold_with_Term, fold_with_Term);
const fold_FnSig_: TypeFoldable<FnSig> = descriptor<FnSig>(visit_with_FnSig, try_fold_with_FnSig, fold_with_FnSig);
const fold_TraitClause_: TypeFoldable<TraitClause> = descriptor<TraitClause>(visit_with_TraitClause, try_fold_with_TraitClause, fold_with_TraitClause);
const fold_ExistentialTraitRef_: TypeFoldable<ExistentialTraitRef> = descriptor<ExistentialTraitRef>(
  visit_with_ExistentialTraitRef,
  try_fold_with_ExistentialTraitRef,
  fold_with_ExistentialTraitRef,
);
const fold_PolyExistentialProjection_: TypeFoldable<Binder<ExistentialProjection>> = fold_Binder(
  descriptor<ExistentialProjection>(visit_with_ExistentialProjection, try_fold_with_ExistentialProjection, fold_with_ExistentialProjection),
);
/** `(&'tcx List<Ty>, Ty): TypeFoldable` (the tuple impls of fold.rs / visit.rs). */
const fold_ListTy_Ty_: TypeFoldable<[List<Ty>, Ty]> = descriptor<[List<Ty>, Ty]>(
  (self, v) => visit_with_tuple2(self, v, visit_with_Tys, visit_with_Ty),
  (self, f) => try_fold_with_tuple2(self, f, try_fold_with_Tys, try_fold_with_Ty),
  (self, f) => fold_with_tuple2(self, f, fold_with_Tys, fold_with_Ty),
);

// -- rustc_middle ty/generics.rs, ty/assoc.rs, ty/adt.rs, ty/pattern.rs, ty/consts/kind.rs, mir --
/** `impl Debug for Pattern` (ty/pattern.rs). */
function debug_Pattern(_pat: Pattern): string {
  return unported("rustc_middle::ty::pattern `impl Debug for Pattern` (ty/pattern.rs)");
}
/** `Expr::binop_args` (ty/consts/kind.rs). */
function Expr_binop_args(_self: Expr): [Ty, Ty, Const, Const] {
  return unported("rustc_middle::ty::consts::kind::Expr::binop_args (ty/consts/kind.rs)");
}
/** `Expr::unop_args` (ty/consts/kind.rs). */
function Expr_unop_args(_self: Expr): [Ty, Const] {
  return unported("rustc_middle::ty::consts::kind::Expr::unop_args (ty/consts/kind.rs)");
}
/** `Expr::call_args` (ty/consts/kind.rs). */
function Expr_call_args(_self: Expr): [Ty, Const, Iterable<Const>] {
  return unported("rustc_middle::ty::consts::kind::Expr::call_args (ty/consts/kind.rs)");
}
/** `Expr::cast_args` (ty/consts/kind.rs). */
function Expr_cast_args(_self: Expr): [Ty, Const, Ty] {
  return unported("rustc_middle::ty::consts::kind::Expr::cast_args (ty/consts/kind.rs)");
}
/** `mir::BinOp::to_hir_binop` (mir/syntax.rs; `BinOp` is `Pending`). */
function BinOp_to_hir_binop(_self: BinOp): BinOpKind {
  return unported("rustc_middle::mir::BinOp::to_hir_binop (mir/mod.rs)");
}

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

    if (def.variants().length === 0) {
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
      const variant_def = def.variant(variant_idx);
      if ((r = this.pretty_print_value_path(variant_def.def_id, args)).$ === "Err") return r;
      const ctor_kind = variant_def.ctor_kind();
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
    if ((r = this.pretty_print_value_path(def_id, unwrap(Binder.no_bound_vars(args, fold_GenericArgs)))).$ === "Err") return r;
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
    const has_regions = this._0.region_highlight_mode.keep_regions && TypeVisitableExt.has_type_flags(ty, TypeFlags.HAS_REGIONS, standin_fold_Ty);
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
      utf8_len(Symbol.as_str(this._0.tcx.item_name(k._0.did()))) < 7
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
        for (const u of EarlyBinder.iter_instantiated_copied(bounds, this._0.tcx, k._1.args, fold_Clause_Span_)) {
          const [value, _] = Unnormalized.skip_norm_wip(u);
          if (TypeVisitableExt.has_bound_vars(value, fold_Clause_)) return true;
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
        if (BoundRegionKind.is_named(br, this._0.tcx)) {
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
        const name = BoundRegionKind.get_name(br, this._0.tcx);
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
      [new_value, map] = [Binder.skip_binder(value), new KeyedMap<BoundRegion, Region>(intern_key)];
    } else {
      const tcx = this._0.tcx;

      const trim_path = with_forced_trimmed_paths();
      // Closure used in `RegionFolder` to create names for anonymous late-bound
      // regions.
      const name = (br: BoundRegion): Region => {
        let name: Symbol;
        let kind: BoundRegionKind;
        const n = BoundRegionKind.get_name(br.kind, tcx);
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
      const new_value_ = d_T.fold_with(Binder.skip_binder(value), folder);
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
          standin_fold_Ty.super_visit_with(ty, this);
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
// PORT: `def_path_str` is declared in ty/decls.ts (merge-w15a removed the class-body placeholder of context.ts).

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
    this.current_index = DebruijnIndex.shifted_in(this.current_index, 1);
    const t_ = fold_Binder(d).super_fold_with(t, this);
    this.current_index = DebruijnIndex.shifted_out(this.current_index, 1);
    return t_;
  }

  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:2728 fold_ty
  fold_ty(t: Ty): Ty {
    if (TypeVisitableExt.has_vars_bound_at_or_above(t, this.current_index, standin_fold_Ty) || TypeVisitableExt.has_placeholders(t, standin_fold_Ty)) {
      return standin_fold_Ty.super_fold_with(t, this);
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
  return Binder.map_bound(self, (tr) => TraitRef_print_only_trait_path(tr));
}

// rustc: compiler/rustc_middle/src/ty/print/pretty.rs:3051 print_trait_sugared
export function PolyTraitRef_print_trait_sugared(self: PolyTraitRef): Binder<TraitRefPrintSugared> {
  return Binder.map_bound(self, (tr) => TraitRef_print_trait_sugared(tr));
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
  return Binder.map_bound(self, (_0): TraitClausePrintModifiersAndPath => ({ _0 }));
}

// rustc: compiler/rustc_middle/src/ty/print/pretty.rs:3092 print_with_bound_constness
export function PolyTraitClause_print_with_bound_constness(self: PolyTraitClause, constness: BoundConstness | undefined): Binder<TraitClausePrintWithBoundConstness> {
  return Binder.map_bound(self, (trait_pred): TraitClausePrintWithBoundConstness => ({ _0: trait_pred, _1: constness }));
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
  if ((r = p.write_str(`<${display_Ty(TraitRef.self_ty(self))} as ${display_TraitRefPrintOnlyTraitPath(TraitRef_print_only_trait_path(self))}>`)).$ === "Err") return r;
  return PRINT_OK;
}

// rustc: compiler/rustc_middle/src/ty/print/pretty.rs:3127 print
export function print_AliasTy(self: AliasTy, p: PrettyPrinter): PrintResult {
  let r: PrintResult;
  const alias_term: AliasTermT = AliasTermC.from_AliasTy(self);
  if ((r = print_AliasTerm(alias_term, p)).$ === "Err") return r;
  return PRINT_OK;
}

// rustc: compiler/rustc_middle/src/ty/print/pretty.rs:3127 print
export function print_AliasTerm(self: AliasTermT, p: PrettyPrinter): PrintResult {
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
  if ((r = print_Ty(TraitRef.self_ty(self.trait_ref), p)).$ === "Err") return r;
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
  if ((r = print_Ty(TraitRef.self_ty(self.trait_ref), p)).$ === "Err") return r;
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
  const trait_ref = ExistentialTraitRef.with_self_ty(self, as_interner(p.tcx()), p.tcx().types.trait_object_dummy_self);
  if ((r = print_TraitRefPrintOnlyTraitPath(TraitRef_print_only_trait_path(trait_ref), p)).$ === "Err") return r;
  return PRINT_OK;
}

// rustc: compiler/rustc_middle/src/ty/print/pretty.rs:3127 print
export function print_ExistentialProjection(self: ExistentialProjection, p: PrettyPrinter): PrintResult {
  let r: PrintResult;
  // PORT: the `associated_item` / `generics_of` query values are `unknown` in queries.gen.ts.
  const name = middle_assoc().AssocItem.name(p.tcx().associated_item(self.def_id) as AssocItem);
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
    (p.tcx().trait_def(self._0.def_id) as TraitDef).paren_sugar &&
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
  if ((r = print_Ty(TraitRef.self_ty(self._0.trait_ref), p)).$ === "Err") return r;
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


// ---- pending tyir-binder / tyir-misc (rustc_type_ir binder.rs, visit.rs, lib.rs) ----
/** PORT: pending tyir-binder: the derived `PartialEq` of `BoundRegionKind` (binder.rs). */
function BoundRegionKind_eq(a: BoundRegionKind, b: BoundRegionKind): boolean {
  if (a.$ !== b.$) return false;
  if (a.$ === "NamedForPrinting" && b.$ === "NamedForPrinting") return a._0 === b._0;
  if (a.$ === "Named" && b.$ === "Named") return DefId_eq(a._0, b._0);
  return true;
}

// ---- pending ty-results / ty-adt-assoc (rustc_middle ty/*) ----
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
function Value_destructure_adt_const(_cv: ValueShape): { variant: VariantIdx; fields: readonly Const[] } {
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
/** PORT: pending (ty/instance.rs, not ported; lane ty-print-a's mod.ts has the same module-local stand-in). */
function Instance_def_id(_self: Instance): DefId {
  return unported("rustc_middle::ty::instance::Instance::def_id (ty/instance.rs)");
}
function Instance_args(_instance: Instance): GenericArgs {
  return unported("rustc_middle::ty::instance::Instance::args (M4)");
}

/** PORT (merge-w15b): ty/assoc.ts is another extension module of `TyCtxt`: reached lazily. */
function middle_assoc(): typeof import("../assoc.ts") {
  return require("../assoc.ts") as typeof import("../assoc.ts");
}
