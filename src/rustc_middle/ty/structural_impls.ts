// Port of compiler/rustc_middle/src/ty/structural_impls.rs (lane ty-results; was merge-w13's contract stub).
//
//! This module contains implementations of the `Lift`, `TypeFoldable` and
//! `TypeVisitable` traits for various types in the Rust compiler. Most are
//! written by hand, though we've recently added some macros and proc-macros
//! to help with the tedium.
//
// PORT (D4): each `TypeFoldable`/`TypeVisitable`/`TypeSuper*` impl of an interned type is a descriptor `fold_<T>` (for
// `Ty`/`Predicate`/`Clause` also carrying `Flags` / `PredicateProxy`); a visit-only impl is `visit_<T>`; generic impls
// are functions from descriptors to descriptors (`fold_Spanned(d)`, `visit_List(d)`). tools/codegen's generated code
// calls the gen-shaped free fns `visit_with_<T>` / `try_fold_with_<T>` / `fold_with_<T>`, which wrap the descriptors
// (type_fold.json). The gen-shaped fns of `Ty`, `Predicate`, `Clause`, `GenericArg` and the `debug_<T>` stubs live in
// those types' modules (ty/mod.ts, ty/predicate.ts, ty/generic_args.ts, other lanes'): root repoints them here.
// PORT: `Lift` impls are skipped (PORTING §3); the `TrivialLiftImpls!` / `TrivialTypeTraversalImpls!` /
// `TrivialTypeTraversalAndLiftImpls!` invocations (structural_impls.rs:162-251) define no fn of this file: a trivially
// traversed type's fold returns the value and its visit returns `V::Result::output()` where a caller needs it
// (`ErrorGuaranteed`, `Span`, `&List<LocalDefId>` below; `ParamTy`, `ScalarInt`, `DefId`, ... in generated code).
// PORT (init order): this module is part of the defining-module graph (rustc_type_ir sty/consts.ts and
// const_kind.gen.ts import it): it imports no extension module at load time. Modules that reach one (binder.ts,
// ty_kind.ts, generic_args.ts, sty/*.ts, print/pretty.ts, context/tls.ts, ...) are required lazily at call time.
// PORT: `write!(f, "{:?}", x)` formats `x` with fresh options (`PLAIN`, tyir-kind decision 5).
import { try_visit } from "../../rustc_ast_ir/visit.ts";
import type { Namespace } from "../../rustc_hir/def.ts";
import type { HirId } from "../../rustc_hir_id/lib.ts";
import { debug_HirId } from "../../rustc_hir_id/lib.ts";
import { type DefId, debug_LocalDefId, type LocalDefId } from "../../rustc_span/def_id.ts";
import type { ErrorGuaranteed, Span } from "../../rustc_span/lib.ts";
import { display_Symbol } from "../../rustc_span/symbol.ts";
import type { AliasTyKind } from "../../rustc_type_ir/ty_kind.gen.ts";
import type { Binder } from "../../rustc_type_ir/binder.gen.ts";
import type { FallibleTypeFolder, PredicateProxy, TypeFoldable, TypeFolder, TypeSuperFoldable } from "../../rustc_type_ir/fold.ts";
import type { Flags, TypeSuperVisitable, TypeVisitable, TypeVisitor } from "../../rustc_type_ir/visit.ts";
import type { ClauseKind, PredicateKind } from "../../rustc_type_ir/predicate_kind.gen.ts";
import type { ProjectionClause } from "../../rustc_type_ir/predicate.gen.ts";
import type { Const } from "../../rustc_type_ir/sty/consts.ts";
import type { Region } from "../../rustc_type_ir/sty/mod.ts";
import type { TyKind } from "../../rustc_type_ir/ty_kind.gen.ts";
import type { ValTreeKind } from "../../rustc_type_ir/const_kind.gen.ts";
import type { PatternKind } from "../../rustc_type_ir/pattern.gen.ts";
import type { OpaqueTypeKey } from "../../rustc_type_ir/opaque_ty.gen.ts";
import { intern_key } from "../../rust_ts/intern_key.ts";
import { type Debug, type Fmt, PLAIN } from "../../std/fmt.ts";
import { panic, unported } from "../../std/panic.ts";
import { Ok, type Result } from "../../std/result.ts";
import type { TyCtxt } from "./context.ts";
import type { AdtDef, BinOp, BoundExistentialPredicates, CastKind, Consts, LocalDefIds, PatList, Pattern, PlaceElem, PredefinedOpaques, RegionAssumptions, UnOp } from "./decls.ts";
import type { ArgOutlivesClause, PolyExistentialPredicate } from "../../rustc_type_ir/decls.ts";
import type { Adjustment, PatAdjustment } from "./adjustment.gen.ts";
import type { GenericArg } from "./generic_args.ts";
import type { Clauses, List } from "./list.ts";
import type { Ty } from "./mod.ts";
import type { Clause, Predicate } from "./predicate.ts";
import type { LateParamRegionKind } from "./region.gen.ts";
import type { ParamConst, ParamTy } from "./sty.gen.ts";
import type { Expr } from "./consts/kind.gen.ts";
import type { ValTree } from "./consts/valtree.ts";

// ---- lazy modules (init order, module comment) ----
function binder(): typeof import("../../rustc_type_ir/binder.ts") {
  return require("../../rustc_type_ir/binder.ts") as typeof import("../../rustc_type_ir/binder.ts");
}
function ty_kind_gen(): typeof import("../../rustc_type_ir/ty_kind.gen.ts") {
  return require("../../rustc_type_ir/ty_kind.gen.ts") as typeof import("../../rustc_type_ir/ty_kind.gen.ts");
}
function ty_kind(): typeof import("../../rustc_type_ir/ty_kind.ts") {
  return require("../../rustc_type_ir/ty_kind.ts") as typeof import("../../rustc_type_ir/ty_kind.ts");
}
function alias(): typeof import("../../rustc_type_ir/ty/alias.ts") {
  return require("../../rustc_type_ir/ty/alias.ts") as typeof import("../../rustc_type_ir/ty/alias.ts");
}
function generic_args(): typeof import("./generic_args.ts") {
  return require("./generic_args.ts") as typeof import("./generic_args.ts");
}
function sty_mod(): typeof import("../../rustc_type_ir/sty/mod.ts") {
  return require("../../rustc_type_ir/sty/mod.ts") as typeof import("../../rustc_type_ir/sty/mod.ts");
}
function sty_consts(): typeof import("../../rustc_type_ir/sty/consts.ts") {
  return require("../../rustc_type_ir/sty/consts.ts") as typeof import("../../rustc_type_ir/sty/consts.ts");
}
function predicate_kind(): typeof import("../../rustc_type_ir/predicate_kind.ts") {
  return require("../../rustc_type_ir/predicate_kind.ts") as typeof import("../../rustc_type_ir/predicate_kind.ts");
}
function predicate_kind_gen(): typeof import("../../rustc_type_ir/predicate_kind.gen.ts") {
  return require("../../rustc_type_ir/predicate_kind.gen.ts") as typeof import("../../rustc_type_ir/predicate_kind.gen.ts");
}
function predicate_gen(): typeof import("../../rustc_type_ir/predicate.gen.ts") {
  return require("../../rustc_type_ir/predicate.gen.ts") as typeof import("../../rustc_type_ir/predicate.gen.ts");
}
function ir_predicate(): typeof import("../../rustc_type_ir/predicate.ts") {
  return require("../../rustc_type_ir/predicate.ts") as typeof import("../../rustc_type_ir/predicate.ts");
}
function pattern_gen(): typeof import("../../rustc_type_ir/pattern.gen.ts") {
  return require("../../rustc_type_ir/pattern.gen.ts") as typeof import("../../rustc_type_ir/pattern.gen.ts");
}
function opaque_ty_gen(): typeof import("../../rustc_type_ir/opaque_ty.gen.ts") {
  return require("../../rustc_type_ir/opaque_ty.gen.ts") as typeof import("../../rustc_type_ir/opaque_ty.gen.ts");
}
function const_kind_gen(): typeof import("../../rustc_type_ir/const_kind.gen.ts") {
  return require("../../rustc_type_ir/const_kind.gen.ts") as typeof import("../../rustc_type_ir/const_kind.gen.ts");
}
function ir_fold(): typeof import("../../rustc_type_ir/fold.ts") {
  return require("../../rustc_type_ir/fold.ts") as typeof import("../../rustc_type_ir/fold.ts");
}
function ir_visit(): typeof import("../../rustc_type_ir/visit.ts") {
  return require("../../rustc_type_ir/visit.ts") as typeof import("../../rustc_type_ir/visit.ts");
}
function pretty(): typeof import("./print/pretty.ts") {
  return require("./print/pretty.ts") as typeof import("./print/pretty.ts");
}
function tls(): typeof import("./context/tls.ts") {
  return require("./context/tls.ts") as typeof import("./context/tls.ts");
}
function adjustment_gen(): typeof import("./adjustment.gen.ts") {
  return require("./adjustment.gen.ts") as typeof import("./adjustment.gen.ts");
}

// ---- PORT stand-ins for items of other lanes' files that are not ported yet ----------------------------------------

/** PORT: stand-in for the fields of `ty::TraitDef` read here (ty/trait_def.rs, lane ty-adt-assoc). */
interface TraitDefShape {
  def_id: DefId;
}
/** PORT: stand-in for the fields of `ty::UpvarId` read here (ty/closure.rs, lane ty-adt-assoc). */
interface UpvarIdShape {
  var_path: { hir_id: HirId };
  closure_expr_id: LocalDefId;
}
/** PORT: stand-in for `AdtDef::did` (ty/adt.rs, lane ty-adt-assoc). */
function AdtDef_did(_self: AdtDef): DefId {
  return unported("rustc_middle::ty::adt::AdtDef::did (lane ty-adt-assoc)");
}
/** PORT: stand-in for `Deref for Pattern` (`*self`, the interned `PatternKind`; ty/pattern.rs, not ported yet). */
function Pattern_deref(_self: Pattern): PatternKind {
  return unported("rustc_middle::ty::Pattern: Deref (ty/pattern.rs not ported yet)");
}
/** PORT: stand-ins for the derived `Debug` of `mir::BinOp` / `mir::UnOp` (mir/syntax.rs, M4) and
 *  `ty::abstract_const::CastKind` (pending in decls.ts). */
function debug_BinOp(_v: BinOp): string {
  return unported("rustc_middle::mir::BinOp: Debug (M4)");
}
function debug_UnOp(_v: UnOp): string {
  return unported("rustc_middle::mir::UnOp: Debug (M4)");
}
function debug_CastKind(_v: CastKind): string {
  return unported("rustc_middle::ty::abstract_const::CastKind: Debug (pending)");
}
/** PORT: stand-in for the `TypeFoldable`/`TypeVisitable` impls of `mir::PlaceElem` (mir/syntax.rs, M4). */
const fold_PlaceElem: TypeFoldable<PlaceElem> = {
  try_fold_with(_self, _folder) {
    return unported("rustc_middle::mir::PlaceElem: TypeFoldable (M4)");
  },
  fold_with(_self, _folder) {
    return unported("rustc_middle::mir::PlaceElem: TypeFoldable (M4)");
  },
  visit_with(_self, _visitor) {
    return unported("rustc_middle::mir::PlaceElem: TypeVisitable (M4)");
  },
};
/** PORT: stand-in for `impl UpcastFrom<TyCtxt, PolyProjectionClause> for Predicate` (ty/predicate.rs:575, lane ty-args),
 *  upstream's body. */
function Predicate_upcast_from_PolyProjectionClause(from: Binder<ProjectionClause>, tcx: TyCtxt): Predicate {
  return tcx.mk_predicate(binder().Binder.map_bound(from, (p): PredicateKind => ({ $: "Clause", _0: { $: "Projection", _0: p } })));
}
/** PORT: stand-in for `impl<T: TypeVisitable> TypeVisitable for &List<T>` (ty/generic_args.rs:714, lane ty-args),
 *  upstream's body: `walk_visitable_list!(visitor, self.iter()); V::Result::output()`. */
export function visit_List<T>(d_T: TypeVisitable<T>): TypeVisitable<List<T>> {
  return {
    visit_with<R>(self: List<T>, visitor: TypeVisitor<R>): R {
      let r: R | undefined;
      for (const t of self) {
        if ((r = try_visit(visitor.Result, d_T.visit_with(t, visitor))) !== undefined) return r;
      }
      return visitor.Result.output();
    },
  };
}

/// Does the equivalent of
/// ```ignore (illustrative)
/// let v = self.iter().map(|p| p.fold_with(folder)).collect::<SmallVec<[_; 8]>>();
/// folder.tcx().intern_*(&v)
/// ```
/** PORT: stand-in for `ty::util::fold_list` (ty/util.rs:1607, lane ty-util), upstream's body. `T: PartialEq` is the
 *  intern key (identity for interned elements). */
export function fold_list<L extends readonly T[], T>(list: L, folder: TypeFolder, intern: (tcx: TyCtxt, v: readonly T[]) => L, d_T: TypeFoldable<T>): L {
  const slice = list;
  // Look for the first element that changed
  let i = 0;
  for (; i < slice.length; i++) {
    const t = slice[i]!;
    const new_t = d_T.fold_with(t, folder);
    if (!T_eq(new_t, t)) {
      // An element changed, prepare to intern the resulting list
      const new_list: T[] = slice.slice(0, i);
      new_list.push(new_t);
      for (let j = i + 1; j < slice.length; j++) {
        new_list.push(d_T.fold_with(slice[j]!, folder));
      }
      return intern(folder.cx(), new_list);
    }
  }
  return list;
}

/** PORT: stand-in for `ty::util::try_fold_list` (ty/util.rs:1643, lane ty-util), upstream's body. */
export function try_fold_list<L extends readonly T[], T, E>(list: L, folder: FallibleTypeFolder<E>, intern: (tcx: TyCtxt, v: readonly T[]) => L, d_T: TypeFoldable<T>): Result<L, E> {
  const slice = list;
  // Look for the first element that changed
  for (let i = 0; i < slice.length; i++) {
    const t = slice[i]!;
    const new_t = d_T.try_fold_with(t, folder);
    if (new_t.$ === "Ok" && T_eq(new_t._0, t)) continue;
    if (new_t.$ === "Err") {
      return new_t;
    }
    // An element changed, prepare to intern the resulting list
    const new_list: T[] = slice.slice(0, i);
    new_list.push(new_t._0);
    for (let j = i + 1; j < slice.length; j++) {
      const r = d_T.try_fold_with(slice[j]!, folder);
      if (r.$ === "Err") return r;
      new_list.push(r._0);
    }
    return Ok(intern(folder.cx(), new_list));
  }
  return Ok(list);
}

/** `T: PartialEq` of a list element: interned values by identity, others by their derived `PartialEq` (intern key). */
function T_eq<T>(a: T, b: T): boolean {
  return a === b || intern_key(a) === intern_key(b);
}

// ---- Debug impls (structural_impls.rs:22-152) ----

/** Formats a `fmt::Result`-returning printer run, as `?` + `f.write_str(&s)` (Debug convention: the text). */
function print_def_path_string(def_id: DefId): string {
  return tls().with_((tcx) => {
    const { with_no_trimmed_paths, FmtPrinter } = pretty();
    return with_no_trimmed_paths(() => {
      const s = FmtPrinter.print_string(tcx, "TypeNS" as Namespace, (p) => p.print_def_path(def_id, []));
      if (s.$ === "Err") return panic("a Display implementation returned an error unexpectedly: Error");
      return s._0;
    });
  });
}

// rustc: compiler/rustc_middle/src/ty/structural_impls.rs:23 fmt
export const debug_TraitDef: Debug<TraitDefShape> = (self, _f) => {
  return print_def_path_string(self.def_id);
};

// rustc: compiler/rustc_middle/src/ty/structural_impls.rs:36 fmt
export const debug_AdtDef: Debug<AdtDef> = (self, _f) => {
  return print_def_path_string(AdtDef_did(self));
};

// rustc: compiler/rustc_middle/src/ty/structural_impls.rs:49 fmt
export const debug_UpvarId: Debug<UpvarIdShape> = (self, _f) => {
  const name = tls().with_((tcx) => tcx.hir_name(self.var_path.hir_id));
  return `UpvarId(${debug_HirId(self.var_path.hir_id, PLAIN)};\`${display_Symbol(name)}\`;${debug_LocalDefId(self.closure_expr_id, PLAIN)})`;
};

// rustc: compiler/rustc_middle/src/ty/structural_impls.rs:56 fmt
export const debug_Adjustment: Debug<Adjustment> = (self, _f) => {
  return `${adjustment_gen().debug_Adjust(self.kind, PLAIN)} -> ${pretty().display_Ty(self.target)}`;
};

// rustc: compiler/rustc_middle/src/ty/structural_impls.rs:62 fmt
export const debug_PatAdjustment: Debug<PatAdjustment> = (self, _f) => {
  return `${pretty().display_Ty(self.source)} -> ${adjustment_gen().debug_PatAdjust(self.kind, PLAIN)}`;
};

// rustc: compiler/rustc_middle/src/ty/structural_impls.rs:68 fmt
export const debug_LateParamRegionKind: Debug<LateParamRegionKind> = (self, _f) => {
  switch (self.$) {
    case "Anon":
      return `LateAnon(${self._0})`;
    case "NamedAnon":
      return `LateNamedAnon(${self._0}, ${display_Symbol(self._1)})`;
    case "Named": {
      const { debug_DefId } = require("../../rustc_span/def_id.ts") as typeof import("../../rustc_span/def_id.ts");
      return `LateNamed(${debug_DefId(self._0, PLAIN)})`;
    }
    case "ClosureEnv":
      return "LateEnv";
  }
};

// rustc: compiler/rustc_middle/src/ty/structural_impls.rs:83 fmt
export const debug_Ty: Debug<Ty> = (self, f) => {
  return pretty().with_no_trimmed_paths(() => ty_kind().debug_TyKind(self.kind(), f));
};

// rustc: compiler/rustc_middle/src/ty/structural_impls.rs:89 fmt
export const debug_ParamTy: Debug<ParamTy> = (self, _f) => {
  return `${display_Symbol(self.name)}/#${self.index}`;
};

// rustc: compiler/rustc_middle/src/ty/structural_impls.rs:95 fmt
export const debug_ParamConst: Debug<ParamConst> = (self, _f) => {
  return `${display_Symbol(self.name)}/#${self.index}`;
};

// rustc: compiler/rustc_middle/src/ty/structural_impls.rs:101 fmt
export const debug_Predicate: Debug<Predicate> = (self, _f) => {
  return binder().debug_Binder(self.kind(), PLAIN, predicate_kind().debug_PredicateKind);
};

// rustc: compiler/rustc_middle/src/ty/structural_impls.rs:107 fmt
export const debug_Clause: Debug<Clause> = (self, _f) => {
  return binder().debug_Binder(self.kind(), PLAIN, predicate_kind().debug_ClauseKind);
};

// rustc: compiler/rustc_middle/src/ty/structural_impls.rs:113 fmt
export const debug_Expr: Debug<Expr> = (self, _f) => {
  const { Expr } = require("./consts/kind.ts") as typeof import("./consts/kind.ts");
  const { debug_Const } = sty_consts();
  const k = self.kind;
  switch (k.$) {
    case "Binop": {
      const op = k._0;
      const [lhs_ty, rhs_ty, lhs, rhs] = Expr.binop_args(self);
      return `(${debug_BinOp(op)}: (${debug_Const(lhs, PLAIN)}: ${debug_Ty(lhs_ty, PLAIN)}), (${debug_Const(rhs, PLAIN)}: ${debug_Ty(rhs_ty, PLAIN)}))`;
    }
    case "UnOp": {
      const op = k._0;
      const [rhs_ty, rhs] = Expr.unop_args(self);
      return `(${debug_UnOp(op)}: (${debug_Const(rhs, PLAIN)}: ${debug_Ty(rhs_ty, PLAIN)}))`;
    }
    case "FunctionCall": {
      const [func_ty, func, args_] = Expr.call_args(self);
      const args = [...args_];
      let out = `(${debug_Const(func, PLAIN)}: ${debug_Ty(func_ty, PLAIN)})(`;
      for (const arg of args.slice(0, Math.max(args.length - 1, 0))) {
        out += `${debug_Const(arg, PLAIN)}, `;
      }
      const last = args[args.length - 1];
      if (last !== undefined) {
        out += debug_Const(last, PLAIN);
      }

      out += ")";
      return out;
    }
    case "Cast": {
      const kind = k._0;
      const [value_ty, value, to_ty] = Expr.cast_args(self);
      return `(${debug_CastKind(kind)}: (${debug_Const(value, PLAIN)}: ${debug_Ty(value_ty, PLAIN)}), ${debug_Ty(to_ty, PLAIN)})`;
    }
  }
};

// rustc: compiler/rustc_middle/src/ty/structural_impls.rs:145 fmt
export const debug_GenericArg: Debug<GenericArg> = (self, f) => {
  const k = generic_args().GenericArg.kind(self);
  switch (k.$) {
    case "Lifetime":
      return sty_mod().debug_Region(k._0, f);
    case "Type":
      return debug_Ty(k._0, f);
    case "Const":
      return sty_consts().debug_Const(k._0, f);
  }
};

///////////////////////////////////////////////////////////////////////////
// Atomic structs
//
// For things that don't carry any arena-allocated data (and are
// copy...), just add them to one of these lists as appropriate.
// (TrivialLiftImpls! / TrivialTypeTraversalImpls! / TrivialTypeTraversalAndLiftImpls!: module comment.)

///////////////////////////////////////////////////////////////////////////
// Lift implementations

// rustc-skip: compiler/rustc_middle/src/ty/structural_impls.rs:259 lift_to_interner Lift (PORTING §3)
// rustc-skip: compiler/rustc_middle/src/ty/structural_impls.rs:266 lift_to_interner Lift (PORTING §3)
// rustc-skip: compiler/rustc_middle/src/ty/structural_impls.rs:273 lift_to_interner Lift (PORTING §3)

///////////////////////////////////////////////////////////////////////////
// Traversal implementations.

/** `impl TypeVisitable for ty::AdtDef` (no `TypeFoldable` impl). */
export const visit_AdtDef: TypeVisitable<AdtDef> = {
  // rustc: compiler/rustc_middle/src/ty/structural_impls.rs:285 visit_with
  visit_with<R>(_self: AdtDef, visitor: TypeVisitor<R>): R {
    return visitor.Result.output();
  },
};

/** `impl TypeFoldable for Pattern` + `impl TypeVisitable for Pattern`. */
export const fold_Pattern: TypeFoldable<Pattern> = {
  // rustc: compiler/rustc_middle/src/ty/structural_impls.rs:291 try_fold_with
  try_fold_with<E>(self: Pattern, folder: FallibleTypeFolder<E>): Result<Pattern, E> {
    const pat = pattern_gen().try_fold_with_PatternKind(Pattern_deref(self), folder);
    if (pat.$ === "Err") return pat;
    return Ok(intern_key(pat._0) === intern_key(Pattern_deref(self)) ? self : folder.cx().mk_pat(pat._0));
  },

  // rustc: compiler/rustc_middle/src/ty/structural_impls.rs:299 fold_with
  fold_with(self: Pattern, folder: TypeFolder): Pattern {
    const pat = pattern_gen().fold_with_PatternKind(Pattern_deref(self), folder);
    return intern_key(pat) === intern_key(Pattern_deref(self)) ? self : folder.cx().mk_pat(pat);
  },

  // rustc: compiler/rustc_middle/src/ty/structural_impls.rs:306 visit_with
  visit_with<R>(self: Pattern, visitor: TypeVisitor<R>): R {
    return pattern_gen().visit_with_PatternKind(Pattern_deref(self), visitor);
  },
};

/** The derived `PartialEq` of `TyKind` (`*self.kind() == kind`): equal intern keys (interned children by identity). */
function TyKind_eq(a: TyKind, b: TyKind): boolean {
  return intern_key(a) === intern_key(b);
}

/** `TypeFoldable` of the `I::BoundExistentialPredicates` field (`list_fold!` below), as a descriptor. */
const fold_BoundExistentialPredicates_: TypeFoldable<BoundExistentialPredicates> = {
  try_fold_with: (self, folder) => fold_BoundExistentialPredicates.try_fold_with(self, folder),
  fold_with: (self, folder) => fold_BoundExistentialPredicates.fold_with(self, folder),
  visit_with: (self, visitor) => fold_BoundExistentialPredicates.visit_with(self, visitor),
};
/** `ty_kind.rs` generated `FnSigTys` impls as a descriptor (for `Binder<FnSigTys>`). */
function fold_FnSigTys(): TypeFoldable<import("../../rustc_type_ir/ty_kind.gen.ts").FnSigTys> {
  const g = ty_kind_gen();
  return { try_fold_with: g.try_fold_with_FnSigTys, fold_with: g.fold_with_FnSigTys, visit_with: g.visit_with_FnSigTys };
}
/** `Alias<AliasTyKind>` generated impls (rustc_type_ir ty/alias.rs). */
function fold_AliasTy(): TypeFoldable<import("../../rustc_type_ir/ty/alias.gen.ts").Alias<AliasTyKind>> {
  const a = alias();
  const g = ty_kind_gen();
  return {
    try_fold_with: (self, folder) => a.try_fold_with_Alias(self, folder, g.try_fold_with_AliasTyKind),
    fold_with: (self, folder) => a.fold_with_Alias(self, folder, g.fold_with_AliasTyKind),
    visit_with: (self, visitor) => a.visit_with_Alias(self, visitor, g.visit_with_AliasTyKind),
  };
}

/** D4 descriptor of `Ty`: `impl TypeFoldable` (:311), `TypeVisitable` (:324), `TypeSuperFoldable` (:330),
 *  `TypeSuperVisitable` (:419), and `Flags` (rustc_type_ir `impl Flags for I::Ty`: the cached type info). */
export const fold_Ty: TypeSuperFoldable<Ty> & TypeSuperVisitable<Ty> & Flags<Ty> = {
  // rustc: compiler/rustc_middle/src/ty/structural_impls.rs:312 try_fold_with
  try_fold_with<E>(self: Ty, folder: FallibleTypeFolder<E>): Result<Ty, E> {
    return folder.try_fold_ty(self);
  },

  // rustc: compiler/rustc_middle/src/ty/structural_impls.rs:319 fold_with
  fold_with(self: Ty, folder: TypeFolder): Ty {
    return folder.fold_ty(self);
  },

  // rustc: compiler/rustc_middle/src/ty/structural_impls.rs:325 visit_with
  visit_with<R>(self: Ty, visitor: TypeVisitor<R>): R {
    return visitor.visit_ty(self);
  },

  // rustc: compiler/rustc_middle/src/ty/structural_impls.rs:331 try_super_fold_with
  try_super_fold_with<E>(self: Ty, folder: FallibleTypeFolder<E>): Result<Ty, E> {
    const k = self.kind();
    let kind: TyKind;
    switch (k.$) {
      case "RawPtr": {
        const ty = fold_Ty.try_fold_with(k._0, folder);
        if (ty.$ === "Err") return ty;
        kind = { $: "RawPtr", _0: ty._0, _1: k._1 };
        break;
      }
      case "Array": {
        const typ = fold_Ty.try_fold_with(k._0, folder);
        if (typ.$ === "Err") return typ;
        const sz = sty_consts().fold_Const.try_fold_with(k._1, folder);
        if (sz.$ === "Err") return sz;
        kind = { $: "Array", _0: typ._0, _1: sz._0 };
        break;
      }
      case "Slice": {
        const typ = fold_Ty.try_fold_with(k._0, folder);
        if (typ.$ === "Err") return typ;
        kind = { $: "Slice", _0: typ._0 };
        break;
      }
      case "Adt": {
        const args = generic_args().fold_GenericArgs.try_fold_with(k._1, folder);
        if (args.$ === "Err") return args;
        kind = { $: "Adt", _0: k._0, _1: args._0 };
        break;
      }
      case "Dynamic": {
        const trait_ty = fold_BoundExistentialPredicates_.try_fold_with(k._0, folder);
        if (trait_ty.$ === "Err") return trait_ty;
        const region = sty_mod().fold_Region.try_fold_with(k._1, folder);
        if (region.$ === "Err") return region;
        kind = { $: "Dynamic", _0: trait_ty._0, _1: region._0 };
        break;
      }
      case "Tuple": {
        const ts = generic_args().fold_List_Ty.try_fold_with(k._0, folder);
        if (ts.$ === "Err") return ts;
        kind = { $: "Tuple", _0: ts._0 };
        break;
      }
      case "FnDef": {
        const args = binder().fold_Binder(generic_args().fold_GenericArgs).try_fold_with(k._1, folder);
        if (args.$ === "Err") return args;
        kind = { $: "FnDef", _0: k._0, _1: args._0 };
        break;
      }
      case "FnPtr": {
        const sig_tys = binder().fold_Binder(fold_FnSigTys()).try_fold_with(k._0, folder);
        if (sig_tys.$ === "Err") return sig_tys;
        kind = { $: "FnPtr", _0: sig_tys._0, _1: k._1 };
        break;
      }
      case "UnsafeBinder": {
        const f = ty_kind_gen().try_fold_with_UnsafeBinderInner(k._0, folder);
        if (f.$ === "Err") return f;
        kind = { $: "UnsafeBinder", _0: f._0 };
        break;
      }
      case "Ref": {
        const r = sty_mod().fold_Region.try_fold_with(k._0, folder);
        if (r.$ === "Err") return r;
        const ty = fold_Ty.try_fold_with(k._1, folder);
        if (ty.$ === "Err") return ty;
        kind = { $: "Ref", _0: r._0, _1: ty._0, _2: k._2 };
        break;
      }
      case "Coroutine": {
        const args = generic_args().fold_GenericArgs.try_fold_with(k._1, folder);
        if (args.$ === "Err") return args;
        kind = { $: "Coroutine", _0: k._0, _1: args._0 };
        break;
      }
      case "CoroutineWitness": {
        const args = generic_args().fold_GenericArgs.try_fold_with(k._1, folder);
        if (args.$ === "Err") return args;
        kind = { $: "CoroutineWitness", _0: k._0, _1: args._0 };
        break;
      }
      case "Closure": {
        const args = generic_args().fold_GenericArgs.try_fold_with(k._1, folder);
        if (args.$ === "Err") return args;
        kind = { $: "Closure", _0: k._0, _1: args._0 };
        break;
      }
      case "CoroutineClosure": {
        const args = generic_args().fold_GenericArgs.try_fold_with(k._1, folder);
        if (args.$ === "Err") return args;
        kind = { $: "CoroutineClosure", _0: k._0, _1: args._0 };
        break;
      }
      case "Alias": {
        const data = fold_AliasTy().try_fold_with(k._1, folder);
        if (data.$ === "Err") return data;
        kind = { $: "Alias", _0: k._0, _1: data._0 };
        break;
      }
      case "Pat": {
        const ty = fold_Ty.try_fold_with(k._0, folder);
        if (ty.$ === "Err") return ty;
        const pat = fold_Pattern.try_fold_with(k._1, folder);
        if (pat.$ === "Err") return pat;
        kind = { $: "Pat", _0: ty._0, _1: pat._0 };
        break;
      }

      case "Bool":
      case "Char":
      case "Str":
      case "Int":
      case "Uint":
      case "Float":
      case "Error":
      case "Infer":
      case "Param":
      case "Bound":
      case "Placeholder":
      case "Never":
      case "Foreign":
        return Ok(self);
    }

    return Ok(TyKind_eq(self.kind(), kind) ? self : folder.cx().mk_ty_from_kind(kind));
  },

  // rustc: compiler/rustc_middle/src/ty/structural_impls.rs:379 super_fold_with
  super_fold_with(self: Ty, folder: TypeFolder): Ty {
    const k = self.kind();
    let kind: TyKind;
    switch (k.$) {
      case "RawPtr":
        kind = { $: "RawPtr", _0: fold_Ty.fold_with(k._0, folder), _1: k._1 };
        break;
      case "Array":
        kind = { $: "Array", _0: fold_Ty.fold_with(k._0, folder), _1: sty_consts().fold_Const.fold_with(k._1, folder) };
        break;
      case "Slice":
        kind = { $: "Slice", _0: fold_Ty.fold_with(k._0, folder) };
        break;
      case "Adt":
        kind = { $: "Adt", _0: k._0, _1: generic_args().fold_GenericArgs.fold_with(k._1, folder) };
        break;
      case "Dynamic":
        kind = { $: "Dynamic", _0: fold_BoundExistentialPredicates_.fold_with(k._0, folder), _1: sty_mod().fold_Region.fold_with(k._1, folder) };
        break;
      case "Tuple":
        kind = { $: "Tuple", _0: generic_args().fold_List_Ty.fold_with(k._0, folder) };
        break;
      case "FnDef":
        kind = { $: "FnDef", _0: k._0, _1: binder().fold_Binder(generic_args().fold_GenericArgs).fold_with(k._1, folder) };
        break;
      case "FnPtr":
        kind = { $: "FnPtr", _0: binder().fold_Binder(fold_FnSigTys()).fold_with(k._0, folder), _1: k._1 };
        break;
      case "UnsafeBinder":
        kind = { $: "UnsafeBinder", _0: ty_kind_gen().fold_with_UnsafeBinderInner(k._0, folder) };
        break;
      case "Ref":
        kind = { $: "Ref", _0: sty_mod().fold_Region.fold_with(k._0, folder), _1: fold_Ty.fold_with(k._1, folder), _2: k._2 };
        break;
      case "Coroutine":
        kind = { $: "Coroutine", _0: k._0, _1: generic_args().fold_GenericArgs.fold_with(k._1, folder) };
        break;
      case "CoroutineWitness":
        kind = { $: "CoroutineWitness", _0: k._0, _1: generic_args().fold_GenericArgs.fold_with(k._1, folder) };
        break;
      case "Closure":
        kind = { $: "Closure", _0: k._0, _1: generic_args().fold_GenericArgs.fold_with(k._1, folder) };
        break;
      case "CoroutineClosure":
        kind = { $: "CoroutineClosure", _0: k._0, _1: generic_args().fold_GenericArgs.fold_with(k._1, folder) };
        break;
      case "Alias":
        kind = { $: "Alias", _0: k._0, _1: fold_AliasTy().fold_with(k._1, folder) };
        break;
      case "Pat":
        kind = { $: "Pat", _0: fold_Ty.fold_with(k._0, folder), _1: fold_Pattern.fold_with(k._1, folder) };
        break;

      case "Bool":
      case "Char":
      case "Str":
      case "Int":
      case "Uint":
      case "Float":
      case "Error":
      case "Infer":
      case "Param":
      case "Bound":
      case "Placeholder":
      case "Never":
      case "Foreign":
        return self;
    }

    return TyKind_eq(self.kind(), kind) ? self : folder.cx().mk_ty_from_kind(kind);
  },

  // rustc: compiler/rustc_middle/src/ty/structural_impls.rs:420 super_visit_with
  super_visit_with<R>(self: Ty, visitor: TypeVisitor<R>): R {
    const k = self.kind();
    let r: R | undefined;
    switch (k.$) {
      case "RawPtr":
        return fold_Ty.visit_with(k._0, visitor);
      case "Array": {
        if ((r = try_visit(visitor.Result, fold_Ty.visit_with(k._0, visitor))) !== undefined) return r;
        return sty_consts().fold_Const.visit_with(k._1, visitor);
      }
      case "Slice":
        return fold_Ty.visit_with(k._0, visitor);
      case "Adt":
        return generic_args().fold_GenericArgs.visit_with(k._1, visitor);
      case "Dynamic": {
        if ((r = try_visit(visitor.Result, fold_BoundExistentialPredicates_.visit_with(k._0, visitor))) !== undefined) return r;
        return sty_mod().fold_Region.visit_with(k._1, visitor);
      }
      case "Tuple":
        return generic_args().fold_List_Ty.visit_with(k._0, visitor);
      case "FnDef":
        return binder().fold_Binder(generic_args().fold_GenericArgs).visit_with(k._1, visitor);
      case "FnPtr":
        return binder().fold_Binder(fold_FnSigTys()).visit_with(k._0, visitor);
      case "UnsafeBinder":
        return ty_kind_gen().visit_with_UnsafeBinderInner(k._0, visitor);
      case "Ref": {
        if ((r = try_visit(visitor.Result, sty_mod().fold_Region.visit_with(k._0, visitor))) !== undefined) return r;
        return fold_Ty.visit_with(k._1, visitor);
      }
      case "Coroutine":
        return generic_args().fold_GenericArgs.visit_with(k._1, visitor);
      case "CoroutineWitness":
        return generic_args().fold_GenericArgs.visit_with(k._1, visitor);
      case "Closure":
        return generic_args().fold_GenericArgs.visit_with(k._1, visitor);
      case "CoroutineClosure":
        return generic_args().fold_GenericArgs.visit_with(k._1, visitor);
      case "Alias":
        return fold_AliasTy().visit_with(k._1, visitor);

      case "Pat": {
        if ((r = try_visit(visitor.Result, fold_Ty.visit_with(k._0, visitor))) !== undefined) return r;
        return fold_Pattern.visit_with(k._1, visitor);
      }

      case "Error":
        return fold_ErrorGuaranteed.visit_with(k._0, visitor);

      case "Bool":
      case "Char":
      case "Str":
      case "Int":
      case "Uint":
      case "Float":
      case "Infer":
      case "Bound":
      case "Placeholder":
      case "Param":
      case "Never":
      case "Foreign":
        return visitor.Result.output();
    }
  },

  // `impl Flags for Ty` (the cached type info; rustc_type_ir flags.rs / ty/mod.ts)
  flags(self: Ty) {
    return self.flags();
  },
  outer_exclusive_binder(self: Ty) {
    return self.outer_exclusive_binder();
  },
};

/** `TypeFoldable` of a `Binder<PredicateKind>` / `Binder<ClauseKind>` (the generated kind impls in a descriptor). */
function fold_PredicateKind(): TypeFoldable<PredicateKind> {
  const g = predicate_kind_gen();
  return { try_fold_with: g.try_fold_with_PredicateKind, fold_with: g.fold_with_PredicateKind, visit_with: g.visit_with_PredicateKind };
}

/** D4 descriptor of `ty::Predicate`: `TypeFoldable` (:470), `PredicateProxy` (:483), `TypeVisitable` (:577),
 *  `TypeSuperFoldable` (:589), `TypeSuperVisitable` (:611). */
export const fold_Predicate: PredicateProxy<Predicate> & TypeFoldable<Predicate> = {
  // rustc: compiler/rustc_middle/src/ty/structural_impls.rs:471 try_fold_with
  try_fold_with<E>(self: Predicate, folder: FallibleTypeFolder<E>): Result<Predicate, E> {
    return folder.try_fold_predicate(self, fold_Predicate);
  },

  // rustc: compiler/rustc_middle/src/ty/structural_impls.rs:478 fold_with
  fold_with(self: Predicate, folder: TypeFolder): Predicate {
    return folder.fold_predicate(self, fold_Predicate);
  },

  // rustc: compiler/rustc_middle/src/ty/structural_impls.rs:484 allow_normalization
  allow_normalization(self: Predicate): boolean {
    // `rustc_type_ir::inherent::Predicate::allow_normalization(*self)`: the inherent method of the same body
    // (ty/predicate.rs, `impl inherent::Predicate for Predicate`).
    return self.allow_normalization();
  },

  // rustc: compiler/rustc_middle/src/ty/structural_impls.rs:488 map_projection
  map_projection(self: Predicate, tcx: TyCtxt, f: (b: Binder<ProjectionClause>) => Binder<ProjectionClause>): Predicate | undefined {
    const kind = self.as_projection_clause();
    return kind === undefined ? undefined : Predicate_upcast_from_PolyProjectionClause(f(kind), tcx);
  },

  // rustc: compiler/rustc_middle/src/ty/structural_impls.rs:496 clause_kind_unchecked
  clause_kind_unchecked(self: Predicate): Binder<ClauseKind> | undefined {
    const clause = self.as_clause();
    return clause === undefined ? undefined : clause.kind();
  },

  // rustc: compiler/rustc_middle/src/ty/structural_impls.rs:578 visit_with
  visit_with<R>(self: Predicate, visitor: TypeVisitor<R>): R {
    return visitor.visit_predicate(self, fold_Predicate);
  },

  // rustc: compiler/rustc_middle/src/ty/structural_impls.rs:590 try_super_fold_with
  try_super_fold_with<E>(self: Predicate, folder: FallibleTypeFolder<E>): Result<Predicate, E> {
    // This method looks different to `Ty::try_super_fold_with` and `Const::super_fold_with`.
    // Why is that? `PredicateKind` provides little scope for optimized folding, unlike
    // `TyKind` and `ConstKind` (which have common variants that don't require recursive
    // `fold_with` calls on their fields). So we just derive the `TypeFoldable` impl for
    // `PredicateKind` and call it here because the derived code is as fast as hand-written
    // code would be.
    const new_ = binder().fold_Binder(fold_PredicateKind()).try_fold_with(self.kind(), folder);
    if (new_.$ === "Err") return new_;
    return Ok(folder.cx().reuse_or_mk_predicate(self, new_._0));
  },

  // rustc: compiler/rustc_middle/src/ty/structural_impls.rs:604 super_fold_with
  super_fold_with(self: Predicate, folder: TypeFolder): Predicate {
    // See comment in `Predicate::try_super_fold_with`.
    const new_ = binder().fold_Binder(fold_PredicateKind()).fold_with(self.kind(), folder);
    return folder.cx().reuse_or_mk_predicate(self, new_);
  },

  // rustc: compiler/rustc_middle/src/ty/structural_impls.rs:612 super_visit_with
  super_visit_with<R>(self: Predicate, visitor: TypeVisitor<R>): R {
    // See comment in `Predicate::try_super_fold_with`.
    return binder().fold_Binder(fold_PredicateKind()).visit_with(self.kind(), visitor);
  },

  // `impl Flags for Predicate` (the cached type info)
  flags: {
    flags: (self: Predicate) => self.flags(),
    outer_exclusive_binder: (self: Predicate) => self.outer_exclusive_binder(),
  },
};

// FIXME(clause): This is wonky
/** D4 descriptor of `ty::Clause`: `TypeFoldable` (:502), `TypeSuperFoldable` (:516), `TypeSuperVisitable` (:537),
 *  `PredicateProxy` (:546), `TypeVisitable` (:583). */
export const fold_Clause: PredicateProxy<Clause> & TypeFoldable<Clause> = {
  // rustc: compiler/rustc_middle/src/ty/structural_impls.rs:503 try_fold_with
  try_fold_with<E>(self: Clause, folder: FallibleTypeFolder<E>): Result<Clause, E> {
    const r = folder.try_fold_predicate(self, fold_Clause);
    if (r.$ === "Err") return r;
    return Ok(r._0);
  },

  // rustc: compiler/rustc_middle/src/ty/structural_impls.rs:510 fold_with
  fold_with(self: Clause, folder: TypeFolder): Clause {
    return folder.fold_predicate(self, fold_Clause);
  },

  // follow `Predicate`'s implementation (by deferring to it)
  // rustc: compiler/rustc_middle/src/ty/structural_impls.rs:517 try_super_fold_with
  try_super_fold_with<E>(self: Clause, folder: FallibleTypeFolder<E>): Result<Clause, E> {
    const r = fold_Predicate.try_super_fold_with(self.as_predicate(), folder);
    if (r.$ === "Err") return r;
    return Ok(r._0.expect_clause());
  },

  // rustc: compiler/rustc_middle/src/ty/structural_impls.rs:528 super_fold_with
  super_fold_with(self: Clause, folder: TypeFolder): Clause {
    return fold_Predicate.super_fold_with(self.as_predicate(), folder).expect_clause();
  },

  // rustc: compiler/rustc_middle/src/ty/structural_impls.rs:538 super_visit_with
  super_visit_with<R>(self: Clause, visitor: TypeVisitor<R>): R {
    return fold_Predicate.super_visit_with(self.as_predicate(), visitor);
  },

  // rustc: compiler/rustc_middle/src/ty/structural_impls.rs:547 allow_normalization
  allow_normalization(self: Clause): boolean {
    return self.as_predicate().allow_normalization();
  },

  // rustc: compiler/rustc_middle/src/ty/structural_impls.rs:551 map_projection
  map_projection(self: Clause, tcx: TyCtxt, f: (b: Binder<ProjectionClause>) => Binder<ProjectionClause>): Clause | undefined {
    const kind = self.as_projection_clause();
    return kind === undefined ? undefined : ir_predicate().Clause_upcast_from_PolyProjectionClause(f(kind), tcx);
  },

  // rustc: compiler/rustc_middle/src/ty/structural_impls.rs:559 clause_kind_unchecked
  clause_kind_unchecked(self: Clause): Binder<ClauseKind> | undefined {
    return self.kind();
  },

  // rustc: compiler/rustc_middle/src/ty/structural_impls.rs:584 visit_with
  visit_with<R>(self: Clause, visitor: TypeVisitor<R>): R {
    return visitor.visit_predicate(self.as_predicate(), fold_Predicate);
  },

  // `impl Flags for Clause` (the cached type info of its predicate)
  flags: {
    flags: (self: Clause) => self.as_predicate().flags(),
    outer_exclusive_binder: (self: Clause) => self.as_predicate().outer_exclusive_binder(),
  },
};

/** D4 descriptor of `ty::Clauses`: `TypeFoldable` (:564), `TypeVisitable` (:618), `TypeSuperVisitable` (:624),
 *  `TypeSuperFoldable` (:630), and `Flags` (`ListWithCachedTypeInfo`'s cached info). */
export const fold_Clauses: TypeSuperFoldable<Clauses> & TypeSuperVisitable<Clauses> & Flags<Clauses> = {
  // rustc: compiler/rustc_middle/src/ty/structural_impls.rs:565 try_fold_with
  try_fold_with<E>(self: Clauses, folder: FallibleTypeFolder<E>): Result<Clauses, E> {
    return folder.try_fold_clauses(self);
  },

  // rustc: compiler/rustc_middle/src/ty/structural_impls.rs:572 fold_with
  fold_with(self: Clauses, folder: TypeFolder): Clauses {
    return folder.fold_clauses(self);
  },

  // rustc: compiler/rustc_middle/src/ty/structural_impls.rs:619 visit_with
  visit_with<R>(self: Clauses, visitor: TypeVisitor<R>): R {
    return visitor.visit_clauses(self);
  },

  // rustc: compiler/rustc_middle/src/ty/structural_impls.rs:625 super_visit_with
  super_visit_with<R>(self: Clauses, visitor: TypeVisitor<R>): R {
    return ir_visit().visit_with_slice(self.as_slice(), visitor, fold_Clause.visit_with);
  },

  // rustc: compiler/rustc_middle/src/ty/structural_impls.rs:631 try_super_fold_with
  try_super_fold_with<E>(self: Clauses, folder: FallibleTypeFolder<E>): Result<Clauses, E> {
    return try_fold_list(self, folder, (tcx, v) => tcx.mk_clauses(v), fold_Clause);
  },

  // rustc: compiler/rustc_middle/src/ty/structural_impls.rs:638 super_fold_with
  super_fold_with(self: Clauses, folder: TypeFolder): Clauses {
    return fold_list(self, folder, (tcx, v) => tcx.mk_clauses(v), fold_Clause);
  },

  // `impl Flags for Clauses` (`ListWithCachedTypeInfo`'s cached info)
  flags(self: Clauses) {
    return self.flags();
  },
  outer_exclusive_binder(self: Clauses) {
    return self.outer_exclusive_binder();
  },
};

/** `ValTreeKind`'s generated impls as a descriptor. */
function fold_ValTreeKind(): TypeFoldable<ValTreeKind> {
  const g = const_kind_gen();
  return { try_fold_with: g.try_fold_with_ValTreeKind, fold_with: g.fold_with_ValTreeKind, visit_with: g.visit_with_ValTreeKind };
}

/** D4 descriptor of `ty::ValTree`: `TypeVisitable` (:643), `TypeFoldable` (:650). */
export const fold_ValTree: TypeFoldable<ValTree> = {
  // rustc: compiler/rustc_middle/src/ty/structural_impls.rs:644 visit_with
  visit_with<R>(self: ValTree, visitor: TypeVisitor<R>): R {
    const inner: ValTreeKind = self.kind();
    return fold_ValTreeKind().visit_with(inner, visitor);
  },

  // rustc: compiler/rustc_middle/src/ty/structural_impls.rs:651 try_fold_with
  try_fold_with<E>(self: ValTree, folder: FallibleTypeFolder<E>): Result<ValTree, E> {
    const inner: ValTreeKind = self.kind();
    const new_inner = fold_ValTreeKind().try_fold_with(inner, folder);
    if (new_inner.$ === "Err") return new_inner;

    if (intern_key(inner) === intern_key(new_inner._0)) {
      return Ok(self);
    } else {
      const valtree = folder.cx().intern_valtree(new_inner._0);
      return Ok(valtree);
    }
  },

  // rustc: compiler/rustc_middle/src/ty/structural_impls.rs:666 fold_with
  fold_with(self: ValTree, folder: TypeFolder): ValTree {
    const inner: ValTreeKind = self.kind();
    const new_inner = fold_ValTreeKind().fold_with(inner, folder);

    return intern_key(inner) === intern_key(new_inner) ? self : folder.cx().intern_valtree(new_inner);
  },
};

/** D4 descriptor of `rustc_span::ErrorGuaranteed`: `TypeVisitable` (:674), `TypeFoldable` (:680). */
export const fold_ErrorGuaranteed: TypeFoldable<ErrorGuaranteed> = {
  // rustc: compiler/rustc_middle/src/ty/structural_impls.rs:675 visit_with
  visit_with<R>(self: ErrorGuaranteed, visitor: TypeVisitor<R>): R {
    return visitor.visit_error(self);
  },

  // rustc: compiler/rustc_middle/src/ty/structural_impls.rs:681 try_fold_with
  try_fold_with<E>(self: ErrorGuaranteed, _folder: FallibleTypeFolder<E>): Result<ErrorGuaranteed, E> {
    return Ok(self);
  },

  // rustc: compiler/rustc_middle/src/ty/structural_impls.rs:688 fold_with
  fold_with(self: ErrorGuaranteed, _folder: TypeFolder): ErrorGuaranteed {
    return self;
  },
};

/** `impl TypeVisitable for TyAndLayout<Ty>` (rustc_abi's `TyAndLayout`, M4: only its `ty` field is read). */
export const visit_TyAndLayout: TypeVisitable<{ ty: Ty }> = {
  // rustc: compiler/rustc_middle/src/ty/structural_impls.rs:694 visit_with
  visit_with<R>(self: { ty: Ty }, visitor: TypeVisitor<R>): R {
    return visitor.visit_ty(self.ty);
  },
};

/** `rustc_span::Spanned<T>` (`{ node, span }`). */
export interface Spanned<T> {
  node: T;
  span: Span;
}
/** `Span`'s trivial traversal (`TrivialTypeTraversalImpls!`, module comment). */
const fold_Span: TypeFoldable<Span> = {
  try_fold_with: (self) => Ok(self),
  fold_with: (self) => self,
  visit_with: (_self, visitor) => visitor.Result.output(),
};

/** `impl<T: TypeVisitable + Debug + Clone> TypeVisitable for Spanned<T>` (:699) and
 *  `impl<T: TypeFoldable + Debug + Clone> TypeFoldable for Spanned<T>` (:708). */
export function fold_Spanned<T>(d_T: TypeFoldable<T>): TypeFoldable<Spanned<T>> {
  return {
    // rustc: compiler/rustc_middle/src/ty/structural_impls.rs:702 visit_with
    visit_with<R>(self: Spanned<T>, visitor: TypeVisitor<R>): R {
      let r: R | undefined;
      if ((r = try_visit(visitor.Result, d_T.visit_with(self.node, visitor))) !== undefined) return r;
      return fold_Span.visit_with(self.span, visitor);
    },

    // rustc: compiler/rustc_middle/src/ty/structural_impls.rs:711 try_fold_with
    try_fold_with<E>(self: Spanned<T>, folder: FallibleTypeFolder<E>): Result<Spanned<T>, E> {
      const node = d_T.try_fold_with(self.node, folder);
      if (node.$ === "Err") return node;
      const span = fold_Span.try_fold_with(self.span, folder);
      if (span.$ === "Err") return span;
      return Ok({ node: node._0, span: span._0 });
    },

    // rustc: compiler/rustc_middle/src/ty/structural_impls.rs:721 fold_with
    fold_with(self: Spanned<T>, folder: TypeFolder): Spanned<T> {
      return { node: d_T.fold_with(self.node, folder), span: fold_Span.fold_with(self.span, folder) };
    },
  };
}

/** `LocalDefId`'s trivial traversal (`TrivialTypeTraversalImpls!`). */
const visit_LocalDefId: TypeVisitable<LocalDefId> = {
  visit_with: (_self, visitor) => visitor.Result.output(),
};

/** `impl TypeFoldable for &List<LocalDefId>` (:726); visit is `TypeVisitable for &List<T>` (generic_args.rs:714). */
export const fold_LocalDefIds: TypeFoldable<LocalDefIds> = {
  // rustc: compiler/rustc_middle/src/ty/structural_impls.rs:727 try_fold_with
  try_fold_with<E>(self: LocalDefIds, _folder: FallibleTypeFolder<E>): Result<LocalDefIds, E> {
    return Ok(self);
  },

  // rustc: compiler/rustc_middle/src/ty/structural_impls.rs:734 fold_with
  fold_with(self: LocalDefIds, _folder: TypeFolder): LocalDefIds {
    return self;
  },

  visit_with<R>(self: LocalDefIds, visitor: TypeVisitor<R>): R {
    return visit_List(visit_LocalDefId).visit_with(self as unknown as List<LocalDefId>, visitor);
  },
};

// macro_rules! list_fold { .. } (:739): one `TypeFoldable` impl per `$ty : $mk`, folding through `ty::util::fold_list`
// with the interner method; each descriptor's visit is `TypeVisitable for &List<T>` (generic_args.rs:714).
function list_fold<T>(mk: (tcx: TyCtxt, v: readonly T[]) => List<T>, d_T: () => TypeFoldable<T>): TypeFoldable<List<T>> {
  return {
    // rustc: compiler/rustc_middle/src/ty/structural_impls.rs:743 try_fold_with
    try_fold_with<E>(self: List<T>, folder: FallibleTypeFolder<E>): Result<List<T>, E> {
      return try_fold_list(self, folder, (tcx, v) => mk(tcx, v), d_T());
    },

    // rustc: compiler/rustc_middle/src/ty/structural_impls.rs:750 fold_with
    fold_with(self: List<T>, folder: TypeFolder): List<T> {
      return fold_list(self, folder, (tcx, v) => mk(tcx, v), d_T());
    },

    visit_with<R>(self: List<T>, visitor: TypeVisitor<R>): R {
      return visit_List(d_T()).visit_with(self, visitor);
    },
  };
}

/** `Binder<ExistentialPredicate>` generated impls in a descriptor. */
function fold_PolyExistentialPredicate(): TypeFoldable<PolyExistentialPredicate> {
  const g = predicate_gen();
  return binder().fold_Binder({ try_fold_with: g.try_fold_with_ExistentialPredicate, fold_with: g.fold_with_ExistentialPredicate, visit_with: g.visit_with_ExistentialPredicate }) as unknown as TypeFoldable<PolyExistentialPredicate>;
}
/** `(OpaqueTypeKey, Ty)` generated impls in a descriptor. */
function fold_OpaqueTypeKey_Ty(): TypeFoldable<[OpaqueTypeKey, Ty]> {
  const g = opaque_ty_gen();
  return ir_fold().fold_tuple2({ try_fold_with: g.try_fold_with_OpaqueTypeKey, fold_with: g.fold_with_OpaqueTypeKey, visit_with: g.visit_with_OpaqueTypeKey }, fold_Ty);
}
/** `OutlivesClause<GenericArg>` generated impls in a descriptor. */
function fold_ArgOutlivesClause(): TypeFoldable<ArgOutlivesClause> {
  const g = predicate_gen();
  const ga = generic_args();
  return {
    try_fold_with: (self, folder) => g.try_fold_with_OutlivesClause(self, folder, ga.try_fold_with_GenericArg),
    fold_with: (self, folder) => g.fold_with_OutlivesClause(self, folder, ga.fold_with_GenericArg),
    visit_with: (self, visitor) => g.visit_with_OutlivesClause(self, visitor, ga.visit_with_GenericArg),
  };
}

// list_fold! {
//     &'tcx ty::List<ty::PolyExistentialPredicate<'tcx>> : mk_poly_existential_predicates,
//     &'tcx ty::List<(ty::OpaqueTypeKey<'tcx>, Ty<'tcx>)>: mk_predefined_opaques_in_body,
//     &'tcx ty::List<PlaceElem<'tcx>> : mk_place_elems,
//     &'tcx ty::List<ty::Pattern<'tcx>> : mk_patterns,
//     &'tcx ty::List<ty::ArgOutlivesClause<'tcx>> : mk_outlives,
//     &'tcx ty::List<ty::Const<'tcx>> : mk_const_list,
// }
export const fold_BoundExistentialPredicates: TypeFoldable<BoundExistentialPredicates> = list_fold<PolyExistentialPredicate>(
  (tcx, v) => tcx.mk_poly_existential_predicates(v),
  fold_PolyExistentialPredicate,
) as unknown as TypeFoldable<BoundExistentialPredicates>;
export const fold_PredefinedOpaques: TypeFoldable<PredefinedOpaques> = list_fold<[OpaqueTypeKey, Ty]>(
  (tcx, v) => tcx.mk_predefined_opaques_in_body(v),
  fold_OpaqueTypeKey_Ty,
) as unknown as TypeFoldable<PredefinedOpaques>;
export const fold_PlaceElems: TypeFoldable<List<PlaceElem>> = list_fold<PlaceElem>((tcx, v) => tcx.mk_place_elems(v), () => fold_PlaceElem);
export const fold_PatList: TypeFoldable<PatList> = list_fold<Pattern>((tcx, v) => tcx.mk_patterns(v), () => fold_Pattern) as unknown as TypeFoldable<PatList>;
export const fold_RegionAssumptions: TypeFoldable<RegionAssumptions> = list_fold<ArgOutlivesClause>(
  (tcx, v) => tcx.mk_outlives(v),
  fold_ArgOutlivesClause,
) as unknown as TypeFoldable<RegionAssumptions>;
export const fold_Consts: TypeFoldable<Consts> = list_fold<Const>((tcx, v) => tcx.mk_const_list(v), () => sty_consts().fold_Const) as unknown as TypeFoldable<Consts>;

// ---- tools/codegen's view of the impls above (type_fold.json): gen-shaped wrappers of the descriptors ----

export function visit_with_AdtDef<R>(self: AdtDef, visitor: TypeVisitor<R>): R {
  return visit_AdtDef.visit_with(self, visitor);
}

export function visit_with_Pattern<R>(self: Pattern, visitor: TypeVisitor<R>): R {
  return fold_Pattern.visit_with(self, visitor);
}
export function try_fold_with_Pattern<E>(self: Pattern, folder: FallibleTypeFolder<E>): Result<Pattern, E> {
  return fold_Pattern.try_fold_with(self, folder);
}
export function fold_with_Pattern(self: Pattern, folder: TypeFolder): Pattern {
  return fold_Pattern.fold_with(self, folder);
}

export function visit_with_Clauses<R>(self: Clauses, visitor: TypeVisitor<R>): R {
  return fold_Clauses.visit_with(self, visitor);
}
export function try_fold_with_Clauses<E>(self: Clauses, folder: FallibleTypeFolder<E>): Result<Clauses, E> {
  return fold_Clauses.try_fold_with(self, folder);
}
export function fold_with_Clauses(self: Clauses, folder: TypeFolder): Clauses {
  return fold_Clauses.fold_with(self, folder);
}

export function visit_with_ErrorGuaranteed<R>(self: ErrorGuaranteed, visitor: TypeVisitor<R>): R {
  return fold_ErrorGuaranteed.visit_with(self, visitor);
}
export function try_fold_with_ErrorGuaranteed<E>(self: ErrorGuaranteed, folder: FallibleTypeFolder<E>): Result<ErrorGuaranteed, E> {
  return fold_ErrorGuaranteed.try_fold_with(self, folder);
}
export function fold_with_ErrorGuaranteed(self: ErrorGuaranteed, folder: TypeFolder): ErrorGuaranteed {
  return fold_ErrorGuaranteed.fold_with(self, folder);
}

export function visit_with_LocalDefIds<R>(self: LocalDefIds, visitor: TypeVisitor<R>): R {
  return fold_LocalDefIds.visit_with(self, visitor);
}
export function try_fold_with_LocalDefIds<E>(self: LocalDefIds, folder: FallibleTypeFolder<E>): Result<LocalDefIds, E> {
  return fold_LocalDefIds.try_fold_with(self, folder);
}
export function fold_with_LocalDefIds(self: LocalDefIds, folder: TypeFolder): LocalDefIds {
  return fold_LocalDefIds.fold_with(self, folder);
}

export function visit_with_Consts<R>(self: Consts, visitor: TypeVisitor<R>): R {
  return fold_Consts.visit_with(self, visitor);
}
export function try_fold_with_Consts<E>(self: Consts, folder: FallibleTypeFolder<E>): Result<Consts, E> {
  return fold_Consts.try_fold_with(self, folder);
}
export function fold_with_Consts(self: Consts, folder: TypeFolder): Consts {
  return fold_Consts.fold_with(self, folder);
}

export function visit_with_PatList<R>(self: PatList, visitor: TypeVisitor<R>): R {
  return fold_PatList.visit_with(self, visitor);
}
export function try_fold_with_PatList<E>(self: PatList, folder: FallibleTypeFolder<E>): Result<PatList, E> {
  return fold_PatList.try_fold_with(self, folder);
}
export function fold_with_PatList(self: PatList, folder: TypeFolder): PatList {
  return fold_PatList.fold_with(self, folder);
}

export function visit_with_BoundExistentialPredicates<R>(self: BoundExistentialPredicates, visitor: TypeVisitor<R>): R {
  return fold_BoundExistentialPredicates.visit_with(self, visitor);
}
export function try_fold_with_BoundExistentialPredicates<E>(self: BoundExistentialPredicates, folder: FallibleTypeFolder<E>): Result<BoundExistentialPredicates, E> {
  return fold_BoundExistentialPredicates.try_fold_with(self, folder);
}
export function fold_with_BoundExistentialPredicates(self: BoundExistentialPredicates, folder: TypeFolder): BoundExistentialPredicates {
  return fold_BoundExistentialPredicates.fold_with(self, folder);
}

export function visit_with_RegionAssumptions<R>(self: RegionAssumptions, visitor: TypeVisitor<R>): R {
  return fold_RegionAssumptions.visit_with(self, visitor);
}
export function try_fold_with_RegionAssumptions<E>(self: RegionAssumptions, folder: FallibleTypeFolder<E>): Result<RegionAssumptions, E> {
  return fold_RegionAssumptions.try_fold_with(self, folder);
}
export function fold_with_RegionAssumptions(self: RegionAssumptions, folder: TypeFolder): RegionAssumptions {
  return fold_RegionAssumptions.fold_with(self, folder);
}

export function visit_with_PredefinedOpaques<R>(self: PredefinedOpaques, visitor: TypeVisitor<R>): R {
  return fold_PredefinedOpaques.visit_with(self, visitor);
}
export function try_fold_with_PredefinedOpaques<E>(self: PredefinedOpaques, folder: FallibleTypeFolder<E>): Result<PredefinedOpaques, E> {
  return fold_PredefinedOpaques.try_fold_with(self, folder);
}
export function fold_with_PredefinedOpaques(self: PredefinedOpaques, folder: TypeFolder): PredefinedOpaques {
  return fold_PredefinedOpaques.fold_with(self, folder);
}
