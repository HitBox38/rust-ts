// Port of compiler/rustc_middle/src/ty/closure.rs (lane ty-adt-assoc; contract stub by lane ty-contract).
//
// Extension module (docs/handoff/ty-contract.md "Init order"): rustc_middle/lib.ts loads it after the classes; its
// top-level code may touch only the classes it imports, never another extension module.
//
// PORT: the types of this file are hand-written (they are not in a tools/codegen set): fieldless enums as string
// unions, data enums tagged by `$`, `CapturedPlace` (inherent methods) as a class, the data structs as interfaces.
// Their `#[derive(Debug)]` impls are `debug_<T>`; `TypeFoldable` / `TypeVisitable` / `StableHash` / `TyEncodable` /
// `TyDecodable` derives are not written (tools/codegen; PORTING §5).
// PORT(decls): pending. `hir::place::{Place, PlaceBase, ProjectionKind, Projection}` (hir/place.rs) and `mir::Local`
// (M4) are not ported: the members read here are typed by the `*View` types below (upstream names, PORTING §5 shapes);
// methods that are not field reads go through `unported` stand-ins at the end of the file. decls.ts still has
// `HirPlace` as `Pending`: the `TyCtxt` methods declared there cast at the boundary. (`TypeckResults` is
// typeck_results.ts's since merge-w15b.)
// PORT: `closure_typeinfo` (the provider) and `provide` are exported; ty/mod.rs `provide` (lane ty-mod) calls
// `closure::provide`.
import { TyCtxt } from "./context.ts";
import { debug_Mutability, type Mutability } from "../../rustc_ast_ir/lib.ts";
import { debug_HirId, type HirId, HirId_eq } from "../../rustc_hir_id/lib.ts";
import { LocalDefId } from "../../rustc_span/def_id.ts";
import type { Span } from "../../rustc_span/lib.ts";
import { bug } from "../../rustc_span/macros.ts";
import { debug_Ident, display_Ident, type Ident, Symbol } from "../../rustc_span/symbol.ts";
import { type Debug, debug_option, debug_struct, debug_tuple, type Fmt, format_debug, PLAIN, PRETTY } from "../../std/fmt.ts";
import { panic, unported, unwrap } from "../../std/panic.ts";
import { debug_TyKind } from "../../rustc_type_ir/ty_kind.ts";
import type { Providers } from "../queries.gen.ts";
import type { CanonicalPolyFnSig, CapturedPlace as PendingCapturedPlace, FieldIdx, HirPlace, TypeckResults, VariantIdx } from "./decls.ts";
import type { List } from "./list.ts";
import type { Ordering, Ty } from "./mod.ts";

/** `mir::Local` (mir/mod.rs, M4). PORT(decls): pending (a `newtype_index!`: a branded number). */
export type Local = number & { readonly __brand: "mir::Local" };

/// Captures are represented using fields inside a structure.
/// This represents accessing self in the closure structure
// `mir::Local::arg(0)` (mir/mod.rs:880: `Local::from_usize(i + 1)`)
export const CAPTURE_STRUCT_LOCAL: Local = (0 + 1) as Local;

export interface UpvarPath {
  hir_id: HirId;
}
/** `#[derive(Debug)]` */
export const debug_UpvarPath: Debug<UpvarPath> = (v, f) => debug_struct(f, "UpvarPath", [["hir_id", debug_HirId(v.hir_id, f)]]);

/// Upvars do not get their own `NodeId`. Instead, we use the pair of
/// the original var ID (that is, the root variable that is referenced
/// by the upvar) and the ID of the closure expression.
export interface UpvarId {
  var_path: UpvarPath;
  closure_expr_id: LocalDefId;
}
export const UpvarId = {
  // rustc: compiler/rustc_middle/src/ty/closure.rs:40 new
  new(var_hir_id: HirId, closure_def_id: LocalDefId): UpvarId {
    return { var_path: { hir_id: var_hir_id }, closure_expr_id: closure_def_id };
  },
};

/// Information describing the capture of an upvar. This is computed
/// during `typeck`, specifically by `regionck`.
export type UpvarCapture =
  /// Upvar is captured by reference.
  | { readonly $: "ByRef"; readonly _0: BorrowKind }

  /// Upvar is captured by use. This is true when the closure is labeled `use`.
  | { readonly $: "ByUse" }

  /// Upvar is captured by value. This is always true when the
  /// closure is labeled `move`, but can also be true in other cases
  /// depending on inference.
  | { readonly $: "ByValue" };
export const UpvarCapture = {
  ByUse: Object.freeze({ $: "ByUse" as const }),
  ByValue: Object.freeze({ $: "ByValue" as const }),

  // Used in rustc_hir_typeck::upvar::determine_capture_info
  // rustc: compiler/rustc_middle/src/ty/closure.rs:65 partial_cmp
  partial_cmp(self: UpvarCapture, other: UpvarCapture): Ordering | undefined {
    if ((self.$ === "ByValue" && other.$ === "ByValue") || (self.$ === "ByUse" && other.$ === "ByUse")) {
      return "Equal";
    }
    if ((self.$ === "ByValue" || self.$ === "ByUse") && other.$ === "ByRef") return "Greater";
    if (self.$ === "ByRef" && (other.$ === "ByValue" || other.$ === "ByUse")) return "Less";
    if (self.$ === "ByRef" && other.$ === "ByRef") return BorrowKind.cmp(self._0, other._0);
    // (Self::ByUse, Self::ByValue) | (Self::ByValue, Self::ByUse)
    return undefined;
  },
};
/** `#[derive(Debug)]` */
export const debug_UpvarCapture: Debug<UpvarCapture> = (v, f) => {
  switch (v.$) {
    case "ByRef":
      return debug_tuple(f, "ByRef", [debug_BorrowKind(v._0, f)]);
    case "ByUse":
    case "ByValue":
      return v.$;
  }
};

/// Given the closure DefId this map provides a map of root variables to minimum
/// set of `CapturedPlace`s that need to be tracked to support all captures of that closure.
export type MinCaptureInformationMap = Map<LocalDefId, RootVariableMinCaptureList>;

/// Part of `MinCaptureInformationMap`; Maps a root variable to the list of `CapturedPlace`.
/// Used to track the minimum set of `Place`s that need to be captured to support all
/// Places captured by the closure starting at a given root variable.
///
/// This provides a convenient and quick way of checking if a variable being used within
/// a closure is a capture of a local variable.
// PORT: `FxIndexMap<HirId, _>` is a `HirIdMap` (D5; insertion-ordered).
export type RootVariableMinCaptureList = import("../../rustc_hir_id/lib.ts").HirIdMap<MinCaptureList>;

/// Part of `MinCaptureInformationMap`; List of `CapturePlace`s.
export type MinCaptureList = CapturedPlace[];

/// A composite describing a `Place` that is captured by a closure.
export class CapturedPlace {
  constructor(
    /// Name and span where the binding happens.
    public var_ident: Ident,

    /// The `Place` that is captured.
    public place: HirPlace,

    /// `CaptureKind` and expression(s) that resulted in such capture of `place`.
    public info: CaptureInfo,

    /// Represents if `place` can be mutated or not.
    public mutability: Mutability,
  ) {}

  // rustc: compiler/rustc_middle/src/ty/closure.rs:111 to_string
  to_string(tcx: TyCtxt): string {
    return place_to_string_for_capture(tcx, this.place);
  }

  /// Returns a symbol of the captured upvar, which looks like `name__field1__field2`.
  // rustc: compiler/rustc_middle/src/ty/closure.rs:116 to_symbol
  to_symbol(): Symbol {
    let symbol = display_Ident(this.var_ident);

    const place = view_HirPlace(this.place);
    let ty = place.base_ty;
    for (const proj of place.projections) {
      const kind = proj.kind;
      switch (kind.$) {
        case "Field": {
          const idx = kind._0;
          const variant = kind._1;
          const k = ty.kind();
          switch (k.$) {
            case "Tuple":
              symbol += `__${idx}`;
              break;
            case "Adt": {
              const def = k._0;
              symbol += `__${Symbol.as_str(unwrap(def.variant(variant).fields[idx], "index out of bounds").name)}`;
              break;
            }
            default:
              bug(`Unexpected type ${debug_TyKind(k, PLAIN)} for \`Field\` projection`);
          }
          break;
        }

        case "UnwrapUnsafeBinder":
          symbol += "__unwrap";
          break;

        // Ignore derefs for now, as they are likely caused by
        // autoderefs that don't appear in the original code.
        case "Deref":
          break;
        // Just change the type to the hidden type, so we can actually project.
        case "OpaqueCast":
          break;
        default:
          bug(`Unexpected projection ${debug_ProjectionKind(kind, PLAIN)} in captured place`);
      }
      ty = proj.ty;
    }

    return Symbol.intern(symbol);
  }

  /// Returns the hir-id of the root variable for the captured place.
  /// e.g., if `a.b.c` was captured, would return the hir-id for `a`.
  // rustc: compiler/rustc_middle/src/ty/closure.rs:156 get_root_variable
  get_root_variable(): HirId {
    const base = view_HirPlace(this.place).base;
    switch (base.$) {
      case "Upvar":
        return base._0.var_path.hir_id;
      default:
        bug(`Expected upvar, found=${debug_PlaceBase(base, PLAIN)}`);
    }
  }

  /// Returns the `LocalDefId` of the closure that captured this Place
  // rustc: compiler/rustc_middle/src/ty/closure.rs:164 get_closure_local_def_id
  get_closure_local_def_id(): LocalDefId {
    const base = view_HirPlace(this.place).base;
    switch (base.$) {
      case "Upvar":
        return base._0.closure_expr_id;
      default:
        bug(`expected upvar, found=${debug_PlaceBase(base, PLAIN)}`);
    }
  }

  /// Return span pointing to use that resulted in selecting the captured path
  // rustc: compiler/rustc_middle/src/ty/closure.rs:172 get_path_span
  get_path_span(tcx: TyCtxt): Span {
    if (this.info.path_expr_id !== undefined) {
      const path_expr_id = this.info.path_expr_id;
      return tcx.hir_span(path_expr_id);
    } else if (this.info.capture_kind_expr_id !== undefined) {
      const capture_kind_expr_id = this.info.capture_kind_expr_id;
      return tcx.hir_span(capture_kind_expr_id);
    } else {
      // Fallback on upvars mentioned if neither path or capture expr id is captured

      // Safe to unwrap since we know this place is captured by the closure, therefore the closure must have upvars.
      return upvar_span(tcx, this.get_closure_local_def_id(), this.get_root_variable());
    }
  }

  /// Return span pointing to use that resulted in selecting the current capture kind
  // rustc: compiler/rustc_middle/src/ty/closure.rs:188 get_capture_kind_span
  get_capture_kind_span(tcx: TyCtxt): Span {
    if (this.info.capture_kind_expr_id !== undefined) {
      const capture_kind_expr_id = this.info.capture_kind_expr_id;
      return tcx.hir_span(capture_kind_expr_id);
    } else if (this.info.path_expr_id !== undefined) {
      const path_expr_id = this.info.path_expr_id;
      return tcx.hir_span(path_expr_id);
    } else {
      // Fallback on upvars mentioned if neither path or capture expr id is captured

      // Safe to unwrap since we know this place is captured by the closure, therefore the closure must have upvars.
      return upvar_span(tcx, this.get_closure_local_def_id(), this.get_root_variable());
    }
  }

  // rustc: compiler/rustc_middle/src/ty/closure.rs:203 is_by_ref
  is_by_ref(): boolean {
    switch (this.info.capture_kind.$) {
      case "ByValue":
      case "ByUse":
        return false;
      case "ByRef":
        return true;
    }
  }
}
/** `#[derive(Debug)]` */
export const debug_CapturedPlace: Debug<CapturedPlace> = (v, f) =>
  debug_struct(f, "CapturedPlace", [
    ["var_ident", debug_Ident(v.var_ident, f)],
    ["place", debug_HirPlace(v.place, f)],
    ["info", debug_CaptureInfo(v.info, f)],
    ["mutability", debug_Mutability(v.mutability, f)],
  ]);

/** `tcx.upvars_mentioned(closure).unwrap()[&root_variable].span` */
function upvar_span(tcx: TyCtxt, closure: LocalDefId, root_variable: HirId): Span {
  // PORT: the `upvars_mentioned` query value is `Option<&FxIndexMap<HirId, hir::Upvar>>` (`hir::Upvar { span }`;
  // its value type is `unknown` in queries.gen.ts). `[&k]` (`impl Index for IndexMap`) panics on a missing key.
  const upvars = unwrap(tcx.upvars_mentioned(LocalDefId.to_def_id(closure)));
  const upvar = upvars.get(root_variable) as { span: Span } | undefined;
  if (upvar === undefined) panic("IndexMap: key not found");
  return upvar.span;
}

export interface ClosureTypeInfo {
  user_provided_sig: CanonicalPolyFnSig;
  captures: List<CapturedPlace>;
  kind_origin: [Span, HirPlace] | undefined;
}

// rustc: compiler/rustc_middle/src/ty/closure.rs:218 closure_typeinfo
export function closure_typeinfo(tcx: TyCtxt, def: LocalDefId): ClosureTypeInfo {
  // debug_assert!(tcx.is_closure_like(def.to_def_id()));
  const typeck_results = tcx.typeck(def) as TypeckResults;
  const user_provided_sig = unwrap(typeck_results.user_provided_sigs.get(def), "index out of bounds");
  const captures_ = typeck_results.closure_min_captures_flattened(def);
  const captures = tcx.mk_captures_from_iter(captures_ as Iterable<unknown> as Iterable<PendingCapturedPlace>) as unknown as List<CapturedPlace>;
  const hir_id = tcx.local_def_id_to_hir_id(def);
  const kind_origin = typeck_results.closure_kind_origins().get(hir_id);
  return { user_provided_sig, captures, kind_origin };
}

// rustc: compiler/rustc_middle/src/ty/closure.rs:230 closure_kind_origin
TyCtxt.prototype.closure_kind_origin = function (this: TyCtxt, def_id: LocalDefId): [Span, HirPlace] | undefined {
  // PORT: the `closure_typeinfo` query value is `unknown` in queries.gen.ts (`ClosureTypeInfo`).
  return (this.closure_typeinfo(def_id) as ClosureTypeInfo).kind_origin;
};

// rustc: compiler/rustc_middle/src/ty/closure.rs:234 closure_user_provided_sig
TyCtxt.prototype.closure_user_provided_sig = function (this: TyCtxt, def_id: LocalDefId): CanonicalPolyFnSig {
  return (this.closure_typeinfo(def_id) as ClosureTypeInfo).user_provided_sig;
};

// rustc: compiler/rustc_middle/src/ty/closure.rs:238 closure_captures
TyCtxt.prototype.closure_captures = function (this: TyCtxt, def_id: LocalDefId): readonly PendingCapturedPlace[] {
  if (!this.is_closure_like(LocalDefId.to_def_id(def_id))) {
    return [];
  }
  return (this.closure_typeinfo(def_id) as ClosureTypeInfo).captures as unknown as readonly PendingCapturedPlace[];
};

/// Return true if the `proj_possible_ancestor` represents an ancestor path
/// to `proj_capture` or `proj_possible_ancestor` is same as `proj_capture`,
/// assuming they both start off of the same root variable.
///
/// **Note:** It's the caller's responsibility to ensure that both lists of projections
///           start off of the same root variable.
///
/// Eg: 1. `foo.x` which is represented using `projections=[Field(x)]` is an ancestor of
///        `foo.x.y` which is represented using `projections=[Field(x), Field(y)]`.
///        Note both `foo.x` and `foo.x.y` start off of the same root variable `foo`.
///     2. Since we only look at the projections here function will return `bar.x` as a valid
///        ancestor of `foo.x.y`. It's the caller's responsibility to ensure that both projections
///        list are being applied to the same root variable.
// rustc: compiler/rustc_middle/src/ty/closure.rs:259 is_ancestor_or_same_capture
export function is_ancestor_or_same_capture(proj_possible_ancestor: readonly HirProjectionKind[], proj_capture: readonly HirProjectionKind[]): boolean {
  // We want to make sure `is_ancestor_or_same_capture("x.0.0", "x.0")` to return false.
  // Therefore we can't just check if all projections are same in the zipped iterator below.
  if (proj_possible_ancestor.length > proj_capture.length) {
    return false;
  }

  // `zip` stops at the shorter slice (`proj_possible_ancestor`).
  return proj_possible_ancestor.every((a, i) => ProjectionKind_eq(a, proj_capture[i]!));
}

/// Part of `MinCaptureInformationMap`; describes the capture kind (&, &mut, move)
/// for a particular capture as well as identifying the part of the source code
/// that triggered this capture to occur.
export interface CaptureInfo {
  /// Expr Id pointing to use that resulted in selecting the current capture kind
  ///
  /// Eg:
  /// ```rust,no_run
  /// let mut t = (0,1);
  ///
  /// let c = || {
  ///     println!("{t:?}"); // L1
  ///     t.1 = 4; // L2
  /// };
  /// ```
  /// `capture_kind_expr_id` will point to the use on L2 and `path_expr_id` will point to the
  /// use on L1.
  ///
  /// If the user doesn't enable feature `capture_disjoint_fields` (RFC 2229) then, it is
  /// possible that we don't see the use of a particular place resulting in capture_kind_expr_id being
  /// None. In such case we fallback on uvpars_mentioned for span.
  ///
  /// Eg:
  /// ```rust,no_run
  /// let x = 5;
  ///
  /// let c = || {
  ///     let _ = x;
  /// };
  /// ```
  ///
  /// In this example, if `capture_disjoint_fields` is **not** set, then x will be captured,
  /// but we won't see it being used during capture analysis, since it's essentially a discard.
  capture_kind_expr_id: HirId | undefined;
  /// Expr Id pointing to use that resulted the corresponding place being captured
  ///
  /// See `capture_kind_expr_id` for example.
  ///
  path_expr_id: HirId | undefined;

  /// Capture mode that was selected
  capture_kind: UpvarCapture;
}
/** `#[derive(Debug)]` */
export const debug_CaptureInfo: Debug<CaptureInfo> = (v, f) =>
  debug_struct(f, "CaptureInfo", [
    ["capture_kind_expr_id", debug_option(v.capture_kind_expr_id, f, debug_HirId)],
    ["path_expr_id", debug_option(v.path_expr_id, f, debug_HirId)],
    ["capture_kind", debug_UpvarCapture(v.capture_kind, f)],
  ]);

// rustc: compiler/rustc_middle/src/ty/closure.rs:318 place_to_string_for_capture
export function place_to_string_for_capture(tcx: TyCtxt, place_: HirPlace): string {
  const place = view_HirPlace(place_);
  let curr_string: string;
  if (place.base.$ === "Upvar") {
    const upvar_id = place.base._0;
    curr_string = Symbol.as_str(tcx.hir_name(upvar_id.var_path.hir_id));
  } else {
    bug("Capture_information should only contain upvars");
  }

  for (let i = 0; i < place.projections.length; i++) {
    const proj = place.projections[i]!;
    const kind = proj.kind;
    switch (kind.$) {
      case "Deref":
        curr_string = `*${curr_string}`;
        break;
      case "Field": {
        const idx = kind._0;
        const variant = kind._1;
        const k = place.ty_before_projection(i).kind();
        switch (k.$) {
          case "Adt": {
            const def = k._0;
            curr_string = `${curr_string}.${Symbol.as_str(unwrap(def.variant(variant).fields[idx], "index out of bounds").name)}`;
            break;
          }
          case "Tuple":
            curr_string = `${curr_string}.${idx}`;
            break;
          default:
            bug(`Field projection applied to a type other than Adt or Tuple: ${debug_TyKind(place.ty_before_projection(i).kind(), PLAIN)}.`);
        }
        break;
      }
      case "UnwrapUnsafeBinder":
        curr_string = `unwrap_binder!(${curr_string})`;
        break;
      // Just change the type to the hidden type, so we can actually project.
      case "OpaqueCast":
        break;
      default:
        bug(`${debug_ProjectionKind(kind, PLAIN)} unexpected because it isn't captured`);
    }
  }

  return curr_string;
}

export type BorrowKind =
  /// Data must be immutable and is aliasable.
  | "Immutable"

  /// Data must be immutable but not aliasable. This kind of borrow
  /// cannot currently be expressed by the user and is used only in
  /// implicit closure bindings. It is needed when the closure
  /// is borrowing or mutating a mutable referent, e.g.:
  ///
  /// ```
  /// let mut z = 3;
  /// let x: &mut isize = &mut z;
  /// let y = || *x += 5;
  /// ```
  ///
  /// If we were to try to translate this closure into a more explicit
  /// form, we'd encounter an error with the code as written:
  ///
  /// ```compile_fail,E0594
  /// struct Env<'a> { x: &'a &'a mut isize }
  /// let mut z = 3;
  /// let x: &mut isize = &mut z;
  /// let y = (&mut Env { x: &x }, fn_ptr);  // Closure is pair of env and fn
  /// fn fn_ptr(env: &mut Env) { **env.x += 5; }
  /// ```
  ///
  /// This is then illegal because you cannot mutate a `&mut` found
  /// in an aliasable location. To solve, you'd have to translate with
  /// an `&mut` borrow:
  ///
  /// ```compile_fail,E0596
  /// struct Env<'a> { x: &'a mut &'a mut isize }
  /// let mut z = 3;
  /// let x: &mut isize = &mut z;
  /// let y = (&mut Env { x: &mut x }, fn_ptr); // changed from &x to &mut x
  /// fn fn_ptr(env: &mut Env) { **env.x += 5; }
  /// ```
  ///
  /// Now the assignment to `**env.x` is legal, but creating a
  /// mutable pointer to `x` is not because `x` is not mutable. We
  /// could fix this by declaring `x` as `let mut x`. This is ok in
  /// user code, if awkward, but extra weird for closures, since the
  /// borrow is hidden.
  ///
  /// So we introduce a "unique imm" borrow -- the referent is
  /// immutable, but not aliasable. This solves the problem. For
  /// simplicity, we don't give users the way to express this
  /// borrow, it's just used when translating closures.
  ///
  /// FIXME: Rename this to indicate the borrow is actually not immutable.
  | "UniqueImmutable"

  /// Data is mutable and not aliasable.
  | "Mutable";
/** `#[derive(PartialOrd, Ord)]`: the order of variants is load-bearing. */
export const BorrowKind_discriminant: Record<BorrowKind, number> = { Immutable: 0, UniqueImmutable: 1, Mutable: 2 };
export const BorrowKind = {
  Immutable: "Immutable",
  UniqueImmutable: "UniqueImmutable",
  Mutable: "Mutable",

  /** `#[derive(Ord)]` `cmp` */
  cmp(self: BorrowKind, other: BorrowKind): Ordering {
    const a = BorrowKind_discriminant[self];
    const b = BorrowKind_discriminant[other];
    return a < b ? "Less" : a > b ? "Greater" : "Equal";
  },

  // rustc: compiler/rustc_middle/src/ty/closure.rs:431 from_mutbl
  from_mutbl(m: Mutability): BorrowKind {
    switch (m) {
      case "Mut":
        return "Mutable";
      case "Not":
        return "Immutable";
    }
  },

  /// Returns a mutability `m` such that an `&m T` pointer could be used to obtain this borrow
  /// kind. Because borrow kinds are richer than mutabilities, we sometimes have to pick a
  /// mutability that is stronger than necessary so that it at least *would permit* the borrow in
  /// question.
  // rustc: compiler/rustc_middle/src/ty/closure.rs:442 to_mutbl_lossy
  to_mutbl_lossy(self: BorrowKind): Mutability {
    switch (self) {
      case "Mutable":
        return "Mut";
      case "Immutable":
        return "Not";

      // We have no type corresponding to a unique imm borrow, so
      // use `&mut`. It gives all the capabilities of a `&uniq`
      // and hence is a safe "over approximation".
      case "UniqueImmutable":
        return "Mut";
    }
  },
} as const;
/** `#[derive(Debug)]` */
export const debug_BorrowKind: Debug<BorrowKind> = (v) => v;

// PORT: `gen move { .. }` is a generator; `Peekable` is a one-item lookahead over the child iterator.
// rustc: compiler/rustc_middle/src/ty/closure.rs:455 analyze_coroutine_closure_captures
export function* analyze_coroutine_closure_captures<T>(
  parent_captures: Iterable<CapturedPlace>,
  child_captures_: Iterable<CapturedPlace>,
  for_each: (parent: [number, CapturedPlace], child: [number, CapturedPlace]) => T,
): Generator<T> {
  const child_captures = new Peekable(enumerate(child_captures_));

  // One parent capture may correspond to several child captures if we end up
  // refining the set of captures via edition-2021 precise captures. We want to
  // match up any number of child captures with one parent capture, so we keep
  // peeking off this `Peekable` until the child doesn't match anymore.
  let parent_field_idx = 0;
  for (const parent_capture of parent_captures) {
    // Make sure we use every field at least once, b/c why are we capturing something
    // if it's not used in the inner coroutine.
    let field_used_at_least_once = false;

    // A parent matches a child if they share the same prefix of projections.
    // The child may have more, if it is capturing sub-fields out of
    // something that is captured by-move in the parent closure.
    for (;;) {
      const peeked = child_captures.peek();
      if (!(peeked !== undefined && child_prefix_matches_parent_projections(parent_capture, peeked[1]))) break;
      const [child_field_idx, child_capture] = unwrap(child_captures.next());
      // This analysis only makes sense if the parent capture is a
      // prefix of the child capture.
      // PORT: `assert!(cond, msg)` with the message formatted only on failure.
      if (!(view_HirPlace(child_capture.place).projections.length >= view_HirPlace(parent_capture.place).projections.length)) {
        panic(
          `parent capture (${format_debug(parent_capture, debug_CapturedPlace, PRETTY)}) expected to be prefix of child capture (${format_debug(child_capture, debug_CapturedPlace, PRETTY)})`,
        );
      }

      yield for_each([parent_field_idx, parent_capture], [child_field_idx, child_capture]);

      field_used_at_least_once = true;
    }

    // Make sure the field was used at least once.
    if (!field_used_at_least_once) {
      panic(`we captured ${format_debug(parent_capture, debug_CapturedPlace, PRETTY)} but it was not used in the child coroutine?`);
    }
    parent_field_idx++;
  }
  // assert_eq!(child_captures.next(), None, "leftover child captures?");
  const leftover = child_captures.next();
  if (leftover !== undefined) {
    panic(
      `assertion \`left == right\` failed: leftover child captures?\n  left: Some(${debug_tuple(PLAIN, "", [String(leftover[0]), debug_CapturedPlace(leftover[1], PLAIN)])})\n right: None`,
    );
  }
}

// rustc: compiler/rustc_middle/src/ty/closure.rs:505 child_prefix_matches_parent_projections
function child_prefix_matches_parent_projections(parent_capture: CapturedPlace, child_capture: CapturedPlace): boolean {
  const parent_place = view_HirPlace(parent_capture.place);
  const child_place = view_HirPlace(child_capture.place);
  if (parent_place.base.$ !== "Upvar") {
    bug("expected capture to be an upvar");
  }
  const parent_base = parent_place.base._0;
  if (child_place.base.$ !== "Upvar") {
    bug("expected capture to be an upvar");
  }
  const child_base = child_place.base._0;

  if (!HirId_eq(parent_base.var_path.hir_id, child_base.var_path.hir_id)) return false;
  const n = Math.min(child_place.projections.length, parent_place.projections.length);
  for (let i = 0; i < n; i++) {
    if (!ProjectionKind_eq(child_place.projections[i]!.kind, parent_place.projections[i]!.kind)) return false;
  }
  return true;
}

// rustc: compiler/rustc_middle/src/ty/closure.rs:521 provide
export function provide(providers: Providers): void {
  providers.closure_typeinfo = closure_typeinfo;
}

// ---- views of pending types and helpers (module comment; not markers) ----------------------------------------------

/** `hir::place::ProjectionKind` (hir/place.rs:23). PORT(decls): pending. */
export type HirProjectionKind =
  | { readonly $: "Deref" }
  | { readonly $: "Field"; readonly _0: FieldIdx; readonly _1: VariantIdx }
  | { readonly $: "Index" }
  | { readonly $: "Subslice" }
  | { readonly $: "OpaqueCast" }
  | { readonly $: "UnwrapUnsafeBinder" };
/** `#[derive(PartialEq)]` of `hir::place::ProjectionKind` */
function ProjectionKind_eq(a: HirProjectionKind, b: HirProjectionKind): boolean {
  if (a.$ !== b.$) return false;
  if (a.$ === "Field" && b.$ === "Field") return a._0 === b._0 && a._1 === b._1;
  return true;
}

/** `hir::place::PlaceBase` (hir/place.rs:10). PORT(decls): pending. */
export type HirPlaceBase = { readonly $: "Rvalue" } | { readonly $: "StaticItem" } | { readonly $: "Local"; readonly _0: HirId } | { readonly $: "Upvar"; readonly _0: UpvarId };

/** The members of `hir::place::Place` (hir/place.rs:69) read here. PORT(decls): pending. */
interface HirPlaceView {
  readonly base_ty: Ty;
  readonly base: HirPlaceBase;
  readonly projections: readonly { readonly ty: Ty; readonly kind: HirProjectionKind }[];
  ty_before_projection(projection_index: number): Ty;
}
function view_HirPlace(p: HirPlace): HirPlaceView {
  return p as unknown as HirPlaceView;
}


/** `Peekable<Enumerate<I>>` */
class Peekable<T> {
  private peeked: { v: T | undefined } | undefined = undefined;
  constructor(private readonly it: Iterator<T>) {}
  peek(): T | undefined {
    if (this.peeked === undefined) {
      const r = this.it.next();
      this.peeked = { v: r.done ? undefined : r.value };
    }
    return this.peeked.v;
  }
  next(): T | undefined {
    if (this.peeked !== undefined) {
      const v = this.peeked.v;
      this.peeked = undefined;
      return v;
    }
    const r = this.it.next();
    return r.done ? undefined : r.value;
  }
}
function* enumerate<T>(it: Iterable<T>): Generator<[number, T]> {
  let i = 0;
  for (const v of it) yield [i++, v];
}

/** PORT: stand-in for `#[derive(Debug)]` of `hir::place::Place` (hir/place.rs:69). */
function debug_HirPlace(_v: HirPlace, _f: Fmt): string {
  return unported("rustc_middle::hir::place::Place Debug (hir/place.rs)");
}
/** PORT: stand-in for `#[derive(Debug)]` of `hir::place::PlaceBase` (hir/place.rs:10). */
function debug_PlaceBase(_v: HirPlaceBase, _f: Fmt): string {
  return unported("rustc_middle::hir::place::PlaceBase Debug (hir/place.rs)");
}
/** PORT: stand-in for `#[derive(Debug)]` of `hir::place::ProjectionKind` (hir/place.rs:23). */
function debug_ProjectionKind(_v: HirProjectionKind, _f: Fmt): string {
  return unported("rustc_middle::hir::place::ProjectionKind Debug (hir/place.rs)");
}
