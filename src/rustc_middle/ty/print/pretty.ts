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
import { display_ExternAbi } from "../../../rustc_abi/extern_abi.ts";
import { BinOpKind } from "../../../rustc_ast/lib.ts";
import { ExprPrecedence_discriminant } from "../../../rustc_ast/util/parser.gen.ts";
import { FloatTy, IntTy, Mutability, UintTy } from "../../../rustc_ast_ir/lib.ts";
import { LangItem } from "../../../rustc_attr_ir/lang_items.ts";
import type { ExternCrate } from "../../../rustc_crate_store/cstore.gen.ts";
import { Res, type DefKind } from "../../../rustc_hir/def.ts";
import { CoroutineKind, display_CoroutineDesugaring, display_CoroutineKind, Safety, type CoroutineKind as CoroutineKindT } from "../../../rustc_hir/hir.ts";
import { type DefKey, type DefPathData, DisambiguatedDefPathData } from "../../../rustc_hir_id/definitions.ts";
import { debug_DefId, DefId, DefId_eq, DefId_key, LOCAL_CRATE, ModId } from "../../../rustc_span/def_id.ts";
import { RemapPathScopeComponents, Span } from "../../../rustc_span/lib.ts";
import { bug } from "../../../rustc_span/macros.ts";
import { display_Ident, display_Symbol, Ident, kw, sym, Symbol } from "../../../rustc_span/symbol.ts";
import { debug_BoundConst, debug_Placeholder, fold_with_Binder, try_fold_with_Binder, visit_with_Binder } from "../../../rustc_type_ir/binder.ts";
import type {
  AliasConst,
  AliasTy,
  Binder,
  BoundRegionKind,
  ConstVid,
  EarlyBinder,
  ExistentialProjection,
  ExistentialTraitRef,
  PlaceholderType,
  PolyExistentialPredicate,
  PolyFnSig,
  PolyTraitClause,
  ProjectionClause,
  RegionVid,
  TraitClause,
  TraitRef,
  TyVid,
  Unnormalized,
} from "../../../rustc_type_ir/decls.ts";
import { type FallibleTypeFolder, fold_with_tuple2, try_fold_with_tuple2, type TypeFoldable, type TypeFolder, visit_with_tuple2 } from "../../../rustc_type_ir/fold.ts";
import { type ClosureKind, debug_BoundVar, type FieldInfo } from "../../../rustc_type_ir/lib.ts";
import {
  fold_with_ExistentialProjection,
  fold_with_ExistentialTraitRef,
  fold_with_TraitClause,
  try_fold_with_ExistentialProjection,
  try_fold_with_ExistentialTraitRef,
  try_fold_with_TraitClause,
  visit_with_ExistentialProjection,
  visit_with_ExistentialTraitRef,
  visit_with_TraitClause,
} from "../../../rustc_type_ir/predicate.ts";
import { type Const, debug_Const, Region } from "../../../rustc_type_ir/sty/mod.ts";
import { AliasTerm, type AliasTermKind } from "../../../rustc_type_ir/term_kind.ts";
import type { Alias } from "../../../rustc_type_ir/ty/alias.ts";
import {
  AliasTy as AliasTy_,
  Binder_map_bound,
  Binder_skip_binder,
  debug_bound_var,
  debug_TyKind,
  display_InferTy,
  FnSig as FnSig_,
  type FnSig,
  FnSigKind,
  fold_with_FnSig,
  PolyFnSig as PolyFnSig_,
  PolyFnSigTys,
  try_fold_with_FnSig,
  type TypeAndMut,
  UnsafeBinderInner_deref,
  visit_with_FnSig,
} from "../../../rustc_type_ir/ty_kind.ts";
import { CoroutineArgs as CoroutineArgs_, CoroutineClosureArgs as CoroutineClosureArgs_, ClosureArgs as ClosureArgs_ } from "../../../rustc_type_ir/ty_kind/closure.ts";
import type { TypeVisitor } from "../../../rustc_type_ir/visit.ts";
import type { Interner } from "../../../rustc_type_ir/interner.ts";
import { intern_key } from "../../../rust_ts/intern_key.ts";
import { KeyedMap } from "../../../rust_ts/keyed.ts";
import { unported_methods } from "../../../rust_ts/stubs.ts";
import { type Debug, PLAIN } from "../../../std/fmt.ts";
import { assert, unported, unreachable, unwrap } from "../../../std/panic.ts";
import { Ok, type Result } from "../../../std/result.ts";
import type { Str } from "../../../std/str.ts";
import { TyCtxt } from "../context.ts";
import type { AssocItem, BinOp, Expr, ParamTy, Pattern, Value } from "../decls.ts";
import { fold_with_Tys, GenericArg, type GenericArgs, try_fold_with_Tys, visit_with_Tys } from "../generic_args.ts";
import type { Generics } from "../generics.ts";
import type { List } from "../list.ts";
import { fold_with_Term, fold_with_Ty, Term, try_fold_with_Term, try_fold_with_Ty, Ty, Visibility, visit_with_Term, visit_with_Ty } from "../mod.ts";
import type { Clause } from "../predicate.ts";
import { type Print, PRINT_OK, type PrintError, type PrintResult, print_Const, print_List_PolyExistentialPredicate, print_Region, print_Ty, Printer } from "./mod.ts";

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
    return print_T(Binder_skip_binder(value), this);
  }

  // rustc: compiler/rustc_middle/src/ty/print/pretty.rs:280 wrap_binder
  wrap_binder<T>(value: Binder<T>, _mode: WrapBinderMode, f: (value: T, p: this) => PrintResult, _d_T: TypeFoldable<T>): PrintResult {
    return f(Binder_skip_binder(value), this);
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
        const args = unwrap(Binder_no_bound_vars(kind._1));
        if (with_reduced_queries()) {
          if ((r = this.print_def_path(def_id, args)).$ === "Err") return r;
        } else {
          // PORT: the `fn_sig` / `codegen_fn_attrs` query values are `unknown` in queries.gen.ts.
          let sig = Unnormalized_skip_norm_wip(EarlyBinder_instantiate(this.tcx().fn_sig(def_id) as EarlyBinder<PolyFnSig>, this.tcx(), args));
          if ((this.tcx().codegen_fn_attrs(def_id) as CodegenFnAttrsView).safe_target_features) {
            if ((r = this.write_str("#[target_feature(..)] ")).$ === "Err") return r;
            sig = Binder_map_bound(sig, (sig_) => {
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
        const field_info = AdtDef_field_representing_type_info(def, this.tcx(), args);
        if (field_info !== undefined) {
          const { base, variant, name } = field_info;
          if (variant !== undefined) {
            if ((r = this.write_str(`field_of!(${display_Ty(base)}, ${display_Symbol(variant)}.${display_Symbol(name)})`)).$ === "Err") return r;
          } else {
            if ((r = this.write_str(`field_of!(${display_Ty(base)}, ${display_Symbol(name)})`)).$ === "Err") return r;
          }
        } else {
          if ((r = this.print_def_path(AdtDef_did(def), args)).$ === "Err") return r;
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
            const parent_ty_kind = Unnormalized_skip_norm_wip(EarlyBinder_instantiate_identity(this.tcx().type_of(parent) as EarlyBinder<Ty>)).kind();
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

    for (const [predicate, _] of EarlyBinder_iter_instantiated_copied(bounds, tcx, args).map(Unnormalized_skip_norm_wip)) {
      const bound_predicate = predicate.kind();

      const sb = Binder_skip_binder(bound_predicate);
      switch (sb.$) {
        case "Trait": {
          const pred = sb._0;
          // With `feature(sized_hierarchy)`, don't print `?Sized` as an alias for
          // `MetaSized`, and skip sizedness bounds to be added at the end.
          const lang_item = tcx.as_lang_item(TraitClause_def_id(pred));
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

          this.insert_trait_and_projection(Binder_rebind(bound_predicate, pred), undefined, traits, fn_traits);
          break;
        }
        case "Projection": {
          const pred = sb._0;
          const proj = Binder_rebind(bound_predicate, pred);
          const trait_ref = Binder_map_bound(proj, (proj): TraitClause => ({
            // PORT: `TyCtxt` lacks 14 `Interner` methods until lane ty-ctxt lands (docs/handoff/ty-contract.md).
            trait_ref: AliasTerm.trait_ref(proj.projection_term, tcx as unknown as Interner),
            polarity: "Positive",
          }));

          this.insert_trait_and_projection(trait_ref, [PolyProjectionClause_item_def_id(proj), PolyProjectionClause_term(proj)], traits, fn_traits);
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
              const ty = Term.as_type(Binder_skip_binder(return_ty));
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
          Binder_map_bound(bound_args_and_self_ty, ([args, self_ty]): TraitClause => ({
            polarity: "Positive",
            trait_ref: TraitRef_new(tcx, trait_def_id, [self_ty, Ty.new_tup(tcx, args)]),
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

            const generics = tcx.generics_of(TraitClause_def_id(trait_pred)) as Generics;
            const own_args = Generics_own_args_no_defaults(generics, tcx, trait_pred.trait_ref.args);

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
                if ((r = p.write_str(`${display_Symbol(AssocItem_name(tcx.associated_item(assoc_item_def_id) as AssocItem))} = `)).$ === "Err") return r;

                const tk = Term.kind(Binder_skip_binder(term));
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
    const trait_def_id = TraitClause_def_id(Binder_skip_binder(trait_pred));

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
      Binder_skip_binder(trait_pred).polarity === "Positive" &&
      fn_trait_and_async !== undefined &&
      (arg1_kind = Binder_skip_binder(trait_pred).trait_ref.args.type_at(1).kind()).$ === "Tuple"
    ) {
      const [kind, is_async] = fn_trait_and_async;
      const types = arg1_kind._0;
      const key: FnTraitsKey = [Binder_rebind(trait_pred, [types, TraitRef_self_ty(Binder_skip_binder(trait_pred).trait_ref)]), is_async];
      let entry = fn_traits.get(key);
      if (entry === undefined) {
        entry = { kind, return_ty: undefined };
        fn_traits.set(key, entry);
      }
      if (ClosureKind_extends(kind, entry.kind)) {
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
      // PORT: `ImplTraitInTraitData` is `Pending` in ty/decls.ts; the `fn_sig` query value is `unknown`.
      const rpitit_info = this.tcx().opt_rpitit_info(def_id) as unknown as ImplTraitInTraitDataView | undefined;
      if (rpitit_info !== undefined && rpitit_info.$ === "Trait") {
        const fn_def_id = rpitit_info.fn_def_id;
        const output_kind = Binder_skip_binder(PolyFnSig_.output(EarlyBinder_skip_binder(this.tcx().fn_sig(fn_def_id) as EarlyBinder<PolyFnSig>))).kind();
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
                      unwrap(Term.as_type(Binder_skip_binder(proj).term), "Return type was a const"),
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
              const principal_with_self = ExistentialTraitRef_with_self_ty(principal, p.tcx(), p.tcx().types.trait_object_dummy_self);

              const args = Generics_own_args_no_defaults(p.tcx().generics_of(principal_with_self.def_id) as Generics, p.tcx(), principal_with_self.args);

              const bound_principal_with_self = PolyExistentialTraitRef_with_self_ty(bound_principal, p.tcx(), p.tcx().types.trait_object_dummy_self);

              const clause: Clause = Upcast_PolyTraitRef_Clause(bound_principal_with_self, p.tcx());
              const super_projections: Binder<ProjectionClause>[] = [];
              for (const clause_ of Elaborator_filter_only_self(elaborate(p.tcx(), [clause]))) {
                const pc = clause_.as_projection_clause();
                if (pc !== undefined) super_projections.push(pc);
              }

              const projections: ExistentialProjection[] = [];
              for (const proj of predicates.projection_bounds()) {
                // Filter out projections that are implied by the super predicates.
                const proj_is_implied = super_projections.some((super_proj_) => {
                  let super_proj = Binder_map_bound(super_proj_, (super_proj) => ExistentialProjection_erase_self_ty(p.tcx(), super_proj));

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
                  projections.push(Binder_skip_binder(proj));
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
/** `ty::ImplTraitInTraitData` (ty/mod.rs; `Pending` in ty/decls.ts) in its PORTING §5 shape. */
type ImplTraitInTraitDataView = { readonly $: "Trait"; fn_def_id: DefId; opaque_def_id: DefId } | { readonly $: "Impl"; fn_def_id: DefId };
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
/** `Binder<T>: TypeFoldable` from `T`'s descriptor. */
function descriptor_Binder<T>(d: TypeFoldable<T>): TypeFoldable<Binder<T>> {
  return descriptor<Binder<T>>(
    (self, v) => visit_with_Binder(self, v, d.visit_with),
    (self, f) => try_fold_with_Binder(self, f, d.try_fold_with),
    (self, f) => fold_with_Binder(self, f, d.fold_with),
  );
}
const fold_Ty_: TypeFoldable<Ty> = descriptor<Ty>(visit_with_Ty, try_fold_with_Ty, fold_with_Ty);
const fold_Term_: TypeFoldable<Term> = descriptor<Term>(visit_with_Term, try_fold_with_Term, fold_with_Term);
const fold_FnSig_: TypeFoldable<FnSig> = descriptor<FnSig>(visit_with_FnSig, try_fold_with_FnSig, fold_with_FnSig);
const fold_TraitClause_: TypeFoldable<TraitClause> = descriptor<TraitClause>(visit_with_TraitClause, try_fold_with_TraitClause, fold_with_TraitClause);
const fold_ExistentialTraitRef_: TypeFoldable<ExistentialTraitRef> = descriptor<ExistentialTraitRef>(
  visit_with_ExistentialTraitRef,
  try_fold_with_ExistentialTraitRef,
  fold_with_ExistentialTraitRef,
);
const fold_PolyExistentialProjection_: TypeFoldable<Binder<ExistentialProjection>> = descriptor_Binder(
  descriptor<ExistentialProjection>(visit_with_ExistentialProjection, try_fold_with_ExistentialProjection, fold_with_ExistentialProjection),
);
/** `(&'tcx List<Ty>, Ty): TypeFoldable` (the tuple impls of fold.rs / visit.rs). */
const fold_ListTy_Ty_: TypeFoldable<[List<Ty>, Ty]> = descriptor<[List<Ty>, Ty]>(
  (self, v) => visit_with_tuple2(self, v, visit_with_Tys, visit_with_Ty),
  (self, f) => try_fold_with_tuple2(self, f, try_fold_with_Tys, try_fold_with_Ty),
  (self, f) => fold_with_tuple2(self, f, fold_with_Tys, fold_with_Ty),
);

// -- rustc_type_ir binder.rs (lane tyir-binder) --
/** `Binder::rebind`: `Binder { value, bound_vars: self.bound_vars }`. */
function Binder_rebind<T, U>(self: Binder<T>, value: U): Binder<U> {
  return { value, bound_vars: self.bound_vars };
}
/** `Binder::no_bound_vars` (binder.rs; needs `has_escaping_bound_vars`). */
function Binder_no_bound_vars<T>(_self: Binder<T>): T | undefined {
  return unported("rustc_type_ir::binder::Binder::no_bound_vars (binder.rs)");
}
/** `EarlyBinder::instantiate` (binder.rs). */
function EarlyBinder_instantiate<T>(_self: EarlyBinder<T>, _tcx: TyCtxt, _args: readonly GenericArg[]): Unnormalized<T> {
  return unported("rustc_type_ir::binder::EarlyBinder::instantiate (binder.rs)");
}
/** `EarlyBinder::instantiate_identity` (binder.rs). */
function EarlyBinder_instantiate_identity<T>(_self: EarlyBinder<T>): Unnormalized<T> {
  return unported("rustc_type_ir::binder::EarlyBinder::instantiate_identity (binder.rs)");
}
/** `EarlyBinder::skip_binder`: `self.value`. */
function EarlyBinder_skip_binder<T>(self: EarlyBinder<T>): T {
  return self.value;
}
/** `EarlyBinder<[(Clause, Span)]>::iter_instantiated_copied` (binder.rs). */
function EarlyBinder_iter_instantiated_copied<T>(_self: EarlyBinder<readonly T[]>, _tcx: TyCtxt, _args: readonly GenericArg[]): Unnormalized<T>[] {
  return unported("rustc_type_ir::binder::EarlyBinder::iter_instantiated_copied (binder.rs)");
}
// -- rustc_type_ir unnormalized.rs --
/** `Unnormalized::skip_norm_wip`: `self.value`. */
function Unnormalized_skip_norm_wip<T>(self: Unnormalized<T>): T {
  return self.value;
}
// -- rustc_type_ir lib.rs --
/** `ClosureKind::extends` (lib.rs; not ported). */
function ClosureKind_extends(_self: ClosureKind, _other: ClosureKind): boolean {
  return unported("rustc_type_ir::ClosureKind::extends (lib.rs)");
}
// -- rustc_type_ir predicate.rs --
/** `TraitRef::new` (predicate.rs). */
function TraitRef_new(_tcx: TyCtxt, _trait_def_id: DefId, _args: readonly GenericArg[]): TraitRef {
  return unported("rustc_type_ir::predicate::TraitRef::new (predicate.rs)");
}
/** `TraitRef::self_ty`: `self.args.type_at(0)`. */
function TraitRef_self_ty(self: TraitRef): Ty {
  return self.args.type_at(0);
}
/** `TraitClause::def_id`: `self.trait_ref.def_id`. */
function TraitClause_def_id(self: TraitClause): DefId {
  return self.trait_ref.def_id;
}
/** `Binder<ProjectionClause>::item_def_id` (predicate.rs). */
function PolyProjectionClause_item_def_id(_self: Binder<ProjectionClause>): DefId {
  return unported("rustc_type_ir::predicate::Binder<ProjectionClause>::item_def_id (predicate.rs)");
}
/** `Binder<ProjectionClause>::term`: `self.map_bound(|predicate| predicate.term)`. */
function PolyProjectionClause_term(self: Binder<ProjectionClause>): Binder<Term> {
  return Binder_map_bound(self, (predicate) => predicate.term);
}
/** `ExistentialTraitRef::with_self_ty` (predicate.rs). */
function ExistentialTraitRef_with_self_ty(_self: ExistentialTraitRef, _tcx: TyCtxt, _self_ty: Ty): TraitRef {
  return unported("rustc_type_ir::predicate::ExistentialTraitRef::with_self_ty (predicate.rs)");
}
/** `Binder<ExistentialTraitRef>::with_self_ty` (predicate.rs). */
function PolyExistentialTraitRef_with_self_ty(_self: Binder<ExistentialTraitRef>, _tcx: TyCtxt, _self_ty: Ty): Binder<TraitRef> {
  return unported("rustc_type_ir::predicate::Binder<ExistentialTraitRef>::with_self_ty (predicate.rs)");
}
/** `ExistentialProjection::erase_self_ty` (predicate.rs). */
function ExistentialProjection_erase_self_ty(_tcx: TyCtxt, _projection_predicate: ProjectionClause): ExistentialProjection {
  return unported("rustc_type_ir::predicate::ExistentialProjection::erase_self_ty (predicate.rs)");
}
// -- rustc_type_ir upcast / elaborate.rs --
/** `impl Upcast<TyCtxt, Clause> for Binder<TraitRef>` (rustc_middle ty/predicate.rs). */
function Upcast_PolyTraitRef_Clause(_self: Binder<TraitRef>, _tcx: TyCtxt): Clause {
  return unported("rustc_middle::ty::predicate `UpcastFrom<PolyTraitRef> for Clause` (ty/predicate.rs)");
}
/** `elaborate::elaborate(tcx, obligations)` (rustc_type_ir elaborate.rs). */
function elaborate(_tcx: TyCtxt, _obligations: readonly Clause[]): Iterable<Clause> {
  return unported("rustc_type_ir::elaborate::elaborate (elaborate.rs)");
}
/** `Elaborator::filter_only_self` (rustc_type_ir elaborate.rs). */
function Elaborator_filter_only_self(_self: Iterable<Clause>): Iterable<Clause> {
  return unported("rustc_type_ir::elaborate::Elaborator::filter_only_self (elaborate.rs)");
}
// -- rustc_middle ty/generics.rs, ty/assoc.rs, ty/adt.rs, ty/pattern.rs, ty/consts/kind.rs, mir --
/** `Generics::own_args_no_defaults` (ty/generics.rs). */
function Generics_own_args_no_defaults(_self: Generics, _tcx: TyCtxt, _args: readonly GenericArg[]): readonly GenericArg[] {
  return unported("rustc_middle::ty::generics::Generics::own_args_no_defaults (ty/generics.rs)");
}
/** `AssocItem::name` (ty/assoc.rs). */
function AssocItem_name(_self: AssocItem): Symbol {
  return unported("rustc_middle::ty::assoc::AssocItem::name (ty/assoc.rs)");
}
/** `AdtDef::did` (ty/adt.rs; `AdtDef` is `Pending`). */
function AdtDef_did(_self: unknown): DefId {
  return unported("rustc_middle::ty::adt::AdtDef::did (ty/adt.rs)");
}
/** `AdtDef::field_representing_type_info` (ty/adt.rs). */
function AdtDef_field_representing_type_info(_self: unknown, _tcx: TyCtxt, _args: GenericArgs): FieldInfo | undefined {
  return unported("rustc_middle::ty::adt::AdtDef::field_representing_type_info (ty/adt.rs)");
}
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

// -- lane ty-print-b's items (pretty.rs:1705..end) this region calls: DELETE AT MERGE, ty-print-b ports them. --
declare module "./pretty.ts" {
  interface PrettyPrinter {
    // pretty.rs:1872
    pretty_print_const_valtree(cv: Value, print_ty: boolean): PrintResult;
    // pretty.rs:2052
    should_print_verbose(): boolean;
  }
}
unported_methods(PrettyPrinter.prototype, "rustc_middle::ty::print::pretty::PrettyPrinter", ["pretty_print_const_valtree"]);
// pretty.rs:2052 should_print_verbose (upstream body)
PrettyPrinter.prototype.should_print_verbose = function (this: PrettyPrinter): boolean {
  return this.tcx().sess.verbose_internals();
};
/** pretty.rs:3598 `pub struct OpaqueFnEntry<'tcx>` (fields as upstream). */
interface OpaqueFnEntry {
  kind: ClosureKind;
  return_ty: Binder<Term> | undefined;
}
/** `forward_display_to_print!` `impl Display for Ty` (pretty.rs:3142). */
function display_Ty(_ty: Ty): string {
  return unported("rustc_middle::ty::print::pretty `impl Display for Ty` (forward_display_to_print!, lane ty-print-b)");
}
/** pretty.rs:2956 `impl Print<P> for ty::Binder<T>`: `p.pretty_print_in_binder(self)` (upstream body). */
function print_Binder<T, P extends PrettyPrinter>(self: Binder<T>, p: P, print_T: Print<T, P>, d_T: TypeFoldable<T>): PrintResult {
  return p.pretty_print_in_binder(self, print_T as Print<T, PrettyPrinter>, d_T);
}
/** define_print! `ty::FnSig` (pretty.rs:3150, upstream body). */
function print_FnSig(self: FnSig, p: PrettyPrinter): PrintResult {
  let r: PrintResult;
  if ((r = p.write_str(Safety.prefix_str(FnSig_.safety(self)))).$ === "Err") return r;

  if (FnSig_.abi(self).$ !== "Rust") {
    if ((r = p.write_str(`extern ${display_ExternAbi(FnSig_.abi(self))} `)).$ === "Err") return r;
  }

  if ((r = p.write_str("fn")).$ === "Err") return r;
  if ((r = p.pretty_print_fn_sig(FnSig_.inputs(self), FnSig_.c_variadic(self), FnSig_.splatted(self), FnSig_.output(self))).$ === "Err") return r;
  return PRINT_OK;
}
/** define_print! `ty::TypeAndMut` (pretty.rs:3211, upstream body). */
function print_TypeAndMut(self: TypeAndMut, p: PrettyPrinter): PrintResult {
  let r: PrintResult;
  if ((r = p.write_str(Mutability.prefix_str(self.mutbl))).$ === "Err") return r;
  if ((r = print_Ty(self.ty, p)).$ === "Err") return r;
  return PRINT_OK;
}
/** define_print! `ty::AliasTy` (pretty.rs:3165). */
function print_AliasTy(_self: AliasTy, _p: PrettyPrinter): PrintResult {
  return unported("rustc_middle::ty::print::pretty define_print! ty::AliasTy (lane ty-print-b)");
}
/** define_print! `ty::ExistentialProjection` (pretty.rs:3280). */
function print_ExistentialProjection(_self: ExistentialProjection, _p: PrettyPrinter): PrintResult {
  return unported("rustc_middle::ty::print::pretty define_print! ty::ExistentialProjection (lane ty-print-b)");
}
/** define_print! `ty::PlaceholderType` (pretty.rs:3318). */
function print_PlaceholderType(_self: PlaceholderType, _p: PrettyPrinter): PrintResult {
  return unported("rustc_middle::ty::print::pretty define_print! ty::PlaceholderType (lane ty-print-b)");
}
/** define_print_and_forward_display! `ty::ParamTy` (pretty.rs:3400, upstream body). */
function print_ParamTy(self: ParamTy, p: PrettyPrinter): PrintResult {
  let r: PrintResult;
  if ((r = p.write_str(display_Symbol(self.name))).$ === "Err") return r;
  return PRINT_OK;
}
/** define_print_and_forward_display! `ty::Term` (pretty.rs:3408, upstream body). */
function print_Term(self: Term, p: PrettyPrinter): PrintResult {
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
/** define_print_and_forward_display! `GenericArg` (pretty.rs:3446, upstream body). */
function print_GenericArg(self: GenericArg, p: PrettyPrinter): PrintResult {
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
/** pretty.rs:2981 `pub struct TraitRefPrintOnlyTraitPath<'tcx>(ty::TraitRef<'tcx>)`. */
type TraitRefPrintOnlyTraitPath = { _0: TraitRef };
/** pretty.rs:3022 `pub struct TraitRefPrintOnlyTraitName<'tcx>(ty::TraitRef<'tcx>)`. */
type TraitRefPrintOnlyTraitName = { _0: TraitRef };
/** pretty.rs:3032 `PrintTraitRefExt::print_only_trait_path`: `TraitRefPrintOnlyTraitPath(self)`. */
function TraitRef_print_only_trait_path(self: TraitRef): TraitRefPrintOnlyTraitPath {
  return { _0: self };
}
/** pretty.rs:3040 `PrintTraitRefExt::print_only_trait_name`: `TraitRefPrintOnlyTraitName(self)`. */
function TraitRef_print_only_trait_name(self: TraitRef): TraitRefPrintOnlyTraitName {
  return { _0: self };
}
/** define_print_and_forward_display! `TraitRefPrintOnlyTraitPath` (pretty.rs:3343, upstream body). */
function print_TraitRefPrintOnlyTraitPath(self: TraitRefPrintOnlyTraitPath, p: PrettyPrinter): PrintResult {
  let r: PrintResult;
  if ((r = p.print_def_path(self._0.def_id, self._0.args)).$ === "Err") return r;
  return PRINT_OK;
}
/** define_print_and_forward_display! `TraitRefPrintOnlyTraitName` (pretty.rs:3366, upstream body). */
function print_TraitRefPrintOnlyTraitName(self: TraitRefPrintOnlyTraitName, p: PrettyPrinter): PrintResult {
  let r: PrintResult;
  if ((r = p.print_def_path(self._0.def_id, [])).$ === "Err") return r;
  return PRINT_OK;
}

// ==== lane ty-print-b: pretty.rs:1705..end ====
import { unported_methods as unported_methods_b } from "../../../rust_ts/stubs.ts";

// The methods this file defines upstream on `TyCtxt` (ty/decls.ts `// ty/print/pretty.rs:<line>`), until lane
// ty-print-b ports them (stub installed by lane ty-contract).
unported_methods_b(TyCtxt.prototype, "rustc_middle::ty::print::pretty::TyCtxt", [
  "def_path_str_with_args",
  "value_path_str_with_args",
]);
