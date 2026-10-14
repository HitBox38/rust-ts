// Port of compiler/rustc_privacy/src/lib.rs (lane privacy-effvis).
//
// PORT: query values typed `unknown` in queries.gen.ts (`type_of`, `generics_of`, `explicit_clauses_of`,
// `explicit_item_bounds`, `adt_def`, `associated_items`, `hir_crate_items`, `hir_module_items`) are cast to their
// upstream types at the read site.
// PORT: `&dyn fmt::Display` descriptions are thunks producing the `Display` output (as `DiagArgFromDisplay` does), so
// `LazyDefPathStr` stays lazy and `descr.into()` is `DiagArgFromDisplay_from_dyn(descr)`.
// PORT: trait `DefIdVisitor`: the interface `DefIdVisitor<R>` plus `DefIdVisitor_provided` (PORTING §8). Its
// `type Result` is the property `DefIdResult` and its `const SHALLOW` the property `SHALLOW`: `TypePrivacyVisitor` is
// also a HIR `Visitor`, whose `Result` is `()`. The structs implementing it name their `tcx` field `tcx_` (the trait
// method is `tcx()`), and `SearchInterfaceForPrivateItemsVisitor`'s `skip_assoc_tys` field is `skip_assoc_tys_`.
// PORT: `impl TypeVisitable` arguments take the value's descriptor last (D4).
// PORT: tracing (`debug!`) is left out.
import { ControlFlow, try_visit, VisitorResult } from "../rustc_ast_ir/visit.ts";
import { find_attr } from "../rustc_attr_ir/lib.ts";
import { DiagArgFromDisplay_from_dyn } from "../rustc_error_messages/diagnostic_impls.ts";
import { MultiSpan } from "../rustc_error_messages/lib.ts";
import { listify } from "../rustc_errors/lib.ts";
import { debug_DefKind, type DefKind, Res } from "../rustc_hir/def.ts";
import { type AmbigArg, type BodyId, type Expr, type ExprField, type ForeignItemId, type ItemId, type LetStmt, Node, type Pat, QPath, type Ty as HirTy } from "../rustc_hir/hir.ts";
import { type InferKind, Visitor, walk_expr, walk_local, walk_pat, walk_qpath, walk_ty } from "../rustc_hir/intravisit.ts";
import { debug_HirId, type HirId, type OwnerId } from "../rustc_hir_id/lib.ts";
import { EXPORTED_PRIVATE_DEPENDENCIES, PRIVATE_BOUNDS, PRIVATE_INTERFACES, UNNAMEABLE_TYPES } from "../rustc_lint_defs/builtin.ts";
import type { ModuleItems } from "../rustc_middle/hir/mod.ts";
import { debug_Level, EffectiveVisibilities, EffectiveVisibility, Level } from "../rustc_middle/middle/privacy.ts";
import type { Providers } from "../rustc_middle/queries.gen.ts";
import { AssocItem, AssocItems } from "../rustc_middle/ty/assoc.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
// PORT: `TyCtxt::typeck_body` takes rustc_middle's pending `BodyId` stand-in (ty/decls.ts); the HIR `BodyId` is cast.
import type { AdtDef, BodyId as MiddleBodyId } from "../rustc_middle/ty/decls.ts";
import { fold_GenericArg, fold_GenericArgs } from "../rustc_middle/ty/generic_args.ts";
import { type GenericClauses, GenericParamDef, type Generics } from "../rustc_middle/ty/generics.ts";
import { RawList } from "../rustc_middle/ty/list.ts";
import { fold_Term, type FieldDef, type Ty, type VariantDef, Visibility, Visibility_eq } from "../rustc_middle/ty/mod.ts";
import type { Clause } from "../rustc_middle/ty/predicate.ts";
import { display_TraitRefPrintOnlyTraitPath, display_Ty, TraitRef_print_only_trait_path } from "../rustc_middle/ty/print/pretty.ts";
import { fold_Ty } from "../rustc_middle/ty/structural_impls.ts";
import type { TypeckResults } from "../rustc_middle/ty/typeck_results.ts";
import { type Binder, Binder as BinderC, EarlyBinder, fold_Binder } from "../rustc_type_ir/binder.ts";
import type { PredicateProxy } from "../rustc_type_ir/fold.ts";
import { display_ExistentialTraitRef } from "../rustc_type_ir/ir_print.ts";
import type { ClauseKind } from "../rustc_type_ir/predicate_kind.ts";
import { as_interner, ExistentialProjection, ExistentialTraitRef, type TraitRef } from "../rustc_type_ir/predicate.ts";
import { type Const, fold_Const } from "../rustc_type_ir/sty/consts.ts";
import type { Region } from "../rustc_type_ir/sty/mod.ts";
import { AliasTerm } from "../rustc_type_ir/term_kind.ts";
import type { AliasTerm as AliasTermT } from "../rustc_type_ir/ty/alias.gen.ts";
import { fold_FnSig, type FnSig } from "../rustc_type_ir/ty_kind.ts";
import { Unnormalized } from "../rustc_type_ir/unnormalized.ts";
import { type TypeVisitable, type TypeVisitor, TypeVisitor_provided } from "../rustc_type_ir/visit.ts";
import type { Clauses } from "../rustc_middle/ty/list.ts";
import { type SpannedTypeVisitor, walk_types } from "../rustc_ty_walk/lib.ts";
import { type DefId, LocalDefId, LocalModId, type LocalModId as LocalModIdT } from "../rustc_span/def_id.ts";
import { type ErrorGuaranteed, Span } from "../rustc_span/lib.ts";
import { bug, span_bug } from "../rustc_span/macros.ts";
import { display_Ident, Ident, sym, type Symbol, display_Symbol } from "../rustc_span/symbol.ts";
import { HasAttrs_LocalDefId } from "../rustc_middle/ty/mod.ts";
import { PLAIN } from "../std/fmt.ts";
import { Ok } from "../std/result.ts";
import { unreachable, unwrap } from "../std/panic.ts";
import { FxHashSet, type KeyType, u32_key } from "../rust_ts/hash_map.ts";
import {
  FieldIsPrivate_diagnostic,
  type FieldIsPrivateLabel,
  FromPrivateDependencyInPublicInterface_diagnostic,
  InPublicInterface_diagnostic,
  ItemIsPrivate_diagnostic,
  PrivateInterfacesOrBoundsLint_diagnostic,
  ReportEffectiveVisibility_diagnostic,
  UnnameableTypesLint_diagnostic,
  UnnamedItemIsPrivate_diagnostic,
} from "./diagnostics.ts";

// mod diagnostics;   (generated: diagnostics.gen.ts, re-exported by diagnostics.ts)

/** PORT: `&dyn fmt::Display`: a thunk producing the `Display` output (module comment). */
type Display = () => string;

/** `FxHashSet::insert`: `true` if the value was not present. */
function insert<T>(set: Set<T>, v: T): boolean {
  if (set.has(v)) return false;
  set.add(v);
  return true;
}

/** PORT: `rustc_data_structures::indexmap::IndexSet` with the operations this file uses (`insert`, `extend`, `pop`,
 *  `clear`): insertion-ordered, `insert` of a present value keeps its position, `pop` removes the last value. */
class IndexSet<T> {
  private readonly items: T[] = [];
  private readonly set = new Set<T>();
  insert(v: T): boolean {
    if (this.set.has(v)) return false;
    this.set.add(v);
    this.items.push(v);
    return true;
  }
  extend(vs: Iterable<T>): void {
    for (const v of vs) this.insert(v);
  }
  pop(): T | undefined {
    const v = this.items.pop();
    if (v !== undefined) this.set.delete(v);
    return v;
  }
  clear(): void {
    this.items.length = 0;
    this.set.clear();
  }
}

/** `LocalDefId`'s `Hash` writes its `DefIndex` (a `u32`). */
const LocalDefId_key = u32_key as unknown as KeyType<LocalDefId>;

/** `effective_vis(..).copied()`: `EffectiveVisibility` is `Copy`; the TS class is mutated in place by
 *  `EffectiveVisibilities::update`, so a copy is taken wherever upstream copies. */
function copied(ev: EffectiveVisibility | undefined): EffectiveVisibility | undefined {
  return ev === undefined ? undefined : new EffectiveVisibility(ev.direct, ev.reexported, ev.reachable, ev.reachable_through_impl_trait);
}

////////////////////////////////////////////////////////////////////////////////
// Generic infrastructure used to implement specific visitors below.
////////////////////////////////////////////////////////////////////////////////

// rustc-type: compiler/rustc_privacy/src/lib.rs:45 LazyDefPathStr
class LazyDefPathStr {
  constructor(
    readonly def_id: DefId,
    readonly tcx: TyCtxt,
  ) {}

  // `impl fmt::Display for LazyDefPathStr`
  // rustc: compiler/rustc_privacy/src/lib.rs:51 fmt
  fmt(): string {
    return this.tcx.def_path_str(this.def_id);
  }
}

/** `&LazyDefPathStr { def_id, tcx }` as a `&dyn fmt::Display`. */
function lazy_def_path_str(def_id: DefId, tcx: TyCtxt): Display {
  const lazy = new LazyDefPathStr(def_id, tcx);
  return () => lazy.fmt();
}

/// Implemented to visit all `DefId`s in a type.
/// Visiting `DefId`s is useful because visibilities and reachabilities are attached to them.
/// The idea is to visit "all components of a type", as documented in
/// <https://rust-lang.github.io/rfcs/2145-type-privacy.html#how-to-determine-visibility-of-a-type>.
/// The default type visitor (`TypeVisitor`) does most of the job, but it has some shortcomings.
/// First, it doesn't have overridable `fn visit_trait_ref`, so we have to catch trait `DefId`s
/// manually. Second, it doesn't visit some type components like signatures of fn types, or traits
/// in `impl Trait`, see individual comments in `DefIdVisitorSkeleton::visit_ty`.
// rustc-trait: compiler/rustc_privacy/src/lib.rs:64 DefIdVisitor
export interface DefIdVisitor<R = undefined> {
  /** `type Result: VisitorResult = ();` (module comment). */
  readonly DefIdResult: VisitorResult<R, unknown>;
  /** `const SHALLOW: bool = false;` */
  readonly SHALLOW: boolean;
  // (provided) lib.rs:67 skip_assoc_tys -> DefIdVisitor_provided.skip_assoc_tys
  skip_assoc_tys(): boolean;

  // rustc: compiler/rustc_privacy/src/lib.rs:71 tcx
  tcx(): TyCtxt;
  /// NOTE: Def-id visiting should be idempotent (or at least produce duplicated errors),
  /// because `DefIdVisitorSkeleton` will use caching and sometimes avoid visiting duplicate
  /// def-ids. All the current visitors follow this rule.
  // rustc: compiler/rustc_privacy/src/lib.rs:75 visit_def_id
  visit_def_id(def_id: DefId, kind: string, descr: Display): R;

  /// Not overridden, but used to actually visit types and traits.
  // (provided) lib.rs:79 skeleton
  skeleton(): DefIdVisitorSkeleton<R>;
  // (provided) lib.rs:86 visit
  visit<T>(ty_fragment: T, d: TypeVisitable<T>): R;
  // (provided) lib.rs:89 visit_trait
  visit_trait(trait_ref: TraitRef): R;
  // (provided) lib.rs:92 visit_gen_clauses
  visit_gen_clauses(gen_clauses: GenericClauses): R;
  // (provided) lib.rs:95 visit_clauses
  visit_clauses(clauses: readonly (readonly [Clause, Span])[]): R;
}

/** PORT: the provided methods of `DefIdVisitor` (PORTING §8). */
export const DefIdVisitor_provided = {
  /** `const SHALLOW: bool = false;` */
  SHALLOW: false,

  // rustc: compiler/rustc_privacy/src/lib.rs:67 skip_assoc_tys
  skip_assoc_tys<R>(_self: DefIdVisitor<R>): boolean {
    return false;
  },

  /// Not overridden, but used to actually visit types and traits.
  // rustc: compiler/rustc_privacy/src/lib.rs:79 skeleton
  skeleton<R>(self: DefIdVisitor<R>): DefIdVisitorSkeleton<R> {
    return new DefIdVisitorSkeleton(self, new Set(), null);
  },
  // rustc: compiler/rustc_privacy/src/lib.rs:86 visit
  visit<T, R>(self: DefIdVisitor<R>, ty_fragment: T, d: TypeVisitable<T>): R {
    return d.visit_with(ty_fragment, self.skeleton());
  },
  // rustc: compiler/rustc_privacy/src/lib.rs:89 visit_trait
  visit_trait<R>(self: DefIdVisitor<R>, trait_ref: TraitRef): R {
    return self.skeleton().visit_trait(trait_ref);
  },
  // rustc: compiler/rustc_privacy/src/lib.rs:92 visit_gen_clauses
  visit_gen_clauses<R>(self: DefIdVisitor<R>, gen_clauses: GenericClauses): R {
    return self.skeleton().visit_clauses_(gen_clauses.clauses);
  },
  // rustc: compiler/rustc_privacy/src/lib.rs:95 visit_clauses
  visit_clauses<R>(self: DefIdVisitor<R>, clauses: readonly (readonly [Clause, Span])[]): R {
    return self.skeleton().visit_clauses_(clauses);
  },
};

// rustc-type: compiler/rustc_privacy/src/lib.rs:100 DefIdVisitorSkeleton
export class DefIdVisitorSkeleton<R> implements TypeVisitor<R> {
  /** `type Result = V::Result;` */
  readonly Result: VisitorResult<R, unknown>;

  constructor(
    readonly def_id_visitor: DefIdVisitor<R>,
    readonly visited_tys: Set<Ty>,
    readonly dummy: null,
  ) {
    this.Result = def_id_visitor.DefIdResult;
  }

  // rustc: compiler/rustc_privacy/src/lib.rs:110 visit_trait
  visit_trait(trait_ref: TraitRef): R {
    let r: R | undefined;
    const { def_id, args } = trait_ref;
    if (
      (r = try_visit(this.Result, this.def_id_visitor.visit_def_id(def_id, "trait", () => display_TraitRefPrintOnlyTraitPath(TraitRef_print_only_trait_path(trait_ref))))) !==
      undefined
    )
      return r;
    if (this.def_id_visitor.SHALLOW) {
      return this.Result.output();
    } else {
      return fold_GenericArgs.visit_with(args, this);
    }
  }

  // rustc: compiler/rustc_privacy/src/lib.rs:120 visit_projection_term
  visit_projection_term(projection: AliasTermT): R {
    let r: R | undefined;
    const tcx = this.def_id_visitor.tcx();
    const [trait_ref, assoc_args] = AliasTerm.trait_ref_and_own_args(projection, as_interner(tcx));
    if ((r = try_visit(this.Result, this.visit_trait(trait_ref))) !== undefined) return r;
    if (this.def_id_visitor.SHALLOW) {
      return this.Result.output();
    } else {
      // `V::Result::from_branch(assoc_args.iter().try_for_each(|arg| arg.visit_with(self).branch()))`
      for (const arg of assoc_args) {
        const b = this.Result.branch(fold_GenericArg.visit_with(arg, this));
        if (b.$ === "Break") return this.Result.from_branch(b);
      }
      return this.Result.from_branch(ControlFlow.CONTINUE);
    }
  }

  // rustc: compiler/rustc_privacy/src/lib.rs:133 visit_clause
  visit_clause(clause: Binder<ClauseKind>): R {
    let r: R | undefined;
    const kind = BinderC.skip_binder(clause);
    switch (kind.$) {
      case "Trait": {
        const { trait_ref } = kind._0;
        return this.visit_trait(trait_ref);
      }
      case "HostEffect": {
        const clause = kind._0;
        if ((r = try_visit(this.Result, this.visit_trait(clause.trait_ref))) !== undefined) return r;
        // PORT: `clause.constness.visit_with(self)`: `BoundConstness` contains no types, its `visit_with` is
        // `V::Result::output()`.
        return this.Result.output();
      }
      case "Projection": {
        const { projection_term: projection_ty, term } = kind._0;
        if ((r = try_visit(this.Result, fold_Term.visit_with(term, this))) !== undefined) return r;
        return this.visit_projection_term(projection_ty);
      }
      case "TypeOutlives": {
        const ty = kind._0._0;
        return fold_Ty.visit_with(ty, this);
      }
      case "RegionOutlives":
        return this.Result.output();
      case "ConstArgHasType": {
        const ct = kind._0;
        const ty = kind._1;
        if ((r = try_visit(this.Result, fold_Const.visit_with(ct, this))) !== undefined) return r;
        return fold_Ty.visit_with(ty, this);
      }
      case "ConstEvaluatable":
        return fold_Const.visit_with(kind._0, this);
      case "WellFormed":
        return fold_Term.visit_with(kind._0, this);
      case "UnstableFeature":
        return this.Result.output();
    }
  }

  // PORT: the inherent `visit_clauses` is `visit_clauses_`: `TypeVisitor::visit_clauses` (the `&List<Clause>` hook
  // called by `Clauses::visit_with`) needs the name.
  // rustc: compiler/rustc_privacy/src/lib.rs:161 visit_clauses
  visit_clauses_(clauses: readonly (readonly [Clause, Span])[]): R {
    let r: R | undefined;
    for (const [clause] of clauses) {
      if ((r = try_visit(this.Result, this.visit_clause(clause.kind()))) !== undefined) return r;
    }
    return this.Result.output();
  }

  // `impl TypeVisitor<TyCtxt<'tcx>> for DefIdVisitorSkeleton`

  // rustc: compiler/rustc_privacy/src/lib.rs:175 visit_predicate
  visit_predicate<P>(p: P, d: PredicateProxy<P>): R {
    return this.visit_clause(unwrap(d.clause_kind_unchecked(p)));
  }

  // rustc: compiler/rustc_privacy/src/lib.rs:179 visit_ty
  visit_ty(ty: Ty): R {
    let r: R | undefined;
    const tcx = this.def_id_visitor.tcx();
    // GenericArgs are not visited here because they are visited below
    // in `super_visit_with`.
    const ty_kind = ty.kind();
    if (
      ty_kind.$ === "Adt" ||
      ty_kind.$ === "Foreign" ||
      ty_kind.$ === "FnDef" ||
      ty_kind.$ === "Closure" ||
      ty_kind.$ === "CoroutineClosure" ||
      ty_kind.$ === "Coroutine"
    ) {
      const def_id: DefId = ty_kind.$ === "Adt" ? ty_kind._0.did() : ty_kind._0;
      if ((r = try_visit(this.Result, this.def_id_visitor.visit_def_id(def_id, "type", () => display_Ty(ty)))) !== undefined) return r;
      if (this.def_id_visitor.SHALLOW) {
        return this.Result.output();
      }
      // Default type visitor doesn't visit signatures of fn types.
      // Something like `fn() -> Priv {my_func}` is considered a private type even if
      // `my_func` is public, so we need to visit signatures.
      if (ty_kind.$ === "FnDef") {
        // FIXME: this should probably use `args` from `FnDef`
        if (
          (r = try_visit(
            this.Result,
            fold_Binder(fold_FnSig).visit_with(Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.fn_sig(def_id) as EarlyBinder<Binder<FnSig>>)), this),
          )) !== undefined
        )
          return r;
      }
      // Inherent static methods don't have self type in args.
      // Something like `fn() {my_method}` type of the method
      // `impl Pub<Priv> { pub fn my_method() {} }` is considered a private type,
      // so we need to visit the self type additionally.
      const assoc_item = tcx.opt_associated_item(def_id);
      if (assoc_item !== undefined) {
        const impl_def_id = AssocItem.impl_container(assoc_item, tcx);
        if (impl_def_id !== undefined) {
          if (
            (r = try_visit(this.Result, fold_Ty.visit_with(Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.type_of(impl_def_id) as EarlyBinder<Ty>)), this))) !==
            undefined
          )
            return r;
        }
      }
    } else if (ty_kind.$ === "Alias" && (ty_kind._1.kind.$ === "Inherent" || ty_kind._1.kind.$ === "Free" || ty_kind._1.kind.$ === "Projection")) {
      const data = ty_kind._1;
      const kind = ty_kind._1.kind;
      const def_id = kind.def_id;
      if (this.def_id_visitor.skip_assoc_tys()) {
        // Visitors searching for minimal visibility/reachability want to
        // conservatively approximate associated types like `Type::Alias`
        // as visible/reachable even if `Type` is private.
        // Ideally, associated types should be instantiated in the same way as
        // free type aliases, but this isn't done yet.
        return this.Result.output();
      }
      if (!insert(this.visited_tys, ty)) {
        // Avoid repeatedly visiting alias types (including projections).
        // This helps with special cases like #145741, but doesn't introduce
        // too much overhead in general case, unlike caching for other types.
        return this.Result.output();
      }

      let kind_descr: string;
      switch (kind.$) {
        case "Inherent":
        case "Projection":
          kind_descr = "associated type";
          break;
        case "Free":
          kind_descr = "type alias";
          break;
      }
      if ((r = try_visit(this.Result, this.def_id_visitor.visit_def_id(def_id, kind_descr, lazy_def_path_str(def_id, tcx)))) !== undefined) return r;

      // This will also visit args if necessary, so we don't need to recurse.
      if (this.def_id_visitor.SHALLOW) {
        return this.Result.output();
      } else if (kind.$ === "Projection") {
        return this.visit_projection_term(AliasTerm.from_AliasTy(data));
      } else {
        // `V::Result::from_branch(data.args.iter().try_for_each(|arg| arg.visit_with(self).branch()))`
        for (const arg of data.args) {
          const b = this.Result.branch(fold_GenericArg.visit_with(arg, this));
          if (b.$ === "Break") return this.Result.from_branch(b);
        }
        return this.Result.from_branch(ControlFlow.CONTINUE);
      }
    } else if (ty_kind.$ === "Dynamic") {
      const predicates = ty_kind._0;
      // All traits in the list are considered the "primary" part of the type
      // and are visited by shallow visitors.
      for (const predicate of predicates) {
        let trait_ref: ExistentialTraitRef;
        const p = BinderC.skip_binder(predicate);
        switch (p.$) {
          case "Trait":
            trait_ref = p._0;
            break;
          case "Projection":
            trait_ref = ExistentialProjection.trait_ref(p._0, as_interner(tcx));
            break;
          case "AutoTrait":
            trait_ref = ExistentialTraitRef.new(as_interner(tcx), p._0, RawList.empty());
            break;
        }
        const { def_id } = trait_ref;
        const tr = trait_ref;
        if ((r = try_visit(this.Result, this.def_id_visitor.visit_def_id(def_id, "trait", () => display_ExistentialTraitRef(tr)))) !== undefined) return r;
      }
    } else if (ty_kind.$ === "Alias" && ty_kind._1.kind.$ === "Opaque") {
      const def_id = ty_kind._1.kind.def_id;
      // Skip repeated `Opaque`s to avoid infinite recursion.
      if (insert(this.visited_tys, ty)) {
        // The intent is to treat `impl Trait1 + Trait2` identically to
        // `dyn Trait1 + Trait2`. Therefore we ignore def-id of the opaque type itself
        // (it either has no visibility, or its visibility is insignificant, like
        // visibilities of type aliases) and recurse into bounds instead to go
        // through the trait list (default type visitor doesn't visit those traits).
        // All traits in the list are considered the "primary" part of the type
        // and are visited by shallow visitors.
        if (
          (r = try_visit(this.Result, this.visit_clauses_(EarlyBinder.skip_binder(tcx.explicit_item_bounds(def_id) as EarlyBinder<readonly (readonly [Clause, Span])[]>)))) !==
          undefined
        )
          return r;
      }
    } else if (
      // These types don't have their own def-ids (but may have subcomponents
      // with def-ids that should be visited recursively).
      ty_kind.$ === "Bool" ||
      ty_kind.$ === "Char" ||
      ty_kind.$ === "Int" ||
      ty_kind.$ === "Uint" ||
      ty_kind.$ === "Float" ||
      ty_kind.$ === "Str" ||
      ty_kind.$ === "Never" ||
      ty_kind.$ === "Array" ||
      ty_kind.$ === "Slice" ||
      ty_kind.$ === "Tuple" ||
      ty_kind.$ === "RawPtr" ||
      ty_kind.$ === "Ref" ||
      ty_kind.$ === "Pat" ||
      ty_kind.$ === "FnPtr" ||
      ty_kind.$ === "UnsafeBinder" ||
      ty_kind.$ === "Param" ||
      ty_kind.$ === "Bound" ||
      ty_kind.$ === "Error" ||
      ty_kind.$ === "CoroutineWitness"
    ) {
      // {}
    } else {
      // ty::Placeholder(..) | ty::Infer(..)
      return bug(`unexpected type: ${display_Ty_debug(ty)}`);
    }

    if (this.def_id_visitor.SHALLOW) {
      return this.Result.output();
    } else {
      return fold_Ty.super_visit_with(ty, this);
    }
  }

  // rustc: compiler/rustc_privacy/src/lib.rs:322 visit_const
  visit_const(c: Const): R {
    const tcx = this.def_id_visitor.tcx();
    return fold_Const.super_visit_with(tcx.expand_abstract_consts(c, fold_Const), this);
  }

  // ---- provided `TypeVisitor` methods (PORTING §8) ----
  visit_binder<T>(t: Binder<T>, d: TypeVisitable<T>): R {
    return TypeVisitor_provided.visit_binder(this, t, d);
  }
  visit_region(r: Region): R {
    return TypeVisitor_provided.visit_region(this, r);
  }
  visit_clauses(c: Clauses): R {
    return TypeVisitor_provided.visit_clauses(this, c);
  }
  visit_error(guar: ErrorGuaranteed): R {
    return TypeVisitor_provided.visit_error(this, guar);
  }
}

/** `{:?}` of a `Ty` (`bug!("unexpected type: {:?}", ty)`). */
function display_Ty_debug(ty: Ty): string {
  // PORT: `Ty`'s `Debug` is its `Display` (`impl fmt::Debug for Ty` in rustc_middle ty/structural_impls.rs).
  return display_Ty(ty);
}

// rustc: compiler/rustc_privacy/src/lib.rs:328 assoc_has_type_of
function assoc_has_type_of(tcx: TyCtxt, item: AssocItem): boolean {
  if (item.kind.$ === "Type" && item.kind.data.$ === "Normal") {
    const node = tcx.hir_node(tcx.local_def_id_to_hir_id(item.def_id.expect_local()));
    if (node.$ === "TraitItem") {
      const trait_item = node._0;
      if (trait_item.kind.$ === "Type" && trait_item.kind._1 === undefined) {
        return false;
      }
    }
  }
  return true;
}

// rustc: compiler/rustc_privacy/src/lib.rs:340 min
function min(vis1: Visibility<LocalModIdT>, vis2: Visibility<LocalModIdT>, tcx: TyCtxt): Visibility<LocalModIdT> {
  if (Visibility.greater_than(vis1, vis2, tcx)) {
    return vis2;
  } else {
    return vis1;
  }
}

/// Visitor used to determine impl visibility and reachability.
// rustc-type: compiler/rustc_privacy/src/lib.rs:345 FindMin
// PORT: the type parameter `VL: VisibilityLike` carries its impl table in `VL`; `const SHALLOW: bool` is the field.
class FindMin<VL> implements DefIdVisitor<undefined> {
  readonly DefIdResult = VisitorResult.unit;

  constructor(
    readonly tcx_: TyCtxt,
    readonly effective_visibilities: EffectiveVisibilities,
    public min: VL,
    readonly VL: VisibilityLike<VL>,
    readonly SHALLOW: boolean,
  ) {}

  // `impl DefIdVisitor for FindMin`
  // `const SHALLOW: bool = SHALLOW;` (the field)
  // rustc: compiler/rustc_privacy/src/lib.rs:355 skip_assoc_tys
  skip_assoc_tys(): boolean {
    return true;
  }
  // rustc: compiler/rustc_privacy/src/lib.rs:358 tcx
  tcx(): TyCtxt {
    return this.tcx_;
  }
  // rustc: compiler/rustc_privacy/src/lib.rs:361 visit_def_id
  visit_def_id(def_id: DefId, _kind: string, _descr: Display): undefined {
    const local = def_id.as_local();
    if (local !== undefined) {
      this.min = this.VL.new_min(this, local);
    }
    return undefined;
  }

  // ---- provided `DefIdVisitor` methods ----
  skeleton(): DefIdVisitorSkeleton<undefined> {
    return DefIdVisitor_provided.skeleton(this);
  }
  visit<T>(ty_fragment: T, d: TypeVisitable<T>): undefined {
    return DefIdVisitor_provided.visit(this, ty_fragment, d);
  }
  visit_trait(trait_ref: TraitRef): undefined {
    return DefIdVisitor_provided.visit_trait(this, trait_ref);
  }
  visit_gen_clauses(gen_clauses: GenericClauses): undefined {
    return DefIdVisitor_provided.visit_gen_clauses(this, gen_clauses);
  }
  visit_clauses(clauses: readonly (readonly [Clause, Span])[]): undefined {
    return DefIdVisitor_provided.visit_clauses(this, clauses);
  }
}

// rustc-trait: compiler/rustc_privacy/src/lib.rs:368 VisibilityLike
// PORT: one impl table per implementing type (`VisibilityLike_Visibility`, `VisibilityLike_EffectiveVisibility`); the
// provided `of_impl` is `VisibilityLike_provided.of_impl(impl, SHALLOW, ..)`.
interface VisibilityLike<Self> {
  /** `const MAX: Self;` (a fresh value per read: `EffectiveVisibility` is mutable in TS). */
  readonly MAX: Self;
  // rustc: compiler/rustc_privacy/src/lib.rs:370 new_min
  new_min(find: FindMin<Self>, def_id: LocalDefId): Self;
  // (provided) lib.rs:377 of_impl -> VisibilityLike_provided.of_impl
}

/** PORT: the provided methods of `VisibilityLike` (PORTING §8). */
const VisibilityLike_provided = {
  // Returns an over-approximation (`skip_assoc_tys()` = true) of visibility due to
  // associated types for which we can't determine visibility precisely.
  // rustc: compiler/rustc_privacy/src/lib.rs:377 of_impl
  of_impl<Self>(
    self_: VisibilityLike<Self>,
    SHALLOW: boolean,
    def_id: LocalDefId,
    of_trait: boolean,
    tcx: TyCtxt,
    effective_visibilities: EffectiveVisibilities,
  ): Self {
    const find = new FindMin<Self>(tcx, effective_visibilities, self_.MAX, self_, SHALLOW);
    find.visit(Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.type_of(def_id) as EarlyBinder<Ty>)), fold_Ty);
    if (of_trait) {
      find.visit_trait(Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.impl_trait_ref(def_id))));
    }
    return find.min;
  },
};

// `impl VisibilityLike for ty::Visibility`
const VisibilityLike_Visibility: VisibilityLike<Visibility<LocalModIdT>> = {
  get MAX(): Visibility<LocalModIdT> {
    return Visibility.Public;
  },
  // rustc: compiler/rustc_privacy/src/lib.rs:394 new_min
  new_min(find: FindMin<Visibility<LocalModIdT>>, def_id: LocalDefId): Visibility<LocalModIdT> {
    return min(find.tcx_.local_visibility(def_id), find.min, find.tcx_);
  },
};

// `impl VisibilityLike for EffectiveVisibility`
const VisibilityLike_EffectiveVisibility: VisibilityLike<EffectiveVisibility> = {
  get MAX(): EffectiveVisibility {
    return EffectiveVisibility.from_vis(Visibility.Public);
  },
  // rustc: compiler/rustc_privacy/src/lib.rs:404 new_min
  new_min(find: FindMin<EffectiveVisibility>, def_id: LocalDefId): EffectiveVisibility {
    const effective_vis =
      copied(find.effective_visibilities.effective_vis(def_id)) ??
      (() => {
        const private_vis = Visibility.Restricted(find.tcx_.parent_module_from_def_id(def_id));
        return EffectiveVisibility.from_vis(private_vis);
      })();

    return effective_vis.min(find.min, find.tcx_);
  },
};

// rustc-type: compiler/rustc_privacy/src/lib.rs:419 DefIdsToImpls
// PORT: the inner `FxHashSet`s iterate in hashbrown order (`queue.extend(impls)` reads it); the outer map is only
// looked up.
type DefIdsToImpls = Map<LocalDefId, FxHashSet<LocalDefId>>;

/// Visitor that collects correspondence map between defs and
/// enclosing impls.
// rustc-type: compiler/rustc_privacy/src/lib.rs:423 DefIdsToImplsCollector
class DefIdsToImplsCollector implements DefIdVisitor<undefined> {
  readonly DefIdResult = VisitorResult.unit;

  constructor(
    readonly tcx_: TyCtxt,
    readonly def_ids_to_impls: DefIdsToImpls,
    readonly impl_def_id: LocalDefId,
  ) {}

  // rustc: compiler/rustc_privacy/src/lib.rs:430 collect
  static collect(tcx: TyCtxt): DefIdsToImpls {
    const def_ids_to_impls: DefIdsToImpls = new Map();
    for (const item of tcx.hir_free_items()) {
      const impl_def_id = item.owner_id.def_id;
      const def_kind = tcx.def_kind(impl_def_id);
      if (def_kind.$ !== "Impl") {
        continue;
      }
      const of_trait = def_kind.of_trait;

      // This behavior should mirror `EffectiveVisibility::of_impl::<true>`.
      const visitor = new DefIdsToImplsCollector(tcx, def_ids_to_impls, impl_def_id);

      visitor.visit(Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.type_of(impl_def_id) as EarlyBinder<Ty>)), fold_Ty);
      if (of_trait) {
        visitor.visit_trait(Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.impl_trait_ref(impl_def_id))));
      }
    }

    return def_ids_to_impls;
  }

  // `impl DefIdVisitor for DefIdsToImplsCollector`
  /** `const SHALLOW: bool = true;` */
  readonly SHALLOW = true;
  // rustc: compiler/rustc_privacy/src/lib.rs:459 skip_assoc_tys
  skip_assoc_tys(): boolean {
    return true;
  }
  // rustc: compiler/rustc_privacy/src/lib.rs:462 tcx
  tcx(): TyCtxt {
    return this.tcx_;
  }
  // rustc: compiler/rustc_privacy/src/lib.rs:465 visit_def_id
  visit_def_id(def_id_: DefId, _kind: string, _descr: Display): undefined {
    const def_id = def_id_.as_local();
    if (def_id !== undefined) {
      // debug_assert_matches!(
      //     self.tcx.def_kind(def_id),
      //     DefKind::Enum
      //         | DefKind::Union
      //         | DefKind::Struct
      //         | DefKind::ForeignTy
      //         | DefKind::Trait
      // );
      let impls = this.def_ids_to_impls.get(def_id);
      if (impls === undefined) {
        impls = FxHashSet.default(LocalDefId_key);
        this.def_ids_to_impls.set(def_id, impls);
      }
      impls.add(this.impl_def_id);
    }
    return undefined;
  }

  // ---- provided `DefIdVisitor` methods ----
  skeleton(): DefIdVisitorSkeleton<undefined> {
    return DefIdVisitor_provided.skeleton(this);
  }
  visit<T>(ty_fragment: T, d: TypeVisitable<T>): undefined {
    return DefIdVisitor_provided.visit(this, ty_fragment, d);
  }
  visit_trait(trait_ref: TraitRef): undefined {
    return DefIdVisitor_provided.visit_trait(this, trait_ref);
  }
  visit_gen_clauses(gen_clauses: GenericClauses): undefined {
    return DefIdVisitor_provided.visit_gen_clauses(this, gen_clauses);
  }
  visit_clauses(clauses: readonly (readonly [Clause, Span])[]): undefined {
    return DefIdVisitor_provided.visit_clauses(this, clauses);
  }
}

/// The embargo visitor, used to determine the exports of the AST.
// rustc-type: compiler/rustc_privacy/src/lib.rs:481 EmbargoVisitor
class EmbargoVisitor {
  constructor(
    readonly tcx: TyCtxt,
    /// Effective visibilities for reachable nodes.
    readonly effective_visibilities: EffectiveVisibilities,
    /// Queue with modified items.
    readonly queue: IndexSet<LocalDefId>,
    /// Correspondence between def and impls containing this def.
    readonly def_ids_to_impls: DefIdsToImpls,
  ) {}

  // rustc: compiler/rustc_privacy/src/lib.rs:499 get
  get(def_id: LocalDefId): EffectiveVisibility | undefined {
    return copied(this.effective_visibilities.effective_vis(def_id));
  }

  // Updates node effective visibility.
  // rustc: compiler/rustc_privacy/src/lib.rs:504 update
  update(def_id: LocalDefId, inherited_effective_vis: EffectiveVisibility, level: Level): void {
    const nominal_vis = this.tcx.local_visibility(def_id);
    this.update_eff_vis(def_id, inherited_effective_vis, nominal_vis, level);
  }

  // rustc: compiler/rustc_privacy/src/lib.rs:514 update_eff_vis
  update_eff_vis(def_id: LocalDefId, inherited_effective_vis: EffectiveVisibility, max_vis: Visibility<LocalModIdT> | undefined, level: Level): boolean {
    const private_vis = Visibility.Restricted(this.tcx.parent_module_from_def_id(def_id));
    if (max_vis === undefined || !Visibility_eq(max_vis, private_vis)) {
      return this.effective_visibilities.update(def_id, max_vis, private_vis, inherited_effective_vis, level, this.tcx);
    }
    return false;
  }

  // rustc: compiler/rustc_privacy/src/lib.rs:535 reach
  reach(def_id: LocalDefId, effective_vis: EffectiveVisibility): ReachEverythingInTheInterfaceVisitor {
    return new ReachEverythingInTheInterfaceVisitor(effective_vis, def_id, this, "Reachable");
  }

  // rustc: compiler/rustc_privacy/src/lib.rs:548 reach_through_impl_trait
  reach_through_impl_trait(def_id: LocalDefId, effective_vis: EffectiveVisibility): ReachEverythingInTheInterfaceVisitor {
    return new ReachEverythingInTheInterfaceVisitor(effective_vis, def_id, this, "ReachableThroughImplTrait");
  }

  // rustc: compiler/rustc_privacy/src/lib.rs:563 check_assoc_item
  check_assoc_item(item: AssocItem, item_ev: EffectiveVisibility): void {
    const def_id = item.def_id.expect_local();
    const tcx = this.tcx;
    const reach = this.reach(def_id, item_ev);
    reach.generics().clauses();
    if (assoc_has_type_of(tcx, item)) {
      reach.ty();
    }
    if (AssocItem.is_type(item) && item.container.$ === "Trait") {
      reach.bounds();
    }
  }

  // rustc: compiler/rustc_privacy/src/lib.rs:576 check_def_id
  check_def_id(def_id: LocalDefId): void {
    // Update levels of nested things and mark all items
    // in interfaces of reachable items as reachable.
    const item_ev = this.get(def_id);
    const def_kind = this.tcx.def_kind(def_id);
    switch (def_kind.$) {
      // The interface is empty, and no nested items.
      case "Use":
      case "ExternCrate":
      case "GlobalAsm":
      case "TestBinderConstraints":
        break;
      // The interface is empty, and all nested items are processed by `check_def_id`.
      case "Mod":
        break;
      // Effective visibilities for macros are processed earlier.
      case "Macro":
        break;
      case "ForeignTy":
      case "Const":
      case "Static":
      case "Fn":
      case "TyAlias": {
        if (item_ev !== undefined) {
          this.reach(def_id, item_ev).generics().clauses().ty();
        }
        break;
      }
      case "Trait": {
        if (item_ev !== undefined) {
          this.reach(def_id, item_ev).generics().clauses();

          for (const assoc_item of AssocItems_in_definition_order(this.tcx, def_id)) {
            const def_id = assoc_item.def_id.expect_local();
            this.update(def_id, item_ev, "Reachable");

            this.check_assoc_item(assoc_item, item_ev);
          }
        }
        break;
      }
      case "TraitAlias": {
        if (item_ev !== undefined) {
          this.reach(def_id, item_ev).generics().clauses();
        }
        break;
      }
      case "Impl": {
        const of_trait = def_kind.of_trait;
        // Type inference is very smart sometimes. It can make an impl reachable even some
        // components of its type or trait are unreachable. E.g. methods of
        // `impl ReachableTrait<UnreachableTy> for ReachableTy<UnreachableTy> { ... }`
        // can be usable from other crates (#57264). So we skip args when calculating
        // reachability and consider an impl reachable if its "shallow" type and trait are
        // reachable.
        //
        // The assumption we make here is that type-inference won't let you use an impl
        // without knowing both "shallow" version of its self type and "shallow" version of
        // its trait if it exists (which require reaching the `DefId`s in them).
        const item_ev = VisibilityLike_provided.of_impl(VisibilityLike_EffectiveVisibility, true, def_id, of_trait, this.tcx, this.effective_visibilities);

        this.update_eff_vis(def_id, item_ev, undefined, "Direct");

        {
          const reach = this.reach(def_id, item_ev);
          reach.generics().clauses().ty();
          if (of_trait) {
            reach.trait_ref();
          }
        }

        for (const assoc_item of AssocItems_in_definition_order(this.tcx, def_id)) {
          const def_id = assoc_item.def_id.expect_local();
          const max_vis = of_trait ? undefined : this.tcx.local_visibility(def_id);
          this.update_eff_vis(def_id, item_ev, max_vis, "Direct");

          const impl_item_ev = this.get(def_id);
          if (impl_item_ev !== undefined) {
            this.check_assoc_item(assoc_item, impl_item_ev);
          }
        }
        break;
      }
      case "Enum": {
        if (item_ev !== undefined) {
          this.reach(def_id, item_ev).generics().clauses();
        }
        const def = this.tcx.adt_def(def_id) as AdtDef;
        for (const variant of def.variants()) {
          if (item_ev !== undefined) {
            this.update(variant.def_id.expect_local(), item_ev, "Reachable");
          }

          const variant_ev = this.get(variant.def_id.expect_local());
          if (variant_ev !== undefined) {
            const ctor_def_id = variant.ctor_def_id();
            if (ctor_def_id !== undefined) {
              this.update(ctor_def_id.expect_local(), variant_ev, "Reachable");
            }

            for (const field_ of variant.fields) {
              const field = field_.did.expect_local();
              this.update(field, variant_ev, "Reachable");
              this.reach(field, variant_ev).ty();
            }
            // Corner case: if the variant is reachable, but its
            // enum is not, make the enum reachable as well.
            this.reach(def_id, variant_ev).ty();
          }
          const ctor_def_id = variant.ctor_def_id();
          if (ctor_def_id !== undefined) {
            const ctor_ev = this.get(ctor_def_id.expect_local());
            if (ctor_ev !== undefined) {
              this.reach(def_id, ctor_ev).ty();
            }
          }
        }
        break;
      }
      case "Struct":
      case "Union": {
        const def = (this.tcx.adt_def(def_id) as AdtDef).non_enum_variant();
        if (item_ev !== undefined) {
          this.reach(def_id, item_ev).generics().clauses();
          for (const field_ of def.fields) {
            const field = field_.did.expect_local();
            this.update(field, item_ev, "Reachable");
            const field_ev = this.get(field);
            if (field_ev !== undefined) {
              this.reach(field, field_ev).ty();
            }
          }
        }
        const ctor_def_id = def.ctor_def_id();
        if (ctor_def_id !== undefined) {
          if (item_ev !== undefined) {
            this.update(ctor_def_id.expect_local(), item_ev, "Reachable");
          }
          const ctor_ev = this.get(ctor_def_id.expect_local());
          if (ctor_ev !== undefined) {
            this.reach(def_id, ctor_ev).ty();
          }
        }
        break;
      }
      // Contents are checked directly.
      case "ForeignMod":
        break;
      case "Field":
      case "Variant":
      case "AssocFn":
      case "AssocTy":
      case "AssocConst":
      case "TyParam":
      case "AnonConst":
      case "OpaqueTy":
      case "Closure":
      case "SyntheticCoroutineBody":
      case "ConstParam":
      case "LifetimeParam":
      case "Ctor":
        return span_bug(this.tcx.def_span(def_id), `${debug_DefKind(def_kind, PLAIN)} should be checked while checking parent`);
    }
  }
}

/** `tcx.associated_items(def_id).in_definition_order()` (the query value is `unknown` in queries.gen.ts). */
function AssocItems_in_definition_order(tcx: TyCtxt, def_id: LocalDefId | DefId): Iterable<AssocItem> {
  const items = tcx.associated_items(def_id) as AssocItems;
  return AssocItems.in_definition_order(items);
}

// rustc-type: compiler/rustc_privacy/src/lib.rs:491 ReachEverythingInTheInterfaceVisitor
class ReachEverythingInTheInterfaceVisitor implements DefIdVisitor<undefined> {
  readonly DefIdResult = VisitorResult.unit;
  readonly SHALLOW = DefIdVisitor_provided.SHALLOW;

  constructor(
    readonly effective_vis: EffectiveVisibility,
    readonly item_def_id: LocalDefId,
    readonly ev: EmbargoVisitor,
    readonly level: Level,
  ) {}

  // rustc: compiler/rustc_privacy/src/lib.rs:733 generics
  generics(): this {
    for (const param of (this.ev.tcx.generics_of(this.item_def_id) as Generics).own_params) {
      if (param.kind.$ === "Const") {
        this.visit(Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(this.ev.tcx.type_of(param.def_id) as EarlyBinder<Ty>)), fold_Ty);
      }
      const default_ = GenericParamDef.default_value(param, this.ev.tcx);
      if (default_ !== undefined) {
        this.visit(Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(default_)), fold_GenericArg);
      }
    }
    return this;
  }

  // rustc: compiler/rustc_privacy/src/lib.rs:747 clauses
  clauses(): this {
    this.visit_gen_clauses(this.ev.tcx.explicit_clauses_of(this.item_def_id) as GenericClauses);
    return this;
  }

  // rustc: compiler/rustc_privacy/src/lib.rs:752 bounds
  bounds(): this {
    this.visit_clauses(EarlyBinder.skip_binder(this.ev.tcx.explicit_item_bounds(this.item_def_id) as EarlyBinder<readonly (readonly [Clause, Span])[]>));
    return this;
  }

  // rustc: compiler/rustc_privacy/src/lib.rs:757 ty
  ty(): this {
    this.visit(Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(this.ev.tcx.type_of(this.item_def_id) as EarlyBinder<Ty>)), fold_Ty);
    return this;
  }

  // rustc: compiler/rustc_privacy/src/lib.rs:762 trait_ref
  trait_ref(): this {
    this.visit_trait(Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(this.ev.tcx.impl_trait_ref(this.item_def_id))));
    return this;
  }

  // If a def encountered in the interface is updated, we put those items
  // that may be affected by this update into the queue.
  // rustc: compiler/rustc_privacy/src/lib.rs:771 enqueue_def_id
  enqueue_def_id(def_id: LocalDefId): void {
    const def_kind = this.ev.tcx.def_kind(def_id);
    switch (def_kind.$) {
      case "Enum":
      case "Union":
      case "Struct":
      case "ForeignTy":
      case "Trait": {
        this.ev.queue.insert(def_id);
        // Make sure that all affected impls are traversed one more time.
        const impls = this.ev.def_ids_to_impls.get(def_id);
        if (impls !== undefined) {
          // The order in which items are traversed is irrelevant.
          // #[allow(rustc::potential_query_instability)]
          this.ev.queue.extend(impls);
        }
        break;
      }

      case "TraitAlias":
      case "Fn":
      case "TyAlias":
        this.ev.queue.insert(def_id);
        break;

      case "AssocConst":
      case "AssocFn":
      case "AssocTy":
        // Traverse the whole impl/trait.
        this.ev.queue.insert(this.ev.tcx.local_parent(def_id));
        break;

      case "Ctor": {
        const ctor_of = def_kind._0;
        let update_id: LocalDefId;
        switch (ctor_of) {
          case "Struct":
            update_id = this.ev.tcx.local_parent(def_id);
            break;
          case "Variant":
            update_id = this.ev.tcx.local_parent(this.ev.tcx.local_parent(def_id));
            break;
        }
        // Update the whole ADT.
        this.ev.queue.insert(update_id);
        break;
      }

      // Can be reached via RPIT (impl Fn), but can't affect
      // the effective visibility of other defs.
      case "Closure":
        break;

      // Can't be reached
      case "Impl":
      case "Field":
      case "Variant":
      case "Static":
      case "Macro":
      case "TyParam":
      case "AnonConst":
      case "OpaqueTy":
      case "SyntheticCoroutineBody":
      case "ConstParam":
      case "LifetimeParam":
      case "Mod":
      case "Use":
      case "ExternCrate":
      case "GlobalAsm":
      case "ForeignMod":
      case "Const":
      case "TestBinderConstraints":
        return span_bug(this.tcx().def_span(def_id), `${debug_DefKind(def_kind, PLAIN)} unexpectedly reached by \`ReachEverythingInTheInterfaceVisitor\``);
    }
  }

  // `impl DefIdVisitor for ReachEverythingInTheInterfaceVisitor`
  skip_assoc_tys(): boolean {
    return DefIdVisitor_provided.skip_assoc_tys(this);
  }
  // rustc: compiler/rustc_privacy/src/lib.rs:839 tcx
  tcx(): TyCtxt {
    return this.ev.tcx;
  }
  // rustc: compiler/rustc_privacy/src/lib.rs:842 visit_def_id
  visit_def_id(def_id_: DefId, _kind: string, _descr: Display): undefined {
    const def_id = def_id_.as_local();
    if (def_id !== undefined) {
      // All effective visibilities except `reachable_through_impl_trait` are limited to
      // nominal visibility. If any type or trait is leaked farther than that, it will
      // produce type privacy errors on any use, so we don't consider it leaked.
      //
      // FIXME: If self.level == Level::Reachable and self.ev == (priv, priv, priv, pub),
      // then the effective visibility of def_id wouldn't be updated at level
      // `ReachableThroughImplTrait` due to max_vis. Could this lead to a privacy violation?
      const max_vis = this.level !== "ReachableThroughImplTrait" ? this.ev.tcx.local_visibility(def_id) : undefined;
      if (this.ev.update_eff_vis(def_id, this.effective_vis, max_vis, this.level)) {
        this.enqueue_def_id(def_id);
      }
    }
    return undefined;
  }

  // ---- provided `DefIdVisitor` methods ----
  skeleton(): DefIdVisitorSkeleton<undefined> {
    return DefIdVisitor_provided.skeleton(this);
  }
  visit<T>(ty_fragment: T, d: TypeVisitable<T>): undefined {
    return DefIdVisitor_provided.visit(this, ty_fragment, d);
  }
  visit_trait(trait_ref: TraitRef): undefined {
    return DefIdVisitor_provided.visit_trait(this, trait_ref);
  }
  visit_gen_clauses(gen_clauses: GenericClauses): undefined {
    return DefIdVisitor_provided.visit_gen_clauses(this, gen_clauses);
  }
  visit_clauses(clauses: readonly (readonly [Clause, Span])[]): undefined {
    return DefIdVisitor_provided.visit_clauses(this, clauses);
  }
}

/// Visitor, used for EffectiveVisibilities table checking
// rustc-type: compiler/rustc_privacy/src/lib.rs:861 TestReachabilityVisitor
export class TestReachabilityVisitor {
  constructor(
    readonly tcx: TyCtxt,
    readonly effective_visibilities: EffectiveVisibilities,
  ) {}

  // rustc: compiler/rustc_privacy/src/lib.rs:867 effective_visibility_diagnostic
  effective_visibility_diagnostic(def_id: LocalDefId): void {
    if (find_attr(HasAttrs_LocalDefId.get_attrs(def_id, this.tcx), (k) => (k.$ === "RustcEffectiveVisibility" ? null : undefined)) !== undefined) {
      let error_msg = "";
      const span = this.tcx.def_span(LocalDefId.to_def_id(def_id));
      const effective_vis = this.effective_visibilities.effective_vis(def_id);
      if (effective_vis !== undefined) {
        for (const level of Level.all_levels()) {
          const vis_str = Visibility.to_string(effective_vis.at_level(level), def_id, this.tcx);
          if (level !== "Direct") {
            error_msg += ", ";
          }
          error_msg += `${debug_Level(level, PLAIN)}: ${vis_str}`;
        }
      } else {
        error_msg += "not in the table";
      }
      this.tcx.dcx().emit_err(ReportEffectiveVisibility_diagnostic({ span, descr: error_msg }));
    }
  }

  // rustc: compiler/rustc_privacy/src/lib.rs:888 check_def_id
  check_def_id(owner_id: OwnerId): void {
    this.effective_visibility_diagnostic(owner_id.def_id);

    switch (this.tcx.def_kind(owner_id.def_id).$) {
      case "Enum": {
        const def = this.tcx.adt_def(owner_id.def_id) as AdtDef;
        for (const variant of def.variants()) {
          this.effective_visibility_diagnostic(variant.def_id.expect_local());
          const ctor_def_id = variant.ctor_def_id();
          if (ctor_def_id !== undefined) {
            this.effective_visibility_diagnostic(ctor_def_id.expect_local());
          }
          for (const field of variant.fields) {
            this.effective_visibility_diagnostic(field.did.expect_local());
          }
        }
        break;
      }
      case "Struct":
      case "Union": {
        const def = (this.tcx.adt_def(owner_id.def_id) as AdtDef).non_enum_variant();
        const ctor_def_id = def.ctor_def_id();
        if (ctor_def_id !== undefined) {
          this.effective_visibility_diagnostic(ctor_def_id.expect_local());
        }
        for (const field of def.fields) {
          this.effective_visibility_diagnostic(field.did.expect_local());
        }
        break;
      }
      default:
        break;
    }
  }
}

/// Name privacy visitor, checks privacy and reports violations.
///
/// Most of name privacy checks are performed during the main resolution phase,
/// or later in type checking when field accesses and associated items are resolved.
/// This pass performs remaining checks for fields in struct expressions and patterns.
// rustc-type: compiler/rustc_privacy/src/lib.rs:923 NamePrivacyVisitor
class NamePrivacyVisitor extends Visitor {
  constructor(
    readonly tcx: TyCtxt,
    readonly mod_id: LocalModIdT,
    public maybe_typeck_results: TypeckResults | undefined,
  ) {
    super();
  }

  /// Gets the type-checking results for the current body.
  /// As this will ICE if called outside bodies, only call when working with
  /// `Expr` or `Pat` nodes (they are guaranteed to be found only in bodies).
  // #[track_caller]
  // rustc: compiler/rustc_privacy/src/lib.rs:934 typeck_results
  typeck_results(): TypeckResults {
    if (this.maybe_typeck_results === undefined) {
      return bug_expect("`NamePrivacyVisitor::typeck_results` called outside of body");
    }
    return this.maybe_typeck_results;
  }

  // Checks that a field in a struct constructor (expression or pattern) is accessible.
  // rustc: compiler/rustc_privacy/src/lib.rs:940 check_field
  check_field(
    use_ctxt: Span, // syntax context of the field name at the use site
    def: AdtDef, // definition of the struct or enum
    field: FieldDef,
  ): boolean {
    if (def.is_enum()) {
      return true;
    }

    // definition of the field
    const ident = Ident.new(sym.dummy, use_ctxt);
    const [, def_id] = this.tcx.adjust_ident_and_get_scope(ident, def.did(), this.mod_id);
    return !Visibility.is_accessible_from(field.vis, def_id, this.tcx);
  }

  // Checks that a field in a struct constructor (expression or pattern) is accessible.
  // rustc: compiler/rustc_privacy/src/lib.rs:957 emit_unreachable_field_error
  emit_unreachable_field_error(
    fields: [Symbol, Span, boolean /* field is present */][],
    def: AdtDef, // definition of the struct or enum
    update_syntax: Span | undefined,
    struct_span: Span,
  ): void {
    if (def.is_enum() || fields.length === 0) {
      return;
    }

    //   error[E0451]: fields `beta` and `gamma` of struct `Alpha` are private
    //   --> $DIR/visibility.rs:18:13
    //    |
    // LL |     let _x = Alpha {
    //    |              ----- in this type      # from `def`
    // LL |         beta: 0,
    //    |         ^^^^^^^ private field        # `fields.2` is `true`
    // LL |         ..
    //    |         ^^ field `gamma` is private  # `fields.2` is `false`

    // Get the list of all private fields for the main message.
    const field_names = listify(fields, ([n]) => `\`${display_Symbol(n)}\``);
    if (field_names === undefined) return;
    const span: MultiSpan = MultiSpan.from_spans(fields.map(([, span]) => span));

    // Get the list of all private fields when pointing at the `..rest`.
    const rest_field_names_: Symbol[] = fields.filter(([, , is_present]) => !is_present).map(([n]) => n);
    const rest_len = rest_field_names_.length;
    const rest_field_names = listify(rest_field_names_, (n) => `\`${display_Symbol(n)}\``) ?? "";
    // Get all the labels for each field or `..rest` in the primary MultiSpan.
    const labels: FieldIsPrivateLabel[] = [
      ...fields.filter(([, , is_present]) => is_present).map(([, span]): FieldIsPrivateLabel => ({ $: "Other", span })),
      ...(update_syntax !== undefined ? [update_syntax] : []).map(
        (span): FieldIsPrivateLabel => ({
          $: "IsUpdateSyntax",
          span,
          rest_field_names,
          rest_len,
        }),
      ),
    ];

    this.tcx.dcx().emit_err(
      FieldIsPrivate_diagnostic({
        span,
        struct_span: this.tcx.sess.source_map().is_multiline(Span.between(fields[0]![1], struct_span)) ? struct_span : undefined,
        field_names,
        variant_descr: def.variant_descr(),
        def_path_str: this.tcx.def_path_str(def.did()),
        labels,
        len: fields.length,
      }),
    );
  }

  // rustc: compiler/rustc_privacy/src/lib.rs:1020 check_expanded_fields
  check_expanded_fields(adt: AdtDef, variant: VariantDef, fields: readonly ExprField[], span: Span, struct_span: Span): void {
    const failed_fields: [Symbol, Span, boolean][] = [];
    for (const [vf_index, variant_field] of variant.fields.entries()) {
      const field = fields.find((f) => this.typeck_results().field_index(f.hir_id) === vf_index);
      const [use_ctxt, span_] = field !== undefined ? [field.ident.span, field.span] : [span, span];
      if (this.check_field(use_ctxt, adt, variant_field)) {
        const name = field !== undefined ? field.ident.name : variant_field.name;
        failed_fields.push([name, span_, field !== undefined]);
      }
    }
    this.emit_unreachable_field_error(failed_fields, adt, span, struct_span);
  }

  // `impl Visitor for NamePrivacyVisitor`

  // rustc: compiler/rustc_privacy/src/lib.rs:1049 visit_nested_body
  override visit_nested_body(body_id: BodyId): undefined {
    const new_typeck_results = this.tcx.typeck_body(body_id as unknown as MiddleBodyId);
    // Do not try reporting privacy violations if we failed to infer types.
    if (new_typeck_results.tainted_by_errors !== undefined) {
      return undefined;
    }
    const old_maybe_typeck_results = this.maybe_typeck_results;
    this.maybe_typeck_results = new_typeck_results;
    this.visit_body(this.tcx.hir_body(body_id));
    this.maybe_typeck_results = old_maybe_typeck_results;
    return undefined;
  }

  // rustc: compiler/rustc_privacy/src/lib.rs:1060 visit_expr
  override visit_expr(expr: Expr): undefined {
    if (expr.kind.$ === "Struct") {
      const qpath = expr.kind._0;
      const fields = expr.kind._1;
      const base = expr.kind._2;
      const res = this.typeck_results().qpath_res(qpath, expr.hir_id);
      const adt = unwrap(this.typeck_results().expr_ty(expr).ty_adt_def());
      const variant = adt.variant_of_res(res);
      switch (base.$) {
        case "Base": {
          // If the expression uses FRU we need to make sure all the unmentioned fields
          // are checked for privacy (RFC 736). Rather than computing the set of
          // unmentioned fields, just check them all.
          this.check_expanded_fields(adt, variant, fields, base._0.span, QPath.span(qpath));
          break;
        }
        case "DefaultFields": {
          this.check_expanded_fields(adt, variant, fields, base._0, QPath.span(qpath));
          break;
        }
        case "None":
        case "NoneWithError": {
          const failed_fields: [Symbol, Span, boolean][] = [];
          for (const field of fields) {
            const index = this.typeck_results().field_index(field.hir_id);
            if (this.check_field(field.ident.span, adt, variant.fields[index]!)) {
              failed_fields.push([field.ident.name, field.ident.span, true]);
            }
          }
          this.emit_unreachable_field_error(failed_fields, adt, undefined, QPath.span(qpath));
          break;
        }
      }
    }

    walk_expr(this, expr);
    return undefined;
  }

  // rustc: compiler/rustc_privacy/src/lib.rs:1091 visit_pat
  override visit_pat(pat: Pat): undefined {
    if (pat.kind.$ === "Struct") {
      const qpath = pat.kind._0;
      const fields = pat.kind._1;
      const res = this.typeck_results().qpath_res(qpath, pat.hir_id);
      const adt = unwrap(this.typeck_results().pat_ty(pat).ty_adt_def());
      const variant = adt.variant_of_res(res);
      const failed_fields: [Symbol, Span, boolean][] = [];
      for (const field of fields) {
        const index = this.typeck_results().field_index(field.hir_id);
        if (this.check_field(field.ident.span, adt, variant.fields[index]!)) {
          failed_fields.push([field.ident.name, field.ident.span, true]);
        }
      }
      this.emit_unreachable_field_error(failed_fields, adt, undefined, QPath.span(qpath));
    }

    walk_pat(this, pat);
    return undefined;
  }
}

/** `Option::expect(msg)` on `None`: a panic (an ICE). */
function bug_expect(msg: string): never {
  return bug(msg);
}

/// Type privacy visitor, checks types for privacy and reports violations.
///
/// Both explicitly written types and inferred types of expressions and patterns are checked.
/// Checks are performed on "semantic" types regardless of names and their hygiene.
// rustc-type: compiler/rustc_privacy/src/lib.rs:1114 TypePrivacyVisitor
class TypePrivacyVisitor extends Visitor implements DefIdVisitor<ControlFlow<null>> {
  /** `impl DefIdVisitor`: `type Result = ControlFlow<()>;` */
  readonly DefIdResult = VisitorResult.ControlFlow<null>();
  readonly SHALLOW = DefIdVisitor_provided.SHALLOW;

  constructor(
    readonly tcx_: TyCtxt,
    readonly mod_id: LocalModIdT,
    public maybe_typeck_results: TypeckResults | undefined,
    public span: Span,
    /// Types already walked clean (no privacy error). A walk's result depends only on the
    /// interned type and `mod_id`, which is fixed for the whole visit, so a type that walks
    /// clean once walks clean everywhere and we can skip it. Errored walks are never cached,
    /// so their error still fires at every span.
    readonly accessible_tys: Set<Ty>,
  ) {
    super();
  }

  // rustc: compiler/rustc_privacy/src/lib.rs:1127 item_is_accessible
  item_is_accessible(did: DefId): boolean {
    return Visibility.is_accessible_from(this.tcx_.visibility(did), this.mod_id, this.tcx_);
  }

  // rustc: compiler/rustc_privacy/src/lib.rs:1131 check_ty
  check_ty(ty: Ty): ControlFlow<null> {
    if (this.accessible_tys.has(ty)) {
      return ControlFlow.CONTINUE;
    }
    const r = this.visit(ty, fold_Ty);
    if (r.$ === "Break") return r;
    this.accessible_tys.add(ty);
    return ControlFlow.CONTINUE;
  }

  // Take node-id of an expression or pattern and check its type for privacy.
  // rustc: compiler/rustc_privacy/src/lib.rs:1141 check_expr_pat_type
  check_expr_pat_type(id: HirId, span: Span): boolean {
    this.span = span;
    const typeck_results = this.maybe_typeck_results ?? span_bug(span, "`hir::Expr` or `hir::Pat` outside of a body");
    // `try { .. }.is_break()`
    const r = ((): ControlFlow<null> => {
      let b: ControlFlow<null>;
      if ((b = this.check_ty(typeck_results.node_type(id))).$ === "Break") return b;
      if ((b = this.visit(typeck_results.node_args(id), fold_GenericArgs)).$ === "Break") return b;
      const adjustments = typeck_results.adjustments().get(id);
      if (adjustments !== undefined) {
        for (const adjustment of adjustments) {
          if ((b = this.check_ty(adjustment.target)).$ === "Break") return b;
        }
      }
      return ControlFlow.CONTINUE;
    })();
    return r.$ === "Break";
  }

  // rustc: compiler/rustc_privacy/src/lib.rs:1156 check_def_id
  check_def_id(def_id: DefId, kind: string, descr: Display): boolean {
    const is_error = !this.item_is_accessible(def_id);
    if (is_error) {
      this.tcx_.dcx().emit_err(ItemIsPrivate_diagnostic({ span: this.span, kind, descr: DiagArgFromDisplay_from_dyn(descr) }));
    }
    return is_error;
  }

  // `impl rustc_ty_walk::SpannedTypeVisitor for TypePrivacyVisitor`: `type Result = ControlFlow<()>;`
  // PORT: the impl is the adapter object `as_spanned_type_visitor()` (its `Result` clashes with the HIR `Visitor`'s).
  // rustc: compiler/rustc_privacy/src/lib.rs:1167 visit
  SpannedTypeVisitor_visit<T>(span: Span, value: T, d: TypeVisitable<T>): ControlFlow<null> {
    this.span = span;
    return d.visit_with(value, this.skeleton());
  }

  /** `&mut TypePrivacyVisitor` as a `SpannedTypeVisitor`. */
  as_spanned_type_visitor(): SpannedTypeVisitor<ControlFlow<null>> {
    return {
      Result: VisitorResult.ControlFlow<null>(),
      visit: <T>(span: Span, value: T, d: TypeVisitable<T>) => this.SpannedTypeVisitor_visit(span, value, d),
    };
  }

  // `impl Visitor for TypePrivacyVisitor`

  // rustc: compiler/rustc_privacy/src/lib.rs:1174 visit_nested_body
  override visit_nested_body(body_id: BodyId): undefined {
    const old_maybe_typeck_results = this.maybe_typeck_results;
    this.maybe_typeck_results = this.tcx_.typeck_body(body_id as unknown as MiddleBodyId);
    this.visit_body(this.tcx_.hir_body(body_id));
    this.maybe_typeck_results = old_maybe_typeck_results;
    return undefined;
  }

  // rustc: compiler/rustc_privacy/src/lib.rs:1181 visit_ty
  override visit_ty(hir_ty: HirTy<AmbigArg>): undefined {
    this.span = hir_ty.span;
    const ty = (this.maybe_typeck_results ?? span_bug(hir_ty.span, "`hir::Ty` outside of a body")).node_type(hir_ty.hir_id);
    if (this.check_ty(ty).$ === "Break") {
      return undefined;
    }

    walk_ty(this, hir_ty);
    return undefined;
  }

  // rustc: compiler/rustc_privacy/src/lib.rs:1194 visit_infer
  override visit_infer(inf_id: HirId, inf_span: Span, _kind: InferKind): undefined {
    this.span = inf_span;
    const ty = (this.maybe_typeck_results ?? span_bug(inf_span, "Inference variable outside of a body")).node_type_opt(inf_id);
    if (ty !== undefined) {
      if (this.check_ty(ty).$ === "Break") {
        return undefined;
      }
    } else {
      // FIXME: check types of const infers here.
    }

    return this.visit_id(inf_id);
  }

  // Check types of expressions
  // rustc: compiler/rustc_privacy/src/lib.rs:1217 visit_expr
  override visit_expr(expr: Expr): undefined {
    if (this.check_expr_pat_type(expr.hir_id, expr.span)) {
      // Do not check nested expressions if the error already happened.
      return undefined;
    }
    if (expr.kind.$ === "Assign" || expr.kind.$ === "Match") {
      // `hir::ExprKind::Assign(_, rhs, _) | hir::ExprKind::Match(rhs, ..)`
      const rhs = expr.kind.$ === "Assign" ? expr.kind._1 : expr.kind._0;
      // Do not report duplicate errors for `x = y` and `match x { ... }`.
      if (this.check_expr_pat_type(rhs.hir_id, rhs.span)) {
        return undefined;
      }
    } else if (expr.kind.$ === "MethodCall") {
      const segment = expr.kind._0;
      // Method calls have to be checked specially.
      this.span = segment.ident.span;
      const typeck_results = this.maybe_typeck_results ?? span_bug(this.span, "`hir::Expr` outside of a body");
      const def_id = typeck_results.type_dependent_def_id(expr.hir_id);
      if (def_id !== undefined) {
        if (this.check_ty(Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(this.tcx_.type_of(def_id) as EarlyBinder<Ty>))).$ === "Break") {
          return undefined;
        }
      } else {
        this.tcx_.dcx().span_delayed_bug(expr.span, "no type-dependent def for method call");
      }
    }

    walk_expr(this, expr);
    return undefined;
  }

  // Prohibit access to associated items with insufficient nominal visibility.
  //
  // Additionally, until better reachability analysis for macros 2.0 is available,
  // we prohibit access to private statics from other crates, this allows to give
  // more code internal visibility at link time. (Access to private functions
  // is already prohibited by type privacy for function types.)
  // rustc: compiler/rustc_privacy/src/lib.rs:1260 visit_qpath
  override visit_qpath(qpath: QPath, id: HirId, span: Span): undefined {
    let def: [DefKind, DefId] | undefined;
    switch (qpath.$) {
      case "Resolved": {
        const path = qpath._1;
        def = path.res.$ === "Def" ? [path.res._0, path.res._1] : undefined;
        break;
      }
      case "TypeRelative": {
        if (this.maybe_typeck_results !== undefined) {
          def = this.maybe_typeck_results.type_dependent_def(id);
        } else {
          // FIXME: Check type-relative associated types in signatures.
          def = undefined;
        }
        break;
      }
    }
    if (def !== undefined) {
      const kind = def[0];
      if (!(kind.$ === "AssocFn" || kind.$ === "AssocConst" || kind.$ === "AssocTy" || kind.$ === "Static")) {
        def = undefined;
      }
    }
    if (def !== undefined) {
      const [kind, def_id] = def;
      const is_local_static = kind.$ === "Static" ? def_id.is_local() : false;
      if (!this.item_is_accessible(def_id) && !is_local_static) {
        let name: string | undefined;
        switch (qpath.$) {
          case "Resolved": {
            const path = qpath._1;
            name = this.tcx_.def_path_str(Res.def_id(path.res, debug_HirId));
            break;
          }
          case "TypeRelative": {
            const segment = qpath._1;
            name = display_Ident(segment.ident);
            break;
          }
        }
        const kind = this.tcx_.def_descr(def_id);
        const sess = this.tcx_.sess;
        if (name !== undefined) {
          const n = name;
          sess.dcx().emit_err(ItemIsPrivate_diagnostic({ span, kind, descr: DiagArgFromDisplay_from_dyn(() => n) }));
        } else {
          sess.dcx().emit_err(UnnamedItemIsPrivate_diagnostic({ span, kind }));
        }
        return undefined;
      }
    }

    walk_qpath(this, qpath, id);
    return undefined;
  }

  // Check types of patterns.
  // rustc: compiler/rustc_privacy/src/lib.rs:1304 visit_pat
  override visit_pat(pattern: Pat): undefined {
    if (this.check_expr_pat_type(pattern.hir_id, pattern.span)) {
      // Do not check nested patterns if the error already happened.
      return undefined;
    }

    walk_pat(this, pattern);
    return undefined;
  }

  // rustc: compiler/rustc_privacy/src/lib.rs:1313 visit_local
  override visit_local(local: LetStmt): undefined {
    const init = local.init;
    if (init !== undefined) {
      if (this.check_expr_pat_type(init.hir_id, init.span)) {
        // Do not report duplicate errors for `let x = y`.
        return undefined;
      }
    }

    walk_local(this, local);
    return undefined;
  }

  // `impl DefIdVisitor for TypePrivacyVisitor`
  skip_assoc_tys(): boolean {
    return DefIdVisitor_provided.skip_assoc_tys(this);
  }
  // rustc: compiler/rustc_privacy/src/lib.rs:1327 tcx
  tcx(): TyCtxt {
    return this.tcx_;
  }
  // rustc: compiler/rustc_privacy/src/lib.rs:1330 visit_def_id
  visit_def_id(def_id: DefId, kind: string, descr: Display): ControlFlow<null> {
    if (this.check_def_id(def_id, kind, descr)) {
      return ControlFlow.Break(null);
    } else {
      return ControlFlow.CONTINUE;
    }
  }

  // ---- provided `DefIdVisitor` methods ----
  skeleton(): DefIdVisitorSkeleton<ControlFlow<null>> {
    return DefIdVisitor_provided.skeleton(this);
  }
  visit<T>(ty_fragment: T, d: TypeVisitable<T>): ControlFlow<null> {
    return DefIdVisitor_provided.visit(this, ty_fragment, d);
  }
  visit_trait(trait_ref: TraitRef): ControlFlow<null> {
    return DefIdVisitor_provided.visit_trait(this, trait_ref);
  }
  visit_gen_clauses(gen_clauses: GenericClauses): ControlFlow<null> {
    return DefIdVisitor_provided.visit_gen_clauses(this, gen_clauses);
  }
  visit_clauses(clauses: readonly (readonly [Clause, Span])[]): ControlFlow<null> {
    return DefIdVisitor_provided.visit_clauses(this, clauses);
  }
}

/// SearchInterfaceForPrivateItemsVisitor traverses an item's interface and
/// finds any private components in it.
///
/// PrivateItemsInPublicInterfacesVisitor ensures there are no private types
/// and traits in public interfaces.
// rustc-type: compiler/rustc_privacy/src/lib.rs:1349 SearchInterfaceForPrivateItemsVisitor
class SearchInterfaceForPrivateItemsVisitor implements DefIdVisitor<ControlFlow<null>> {
  /** `impl DefIdVisitor`: `type Result = ControlFlow<()>;` */
  readonly DefIdResult = VisitorResult.ControlFlow<null>();
  readonly SHALLOW = DefIdVisitor_provided.SHALLOW;

  // PORT: `#![feature(default_field_values)]`: the defaults are constructor parameter defaults.
  constructor(
    readonly tcx_: TyCtxt,
    readonly item_def_id: LocalDefId,
    /// The visitor checks that each component type is at least this visible.
    readonly required_visibility: Visibility<LocalModIdT>,
    readonly required_effective_vis: EffectiveVisibility | undefined,
    public hard_error: boolean = false,
    public in_primary_interface: boolean = true,
    public skip_assoc_tys_: boolean = false,
  ) {}

  // rustc: compiler/rustc_privacy/src/lib.rs:1361 generics
  generics(): this {
    this.in_primary_interface = true;
    for (const param of (this.tcx_.generics_of(this.item_def_id) as Generics).own_params) {
      if (param.kind.$ === "Const") {
        this.visit(Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(this.tcx_.type_of(param.def_id) as EarlyBinder<Ty>)), fold_Ty);
      }
      const default_ = GenericParamDef.default_value(param, this.tcx_);
      if (default_ !== undefined) {
        this.visit(Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(default_)), fold_GenericArg);
      }
    }
    return this;
  }

  // rustc: compiler/rustc_privacy/src/lib.rs:1375 clauses
  clauses(): this {
    this.in_primary_interface = false;
    // N.B., we use `explicit_clauses_of` and not `clauses_of`
    // because we don't want to report privacy errors due to where
    // clauses that the compiler inferred. We only want to
    // consider the ones that the user wrote. This is important
    // for the inferred outlives rules; see
    // `tests/ui/rfc-2093-infer-outlives/privacy.rs`.
    this.visit_gen_clauses(this.tcx_.explicit_clauses_of(this.item_def_id) as GenericClauses);
    return this;
  }

  // rustc: compiler/rustc_privacy/src/lib.rs:1387 bounds
  bounds(): this {
    this.in_primary_interface = false;
    this.visit_clauses(EarlyBinder.skip_binder(this.tcx_.explicit_item_bounds(this.item_def_id) as EarlyBinder<readonly (readonly [Clause, Span])[]>));
    return this;
  }

  // rustc: compiler/rustc_privacy/src/lib.rs:1393 ty
  ty(): this {
    this.in_primary_interface = true;
    this.visit(Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(this.tcx_.type_of(this.item_def_id) as EarlyBinder<Ty>)), fold_Ty);
    return this;
  }

  // rustc: compiler/rustc_privacy/src/lib.rs:1400 trait_ref
  trait_ref(): this {
    this.in_primary_interface = true;
    this.visit_trait(Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(this.tcx_.impl_trait_ref(this.item_def_id))));
    return this;
  }

  // rustc: compiler/rustc_privacy/src/lib.rs:1408 check_def_id
  check_def_id(def_id: DefId, kind: string, descr: Display): boolean {
    if (this.leaks_private_dep(def_id)) {
      this.tcx_.emit_node_span_lint(
        EXPORTED_PRIVATE_DEPENDENCIES,
        this.tcx_.local_def_id_to_hir_id(this.item_def_id),
        this.tcx_.def_span(LocalDefId.to_def_id(this.item_def_id)),
        FromPrivateDependencyInPublicInterface_diagnostic({
          kind,
          descr: DiagArgFromDisplay_from_dyn(descr),
          krate: this.tcx_.crate_name(def_id.krate),
        }),
      );
    }

    const local_def_id = def_id.as_local();
    if (local_def_id === undefined) {
      return false;
    }

    const vis = this.tcx_.local_visibility(local_def_id);
    if (this.hard_error && Visibility.greater_than(this.required_visibility, vis, this.tcx_)) {
      let vis_descr: string;
      switch (vis.$) {
        case "Public":
          vis_descr = "public";
          break;
        case "Restricted": {
          const vis_mod_id = vis._0;
          if (vis_mod_id === this.tcx_.parent_module_from_def_id(local_def_id)) {
            vis_descr = "private";
          } else if (LocalModId.is_top_level_module(vis_mod_id)) {
            vis_descr = "crate-private";
          } else {
            vis_descr = "restricted";
          }
          break;
        }
      }

      const span = this.tcx_.def_span(LocalDefId.to_def_id(this.item_def_id));
      const vis_span = this.tcx_.def_span(def_id);
      this.tcx_.dcx().emit_err(
        InPublicInterface_diagnostic({
          span,
          vis_descr,
          kind,
          descr: DiagArgFromDisplay_from_dyn(descr),
          vis_span,
        }),
      );
      return false;
    }

    const effective_vis = this.required_effective_vis;
    if (effective_vis === undefined) {
      return false;
    }

    const reachable_at_vis = effective_vis.at_level("Reachable");

    if (Visibility.greater_than(reachable_at_vis, vis, this.tcx_)) {
      const lint = this.in_primary_interface ? PRIVATE_INTERFACES : PRIVATE_BOUNDS;
      const span = this.tcx_.def_span(LocalDefId.to_def_id(this.item_def_id));
      const vis_span = this.tcx_.def_span(def_id);
      this.tcx_.emit_node_span_lint(
        lint,
        this.tcx_.local_def_id_to_hir_id(this.item_def_id),
        span,
        PrivateInterfacesOrBoundsLint_diagnostic({
          item_span: span,
          item_kind: this.tcx_.def_descr(LocalDefId.to_def_id(this.item_def_id)),
          item_descr: DiagArgFromDisplay_from_dyn(lazy_def_path_str(LocalDefId.to_def_id(this.item_def_id), this.tcx_)),
          item_vis_descr: Visibility.to_string(reachable_at_vis, this.item_def_id, this.tcx_),
          ty_span: vis_span,
          ty_kind: kind,
          ty_descr: DiagArgFromDisplay_from_dyn(descr),
          ty_vis_descr: Visibility.to_string(vis, local_def_id, this.tcx_),
        }),
      );
    }

    return false;
  }

  /// An item is 'leaked' from a private dependency if all
  /// of the following are true:
  /// 1. It's contained within a public type
  /// 2. It comes from a private crate
  // rustc: compiler/rustc_privacy/src/lib.rs:1491 leaks_private_dep
  leaks_private_dep(item_id: DefId): boolean {
    const ret = Visibility.is_public(this.required_visibility) && this.tcx_.is_private_dep(item_id.krate);

    // debug!("leaks_private_dep(item_id={:?})={}", item_id, ret);
    return ret;
  }

  // `impl DefIdVisitor for SearchInterfaceForPrivateItemsVisitor`
  // rustc: compiler/rustc_privacy/src/lib.rs:1501 skip_assoc_tys
  skip_assoc_tys(): boolean {
    return this.skip_assoc_tys_;
  }
  // rustc: compiler/rustc_privacy/src/lib.rs:1504 tcx
  tcx(): TyCtxt {
    return this.tcx_;
  }
  // rustc: compiler/rustc_privacy/src/lib.rs:1507 visit_def_id
  visit_def_id(def_id: DefId, kind: string, descr: Display): ControlFlow<null> {
    if (this.check_def_id(def_id, kind, descr)) {
      return ControlFlow.Break(null);
    } else {
      return ControlFlow.CONTINUE;
    }
  }

  // ---- provided `DefIdVisitor` methods ----
  skeleton(): DefIdVisitorSkeleton<ControlFlow<null>> {
    return DefIdVisitor_provided.skeleton(this);
  }
  visit<T>(ty_fragment: T, d: TypeVisitable<T>): ControlFlow<null> {
    return DefIdVisitor_provided.visit(this, ty_fragment, d);
  }
  visit_trait(trait_ref: TraitRef): ControlFlow<null> {
    return DefIdVisitor_provided.visit_trait(this, trait_ref);
  }
  visit_gen_clauses(gen_clauses: GenericClauses): ControlFlow<null> {
    return DefIdVisitor_provided.visit_gen_clauses(this, gen_clauses);
  }
  visit_clauses(clauses: readonly (readonly [Clause, Span])[]): ControlFlow<null> {
    return DefIdVisitor_provided.visit_clauses(this, clauses);
  }
}

// rustc-type: compiler/rustc_privacy/src/lib.rs:1521 PrivateItemsInPublicInterfacesChecker
class PrivateItemsInPublicInterfacesChecker {
  constructor(
    readonly tcx: TyCtxt,
    readonly effective_visibilities: EffectiveVisibilities,
  ) {}

  // rustc: compiler/rustc_privacy/src/lib.rs:1527 check
  check(def_id: LocalDefId, required_visibility: Visibility<LocalModIdT>, required_effective_vis: EffectiveVisibility | undefined): SearchInterfaceForPrivateItemsVisitor {
    return new SearchInterfaceForPrivateItemsVisitor(this.tcx, def_id, required_visibility, required_effective_vis);
  }

  // rustc: compiler/rustc_privacy/src/lib.rs:1542 check_unnameable
  check_unnameable(def_id: LocalDefId, effective_vis: EffectiveVisibility | undefined): void {
    if (effective_vis === undefined) {
      return;
    }

    const reexported_at_vis = effective_vis.at_level("Reexported");
    const reachable_at_vis = effective_vis.at_level("Reachable");

    if (Visibility.is_public(reachable_at_vis) && !Visibility_eq(reexported_at_vis, reachable_at_vis)) {
      const hir_id = this.tcx.local_def_id_to_hir_id(def_id);
      const span = this.tcx.def_span(LocalDefId.to_def_id(def_id));
      this.tcx.emit_node_span_lint(
        UNNAMEABLE_TYPES,
        hir_id,
        span,
        UnnameableTypesLint_diagnostic({
          span,
          kind: this.tcx.def_descr(LocalDefId.to_def_id(def_id)),
          descr: DiagArgFromDisplay_from_dyn(lazy_def_path_str(LocalDefId.to_def_id(def_id), this.tcx)),
          reachable_vis: Visibility.to_string(reachable_at_vis, def_id, this.tcx),
          reexported_vis: Visibility.to_string(reexported_at_vis, def_id, this.tcx),
        }),
      );
    }
  }

  // rustc: compiler/rustc_privacy/src/lib.rs:1568 check_assoc_item
  check_assoc_item(item: AssocItem, vis: Visibility<LocalModIdT>, effective_vis: EffectiveVisibility | undefined): void {
    const check = this.check(item.def_id.expect_local(), vis, effective_vis);

    const is_assoc_ty = AssocItem.is_type(item);
    check.hard_error = is_assoc_ty;
    check.generics().clauses();
    if (assoc_has_type_of(this.tcx, item)) {
      check.ty();
    }
    if (is_assoc_ty && item.container.$ === "Trait") {
      // FIXME: too much breakage from reporting hard errors here, better wait for a fix
      // from proper associated type normalization.
      check.hard_error = false;
      check.bounds();
    }
  }

  // rustc: compiler/rustc_privacy/src/lib.rs:1590 get
  get(def_id: LocalDefId): EffectiveVisibility | undefined {
    return copied(this.effective_visibilities.effective_vis(def_id));
  }

  // rustc: compiler/rustc_privacy/src/lib.rs:1594 check_item
  check_item(id: ItemId): void {
    const tcx = this.tcx;
    const def_id = id.owner_id.def_id;
    const item_visibility = tcx.local_visibility(def_id);
    const effective_vis = this.get(def_id);
    const def_kind = tcx.def_kind(def_id);

    switch (def_kind.$) {
      case "Const":
      case "Static":
      case "Fn":
      case "TyAlias": {
        if (def_kind.$ === "TyAlias") {
          this.check_unnameable(def_id, effective_vis);
        }
        this.check(def_id, item_visibility, effective_vis).generics().clauses().ty();
        break;
      }
      case "OpaqueTy": {
        // `ty()` for opaque types is the underlying type,
        // it's not a part of interface, so we skip it.
        this.check(def_id, item_visibility, effective_vis).generics().bounds();
        break;
      }
      case "Trait": {
        this.check_unnameable(def_id, effective_vis);

        this.check(def_id, item_visibility, effective_vis).generics().clauses();

        for (const assoc_item of AssocItems_in_definition_order(tcx, def_id)) {
          this.check_assoc_item(assoc_item, item_visibility, effective_vis);
        }
        break;
      }
      case "TraitAlias": {
        this.check(def_id, item_visibility, effective_vis).generics().clauses();
        break;
      }
      case "Enum": {
        this.check_unnameable(def_id, effective_vis);
        this.check(def_id, item_visibility, effective_vis).generics().clauses();

        const adt = tcx.adt_def(def_id) as AdtDef;
        for (const field of adt.all_fields()) {
          this.check(field.did.expect_local(), item_visibility, effective_vis).ty();
        }
        break;
      }
      // Subitems of structs and unions have their own publicity.
      case "Struct":
      case "Union": {
        this.check_unnameable(def_id, effective_vis);
        this.check(def_id, item_visibility, effective_vis).generics().clauses();

        const adt = tcx.adt_def(def_id) as AdtDef;
        for (const field of adt.all_fields()) {
          const visibility = min(item_visibility, Visibility.expect_local(field.vis), tcx);
          const field_ev = this.get(field.did.expect_local());

          this.check(field.did.expect_local(), visibility, field_ev).ty();
        }
        break;
      }
      // Subitems of foreign modules have their own publicity.
      case "ForeignMod":
        break;
      // An inherent impl is public when its type is public
      // Subitems of inherent impls have their own publicity.
      // A trait impl is public when both its type and its trait are public
      // Subitems of trait impls have inherited publicity.
      case "Impl": {
        const of_trait = def_kind.of_trait;
        const impl_vis = VisibilityLike_provided.of_impl(VisibilityLike_Visibility, false, def_id, of_trait, tcx, EffectiveVisibilities.default());

        // We are using the non-shallow version here, unlike when building the
        // effective visisibilities table to avoid large number of false positives.
        // For example in
        //
        // impl From<Priv> for Pub {
        //     fn from(_: Priv) -> Pub {...}
        // }
        //
        // lints shouldn't be emitted even if `from` effective visibility
        // is larger than `Priv` nominal visibility and if `Priv` can leak
        // in some scenarios due to type inference.
        const impl_ev = VisibilityLike_provided.of_impl(VisibilityLike_EffectiveVisibility, false, def_id, of_trait, tcx, this.effective_visibilities);

        const check = this.check(def_id, impl_vis, impl_ev);

        // Generics and clauses of trait impls are intentionally not checked
        // for private components (#90586).
        if (!of_trait) {
          check.generics().clauses();
        }

        // Skip checking private components in associated types, due to lack of full
        // normalization they produce very ridiculous false positives.
        // FIXME: Remove this when full normalization is implemented.
        check.skip_assoc_tys_ = true;
        check.ty();
        if (of_trait) {
          check.trait_ref();
        }

        for (const assoc_item of AssocItems_in_definition_order(tcx, def_id)) {
          const impl_item_vis = !of_trait ? min(tcx.local_visibility(assoc_item.def_id.expect_local()), impl_vis, tcx) : impl_vis;

          const impl_item_ev = !of_trait ? this.get(assoc_item.def_id.expect_local())?.min(impl_ev, this.tcx) : impl_ev;

          this.check_assoc_item(assoc_item, impl_item_vis, impl_item_ev);
        }
        break;
      }
      default:
        break;
    }
  }

  // rustc: compiler/rustc_privacy/src/lib.rs:1713 check_foreign_item
  check_foreign_item(id: ForeignItemId): void {
    const tcx = this.tcx;
    const def_id = id.owner_id.def_id;
    const item_visibility = tcx.local_visibility(def_id);
    const effective_vis = this.get(def_id);

    if (this.tcx.def_kind(def_id).$ === "ForeignTy") {
      this.check_unnameable(def_id, effective_vis);
    }

    this.check(def_id, item_visibility, effective_vis).generics().clauses().ty();
  }
}

// rustc: compiler/rustc_privacy/src/lib.rs:1727 provide
export function provide(providers: Providers): void {
  providers.effective_visibilities = effective_visibilities;
  providers.check_private_in_public = check_private_in_public;
  providers.check_mod_privacy = check_mod_privacy;
}

// rustc: compiler/rustc_privacy/src/lib.rs:1736 check_mod_privacy
function check_mod_privacy(tcx: TyCtxt, mod_id: LocalModIdT): null {
  // Check privacy of names not checked in previous compilation stages.
  const visitor = new NamePrivacyVisitor(tcx, mod_id, undefined);
  tcx.hir_visit_item_likes_in_module(mod_id, visitor);

  // Check privacy of explicitly written types and traits as well as
  // inferred types of expressions and patterns.
  const span = tcx.def_span(LocalModId.to_def_id(mod_id));
  const visitor2 = new TypePrivacyVisitor(tcx, mod_id, undefined, span, new Set());

  const module = tcx.hir_module_items(mod_id) as ModuleItems;
  for (const def_id of module.definitions()) {
    walk_types(tcx, def_id, visitor2.as_spanned_type_visitor());

    const body = tcx.hir_maybe_body_owned_by(def_id);
    if (body !== undefined) {
      visitor2.visit_nested_body(body.id());
    }

    const def_kind = tcx.def_kind(def_id);
    if (def_kind.$ === "Impl" && def_kind.of_trait) {
      const trait_ref_ = tcx.impl_trait_ref(def_id);
      const trait_ref = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(trait_ref_));
      visitor2.span = unwrap(tcx.hir_expect_item(def_id).expect_impl().of_trait).trait_ref.path.span;
      visitor2.visit_def_id(trait_ref.def_id, "trait", () => display_TraitRefPrintOnlyTraitPath(TraitRef_print_only_trait_path(trait_ref)));
    }
  }
  return null;
}

// rustc: compiler/rustc_privacy/src/lib.rs:1771 effective_visibilities
function effective_visibilities(tcx: TyCtxt, _: null): EffectiveVisibilities {
  const def_ids_to_impls = DefIdsToImplsCollector.collect(tcx);

  // Build up a set of all exported items in the AST. This is a set of all
  // items which are reachable from external crates based on visibility.
  const visitor = new EmbargoVisitor(tcx, clone_EffectiveVisibilities(tcx.resolutions(null).effective_visibilities), new IndexSet(), def_ids_to_impls);

  visitor.effective_visibilities.check_invariants(tcx);

  // HACK(jynelson): trying to infer the type of `impl Trait` breaks `async-std` (and
  // `pub async fn` in general). Since rustdoc never needs to do codegen and doesn't
  // care about link-time reachability, keep them unreachable (issue #75100).
  const impl_trait_pass = !tcx.sess.opts.actually_rustdoc;
  if (impl_trait_pass) {
    // Underlying types of `impl Trait`s are marked as reachable unconditionally,
    // so this pass doesn't need to be a part of the fixed point iteration below.
    const krate = tcx.hir_crate_items(null) as ModuleItems;
    for (const id of krate.opaques()) {
      const opaque = Node.expect_opaque_ty(tcx.hir_node_by_def_id(id));
      let should_visit: boolean;
      const origin = opaque.origin;
      if ((origin.$ === "FnReturn" || origin.$ === "AsyncFn") && origin.in_trait_or_impl === "Trait") {
        const parent = origin.parent;
        const [, trait_fn] = Node.expect_trait_item(tcx.hir_node_by_def_id(parent)).expect_fn();
        switch (trait_fn.$) {
          case "Required":
            should_visit = false;
            break;
          case "Provided":
            should_visit = true;
            break;
        }
      } else {
        // Always visit RPITs in functions that have definitions,
        // and all TAITs.
        // `FnReturn`/`AsyncFn { in_trait_or_impl: None | Some(RpitContext::TraitImpl) } | TyAlias { .. }`
        should_visit = true;
      }
      if (should_visit) {
        // FIXME: This is some serious pessimization intended to workaround deficiencies
        // in the reachability pass (`middle/reachable.rs`). Types are marked as link-time
        // reachable if they are returned via `impl Trait`, even from private functions.
        const pub_ev = EffectiveVisibility.from_vis(Visibility.Public);
        visitor.reach_through_impl_trait(opaque.def_id, pub_ev).generics().clauses().ty();
      }
    }

    visitor.queue.clear();
  }

  // FIXME: remove this once proper support for defs reachability from macros is implemented.
  // See `ResolverGlobalCtxt::macro_reachable_adts` comment.
  for (const [adt_def_id, macro_mods] of tcx.resolutions(null).macro_reachable_adts) {
    const struct_def = tcx.adt_def(adt_def_id) as AdtDef;
    const struct_ev = copied(visitor.effective_visibilities.effective_vis(adt_def_id));
    if (struct_ev === undefined) {
      continue;
    }
    for (const field of struct_def.non_enum_variant().fields) {
      const def_id = field.did.expect_local();
      const field_vis = tcx.local_visibility(def_id);

      for (const macro_mod of macro_mods) {
        if (Visibility.is_accessible_from(field_vis, macro_mod, tcx)) {
          visitor.reach(def_id, struct_ev).ty();
        }
      }
    }
  }

  const crate_items = tcx.hir_crate_items(null) as ModuleItems;
  for (const id of crate_items.free_items()) {
    visitor.check_def_id(id.owner_id.def_id);
  }
  for (const id of crate_items.foreign_items()) {
    visitor.check_def_id(id.owner_id.def_id);
  }
  let def_id: LocalDefId | undefined;
  while ((def_id = visitor.queue.pop()) !== undefined) {
    visitor.check_def_id(def_id);
  }
  visitor.effective_visibilities.check_invariants(tcx);

  const check_visitor = new TestReachabilityVisitor(tcx, visitor.effective_visibilities);
  for (const id of crate_items.owners()) {
    check_visitor.check_def_id(id);
  }

  // `tcx.arena.alloc(visitor.effective_visibilities)`
  return visitor.effective_visibilities;
}

/** `EffectiveVisibilities: Clone` (each `EffectiveVisibility` is `Copy`; the TS values are mutable, so they are
 *  copied). */
function clone_EffectiveVisibilities(ev: EffectiveVisibilities): EffectiveVisibilities {
  const map = new Map<LocalDefId, EffectiveVisibility>();
  for (const [id, e] of ev.map) map.set(id, copied(e)!);
  return new EffectiveVisibilities(map);
}

// rustc: compiler/rustc_privacy/src/lib.rs:1873 check_private_in_public
function check_private_in_public(tcx: TyCtxt, mod_id: LocalModIdT): null {
  const effective_visibilities = tcx.effective_visibilities(null);
  // Check for private types in public interfaces.
  const checker = new PrivateItemsInPublicInterfacesChecker(tcx, effective_visibilities);

  const crate_items = tcx.hir_module_items(mod_id) as ModuleItems;
  crate_items.par_items((id) => {
    checker.check_item(id);
    return Ok(null);
  });
  crate_items.par_foreign_items((id) => {
    checker.check_foreign_item(id);
    return Ok(null);
  });
  return null;
}
