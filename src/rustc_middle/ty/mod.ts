// Partial port of compiler/rustc_middle/src/ty/mod.rs: `Visibility` (and its impls), the `TyCtxt`
// def-id tree helpers name resolution needs (`opt_parent`, `parent`, `opt_local_parent`, `local_parent`,
// `def_id_partial_cmp`, `is_descendant_of`, `opt_item_name`, `item_name`), and (lane ty-contract, plan-m3
// D2/D3) the hash-consed `Ty` class and the `Term` union. The rest of ty/mod.rs (types, generics, ADTs, ...)
// is M3+: its `TyCtxt` methods are stubs at the end of this file (tyctxt-min decision 6).
//
// PORT (D2): `Ty(Interned<'tcx, WithCachedTypeInfo<TyKind<'tcx>>>)` is the hash-consed object itself: one
// frozen `Ty` per distinct `TyKind`, made only by `CtxtInterners::intern_ty` (context.ts); equality is `===`, a
// `Ty` is its own `Map`/`Set` key. `WithCachedTypeInfo`'s fields are `internee`, `flags_`,
// `outer_exclusive_binder_` (renamed: `impl Flags for Ty` has methods of those names). Its methods are
// declared in decls.ts and filled by the files that define them upstream (sty.ts, util.ts, ...), which are
// extension modules: this file must never import them (they assign to `Ty.prototype` at load).
// PORT (D3): `Term` is `Ty | Const` (upstream a tagged pointer); `Term.kind(t)` dispatches on the class.
//
// PORT: `Visibility<Id>` is generic over `LocalModId` (a number) and `ModId` (a class); conversions
// `Id: Into<ModId>` / `impl Into<DefId>` dispatch on the runtime shape (`into_ModId`,
// `into_query_key_DefId`). `Option<Ordering>` is `Ordering | undefined` with
// `Ordering = "Less" | "Equal" | "Greater"`.
import { type DefPath, debug_DefPath } from "../../rustc_hir_id/definitions.ts";
import { DefId, type DefId as DefIdT, debug_DefId, debug_LocalModId, debug_ModId, type LocalDefId, LocalModId, ModId, ModId_eq } from "../../rustc_span/def_id.ts";
import type { Ident, Symbol } from "../../rustc_span/symbol.ts";
import type { Span } from "../../rustc_span/lib.ts";
import type { DefKind, Res } from "../../rustc_hir/def.ts";
import { type Debug, debug_list, debug_tuple, type Fmt, PLAIN } from "../../std/fmt.ts";
import { panic } from "../../std/panic.ts";
import { Interned } from "../../rustc_data_structures/intern.ts";
import { unported_methods } from "../../rust_ts/stubs.ts";
import type { DebruijnIndex, TermKind, TyKind, TypeFlags } from "../../rustc_type_ir/decls.ts";
import type { FallibleTypeFolder, TypeFoldable, TypeFolder } from "../../rustc_type_ir/fold.ts";
import type { TypeVisitor } from "../../rustc_type_ir/visit.ts";
import { Const } from "../../rustc_type_ir/sty/mod.ts";
import { unported } from "../../std/panic.ts";
import type { Result } from "../../std/result.ts";
import { type IntoQueryKey, into_query_key_DefId } from "../query/into_query_key.ts";
import type { TyCtxt } from "./context.ts";
import type { AssocItem, Attribute, Body, BodyId, CoroutineLayout, FieldIdx, FnAbi, FnAbiError, ImplOverlapKind, ImplTraitInTraitData, Instance, InstanceKind, LayoutError, PseudoCanonicalInput, ReprOptions, TypeckResults, VariantDef } from "./decls.ts";
import type { EarlyBinder, ImplPolarity, TraitRef } from "../../rustc_type_ir/decls.ts";
import type { GenericArg, GenericArgs } from "./generic_args.ts";
import type { List } from "./list.ts";
// ty-mod-a imports
import { ControlFlow, type VisitorResult, VisitorResult as VisitorResultC } from "../../rustc_ast_ir/visit.ts";
import type { Diag } from "../../rustc_errors/lib.ts";
import { type Constness as HirConstness, debug_Constness, debug_Safety, type Safety as HirSafety } from "../../rustc_hir/lib.ts";
import { CrateNum, type DefIdMap, LOCAL_CRATE } from "../../rustc_span/def_id.ts";
import { debug_Span, DUMMY_SP, type ErrorGuaranteed } from "../../rustc_span/lib.ts";
import { bug } from "../../rustc_span/macros.ts";
import { debug_HashMap } from "../../rust_ts/hash_map.ts";
import type { Decoder } from "../../rustc_serialize/serialize.ts";
import type { Binder } from "../../rustc_type_ir/binder.ts";
import type { PredicateProxy } from "../../rustc_type_ir/fold.ts";
import { debug_TypingModeEqWrapper, type TypingModeEqWrapper } from "../../rustc_type_ir/infer_ctxt.gen.ts";
import { debug_Variance, type Variance } from "../../rustc_type_ir/lib.ts";
import type { OpaqueTypeKey } from "../../rustc_type_ir/opaque_ty.ts";
import { debug_Const, debug_Region, fold_Const, type Region } from "../../rustc_type_ir/sty/mod.ts";
import type { AliasTerm } from "../../rustc_type_ir/ty/alias.ts";
import type { Unnormalized } from "../../rustc_type_ir/unnormalized.ts";
import { debug_Unnormalized } from "../../rustc_type_ir/unnormalized.gen.ts";
import type { Flags, TypeVisitable } from "../../rustc_type_ir/visit.ts";
import type { TypeWalker } from "../../rustc_type_ir/walk.ts";
import { debug_struct, debug_vec } from "../../std/fmt.ts";
import { Ok } from "../../std/result.ts";
import { OpaqueHiddenTypeMismatch_diagnostic, type TypeMismatchReason } from "../diagnostics.gen.ts";
import type { ParamEnv as ParamEnvPending } from "./decls.ts";
import { type Clauses, debug_RawList, RawList } from "./list.ts";
import type { Clause } from "./predicate.ts";

export type Ordering = "Less" | "Equal" | "Greater";

// PORT (init order, ty-contract "Init order"): this is a defining module (context.ts imports it); the modules below
// import it back or reach extension modules (ty/sty.ts, ty/structural_impls.ts, ...) at load, so a static import
// throws a TDZ `ReferenceError` when rustc_middle/lib.ts loads. They are required lazily, at call time (the precedent
// of rustc_type_ir sty/mod.ts).
function tyir_binder(): typeof import("../../rustc_type_ir/binder.ts") {
  return require("../../rustc_type_ir/binder.ts") as typeof import("../../rustc_type_ir/binder.ts");
}
function tyir_fold(): typeof import("../../rustc_type_ir/fold.ts") {
  return require("../../rustc_type_ir/fold.ts") as typeof import("../../rustc_type_ir/fold.ts");
}
function tyir_visit(): typeof import("../../rustc_type_ir/visit.ts") {
  return require("../../rustc_type_ir/visit.ts") as typeof import("../../rustc_type_ir/visit.ts");
}
function tyir_predicate(): typeof import("../../rustc_type_ir/predicate.ts") {
  return require("../../rustc_type_ir/predicate.ts") as typeof import("../../rustc_type_ir/predicate.ts");
}
function tyir_unnormalized(): typeof import("../../rustc_type_ir/unnormalized.ts") {
  return require("../../rustc_type_ir/unnormalized.ts") as typeof import("../../rustc_type_ir/unnormalized.ts");
}
function tyir_term_kind(): typeof import("../../rustc_type_ir/term_kind.ts") {
  return require("../../rustc_type_ir/term_kind.ts") as typeof import("../../rustc_type_ir/term_kind.ts");
}
function tyir_walk(): typeof import("../../rustc_type_ir/walk.ts") {
  return require("../../rustc_type_ir/walk.ts") as typeof import("../../rustc_type_ir/walk.ts");
}
function middle_generic_args(): typeof import("./generic_args.ts") {
  return require("./generic_args.ts") as typeof import("./generic_args.ts");
}
function middle_predicate(): typeof import("./predicate.ts") {
  return require("./predicate.ts") as typeof import("./predicate.ts");
}
function middle_pretty(): typeof import("./print/pretty.ts") {
  return require("./print/pretty.ts") as typeof import("./print/pretty.ts");
}

/** PORT: the visit descriptor of `(Ty, Ty)` (rustc_type_ir visit.rs:136 over the `Ty` stand-in, merge-w15a decision 3). */
function visit_Ty_Ty(): TypeVisitable<[Ty, Ty]> {
  const { standin_fold_Ty } = tyir_fold();
  return { visit_with: (self, visitor) => tyir_visit().visit_with_tuple2(self, visitor, standin_fold_Ty.visit_with, standin_fold_Ty.visit_with) };
}

// ---- PORT stand-ins for fns of other upstream files that are not ported yet (repoint when they land) ----

/** PORT: stand-in for `opaque_types::ReverseMapper::new` (rustc_middle ty/opaque_types.rs, not ported yet). */
function ReverseMapper_new(_tcx: TyCtxt, _map: Map<GenericArg, GenericArg>, _span: Span): TypeFolder {
  return unported("rustc_middle::ty::opaque_types::ReverseMapper::new");
}

// Data types

// rustc-type: compiler/rustc_middle/src/ty/mod.rs:169 ImplTraitHeader
export class ImplTraitHeader {
  constructor(
    public readonly trait_ref: EarlyBinder<TraitRef>,
    public readonly polarity: ImplPolarity,
    public readonly safety: HirSafety,
    public readonly constness: HirConstness,
  ) {}

  /// For trait impls, checks whether
  /// * the type and trait only use generic lifetime arguments (and no concrete ones like `'static`), and
  /// * uses any generic param (lifetime or type) only once.
  ///
  /// This is a pessimistic analysis, so it will reject alias types
  /// and other types that may be actually ok. We can allow more in the future.
  ///
  /// Constants (associated or generic) are irrelevant for this analysis, as their value is neither
  /// affected by lifetimes, nor do they affect lifetimes.
  // rustc: compiler/rustc_middle/src/ty/mod.rs:186 is_fully_generic_for_reflection
  is_fully_generic_for_reflection(): boolean {
    // rustc-type: compiler/rustc_middle/src/ty/mod.rs:188 ParamFinder
    // PORT: `#[derive(Default)]`: `seen` starts empty. `FxHashSet<u32>` is only probed: a `Set`.
    class ParamFinder implements TypeVisitor<ControlFlow<null>> {
      readonly Result: VisitorResult<ControlFlow<null>, unknown> = VisitorResultC.ControlFlow<null>();
      seen: Set<number> = new Set();

      visit_binder<T>(t: Binder<T>, d: TypeVisitable<T>): ControlFlow<null> {
        return tyir_visit().TypeVisitor_provided.visit_binder(this, t, d);
      }

      // rustc: compiler/rustc_middle/src/ty/mod.rs:194 visit_region
      visit_region(r: Region): ControlFlow<null> {
        const k = r.kind();
        switch (k.$) {
          case "ReEarlyParam": {
            const param = k._0;
            if (!this.seen.has(param.index)) {
              this.seen.add(param.index);
              return ControlFlow.CONTINUE;
            } else {
              return ControlFlow.Break(null);
            }
          }
          case "ReBound":
            return ControlFlow.CONTINUE;
          case "ReStatic":
          case "ReError":
            return ControlFlow.Break(null);
          case "ReVar":
          case "RePlaceholder":
          case "ReErased":
          case "ReLateParam":
            return bug(`unexpected lifetime in impl: ${debug_Region(r, PLAIN)}`);
        }
      }

      // rustc: compiler/rustc_middle/src/ty/mod.rs:212 visit_ty
      visit_ty(t: Ty): ControlFlow<null> {
        const k = t.kind();
        switch (k.$) {
          case "Param": {
            const p = k._0;
            // Reject using a parameter twice (e.g. in `Foo<T, T>`)
            if (this.seen.has(p.index)) {
              return ControlFlow.Break(null);
            }
            this.seen.add(p.index);
            break;
          }
          case "Alias":
            return ControlFlow.Break(null);
          default:
            break;
        }
        return tyir_fold().standin_fold_Ty.super_visit_with(t, this);
      }

      visit_const(c: Const): ControlFlow<null> {
        return tyir_visit().TypeVisitor_provided.visit_const(this, c);
      }

      visit_predicate<P>(p: P, d: PredicateProxy<P>): ControlFlow<null> {
        return tyir_visit().TypeVisitor_provided.visit_predicate(this, p, d);
      }

      visit_clauses(c: Clauses): ControlFlow<null> {
        return tyir_visit().TypeVisitor_provided.visit_clauses(this, c);
      }

      visit_error(guar: ErrorGuaranteed): ControlFlow<null> {
        return tyir_visit().TypeVisitor_provided.visit_error(this, guar);
      }
    }
    const trait_ref = tyir_unnormalized().Unnormalized.skip_norm_wip(tyir_binder().EarlyBinder.instantiate_identity(this.trait_ref));
    return tyir_predicate().visit_with_TraitRef(trait_ref, new ParamFinder()).$ === "Continue";
  }
}

/** `#[derive(Debug)]` */
export const debug_ImplTraitHeader: Debug<ImplTraitHeader> = (v, f) =>
  debug_struct(f, "ImplTraitHeader", [
    ["trait_ref", tyir_binder().debug_EarlyBinder(v.trait_ref, f, tyir_predicate().debug_TraitRef)],
    ["polarity", tyir_predicate().debug_ImplPolarity(v.polarity, f)],
    ["safety", debug_Safety(v.safety, f)],
    ["constness", debug_Constness(v.constness, f)],
  ]);

// rustc-type: compiler/rustc_middle/src/ty/mod.rs:236 Asyncness
export type Asyncness = "Yes" | "No";

export const Asyncness = {
  Yes: "Yes" as const,
  No: "No" as const,

  /** `#[derive(Default)]` (`#[default] No`) */
  default_(): Asyncness {
    return "No";
  },

  // rustc: compiler/rustc_middle/src/ty/mod.rs:243 is_async
  is_async(self: Asyncness): boolean {
    return self === "Yes";
  },
};

/** `#[derive(Debug)]` */
export const debug_Asyncness: Debug<Asyncness> = (v) => v;

export type Visibility<Id = LocalModId> =
  /// Visible everywhere (including in other crates).
  | { readonly $: "Public" }
  /// Visible only in the given crate-local module.
  | { readonly $: "Restricted"; readonly _0: Id };

/** `Into<ModId>` for the two `Id`s used with `Visibility` (`LocalModId`, `ModId`). */
function into_ModId(id: LocalModId | ModId): ModId {
  return id instanceof ModId ? id : LocalModId.to_mod_id(id);
}

const PUBLIC: { readonly $: "Public" } = Object.freeze({ $: "Public" as const });

export const Visibility = {
  Public: PUBLIC,
  Restricted<Id>(id: Id): Visibility<Id> {
    return { $: "Restricted", _0: id };
  },

  // rustc: compiler/rustc_middle/src/ty/mod.rs:257 to_string
  to_string(self: Visibility<LocalModId>, def_id: LocalDefId, tcx: TyCtxt): string {
    switch (self.$) {
      case "Restricted": {
        const restricted_id = self._0;
        if (LocalModId.is_top_level_module(restricted_id)) {
          return "pub(crate)";
        } else if (restricted_id === tcx.parent_module_from_def_id(def_id)) {
          return "pub(self)";
        } else {
          const p: DefPath = tcx.def_path(LocalModId.to_def_id(restricted_id));
          return `pub(in crate${p.to_string_no_crate_verbose()})`;
        }
      }
      case "Public":
        return "pub";
    }
  },

  // rustc: compiler/rustc_middle/src/ty/mod.rs:414 is_public
  is_public<Id>(self: Visibility<Id>): boolean {
    return self.$ === "Public";
  },

  // rustc: compiler/rustc_middle/src/ty/mod.rs:418 map_id
  map_id<Id, OutId>(self: Visibility<Id>, f: (id: Id) => OutId): Visibility<OutId> {
    switch (self.$) {
      case "Public":
        return PUBLIC;
      case "Restricted":
        return Visibility.Restricted(f(self._0));
    }
  },

  // rustc: compiler/rustc_middle/src/ty/mod.rs:427 to_mod_id
  to_mod_id(self: Visibility<LocalModId>): Visibility<ModId> {
    return Visibility.map_id(self, LocalModId.to_mod_id);
  },

  /// Returns `true` if an item with this visibility is accessible from the given definition.
  // rustc: compiler/rustc_middle/src/ty/mod.rs:434 is_accessible_from
  is_accessible_from(self: Visibility<LocalModId | ModId>, def_id: IntoQueryKey<DefIdT>, tcx: TyCtxt): boolean {
    switch (self.$) {
      // Public items are visible everywhere.
      case "Public":
        return true;
      case "Restricted":
        return tcx.is_descendant_of(def_id, into_ModId(self._0));
    }
  },

  // rustc: compiler/rustc_middle/src/ty/mod.rs:442 partial_cmp
  partial_cmp(self: Visibility<LocalModId | ModId>, vis: Visibility<LocalModId | ModId>, tcx: TyCtxt): Ordering | undefined {
    if (self.$ === "Public" && vis.$ === "Public") return "Equal";
    if (self.$ === "Public" && vis.$ === "Restricted") return "Greater";
    if (self.$ === "Restricted" && vis.$ === "Public") return "Less";
    const [lhs_id, rhs_id] = [into_ModId((self as { _0: LocalModId | ModId })._0), into_ModId((vis as { _0: LocalModId | ModId })._0)];
    return tcx.def_id_partial_cmp(lhs_id.to_def_id(), rhs_id.to_def_id());
  },

  /// Returns `true` if this visibility is strictly larger than the given visibility.
  // rustc: compiler/rustc_middle/src/ty/mod.rs:462 greater_than
  greater_than(self: Visibility<LocalModId | ModId>, vis: Visibility<LocalModId | ModId>, tcx: TyCtxt): boolean {
    const ord = Visibility.partial_cmp(self, vis, tcx);
    if (ord !== undefined) {
      return ord === "Greater";
    } else {
      tcx.dcx().delayed_bug(`unordered visibilities: ${debug_Visibility_any(self)} and ${debug_Visibility_any(vis)}`);
      return false;
    }
  },

  // rustc: compiler/rustc_middle/src/ty/mod.rs:478 expect_local
  expect_local(self: Visibility<ModId>): Visibility<LocalModId> {
    return Visibility.map_id(self, (id) => id.expect_local());
  },

  /// Returns `true` if this item is visible anywhere in the local crate.
  // rustc: compiler/rustc_middle/src/ty/mod.rs:483 is_visible_locally
  is_visible_locally(self: Visibility<ModId>): boolean {
    switch (self.$) {
      case "Public":
        return true;
      case "Restricted":
        return self._0.is_local();
    }
  },
};

/** `#[derive(Debug)]` */
export function debug_Visibility<Id>(v: Visibility<Id>, f: Parameters<Debug<Id>>[1], debug_id: Debug<Id>): string {
  switch (v.$) {
    case "Public":
      return "Public";
    case "Restricted":
      return debug_tuple(f, "Restricted", [debug_id(v._0, f)]);
  }
}
function debug_Visibility_any(v: Visibility<LocalModId | ModId>): string {
  return debug_Visibility(v, PLAIN, (id, f) => (id instanceof ModId ? debug_ModId(id, f) : debug_LocalModId(id, f)));
}

/** `#[derive(PartialEq)]` */
export function Visibility_eq<Id>(a: Visibility<Id>, b: Visibility<Id>): boolean {
  if (a.$ !== b.$) return false;
  if (a.$ === "Public") return true;
  const x = a._0;
  const y = (b as { _0: Id })._0;
  return x instanceof ModId ? ModId_eq(x, y as ModId) : x === y;
}

// PORT: `RestrictionKind` sits between `Visibility::to_string` (mod.rs:256) and the generic `Visibility` impls
// (:413) upstream; the `Visibility` methods are one companion above (PORTING §8), so it follows them.
// rustc-type: compiler/rustc_middle/src/ty/mod.rs:277 RestrictionKind
export type RestrictionKind =
  | { readonly $: "Unrestricted" }
  | { readonly $: "Restricted"; readonly _0: DefIdT; readonly _1: Span };

export const RestrictionKind = {
  Unrestricted: Object.freeze({ $: "Unrestricted" as const }),

  /// Returns `true` if the behavior is allowed/unrestricted in the given module.
  /// A value of `false` indicates that the behavior is prohibited.
  // rustc: compiler/rustc_middle/src/ty/mod.rs:285 is_allowed_in
  is_allowed_in(self: RestrictionKind, module: DefIdT, tcx: TyCtxt): boolean {
    switch (self.$) {
      case "Unrestricted":
        return true;
      case "Restricted": {
        const restricted_to = self._0;
        return tcx.is_descendant_of(module, restricted_to);
      }
    }
  },

  /// Obtain the [`Span`] of the restriction. Panics if the restriction is unrestricted.
  // rustc: compiler/rustc_middle/src/ty/mod.rs:295 expect_span
  expect_span(self: RestrictionKind): Span {
    switch (self.$) {
      case "Unrestricted":
        return bug("called `expect_span` on an unrestricted item");
      case "Restricted":
        return self._1;
    }
  },

  /// Obtain the path of the restriction. If unrestricted, an empty string is returned.
  // rustc: compiler/rustc_middle/src/ty/mod.rs:305 restriction_path
  restriction_path(self: RestrictionKind, tcx: TyCtxt): string {
    switch (self.$) {
      case "Unrestricted":
        return "";
      case "Restricted": {
        const restricted_to = self._0;
        if (restricted_to.krate === LOCAL_CRATE) {
          const { with_crate_prefix, with_no_trimmed_paths } = middle_pretty();
          return with_crate_prefix(() => with_no_trimmed_paths(() => tcx.def_path_str(restricted_to)));
        } else {
          return tcx.def_path_str(CrateNum.as_mod_id(restricted_to.krate));
        }
      }
    }
  },

  /// Obtain the stricter restriction between `self` and `rhs`.
  /// Panics if the restrictions do not reference the same crate.
  // rustc: compiler/rustc_middle/src/ty/mod.rs:320 stricter_of
  stricter_of(self: RestrictionKind, rhs: RestrictionKind, tcx: TyCtxt): RestrictionKind {
    // (RestrictionKind::Unrestricted, r) | (r, RestrictionKind::Unrestricted) => r,
    if (self.$ === "Unrestricted") return rhs;
    if (rhs.$ === "Unrestricted") return self;
    const left_did = self._0;
    const right_did = rhs._0;
    if (left_did.krate !== right_did.krate) {
      bug("stricter_of: left and right restriction do not reference the same crate");
    }
    if (tcx.is_descendant_of(left_did, right_did)) {
      return self;
    } else {
      return rhs;
    }
  },
};

/** `#[derive(Debug)]` */
export const debug_RestrictionKind: Debug<RestrictionKind> = (v, f) => {
  switch (v.$) {
    case "Unrestricted":
      return "Unrestricted";
    case "Restricted":
      return debug_tuple(f, "Restricted", [debug_DefId(v._0, f), debug_Span(v._1, f)]);
  }
};

// rustc-type: compiler/rustc_middle/src/ty/mod.rs:338 ClosureSizeProfileData
export interface ClosureSizeProfileData {
  /// Tuple containing the types of closure captures before the feature `capture_disjoint_fields`
  readonly before_feature_tys: Ty;
  /// Tuple containing the types of closure captures after the feature `capture_disjoint_fields`
  readonly after_feature_tys: Ty;
}

/** `#[derive(Debug)]` */
export const debug_ClosureSizeProfileData: Debug<ClosureSizeProfileData> = (v, f) =>
  debug_struct(f, "ClosureSizeProfileData", [
    ["before_feature_tys", debug_Ty(v.before_feature_tys, f)],
    ["after_feature_tys", debug_Ty(v.after_feature_tys, f)],
  ]);

/// The crate variances map is computed during typeck and contains the
/// variance of every item in the local crate. You should not use it
/// directly, because to do so will make your pass dependent on the
/// HIR of every item in the local crate. Instead, use
/// `tcx.variances_of()` to get the variance for a *particular*
/// item.
// rustc-type: compiler/rustc_middle/src/ty/mod.rs:498 CrateVariancesMap
export interface CrateVariancesMap {
  /// For each item with generics, maps to a vector of the variance
  /// of its generics. If an item has no generics, it will have no
  /// entry.
  readonly variances: DefIdMap<readonly Variance[]>;
}

/** `#[derive(Debug)]` (`DefIdMap` is an `FxHashMap`: rust_ts/hash_map.ts `debug_HashMap`) */
export const debug_CrateVariancesMap: Debug<CrateVariancesMap> = (v, f) =>
  debug_struct(f, "CrateVariancesMap", [
    ["variances", debug_HashMap(v.variances, f, debug_DefId, (x, f) => debug_vec(x, f, debug_Variance))],
  ]);

// Contains information needed to resolve types and (in the future) look up
// the types of AST nodes.
// rustc-type: compiler/rustc_middle/src/ty/mod.rs:508 CReaderCacheKey
export interface CReaderCacheKey {
  readonly cnum: CrateNum | undefined;
  readonly pos: number;
}

/// Use this rather than `TyKind`, whenever possible.
// rustc-type: compiler/rustc_middle/src/ty/mod.rs:517 Ty
export class Ty extends Interned {
  /** `WithCachedTypeInfo::internee` */
  readonly internee: TyKind;
  /** `WithCachedTypeInfo::flags` (renamed: module comment) */
  readonly flags_: TypeFlags;
  /** `WithCachedTypeInfo::outer_exclusive_binder` (renamed: module comment) */
  readonly outer_exclusive_binder_: DebruijnIndex;

  /** PORT: only `CtxtInterners::intern_ty` constructs (D2); the kind object is frozen with it. */
  constructor(internee: TyKind, flags: TypeFlags, outer_exclusive_binder: DebruijnIndex) {
    super();
    this.internee = Object.freeze(internee);
    this.flags_ = flags;
    this.outer_exclusive_binder_ = outer_exclusive_binder;
    Object.freeze(this);
  }

  // Avoid this in favour of more specific `new_*` methods, where possible.
  // rustc: compiler/rustc_middle/src/ty/sty.rs:368 new
  static new(tcx: TyCtxt, st: TyKind): Ty {
    return tcx.mk_ty_from_kind(st);
  }

  // It would be nicer if this returned the value instead of a reference,
  // like how `Predicate::kind` and `Region::kind` do. (It would result in
  // many fewer subsequent dereferences.) But that gives a small but
  // noticeable performance hit. See #126069 for details.
  // PORT: also `impl IntoKind for Ty` (mod.rs:522, `*self.kind()`): one method.
  // rustc: compiler/rustc_middle/src/ty/mod.rs:522 kind
  // rustc: compiler/rustc_middle/src/ty/sty.rs:1134 kind
  kind(): TyKind {
    return this.internee;
  }

  // rustc: compiler/rustc_middle/src/ty/mod.rs:528 flags
  flags(): TypeFlags {
    return this.flags_;
  }

  // rustc: compiler/rustc_middle/src/ty/mod.rs:532 outer_exclusive_binder
  outer_exclusive_binder(): DebruijnIndex {
    return this.outer_exclusive_binder_;
  }
}

/// The crate outlives map is computed during typeck and contains the
/// outlives of every item in the local crate. You should not use it
/// directly, because to do so will make your pass dependent on the
/// HIR of every item in the local crate. Instead, use
/// `tcx.inferred_outlives_of()` to get the outlives for a *particular*
/// item.
// rustc-type: compiler/rustc_middle/src/ty/mod.rs:544 CrateClausesMap
export interface CrateClausesMap {
  /// For each struct with outlive bounds, maps to a vector of the
  /// clause of its outlive bounds. If an item has no outlives
  /// bounds, it will have no entry.
  readonly clauses: DefIdMap<readonly (readonly [Clause, Span])[]>;
}

/** `#[derive(Debug)]` (`DefIdMap` is an `FxHashMap`: rust_ts/hash_map.ts `debug_HashMap`) */
export const debug_CrateClausesMap: Debug<CrateClausesMap> = (v, f) =>
  debug_struct(f, "CrateClausesMap", [
    [
      "clauses",
      debug_HashMap(v.clauses, f, debug_DefId, (x, f) =>
        debug_vec(x, f, (t, f) => debug_tuple(f, "", [middle_predicate().debug_Clause(t[0], f), debug_Span(t[1], f)])),
      ),
    ],
  ]);

/** PORT (D3): `pub struct Term<'tcx> { ptr: NonNull<()>, .. }` (mod.rs:550) is `Ty | Const`. */
export type Term = Ty | Const;

export const Term = {
  // rustc: compiler/rustc_middle/src/ty/mod.rs:588 from
  /** `impl From<Ty> for Term` */
  from_Ty(ty: Ty): Term {
    return Term.pack({ $: "Ty", _0: ty });
  },

  // rustc: compiler/rustc_middle/src/ty/mod.rs:594 from
  /** `impl From<Const> for Term` */
  from_Const(c: Const): Term {
    return Term.pack({ $: "Const", _0: c });
  },

  // PORT: also `impl IntoKind for Term` (mod.rs:562, `self.kind()`): one function.
  // PORT: the tag bits of the packed pointer are the class of the object (D3).
  // rustc: compiler/rustc_middle/src/ty/mod.rs:562 kind
  // rustc: compiler/rustc_middle/src/ty/mod.rs:648 kind
  kind(self: Term): TermKind {
    // SAFETY: use of `Interned::new_unchecked` here is ok because these
    // pointers were originally created from `Interned` types in `pack()`,
    // and this is just going in the other direction.
    if (self instanceof Ty) return { $: "Ty", _0: self };
    if (self instanceof Const) return { $: "Const", _0: self };
    return panic("internal error: entered unreachable code");
  },

  // rustc: compiler/rustc_middle/src/ty/mod.rs:667 as_type
  as_type(self: Term): Ty | undefined {
    const k = Term.kind(self);
    return k.$ === "Ty" ? k._0 : undefined;
  },

  // rustc: compiler/rustc_middle/src/ty/mod.rs:671 expect_type
  expect_type(self: Term): Ty {
    const t = Term.as_type(self);
    if (t === undefined) panic("expected a type, but found a const");
    return t;
  },

  // rustc: compiler/rustc_middle/src/ty/mod.rs:675 as_const
  as_const(self: Term): Const | undefined {
    const k = Term.kind(self);
    return k.$ === "Const" ? k._0 : undefined;
  },

  // rustc: compiler/rustc_middle/src/ty/mod.rs:679 expect_const
  expect_const(self: Term): Const {
    const c = Term.as_const(self);
    if (c === undefined) panic("expected a const, but found a type");
    return c;
  },

  // rustc: compiler/rustc_middle/src/ty/mod.rs:683 into_arg
  into_arg(self: Term): GenericArg {
    const k = Term.kind(self);
    switch (k.$) {
      case "Ty":
        return k._0;
      case "Const":
        return k._0;
    }
  },

  // rustc: compiler/rustc_middle/src/ty/mod.rs:690 to_alias_term
  to_alias_term(self: Term): AliasTerm | undefined {
    const k = Term.kind(self);
    switch (k.$) {
      case "Ty": {
        const tk = k._0.kind();
        switch (tk.$) {
          case "Alias":
            return tyir_term_kind().AliasTerm.from_AliasTy(tk._1);
          default:
            return undefined;
        }
      }
      case "Const": {
        const ck = k._0.kind();
        switch (ck.$) {
          case "Alias":
            return tyir_term_kind().AliasTerm.from_AliasConst(ck._1);
          default:
            return undefined;
        }
      }
    }
  },

  // rustc: compiler/rustc_middle/src/ty/mod.rs:703 is_non_rigid_alias
  is_non_rigid_alias(self: Term): boolean {
    const k = Term.kind(self);
    switch (k.$) {
      case "Ty": {
        const tk = k._0.kind();
        return tk.$ === "Alias" && tk._0 === "No";
      }
      case "Const": {
        const ck = k._0.kind();
        return ck.$ === "Alias" && ck._0 === "No";
      }
    }
  },

  // rustc: compiler/rustc_middle/src/ty/mod.rs:716 is_infer
  is_infer(self: Term): boolean {
    const k = Term.kind(self);
    switch (k.$) {
      case "Ty":
        return k._0.is_ty_var();
      case "Const":
        return k._0.is_ct_infer();
    }
  },

  // rustc: compiler/rustc_middle/src/ty/mod.rs:723 is_trivially_wf
  is_trivially_wf(self: Term, tcx: TyCtxt): boolean {
    const k = Term.kind(self);
    switch (k.$) {
      case "Ty":
        return k._0.is_trivially_wf(tcx);
      case "Const":
        return k._0.is_trivially_wf();
    }
  },

  /// Iterator that walks `self` and any types reachable from
  /// `self`, in depth-first order. Note that just walks the types
  /// that appear in `self`, it does not descend into the fields of
  /// structs or variants. For example:
  ///
  /// ```text
  /// isize => { isize }
  /// Foo<Bar<isize>> => { Foo<Bar<isize>>, Bar<isize>, isize }
  /// [isize] => { [isize], isize }
  /// ```
  // rustc: compiler/rustc_middle/src/ty/mod.rs:740 walk
  walk(self: Term): TypeWalker {
    return tyir_walk().TypeWalker.new(middle_generic_args().GenericArg.from_Term(self));
  },

  // PORT: `TermKindPackExt::pack`: the tagged pointer is the object itself (D3).
  // rustc: compiler/rustc_middle/src/ty/mod.rs:752 pack
  pack(self: TermKind): Term {
    switch (self.$) {
      case "Ty":
        // Ensure we can use the tag bits.
        // PORT: `assert_eq!(align_of_val(..) & TAG_MASK, 0)` has no meaning without pointers.
        return self._0;
      case "Const":
        return self._0;
    }
  },
};

// rustc: compiler/rustc_middle/src/ty/mod.rs:579 fmt
/** `impl Debug for Term` (`write!` formats `{ty:?}` with a fresh spec: the inner Debug is plain). */
export function debug_Term(v: Term, _f: Fmt): string {
  const k = Term.kind(v);
  switch (k.$) {
    case "Ty":
      return `Term::Ty(${debug_Ty(k._0, PLAIN)})`;
    case "Const":
      return `Term::Const(${debug_Const(k._0, PLAIN)})`;
  }
}

// rustc-skip: compiler/rustc_middle/src/ty/mod.rs:600 stable_hash StableHash impl (incremental, M5)

/** D4 descriptor: `impl TypeFoldable for Term` (mod.rs:605) + `impl TypeVisitable for Term` (:624). */
export const fold_Term: TypeFoldable<Term> = {
  // rustc: compiler/rustc_middle/src/ty/mod.rs:606 try_fold_with
  try_fold_with(self, folder) {
    const k = Term.kind(self);
    switch (k.$) {
      case "Ty": {
        const r = tyir_fold().standin_fold_Ty.try_fold_with(k._0, folder);
        return r.$ === "Ok" ? Ok(Term.from_Ty(r._0)) : r;
      }
      case "Const": {
        const r = fold_Const.try_fold_with(k._0, folder);
        return r.$ === "Ok" ? Ok(Term.from_Const(r._0)) : r;
      }
    }
  },

  // rustc: compiler/rustc_middle/src/ty/mod.rs:616 fold_with
  fold_with(self, folder) {
    const k = Term.kind(self);
    switch (k.$) {
      case "Ty":
        return Term.from_Ty(tyir_fold().standin_fold_Ty.fold_with(k._0, folder));
      case "Const":
        return Term.from_Const(fold_Const.fold_with(k._0, folder));
    }
  },

  // rustc: compiler/rustc_middle/src/ty/mod.rs:625 visit_with
  visit_with(self, visitor) {
    const k = Term.kind(self);
    switch (k.$) {
      case "Ty":
        return tyir_fold().standin_fold_Ty.visit_with(k._0, visitor);
      case "Const":
        return fold_Const.visit_with(k._0, visitor);
    }
  },
};

// rustc-skip: compiler/rustc_middle/src/ty/mod.rs:634 encode Encodable impl (metadata encoding, M5)

// PORT: `impl<D: TyDecoder> Decodable<D> for Term` is hand-written upstream, so it is ported (the precedent of
// rustc_type_ir/serialize.ts); `TermKind: Decodable<D>` is the derived impl tools/codegen generates, passed as a fn.
// rustc: compiler/rustc_middle/src/ty/mod.rs:640 decode
export function decode_Term<D extends Decoder>(d: D, decode_TermKind: (d: D) => TermKind): Term {
  const res: TermKind = decode_TermKind(d);
  return Term.pack(res);
}

/// Represents the bounds declared on a particular set of type
/// parameters. Should eventually be generalized into a flag list of
/// where-clauses. You can obtain an `InstantiatedClauses` list from a
/// `GenericClauses` by using the `instantiate` method. Note that this method
/// reflects an important semantic invariant of `InstantiatedClauses`: while
/// the `GenericClauses` are expressed in terms of the bound type
/// parameters of the impl/trait/whatever, an `InstantiatedClauses` instance
/// represented a set of bounds for some particular instantiation,
/// meaning that the generic parameters have been instantiated with
/// their values.
///
/// Example:
/// ```ignore (illustrative)
/// struct Foo<T, U: Bar<T>> { ... }
/// ```
/// Here, the `GenericClauses` for `Foo` would contain a list of bounds like
/// `[[], [U:Bar<T>]]`. Now if there were some particular reference
/// like `Foo<isize,usize>`, then the `InstantiatedClauses` would be `[[],
/// [usize:Bar<isize>]]`.
// PORT: the two `IntoIterator` impls are `into_iter` (by value, :809) and `into_iter_ref` (`for &InstantiatedClauses`,
// :823); `[Symbol.iterator]` is the by-reference one (what `for _ in &clauses` and `iter()` use).
// rustc-type: compiler/rustc_middle/src/ty/mod.rs:790 InstantiatedClauses
export class InstantiatedClauses implements Iterable<[Unnormalized<Clause>, Span]> {
  constructor(
    public clauses: Unnormalized<Clause>[],
    public spans: Span[],
  ) {}

  // rustc: compiler/rustc_middle/src/ty/mod.rs:796 empty
  static empty(): InstantiatedClauses {
    return new InstantiatedClauses([], []);
  }

  // rustc: compiler/rustc_middle/src/ty/mod.rs:800 is_empty
  is_empty(): boolean {
    return this.clauses.length === 0;
  }

  // rustc: compiler/rustc_middle/src/ty/mod.rs:804 iter
  iter(): IterableIterator<[Unnormalized<Clause>, Span]> {
    return this.into_iter_ref();
  }

  // rustc: compiler/rustc_middle/src/ty/mod.rs:817 into_iter
  into_iter(): IterableIterator<[Unnormalized<Clause>, Span]> {
    // debug_assert_eq!(self.clauses.len(), self.spans.len());
    return zip(this.clauses, this.spans);
  }

  // rustc: compiler/rustc_middle/src/ty/mod.rs:831 into_iter
  into_iter_ref(): IterableIterator<[Unnormalized<Clause>, Span]> {
    // debug_assert_eq!(self.clauses.len(), self.spans.len());
    return zip(this.clauses, this.spans);
  }

  [globalThis.Symbol.iterator](): IterableIterator<[Unnormalized<Clause>, Span]> {
    return this.into_iter_ref();
  }
}

/** `std::iter::zip`: pairs until the shorter side ends. */
function* zip<A, B>(a: readonly A[], b: readonly B[]): IterableIterator<[A, B]> {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) yield [a[i]!, b[i]!];
}

/** `#[derive(Debug)]` */
export const debug_InstantiatedClauses: Debug<InstantiatedClauses> = (v, f) =>
  debug_struct(f, "InstantiatedClauses", [
    ["clauses", debug_vec(v.clauses, f, (x, f) => debug_Unnormalized(x, f, middle_predicate().debug_Clause))],
    ["spans", debug_vec(v.spans, f, debug_Span)],
  ]);

// rustc-type: compiler/rustc_middle/src/ty/mod.rs:838 ProvisionalHiddenType
export class ProvisionalHiddenType {
  constructor(
    /// The span of this particular definition of the opaque type. So
    /// for example:
    ///
    /// ```ignore (incomplete snippet)
    /// type Foo = impl Baz;
    /// fn bar() -> Foo {
    /// //          ^^^ This is the span we are looking for!
    /// }
    /// ```
    ///
    /// In cases where the fn returns `(impl Trait, impl Trait)` or
    /// other such combinations, the result is currently
    /// over-approximated, but better than nothing.
    public readonly span: Span,

    /// The type variable that represents the value of the opaque type
    /// that we require. In other words, after we compile this function,
    /// we will be created a constraint like:
    /// ```ignore (pseudo-rust)
    /// Foo<'a, T> = ?C
    /// ```
    /// where `?C` is the value of this type variable. =) It may
    /// naturally refer to the type and lifetime parameters in scope
    /// in this function, though ultimately it should only reference
    /// those that are arguments to `Foo` in the constraint above. (In
    /// other words, `?C` should not include `'b`, even though it's a
    /// lifetime parameter on `foo`.)
    public readonly ty: Ty,
  ) {}

  // rustc: compiler/rustc_middle/src/ty/mod.rs:881 new_error
  static new_error(tcx: TyCtxt, guar: ErrorGuaranteed): ProvisionalHiddenType {
    return new ProvisionalHiddenType(DUMMY_SP, Ty.new_error(tcx, guar));
  }

  // rustc: compiler/rustc_middle/src/ty/mod.rs:885 build_mismatch_error
  build_mismatch_error(other: ProvisionalHiddenType, tcx: TyCtxt): Result<Diag, ErrorGuaranteed> {
    const r = tyir_visit().TypeVisitableExt.error_reported<[Ty, Ty]>([this.ty, other.ty], visit_Ty_Ty());
    if (r.$ === "Err") return r;
    // Found different concrete types for the opaque type.
    const sub_diag: TypeMismatchReason =
      this.span === other.span ? { $: "ConflictType", span: this.span } : { $: "PreviousUse", span: this.span };
    return Ok(
      tcx.dcx().create_err(
        OpaqueHiddenTypeMismatch_diagnostic({
          self_ty: this.ty,
          other_ty: other.ty,
          other_span: other.span,
          sub: sub_diag,
        }),
      ),
    );
  }

  // PORT: `#[instrument(level = "debug", skip(tcx), ret)]` and `debug!` are tracing (no output): dropped.
  // rustc: compiler/rustc_middle/src/ty/mod.rs:906 remap_generic_params_to_declaration_params
  remap_generic_params_to_declaration_params(
    opaque_type_key: OpaqueTypeKey,
    tcx: TyCtxt,
    defining_scope_kind: DefiningScopeKind,
  ): DefinitionSiteHiddenType {
    const { def_id, args } = opaque_type_key;

    // Use args to build up a reverse map from regions to their
    // identity mappings. This is necessary because of `impl
    // Trait` lifetimes are computed by replacing existing
    // lifetimes with 'static and remapping only those used in the
    // `impl Trait` return type, resulting in the parameters
    // shifting.
    const id_args = RawList.identity_for_item(tcx, into_query_key_DefId(def_id));
    // debug!(?id_args);

    // This zip may have several times the same lifetime in `args` paired with a different
    // lifetime from `id_args`. Simply `collect`ing the iterator is the correct behaviour:
    // it will pick the last one, which is the one we introduced in the impl-trait desugaring.
    // PORT: `FxIndexMap` is a `Map` (insertion-ordered; re-inserting a key keeps its slot, as `IndexMap::insert`).
    const map = new Map<GenericArg, GenericArg>(zip(args, id_args));
    // debug!("map = {:#?}", map);

    // Convert the type from the function into a type valid outside by mapping generic
    // parameters to into the context of the opaque.
    //
    // We erase regions when doing this during HIR typeck. We manually use `fold_regions`
    // here as we do not want to anonymize bound variables.
    const { fold_regions, standin_fold_Ty } = tyir_fold();
    let ty: Ty;
    switch (defining_scope_kind) {
      case "HirTypeck":
        ty = fold_regions(tcx, this.ty, () => tcx.lifetimes.re_erased, standin_fold_Ty);
        break;
      case "MirBorrowck":
        ty = this.ty;
        break;
    }
    const result_ty = standin_fold_Ty.fold_with(ty, ReverseMapper_new(tcx, map, this.span));
    // PORT: `if cfg!(debug_assertions) && .. { assert_eq!(result_ty, fold_regions(..)) }`: rustc ships without
    // debug assertions.
    return new DefinitionSiteHiddenType(this.span, tyir_binder().EarlyBinder.bind(tcx, result_ty, standin_fold_Ty));
  }
}

/** `#[derive(Debug)]` */
export const debug_ProvisionalHiddenType: Debug<ProvisionalHiddenType> = (v, f) =>
  debug_struct(f, "ProvisionalHiddenType", [
    ["span", debug_Span(v.span, f)],
    ["ty", debug_Ty(v.ty, f)],
  ]);

/// Whether we're currently in HIR typeck or MIR borrowck.
// rustc-type: compiler/rustc_middle/src/ty/mod.rs:871 DefiningScopeKind
export type DefiningScopeKind =
  /// During writeback in typeck, we don't care about regions and simply
  /// erase them. This means we also don't check whether regions are
  /// universal in the opaque type key. This will only be checked in
  /// MIR borrowck.
  | "HirTypeck"
  | "MirBorrowck";
export const DefiningScopeKind = { HirTypeck: "HirTypeck", MirBorrowck: "MirBorrowck" } as const;

/** `#[derive(Debug)]` */
export const debug_DefiningScopeKind: Debug<DefiningScopeKind> = (v) => v;

// rustc-type: compiler/rustc_middle/src/ty/mod.rs:949 DefinitionSiteHiddenType
export class DefinitionSiteHiddenType {
  constructor(
    /// The span of the definition of the opaque type. So for example:
    ///
    /// ```ignore (incomplete snippet)
    /// type Foo = impl Baz;
    /// fn bar() -> Foo {
    /// //          ^^^ This is the span we are looking for!
    /// }
    /// ```
    ///
    /// In cases where the fn returns `(impl Trait, impl Trait)` or
    /// other such combinations, the result is currently
    /// over-approximated, but better than nothing.
    public readonly span: Span,

    /// The final type of the opaque.
    public readonly ty: EarlyBinder<Ty>,
  ) {}

  // rustc: compiler/rustc_middle/src/ty/mod.rs:969 new_error
  static new_error(tcx: TyCtxt, guar: ErrorGuaranteed): DefinitionSiteHiddenType {
    return new DefinitionSiteHiddenType(DUMMY_SP, tyir_binder().EarlyBinder.bind(tcx, Ty.new_error(tcx, guar), tyir_fold().standin_fold_Ty));
  }

  // rustc: compiler/rustc_middle/src/ty/mod.rs:976 build_mismatch_error
  build_mismatch_error(other: DefinitionSiteHiddenType, tcx: TyCtxt): Result<Diag, ErrorGuaranteed> {
    const { EarlyBinder } = tyir_binder();
    const { Unnormalized } = tyir_unnormalized();
    const self_ty = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(this.ty));
    const other_ty = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(other.ty));
    const r = tyir_visit().TypeVisitableExt.error_reported<[Ty, Ty]>([self_ty, other_ty], visit_Ty_Ty());
    if (r.$ === "Err") return r;
    // Found different concrete types for the opaque type.
    const sub_diag: TypeMismatchReason =
      this.span === other.span ? { $: "ConflictType", span: this.span } : { $: "PreviousUse", span: this.span };
    return Ok(
      tcx.dcx().create_err(
        OpaqueHiddenTypeMismatch_diagnostic({
          self_ty,
          other_ty,
          other_span: other.span,
          sub: sub_diag,
        }),
      ),
    );
  }
}

/** `#[derive(Debug)]` */
export const debug_DefinitionSiteHiddenType: Debug<DefinitionSiteHiddenType> = (v, f) =>
  debug_struct(f, "DefinitionSiteHiddenType", [
    ["span", debug_Span(v.span, f)],
    ["ty", tyir_binder().debug_EarlyBinder(v.ty, f, debug_Ty)],
  ]);

// `pub type Clauses<'tcx> = &'tcx ListWithCachedTypeInfo<Clause<'tcx>>` (mod.rs:999) is list.ts's `Clauses`.

/** D4 descriptor: `impl rustc_type_ir::Flags for Clauses` (mod.rs:1001). */
export const flags_Clauses: Flags<Clauses> = {
  // rustc: compiler/rustc_middle/src/ty/mod.rs:1002 flags
  flags(self) {
    return self.flags();
  },

  // rustc: compiler/rustc_middle/src/ty/mod.rs:1006 outer_exclusive_binder
  outer_exclusive_binder(self) {
    return self.outer_exclusive_binder();
  },
};

/// When interacting with the type system we must provide information about the
/// environment. `ParamEnv` is the type that represents this information. See the
/// [dev guide chapter][param_env_guide] for more information.
///
/// [param_env_guide]: https://rustc-dev-guide.rust-lang.org/typing_parameter_envs.html
// PORT: the private field `caller_bounds` is `caller_bounds_` (the method `caller_bounds()` takes the name, as `Ty`'s
// `flags_`). `#[derive(PartialEq, Eq, Hash)]` compares the interned list: `ParamEnv_eq`; intern keys see the field.
// `static_assert_size!(ParamEnv<'_>, size_of::<usize>())` (mod.rs:1030) is a compile-time check: dropped.
// rustc-type: compiler/rustc_middle/src/ty/mod.rs:1018 ParamEnv
export class ParamEnv {
  constructor(
    /// Caller bounds are `Obligation`s that the caller must satisfy. This is
    /// basically the set of bounds on the in-scope type parameters, translated
    /// into `Obligation`s, and elaborated and normalized.
    ///
    /// Use the `caller_bounds()` method to access.
    readonly caller_bounds_: Clauses,
  ) {}

  /// Construct a trait environment suitable for contexts where there are
  /// no where-clauses in scope. In the majority of cases it is incorrect
  /// to use an empty environment. See the [dev guide section][param_env_guide]
  /// for information on what a `ParamEnv` is and how to acquire one.
  ///
  /// [param_env_guide]: https://rustc-dev-guide.rust-lang.org/typing_parameter_envs.html
  // rustc: compiler/rustc_middle/src/ty/mod.rs:1046 empty
  static empty(): ParamEnv {
    return new ParamEnv(RawList.empty_with_type_info());
  }

  // PORT: also `impl inherent::ParamEnv for ParamEnv` (mod.rs:1033, `self.caller_bounds()`): one method.
  // rustc: compiler/rustc_middle/src/ty/mod.rs:1033 caller_bounds
  // rustc: compiler/rustc_middle/src/ty/mod.rs:1051 caller_bounds
  caller_bounds(): IterableIterator<Clause> {
    return this.caller_bounds_.iter();
  }

  // rustc: compiler/rustc_middle/src/ty/mod.rs:1056 is_empty
  is_empty(): boolean {
    return this.caller_bounds_.as_slice().length === 0;
  }

  /// Construct a trait environment with the given set of predicates.
  // rustc: compiler/rustc_middle/src/ty/mod.rs:1062 new
  static new(tcx: TyCtxt, caller_bounds: Iterable<Clause>): ParamEnv {
    return new ParamEnv(tcx.mk_clauses_from_iter(caller_bounds));
  }

  /// Creates a pair of param-env and value for use in queries.
  // rustc: compiler/rustc_middle/src/ty/mod.rs:1070 and
  and<T>(value: T): ParamEnvAnd<T> {
    return { param_env: this, value };
  }

  /// Eagerly reveal all opaque types in the `param_env`.
  // rustc: compiler/rustc_middle/src/ty/mod.rs:1075 with_normalized
  with_normalized(tcx: TyCtxt): ParamEnv {
    // No need to reveal opaques with the new solver enabled,
    // since we have lazy norm.
    if (tcx.next_trait_solver_globally()) {
      return this;
    } else {
      // PORT: the query's value type is not generated yet (`unknown`): it is `Clauses`.
      return ParamEnv.new(tcx, (tcx.reveal_opaque_types_in_bounds(this.caller_bounds_) as Clauses).iter());
    }
  }
}

/** `#[derive(PartialEq)]` */
export function ParamEnv_eq(a: ParamEnv, b: ParamEnv): boolean {
  return a.caller_bounds_ === b.caller_bounds_;
}

/** `#[derive(Debug)]` */
export const debug_ParamEnv: Debug<ParamEnv> = (v, f) =>
  debug_struct(f, "ParamEnv", [["caller_bounds", debug_RawList(v.caller_bounds_, f, middle_predicate().debug_Clause)]]);

// rustc-type: compiler/rustc_middle/src/ty/mod.rs:1088 ParamEnvAnd
export interface ParamEnvAnd<T> {
  readonly param_env: ParamEnv;
  readonly value: T;
}

/** `#[derive(Debug)]` */
export function debug_ParamEnvAnd<T>(v: ParamEnvAnd<T>, f: Fmt, debug_T: Debug<T>): string {
  return debug_struct(f, "ParamEnvAnd", [
    ["param_env", debug_ParamEnv(v.param_env, f)],
    ["value", debug_T(v.value, f)],
  ]);
}

/// The environment in which to do trait solving.
///
/// Most of the time you only need to care about the `ParamEnv`
/// as the `TypingMode` is simply stored in the `InferCtxt`.
///
/// However, there are some places which rely on trait solving
/// without using an `InferCtxt` themselves. For these to be
/// able to use the trait system they have to be able to initialize
/// such an `InferCtxt` with the right `typing_mode`, so they need
/// to track both.
// PORT: the private field `typing_mode` is `typing_mode_` (the method `typing_mode()`, mod.rs:1117, takes the
// name). The inherent methods (mod.rs:1112..) are lane ty-mod-b's.
// rustc-type: compiler/rustc_middle/src/ty/mod.rs:1105 TypingEnv
export class TypingEnv {
  constructor(
    /** `#[type_foldable(identity)] #[type_visitable(ignore)]` */
    readonly typing_mode_: TypingModeEqWrapper,
    readonly param_env: ParamEnv,
  ) {}
}

/** `#[derive(Debug)]` */
export const debug_TypingEnv: Debug<TypingEnv> = (v, f) =>
  debug_struct(f, "TypingEnv", [
    ["typing_mode", debug_TypingModeEqWrapper(v.typing_mode_, f)],
    ["param_env", debug_ParamEnv(v.param_env, f)],
  ]);

// ---- tools/codegen's view of the traversal / Debug impls (merge-w13) ----
// PORT: generated code calls `visit_with_<T>` / `try_fold_with_<T>` / `fold_with_<T>` free fns and `debug_<T>`
// (tools/codegen type_fold.json / tyir.typemap.json). For `Term` they are the methods of the D4 descriptor above;
// `Ty`'s impls (structural_impls.rs) are stubs until lane ty-print / tyir-binder ports them (then: a D4 descriptor
// `fold_Ty`, which these wrap). `I::FnInputTys` = `&[Ty]` (rustc_type_ir/interner.ts header).
export type FnInputTys = readonly Ty[];

export function visit_with_Term<R>(self: Term, visitor: TypeVisitor<R>): R {
  return fold_Term.visit_with(self, visitor);
}
export function try_fold_with_Term<E>(self: Term, folder: FallibleTypeFolder<E>): Result<Term, E> {
  return fold_Term.try_fold_with(self, folder);
}
export function fold_with_Term(self: Term, folder: TypeFolder): Term {
  return fold_Term.fold_with(self, folder);
}

/** Stub: `impl fmt::Debug for Ty` (structural_impls.rs:82). */
export function debug_Ty(_v: Ty, _f: Fmt): string {
  return unported("rustc_middle::ty::Ty: Debug (structural_impls.rs:82)");
}
/** Stub: `impl TypeVisitable for Ty` (structural_impls.rs:324). */
export function visit_with_Ty<R>(_self: Ty, _visitor: TypeVisitor<R>): R {
  return unported("rustc_middle::ty::Ty: TypeVisitable::visit_with (structural_impls.rs:324)");
}
/** Stub: `impl TypeFoldable for Ty` (structural_impls.rs:311). */
export function try_fold_with_Ty<E>(_self: Ty, _folder: FallibleTypeFolder<E>): Result<Ty, E> {
  return unported("rustc_middle::ty::Ty: TypeFoldable::try_fold_with (structural_impls.rs:311)");
}
export function fold_with_Ty(_self: Ty, _folder: TypeFolder): Ty {
  return unported("rustc_middle::ty::Ty: TypeFoldable::fold_with (structural_impls.rs:311)");
}
/** `Debug for &[Ty]`: the slice's Debug. */
export function debug_FnInputTys(v: FnInputTys, f: Fmt): string {
  return debug_list(f, v.map((x) => debug_Ty(x, f)));
}

/** Stub: `#[derive(TypeVisitable)]` of `ParamEnv` (mod.rs:1018; not generated yet: ParamEnv is pending). */
// PORT: generated code (rustc_type_ir solve/mod.gen.ts) still types `I::ParamEnv` as decls.ts's pending `ParamEnv`, so
// these keep that type until root re-exports the class above from decls.ts.
export function visit_with_ParamEnv<R>(_self: ParamEnvPending, _visitor: TypeVisitor<R>): R {
  return unported("rustc_middle::ty::ParamEnv: TypeVisitable::visit_with (mod.rs:1018 derive)");
}
/** Stub: `#[derive(TypeFoldable)]` of `ParamEnv` (mod.rs:1018). */
export function try_fold_with_ParamEnv<E>(_self: ParamEnvPending, _folder: FallibleTypeFolder<E>): Result<ParamEnvPending, E> {
  return unported("rustc_middle::ty::ParamEnv: TypeFoldable::try_fold_with (mod.rs:1018 derive)");
}
export function fold_with_ParamEnv(_self: ParamEnvPending, _folder: TypeFolder): ParamEnvPending {
  return unported("rustc_middle::ty::ParamEnv: TypeFoldable::fold_with (mod.rs:1018 derive)");
}

// ---- impl TyCtxt (ty/mod.rs) -------------------------------------------------------------------
// PORT: free functions `TyCtxt_<name>(tcx, ..)`; the `TyCtxt` class (context.ts) declares the methods and
// delegates here (PORTING §8), so context.ts never depends on an extension module at load time.


// rustc: compiler/rustc_middle/src/ty/mod.rs:347 opt_parent
export function TyCtxt_opt_parent(tcx: TyCtxt, id: DefIdT): DefIdT | undefined {
  const index = tcx.def_key(id).parent;
  return index === undefined ? undefined : new DefId(index, id.krate);
}

// rustc: compiler/rustc_middle/src/ty/mod.rs:353 parent
export function TyCtxt_parent(tcx: TyCtxt, id: DefIdT): DefIdT {
  const p = tcx.opt_parent(id);
  if (p !== undefined) {
    return p;
  }
  // not `unwrap_or_else` to avoid breaking caller tracking
  return panic(`${debug_DefId(id, PLAIN)} doesn't have a parent`);
}

// rustc: compiler/rustc_middle/src/ty/mod.rs:363 opt_local_parent
export function TyCtxt_opt_local_parent(tcx: TyCtxt, id: LocalDefId): LocalDefId | undefined {
  return tcx.opt_parent(into_query_key_DefId(id))?.expect_local();
}

// rustc: compiler/rustc_middle/src/ty/mod.rs:369 local_parent
export function TyCtxt_local_parent(tcx: TyCtxt, id: LocalDefId | LocalModId): LocalDefId {
  return tcx.parent(into_query_key_DefId(id)).expect_local();
}

/// Compare def-ids based on their position in def-id tree, ancestor def-ids are considered
/// larger than descendant def-ids, and two different def-ids are considered unordered if
/// neither of them is an ancestor of the other.
// rustc: compiler/rustc_middle/src/ty/mod.rs:376 def_id_partial_cmp
export function TyCtxt_def_id_partial_cmp(tcx: TyCtxt, lhs: DefIdT, rhs: DefIdT): Ordering | undefined {
  // Def-ids from different crates are always unordered.
  if (lhs.krate !== rhs.krate) {
    return undefined;
  }

  // Def-ids of parent nodes are always created before def-ids of child nodes
  // and have a smaller index, so we only need to search in one direction,
  // either from lhs to rhs, or vice versa.
  const search = (start: DefIdT, finish: DefIdT, ord: Ordering): Ordering | undefined => {
    while (start.index !== finish.index) {
      const parent = tcx.opt_parent(start);
      if (parent !== undefined) {
        start = new DefId(parent.index, start.krate);
      } else {
        return undefined;
      }
    }
    return ord;
  };
  if (lhs.index === rhs.index) return "Equal";
  if (lhs.index < rhs.index) return search(rhs, lhs, "Greater");
  return search(lhs, rhs, "Less");
}

// rustc: compiler/rustc_middle/src/ty/mod.rs:401 is_descendant_of
export function TyCtxt_is_descendant_of(tcx: TyCtxt, descendant: IntoQueryKey<DefIdT>, ancestor: IntoQueryKey<DefIdT>): boolean {
  const o = tcx.def_id_partial_cmp(into_query_key_DefId(descendant), into_query_key_DefId(ancestor));
  return o === "Less" || o === "Equal";
}

/// Look up the name of a definition across crates. This does not look at HIR.
// rustc: compiler/rustc_middle/src/ty/mod.rs:1689 opt_item_name
export function TyCtxt_opt_item_name(tcx: TyCtxt, def_id_: IntoQueryKey<DefIdT>): Symbol | undefined {
  const def_id = into_query_key_DefId(def_id_);
  const cnum = def_id.as_crate_root();
  if (cnum !== undefined) {
    return tcx.crate_name(cnum);
  } else {
    const def_key = tcx.def_key(def_id);
    switch (def_key.disambiguated_data.data.$) {
      // The name of a constructor is that of its parent.
      case "Ctor": {
        const parent = def_key.parent;
        if (parent === undefined) panic("called `Option::unwrap()` on a `None` value");
        return tcx.opt_item_name(new DefId(parent, def_id.krate));
      }
      default:
        return def_key.get_opt_name();
    }
  }
}

/// Look up the name of a definition across crates. This does not look at HIR.
///
/// This method will ICE if the corresponding item does not have a name. In these cases, use
/// [`opt_item_name`] instead.
///
/// [`opt_item_name`]: Self::opt_item_name
// rustc: compiler/rustc_middle/src/ty/mod.rs:1710 item_name
export function TyCtxt_item_name(tcx: TyCtxt, id_: IntoQueryKey<DefIdT>): Symbol {
  const id = into_query_key_DefId(id_);
  const n = tcx.opt_item_name(id);
  if (n !== undefined) return n;
  return panic(`item_name: no name for ${debug_DefPath(tcx.def_path(id), PLAIN)}`);
}

// ---- stubs: the rest of `impl TyCtxt` in ty/mod.rs (upstream order) -----------------------------------
// Lane ty-mod-* fills each in place (marker above it, keep the position in upstream order relative to the
// ported fns above when it moves it) and keeps the delegating method in context.ts's `TyCtxt` class.

/** `TyCtxt::typeck_body` (ty/mod.rs:1578). */
export function TyCtxt_typeck_body(_tcx: TyCtxt, _body: BodyId): TypeckResults {
  return unported("rustc_middle::ty::TyCtxt::typeck_body");
}

/** `TyCtxt::provided_trait_methods` (ty/mod.rs:1582). */
export function TyCtxt_provided_trait_methods(_tcx: TyCtxt, _id: DefId): Iterable<AssocItem> {
  return unported("rustc_middle::ty::TyCtxt::provided_trait_methods");
}

/** `TyCtxt::repr_options_of_def` (ty/mod.rs:1588). */
export function TyCtxt_repr_options_of_def(_tcx: TyCtxt, _did: LocalDefId): ReprOptions {
  return unported("rustc_middle::ty::TyCtxt::repr_options_of_def");
}

/** `TyCtxt::opt_item_ident` (ty/mod.rs:1720). */
export function TyCtxt_opt_item_ident(_tcx: TyCtxt, _def_id: IntoQueryKey<DefId>): Ident | undefined {
  return unported("rustc_middle::ty::TyCtxt::opt_item_ident");
}

/** `TyCtxt::item_ident` (ty/mod.rs:1732). */
export function TyCtxt_item_ident(_tcx: TyCtxt, _def_id: IntoQueryKey<DefId>): Ident {
  return unported("rustc_middle::ty::TyCtxt::item_ident");
}

/** `TyCtxt::opt_associated_item` (ty/mod.rs:1739). */
export function TyCtxt_opt_associated_item(_tcx: TyCtxt, _def_id: DefId): AssocItem | undefined {
  return unported("rustc_middle::ty::TyCtxt::opt_associated_item");
}

/** `TyCtxt::opt_rpitit_info` (ty/mod.rs:1750). */
export function TyCtxt_opt_rpitit_info(_tcx: TyCtxt, _def_id: DefId): ImplTraitInTraitData | undefined {
  return unported("rustc_middle::ty::TyCtxt::opt_rpitit_info");
}

/** `TyCtxt::find_field_index` (ty/mod.rs:1761). */
export function TyCtxt_find_field_index(_tcx: TyCtxt, _ident: Ident, _variant: VariantDef): FieldIdx | undefined {
  return unported("rustc_middle::ty::TyCtxt::find_field_index");
}

/** `TyCtxt::impls_are_allowed_to_overlap` (ty/mod.rs:1770). */
export function TyCtxt_impls_are_allowed_to_overlap(_tcx: TyCtxt, _def_id1: DefId, _def_id2: DefId): ImplOverlapKind | undefined {
  return unported("rustc_middle::ty::TyCtxt::impls_are_allowed_to_overlap");
}

/** `TyCtxt::expect_variant_res` (ty/mod.rs:1809). */
export function TyCtxt_expect_variant_res(_tcx: TyCtxt, _res: Res): VariantDef {
  return unported("rustc_middle::ty::TyCtxt::expect_variant_res");
}

/** `TyCtxt::instance_mir` (ty/mod.rs:1831). */
export function TyCtxt_instance_mir(_tcx: TyCtxt, _instance: InstanceKind): Body {
  return unported("rustc_middle::ty::TyCtxt::instance_mir");
}

/** `TyCtxt::get_attrs` (ty/mod.rs:1874). */
export function TyCtxt_get_attrs(_tcx: TyCtxt, _did: DefId, _attr: Symbol): Iterable<Attribute> {
  return unported("rustc_middle::ty::TyCtxt::get_attrs");
}

/** `TyCtxt::get_all_attrs` (ty/mod.rs:1893). */
export function TyCtxt_get_all_attrs(_tcx: TyCtxt, _did: DefId): readonly Attribute[] {
  return unported("rustc_middle::ty::TyCtxt::get_all_attrs");
}

/** `TyCtxt::get_attrs_by_path` (ty/mod.rs:1902). */
export function TyCtxt_get_attrs_by_path(_tcx: TyCtxt, _did: DefId, _attr: readonly Symbol[]): Iterable<Attribute> {
  return unported("rustc_middle::ty::TyCtxt::get_attrs_by_path");
}

/** `TyCtxt::trait_is_auto` (ty/mod.rs:1916). */
export function TyCtxt_trait_is_auto(_tcx: TyCtxt, _trait_def_id: DefId): boolean {
  return unported("rustc_middle::ty::TyCtxt::trait_is_auto");
}

/** `TyCtxt::trait_is_coinductive` (ty/mod.rs:1922). */
export function TyCtxt_trait_is_coinductive(_tcx: TyCtxt, _trait_def_id: DefId): boolean {
  return unported("rustc_middle::ty::TyCtxt::trait_is_coinductive");
}

/** `TyCtxt::trait_is_alias` (ty/mod.rs:1927). */
export function TyCtxt_trait_is_alias(_tcx: TyCtxt, _trait_def_id: DefId): boolean {
  return unported("rustc_middle::ty::TyCtxt::trait_is_alias");
}

/** `TyCtxt::layout_error` (ty/mod.rs:1932). */
export function TyCtxt_layout_error(_tcx: TyCtxt, _err: LayoutError): LayoutError {
  return unported("rustc_middle::ty::TyCtxt::layout_error");
}

/** `TyCtxt::ordinary_coroutine_layout` (ty/mod.rs:1941). */
export function TyCtxt_ordinary_coroutine_layout(_tcx: TyCtxt, _def_id: DefId, _args: GenericArgs): Result<CoroutineLayout, LayoutError> {
  return unported("rustc_middle::ty::TyCtxt::ordinary_coroutine_layout");
}

/** `TyCtxt::async_drop_coroutine_layout` (ty/mod.rs:1982). */
export function TyCtxt_async_drop_coroutine_layout(_tcx: TyCtxt, _def_id: DefId, _args: GenericArgs): Result<CoroutineLayout, LayoutError> {
  return unported("rustc_middle::ty::TyCtxt::async_drop_coroutine_layout");
}

/** `TyCtxt::coroutine_layout` (ty/mod.rs:1999). */
export function TyCtxt_coroutine_layout(_tcx: TyCtxt, _def_id: DefId, _args: GenericArgs): Result<CoroutineLayout, LayoutError> {
  return unported("rustc_middle::ty::TyCtxt::coroutine_layout");
}

/** `TyCtxt::assoc_parent` (ty/mod.rs:2034). */
export function TyCtxt_assoc_parent(_tcx: TyCtxt, _def_id: DefId): [DefId, DefKind] | undefined {
  return unported("rustc_middle::ty::TyCtxt::assoc_parent");
}

/** `TyCtxt::trait_item_of` (ty/mod.rs:2044). */
export function TyCtxt_trait_item_of(_tcx: TyCtxt, _def_id: IntoQueryKey<DefId>): DefId | undefined {
  return unported("rustc_middle::ty::TyCtxt::trait_item_of");
}

/** `TyCtxt::trait_of_assoc` (ty/mod.rs:2051). */
export function TyCtxt_trait_of_assoc(_tcx: TyCtxt, _def_id: DefId): DefId | undefined {
  return unported("rustc_middle::ty::TyCtxt::trait_of_assoc");
}

/** `TyCtxt::impl_is_of_trait` (ty/mod.rs:2058). */
export function TyCtxt_impl_is_of_trait(_tcx: TyCtxt, _def_id: IntoQueryKey<DefId>): boolean {
  return unported("rustc_middle::ty::TyCtxt::impl_is_of_trait");
}

/** `TyCtxt::impl_of_assoc` (ty/mod.rs:2068). */
export function TyCtxt_impl_of_assoc(_tcx: TyCtxt, _def_id: DefId): DefId | undefined {
  return unported("rustc_middle::ty::TyCtxt::impl_of_assoc");
}

/** `TyCtxt::inherent_impl_of_assoc` (ty/mod.rs:2077). */
export function TyCtxt_inherent_impl_of_assoc(_tcx: TyCtxt, _def_id: DefId): DefId | undefined {
  return unported("rustc_middle::ty::TyCtxt::inherent_impl_of_assoc");
}

/** `TyCtxt::trait_impl_of_assoc` (ty/mod.rs:2086). */
export function TyCtxt_trait_impl_of_assoc(_tcx: TyCtxt, _def_id: DefId): DefId | undefined {
  return unported("rustc_middle::ty::TyCtxt::trait_impl_of_assoc");
}

/** `TyCtxt::impl_polarity` (ty/mod.rs:2093). */
export function TyCtxt_impl_polarity(_tcx: TyCtxt, _def_id: IntoQueryKey<DefId>): ImplPolarity {
  return unported("rustc_middle::ty::TyCtxt::impl_polarity");
}

/** `TyCtxt::impl_trait_ref` (ty/mod.rs:2099). */
export function TyCtxt_impl_trait_ref(_tcx: TyCtxt, _def_id: IntoQueryKey<DefId>): EarlyBinder<TraitRef> {
  return unported("rustc_middle::ty::TyCtxt::impl_trait_ref");
}

/** `TyCtxt::impl_opt_trait_ref` (ty/mod.rs:2109). */
export function TyCtxt_impl_opt_trait_ref(_tcx: TyCtxt, _def_id: IntoQueryKey<DefId>): EarlyBinder<TraitRef> | undefined {
  return unported("rustc_middle::ty::TyCtxt::impl_opt_trait_ref");
}

/** `TyCtxt::impl_trait_id` (ty/mod.rs:2118). */
export function TyCtxt_impl_trait_id(_tcx: TyCtxt, _def_id: IntoQueryKey<DefId>): DefId {
  return unported("rustc_middle::ty::TyCtxt::impl_trait_id");
}

/** `TyCtxt::impl_opt_trait_id` (ty/mod.rs:2125). */
export function TyCtxt_impl_opt_trait_id(_tcx: TyCtxt, _def_id: IntoQueryKey<DefId>): DefId | undefined {
  return unported("rustc_middle::ty::TyCtxt::impl_opt_trait_id");
}

/** `TyCtxt::is_exportable` (ty/mod.rs:2130). */
export function TyCtxt_is_exportable(_tcx: TyCtxt, _def_id: DefId): boolean {
  return unported("rustc_middle::ty::TyCtxt::is_exportable");
}

/** `TyCtxt::is_builtin_derived` (ty/mod.rs:2136). */
export function TyCtxt_is_builtin_derived(_tcx: TyCtxt, _def_id: DefId): boolean {
  return unported("rustc_middle::ty::TyCtxt::is_builtin_derived");
}

/** `TyCtxt::is_automatically_derived` (ty/mod.rs:2150). */
export function TyCtxt_is_automatically_derived(_tcx: TyCtxt, _def_id: DefId): boolean {
  return unported("rustc_middle::ty::TyCtxt::is_automatically_derived");
}

/** `TyCtxt::span_of_impl` (ty/mod.rs:2156). */
export function TyCtxt_span_of_impl(_tcx: TyCtxt, _impl_def_id: DefId): Result<Span, Symbol> {
  return unported("rustc_middle::ty::TyCtxt::span_of_impl");
}

/** `TyCtxt::hygienic_eq` (ty/mod.rs:2167). */
export function TyCtxt_hygienic_eq(_tcx: TyCtxt, _use_ident: Ident, _def_ident: Ident, _def_parent_def_id: DefId): boolean {
  return unported("rustc_middle::ty::TyCtxt::hygienic_eq");
}

/** `TyCtxt::adjust_ident` (ty/mod.rs:2178). */
export function TyCtxt_adjust_ident(_tcx: TyCtxt, _ident: Ident, _scope: DefId): Ident {
  return unported("rustc_middle::ty::TyCtxt::adjust_ident");
}

/** `TyCtxt::adjust_ident_and_get_scope` (ty/mod.rs:2183). */
export function TyCtxt_adjust_ident_and_get_scope(_tcx: TyCtxt, _ident: Ident, _scope: DefId, _mod_id: LocalModId): [Ident, ModId] {
  return unported("rustc_middle::ty::TyCtxt::adjust_ident_and_get_scope");
}

/** `TyCtxt::is_const_fn` (ty/mod.rs:2201). */
export function TyCtxt_is_const_fn(_tcx: TyCtxt, _def_id: IntoQueryKey<DefId>): boolean {
  return unported("rustc_middle::ty::TyCtxt::is_const_fn");
}

/** `TyCtxt::is_conditionally_const` (ty/mod.rs:2215). */
export function TyCtxt_is_conditionally_const(_tcx: TyCtxt, _def_id: DefId): boolean {
  return unported("rustc_middle::ty::TyCtxt::is_conditionally_const");
}

/** `TyCtxt::is_const_trait` (ty/mod.rs:2298). */
export function TyCtxt_is_const_trait(_tcx: TyCtxt, _def_id: DefId): boolean {
  return unported("rustc_middle::ty::TyCtxt::is_const_trait");
}

/** `TyCtxt::impl_method_has_trait_impl_trait_tys` (ty/mod.rs:2302). */
export function TyCtxt_impl_method_has_trait_impl_trait_tys(_tcx: TyCtxt, _def_id: DefId): boolean {
  return unported("rustc_middle::ty::TyCtxt::impl_method_has_trait_impl_trait_tys");
}

/** `TyCtxt::fn_abi_of_instance` (ty/mod.rs:2333). */
export function TyCtxt_fn_abi_of_instance(_tcx: TyCtxt, _query: PseudoCanonicalInput<[Instance, List<Ty>]>): Result<FnAbi<Ty>, FnAbiError> {
  return unported("rustc_middle::ty::TyCtxt::fn_abi_of_instance");
}
