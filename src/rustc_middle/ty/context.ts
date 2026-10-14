//! Type context book-keeping.
// Partial port of compiler/rustc_middle/src/ty/context.rs: `GlobalCtxt`, `TyCtxt`, `TyCtxtFeed`,
// `CurrentGcx` and the `TyCtxt` methods name resolution and expansion need (docs/plan-m2.md blocker G).
//
// PORT decisions (D3 and PORTING §5):
// - `TyCtxt` is a class wrapping the `GlobalCtxt` (`gcx`); `impl Deref for TyCtxt` is the getters below
//   (`sess`, `dep_graph`, `prof`, `hooks`, `query_system`). Private `GlobalCtxt` fields (`untracked`,
//   `crate_types`, `stable_crate_id`) are read through `this.gcx`.
// - Arenas are erased (`arena`, `hir_arena`); `GlobalCaches` and `alloc_map` are not ported.
// - Type interning (lane ty-contract, docs/plan-m3.md D2): `CtxtInterners` (eager, in `create_global_ctxt`), the
//   `direct_interners!` / `slice_interners!` methods and the `mk_*` entry points that only intern. `CommonTypes`,
//   `CommonLifetimes` and `CommonConsts` are built on the first read of `types` / `lifetimes` / `consts` instead of
//   in `create_global_ctxt`: `CommonTypes::new` needs `FlagComputation::for_kind` (lane tyir-kind) and
//   `CommonConsts::new` needs `ValTree`/`ScalarInt`; building them eagerly would make every run UNPORTED.
//   Nothing observable depends on when they are built.
// - No dep graph (D3): `dep_graph` is the disabled graph (dep_graph/graph.ts).
// - `data_layout` (`sess.target.parse_data_layout()`) is computed on first read, pending rustc_target /
//   rustc_abi (lane target-cfg); upstream computes it eagerly in `create_global_ctxt` and can only fail
//   for custom target specs.
// - Query methods (`tcx.$query(..)`) are installed by query/query_api.ts and hook methods by hooks.ts.
import type { Crate } from "../../rustc_ast/ast.gen.ts";
import type { LanguageItems } from "../../rustc_attr_ir/lang_items.ts";
import type { Untracked, CrateStoreDyn } from "../../rustc_crate_store/cstore.ts";
import type { DiagCtxtHandle } from "../../rustc_errors/lib.ts";
import type { Features } from "../../rustc_feature/unstable.ts";
import { Safety } from "../../rustc_hir/lib.ts";
import { DefKind } from "../../rustc_hir/def.ts";
import type { DefKey, DefPath, DefPathData, Definitions, PerParentDisambiguatorState } from "../../rustc_hir_id/definitions.ts";
import { OwnerId } from "../../rustc_hir_id/lib.ts";
import type { Session } from "../../rustc_session/session.ts";
import type { SelfProfilerRef } from "../../rustc_session/stand_ins.ts";
import { CRATE_DEF_ID, type CrateNum, type DefId, DefPathHash, LOCAL_CRATE, LocalDefId, LocalModId, type ModId, StableCrateId, debug_StableCrateId } from "../../rustc_span/def_id.ts";
import { DUMMY_SP, Span } from "../../rustc_span/lib.ts";
import { Symbol } from "../../rustc_span/symbol.ts";
import type { CrateType } from "../../rustc_structures/lib.ts";
import type { Limit } from "../../rustc_structures/lib.ts";
import { PLAIN } from "../../std/fmt.ts";
import { assert, assert_eq, panic, unported } from "../../std/panic.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
import { Steal } from "../../rustc_data_structures/steal.ts";
import type { DepGraph } from "../dep_graph/graph.ts";
import { DepNodeIndex } from "../dep_graph/graph.ts";
import { StableHashState } from "../ich.ts";
import type { Providers as HookProviders } from "../hooks.ts";
import type { ModChild, ResolverAstLowering } from "../middle/resolve.ts";
import type { QueryTypes } from "../queries.gen.ts";
import { type IntoQueryKey, into_query_key_DefId } from "../query/into_query_key.ts";
import type { QuerySystem } from "../query/system.ts";
import * as calls from "../query/calls.ts";
import type { TyCtxtAt, TyCtxtEnsureDone, TyCtxtEnsureOk, TyCtxtEnsureResult } from "../query/calls.ts";
import * as ty_mod from "./mod.ts";
import { enter_context, ImplicitCtxt } from "./context/tls.ts";
import { Visibility } from "./mod.ts";
import type { Ordering } from "./mod.ts";
import { Interned } from "../../rustc_data_structures/intern.ts";
import { type InternedSet as InternedSetImpl, ShardedHashMap } from "../../rustc_data_structures/sharded.ts";
import { intern_key } from "../../rust_ts/intern_key.ts";
import type { ArgOutlivesClause, BoundVar, BoundVariableKind, CanonicalInputData, CanonicalVarKind, ConstKind, DebruijnIndex, ExternalConstraintsData, ImplPolarity, OpaqueTypeKey, PatternKind, PolyExistentialPredicate, PredicateKind, RegionKind, RegionVid, TraitRef, TyKind, TyVid, ValTreeKind } from "../../rustc_type_ir/decls.ts";
import { FlagComputation } from "../../rustc_type_ir/flags.ts";
import { CollectAndApply_Result, CollectAndApply_T } from "../../rustc_type_ir/interner.ts";
import { Const, Region } from "../../rustc_type_ir/sty/mod.ts";
import { kw } from "../../rustc_span/symbol.ts";
import type { AdtDef, AdtDefData, Allocation, AssocItem, Attribute, Body, BodyId, CanonicalInput, CapturedPlace, ConstAllocation, CoroutineLayout, ExternalConstraints, FieldIdx, FnAbi, FnAbiError, ImplOverlapKind, ImplTraitInTraitData, Instance, InstanceKind, Layout, LayoutData, LayoutError, Pattern, PlaceElem, ProjectionKind, PseudoCanonicalInput, ReprOptions, TypeckResults, ValTree, VariantDef } from "./decls.ts";
import { GenericArg, type GenericArgs } from "./generic_args.ts";
import { type Clauses, type List, RawList, TypeInfo } from "./list.ts";
import { Ty } from "./mod.ts";
import { type Clause, Predicate } from "./predicate.ts";
import type { Ident } from "../../rustc_span/symbol.ts";
import type { Namespace, DefKind as DefKindT, Res } from "../../rustc_hir/def.ts";
import { type Attribute as Attribute_, find_attr } from "../../rustc_attr_ir/lib.ts";
import type { LangItem } from "../../rustc_attr_ir/lang_items.ts";
import type { ConstStability } from "../../rustc_attr_ir/stability.ts";
import type { Diag, Diagnostic } from "../../rustc_errors/lib.ts";
import { into_MultiSpan, type IntoMultiSpan } from "../../rustc_error_messages/lib.ts";
import { debug_DefKind } from "../../rustc_hir/def.ts";
import { type Constness, CoroutineKind, Node, type OpaqueTyOrigin, type TraitCandidate, type Ty as HirTy } from "../../rustc_hir/lib.ts";
import type { DefPathToIndexMap } from "../../rustc_hir_id/definitions.ts";
import { CRATE_HIR_ID, type HirId } from "../../rustc_hir_id/lib.ts";
import type { Lint } from "../../rustc_lint_defs/lib.ts";
import type { Movability } from "../../rustc_ast_ir/lib.ts";
import { DefId_eq, DefIndex, debug_DefId, debug_LocalDefId } from "../../rustc_span/def_id.ts";
import type { ErrorGuaranteed } from "../../rustc_span/lib.ts";
import { sym } from "../../rustc_span/symbol.ts";
import { PRETTY, type Debug, type Fmt, debug_bool, debug_struct, debug_vec } from "../../std/fmt.ts";
import { unwrap } from "../../std/panic.ts";
import { FnSig, FnSigKind, PolyFnSig } from "../../rustc_type_ir/ty_kind.ts";
import { Binder, EarlyBinder } from "../../rustc_type_ir/binder.ts";
import { supertrait_def_ids } from "../../rustc_type_ir/elaborate.ts";
import { standin_fold_Ty } from "../../rustc_type_ir/fold.ts";
import { Unnormalized } from "../../rustc_type_ir/unnormalized.ts";
import type { AliasTermKind, CanonicalParamEnvCache, GlobalCache, Pending, PendingEnum } from "../../rustc_type_ir/decls.ts";
import type { EarlyParamRegion, LateParamRegionKind, VariantIdx } from "./decls.ts";
import { debug_GenericArg, debug_GenericArgs } from "./generic_args.ts";
import type { GenericParamDef, Generics } from "./generics.ts";
import type { ListWithCachedTypeInfo } from "./list.ts";

/**
 * PORT: `rustc_session::Limits` (session.rs:62; `#[derive(Copy, Clone, Debug, ..)]`) is not ported; this is its
 * shape, as returned by the `limits` query (rustc_interface/src/limits.rs, pending).
 */
export interface Limits {
  /// The maximum recursion limit for potentially infinitely recursive
  /// operations such as auto-dereference and monomorphization.
  recursion_limit: Limit;
  /// The size at which the `large_assignments` lint starts
  /// being emitted.
  move_size_limit: Limit;
  /// The maximum length of types during monomorphization.
  type_length_limit: Limit;
  /// The maximum pattern complexity allowed (internal only).
  pattern_complexity_limit: Limit;
}

// PORT: the `rustc_type_ir::inherent::*` impls below (`I::DefId` = `DefId`, `I::Safety` = hir `Safety`, `I::Features`
// = `Features`, `I::Span` = `Span`, rustc_type_ir/interner.ts header) are companion objects taking `self` first
// (`inherent_<Trait>`), as rustc_type_ir/inherent.rs is not ported: generic code calls the same-named inherent methods
// (`def_id.is_local()`, `Safety.is_safe(s)`, `features.generic_const_exprs()`) directly, which these forward to.

// `impl inherent::DefId<TyCtxt> for DefId` (context.rs:81)
export const inherent_DefId = {
  // rustc: compiler/rustc_middle/src/ty/context.rs:82 is_local
  is_local(self: DefId): boolean {
    return self.is_local();
  },

  // rustc: compiler/rustc_middle/src/ty/context.rs:86 as_local
  as_local(self: DefId): LocalDefId | undefined {
    return self.as_local();
  },
};

// `impl inherent::Safety<TyCtxt> for hir::Safety` (context.rs:91)
export const inherent_Safety = {
  // rustc: compiler/rustc_middle/src/ty/context.rs:92 safe
  safe(): Safety {
    return "Safe";
  },

  // rustc: compiler/rustc_middle/src/ty/context.rs:96 unsafe_mode
  unsafe_mode(): Safety {
    return "Unsafe";
  },

  // rustc: compiler/rustc_middle/src/ty/context.rs:100 is_safe
  is_safe(self: Safety): boolean {
    return Safety.is_safe(self);
  },

  // rustc: compiler/rustc_middle/src/ty/context.rs:104 prefix_str
  prefix_str(self: Safety): string {
    return Safety.prefix_str(self);
  },
};

// `impl inherent::Features<TyCtxt> for &rustc_feature::Features` (context.rs:109)
export const inherent_Features = {
  // rustc: compiler/rustc_middle/src/ty/context.rs:110 generic_const_exprs
  generic_const_exprs(self: Features): boolean {
    return self.generic_const_exprs();
  },

  // rustc: compiler/rustc_middle/src/ty/context.rs:114 gca_const_items
  gca_const_items(self: Features): boolean {
    return self.gca_const_items();
  },

  // rustc: compiler/rustc_middle/src/ty/context.rs:118 coroutine_clone
  coroutine_clone(self: Features): boolean {
    return self.coroutine_clone();
  },

  // rustc: compiler/rustc_middle/src/ty/context.rs:122 feature_bound_holds_in_crate
  feature_bound_holds_in_crate(self: Features, symbol: Symbol): boolean {
    // We don't consider feature bounds to hold in the crate when `staged_api` feature is
    // enabled, even if it is enabled through `#[feature]`.
    // This is to prevent accidentally leaking unstable APIs to stable.
    return !self.staged_api() && self.enabled(symbol);
  },
};

// `impl inherent::Span<TyCtxt> for Span` (context.rs:130)
export const inherent_Span = {
  // rustc: compiler/rustc_middle/src/ty/context.rs:131 dummy
  dummy(): Span {
    return DUMMY_SP;
  },
};

// PORT: types of upstream modules that are not ported yet, used in signatures here (`Pending`, rustc_type_ir/decls.ts).
// `CodegenFnAttrs` / `TargetFeature` (middle/codegen_fn_attrs.rs) and `Place` (mir/syntax.rs) list only the fields this
// file reads.
type Thir = Pending<"thir::Thir">;
type AdtKind = Pending<"ty::AdtKind">;
type AllocId = Pending<"mir::interpret::AllocId">;
type IntrinsicDef = Pending<"ty::IntrinsicDef">;
type DepNode = Pending<"dep_graph::DepNode">;
type Local = Pending<"mir::Local">;
type ResolvedArg = PendingEnum<"middle::resolve_bound_vars::ResolvedArg">;
interface TargetFeature {
  name: Symbol;
}
interface CodegenFnAttrs {
  target_features: readonly TargetFeature[];
}
interface Place {
  local: Local;
  projection: List<PlaceElem>;
}
/** `std::env::VarError` */
type VarError = { $: "NotPresent" } | { $: "NotUnicode"; _0: string };

/** PORT (D2): `ShardedHashMap<InternedInSet<'tcx, T>, ()>`; the stored `K` is the hash-consed object itself. */
type InternedSet<K> = InternedSetImpl<K>;

// rustc-type: compiler/rustc_middle/src/ty/context.rs:138 CtxtInterners
// PORT (D2): every set maps the canonical key of the value (rust_ts/intern_key.ts: the derived `Hash` + `Eq` of
// `TyKind`, `RegionKind`, ... with interned children by id, i.e. upstream's `InternedInSet` `Borrow`/`Hash`/`Eq`
// impls, context.rs:1906-1999) to the one object made for it. The arena is erased (PORTING §5). The element
// types of sets whose classes are not ported yet are `unknown`; their `mk_*` / `intern_*` are stubs.
export class CtxtInterners {
  constructor(
    // Specifically use a speedy hash algorithm for these hash sets, since
    // they're accessed quite often.
    public type_: InternedSet<Ty>,
    public const_lists: InternedSet<List<Const>>,
    public args: InternedSet<GenericArgs>,
    public type_lists: InternedSet<List<Ty>>,
    public canonical_var_kinds: InternedSet<List<CanonicalVarKind>>,
    public region: InternedSet<Region>,
    public poly_existential_predicates: InternedSet<List<PolyExistentialPredicate>>,
    public predicate: InternedSet<Predicate>,
    public clauses: InternedSet<Clauses>,
    public projs: InternedSet<List<ProjectionKind>>,
    public place_elems: InternedSet<List<PlaceElem>>,
    public const_: InternedSet<Const>,
    public pat: InternedSet<unknown>,
    public const_allocation: InternedSet<unknown>,
    public bound_variable_kinds: InternedSet<List<BoundVariableKind>>,
    public layout: InternedSet<unknown>,
    public adt_def: InternedSet<unknown>,
    public external_constraints: InternedSet<unknown>,
    public predefined_opaques_in_body: InternedSet<List<[OpaqueTypeKey, Ty]>>,
    public fields: InternedSet<List<FieldIdx>>,
    public local_def_ids: InternedSet<List<LocalDefId>>,
    public captures: InternedSet<List<CapturedPlace>>,
    public valtree: InternedSet<unknown>,
    public patterns: InternedSet<List<Pattern>>,
    public outlives: InternedSet<List<ArgOutlivesClause>>,
    public canonical_inputs: InternedSet<unknown>,
  ) {}

  // rustc: compiler/rustc_middle/src/ty/context.rs:173 new
  static new(_arena?: undefined): CtxtInterners {
    // Default interner size - this value has been chosen empirically, and may need to be
    // adjusted as the compiler evolves.
    const N = 2048;
    // The factors have been chosen by @FractalFir based on observed interner sizes, and
    // local perf runs. To get the interner sizes, insert `eprintln` printing the size of
    // the interner in functions like `intern_ty`. Bigger benchmarks tend to give more
    // accurate ratios, so use something like `x perf eprintln --includes cargo`.
    // PORT: the arena (first field) is erased; the capacities are hints only (sharded.ts).
    return new CtxtInterners(
      ShardedHashMap.with_capacity(N * 16), // type_
      ShardedHashMap.with_capacity(N * 4), // const_lists
      ShardedHashMap.with_capacity(N * 4), // args
      ShardedHashMap.with_capacity(N * 4), // type_lists
      ShardedHashMap.with_capacity(N / 2), // canonical_var_kinds
      ShardedHashMap.with_capacity(N * 4), // region
      ShardedHashMap.with_capacity(N / 4), // poly_existential_predicates
      ShardedHashMap.with_capacity(N), // predicate
      ShardedHashMap.with_capacity(N), // clauses
      ShardedHashMap.with_capacity(N * 4), // projs
      ShardedHashMap.with_capacity(N * 2), // place_elems
      ShardedHashMap.with_capacity(N * 2), // const_
      ShardedHashMap.with_capacity(N), // pat
      ShardedHashMap.with_capacity(N), // const_allocation
      ShardedHashMap.with_capacity(N * 2), // bound_variable_kinds
      ShardedHashMap.with_capacity(N), // layout
      ShardedHashMap.with_capacity(N), // adt_def
      ShardedHashMap.with_capacity(N), // external_constraints
      ShardedHashMap.with_capacity(N), // predefined_opaques_in_body
      ShardedHashMap.with_capacity(N * 4), // fields
      ShardedHashMap.with_capacity(N), // local_def_ids
      ShardedHashMap.with_capacity(N), // captures
      ShardedHashMap.with_capacity(N), // valtree
      ShardedHashMap.with_capacity(N), // patterns
      ShardedHashMap.with_capacity(N), // outlives
      ShardedHashMap.with_capacity(N), // canonical_inputs
    );
  }

  /// Interns a type. (Use `mk_*` functions instead, where possible.)
  // rustc: compiler/rustc_middle/src/ty/context.rs:215 intern_ty
  intern_ty(kind: TyKind): Ty {
    return Interned.new_unchecked(
      this.type_.intern(kind, intern_key(kind), (kind) => {
        const flags = FlagComputation.for_kind(kind);
        return new Ty(kind, flags.flags, flags.outer_exclusive_binder);
      }),
    );
  }

  /// Interns a const. (Use `mk_*` functions instead, where possible.)
  // rustc: compiler/rustc_middle/src/ty/context.rs:233 intern_const
  intern_const(kind: ConstKind): Const {
    return Interned.new_unchecked(
      this.const_.intern(kind, intern_key(kind), (kind) => {
        const flags = FlagComputation.for_const_kind(kind);
        return new Const(kind, flags.flags, flags.outer_exclusive_binder);
      }),
    );
  }

  /// Interns a predicate. (Use `mk_predicate` instead, where possible.)
  // rustc: compiler/rustc_middle/src/ty/context.rs:250 intern_predicate
  intern_predicate(kind: Binder<PredicateKind>): Predicate {
    return Interned.new_unchecked(
      this.predicate.intern(kind, intern_key(kind), (kind) => {
        const flags = FlagComputation.for_predicate(kind);
        return new Predicate(kind, flags.flags, flags.outer_exclusive_binder);
      }),
    );
  }

  // rustc: compiler/rustc_middle/src/ty/context.rs:265 intern_clauses
  intern_clauses(clauses: readonly Clause[]): Clauses {
    if (clauses.length === 0) {
      return RawList.empty_with_type_info();
    } else {
      return this.clauses.intern_ref(clauses, intern_key(clauses), () => {
        const flags = FlagComputation.for_clauses(clauses);

        return RawList.from_arena(undefined, TypeInfo.from(flags), clauses);
      });
    }
  }
}

// For these preinterned values, an alternative would be to have
// variable-length vectors that grow as needed. But that turned out to be
// slightly more complex and no faster.

const NUM_PREINTERNED_TY_VARS = 100;
const NUM_PREINTERNED_FRESH_TYS = 20;
const NUM_PREINTERNED_FRESH_INT_TYS = 3;
const NUM_PREINTERNED_FRESH_FLOAT_TYS = 3;
const NUM_PREINTERNED_ANON_BOUND_TYS_I = 3;

// From general profiling of the *max vars during canonicalization* of a value:
// - about 90% of the time, there are no canonical vars
// - about 9% of the time, there is only one canonical var
// - there are rarely more than 3-5 canonical vars (with exceptions in particularly pathological
//   cases)
// This may not match the number of bound vars found in `for`s.
// Given that this is all heap interned, it seems likely that interning fewer
// vars here won't make an appreciable difference. Though, if we were to inline the data (in an
// array), we may want to consider reducing the number for canonicalized vars down to 4 or so.
const NUM_PREINTERNED_ANON_BOUND_TYS_V = 20;

// This number may seem high, but it is reached in all but the smallest crates.
const NUM_PREINTERNED_RE_VARS = 500;
const NUM_PREINTERNED_ANON_RE_BOUNDS_I = 3;
const NUM_PREINTERNED_ANON_RE_BOUNDS_V = 20;

// PORT: the `newtype_index!` conversions below (`TyVid::from(n)`, `DebruijnIndex::from(i)`, `BoundVar::from(v)`,
// `RegionVid::from(n)`) are the identity on the branded numbers: every `n` is below the preintern counts, far
// under the indices' `MAX`.

// rustc-type: compiler/rustc_middle/src/ty/context.rs:310 CommonTypes
export class CommonTypes {
  constructor(
    public unit: Ty,
    public bool: Ty,
    public char: Ty,
    public isize: Ty,
    public i8: Ty,
    public i16: Ty,
    public i32: Ty,
    public i64: Ty,
    public i128: Ty,
    public usize: Ty,
    public u8: Ty,
    public u16: Ty,
    public u32: Ty,
    public u64: Ty,
    public u128: Ty,
    public f16: Ty,
    public f32: Ty,
    public f64: Ty,
    public f128: Ty,
    public str_: Ty,
    public never: Ty,
    public self_param: Ty,
    /// A dummy type that can be used as the self type of trait object types outside of
    /// [`ty::ExistentialTraitRef`], [`ty::ExistentialProjection`], etc.
    ///
    /// Under the hood, this type is just `ty::Infer(ty::FreshTy(0))` (see upstream for the full warning).
    public trait_object_dummy_self: Ty,
    /// Pre-interned `Infer(ty::TyVar(n))` for small values of `n`.
    public ty_vars: Ty[],
    /// Pre-interned `Infer(ty::FreshTy(n))` for small values of `n`.
    public fresh_tys: Ty[],
    /// Pre-interned `Infer(ty::FreshIntTy(n))` for small values of `n`.
    public fresh_int_tys: Ty[],
    /// Pre-interned `Infer(ty::FreshFloatTy(n))` for small values of `n`.
    public fresh_float_tys: Ty[],
    /// Pre-interned values of the form:
    /// `Bound(BoundVarIndexKind::Bound(DebruijnIndex(i)), BoundTy { var: v, kind:
    /// BoundTyKind::Anon})` for small values of `i` and `v`.
    public anon_bound_tys: Ty[][],
    // Pre-interned values of the form:
    // `Bound(BoundVarIndexKind::Canonical, BoundTy { var: v, kind: BoundTyKind::Anon })`
    // for small values of `v`.
    public anon_canonical_bound_tys: Ty[],
  ) {}

  // rustc: compiler/rustc_middle/src/ty/context.rs:415 new
  static new(interners: CtxtInterners): CommonTypes {
    const mk = (ty: TyKind): Ty => interners.intern_ty(ty);

    const ty_vars = range(NUM_PREINTERNED_TY_VARS).map((n) => mk({ $: "Infer", _0: { $: "TyVar", _0: n as TyVid } }));
    const fresh_tys = range(NUM_PREINTERNED_FRESH_TYS).map((n) => mk({ $: "Infer", _0: { $: "FreshTy", _0: n } }));
    const fresh_int_tys = range(NUM_PREINTERNED_FRESH_INT_TYS).map((n) => mk({ $: "Infer", _0: { $: "FreshIntTy", _0: n } }));
    const fresh_float_tys = range(NUM_PREINTERNED_FRESH_FLOAT_TYS).map((n) => mk({ $: "Infer", _0: { $: "FreshFloatTy", _0: n } }));

    const anon_bound_tys = range(NUM_PREINTERNED_ANON_BOUND_TYS_I).map((i) =>
      range(NUM_PREINTERNED_ANON_BOUND_TYS_V).map((v) =>
        mk({
          $: "Bound",
          _0: { $: "Bound", _0: i as DebruijnIndex },
          _1: { var: v as BoundVar, kind: { $: "Anon" } },
        }),
      ),
    );

    const anon_canonical_bound_tys = range(NUM_PREINTERNED_ANON_BOUND_TYS_V).map((v) =>
      mk({
        $: "Bound",
        _0: { $: "Canonical" },
        _1: { var: v as BoundVar, kind: { $: "Anon" } },
      }),
    );

    // PORT: struct literal fields in upstream (literal) order; the constructor takes declaration order.
    const unit = mk({ $: "Tuple", _0: RawList.empty<Ty>() });
    const bool = mk({ $: "Bool" });
    const char = mk({ $: "Char" });
    const never = mk({ $: "Never" });
    const isize = mk({ $: "Int", _0: "Isize" });
    const i8 = mk({ $: "Int", _0: "I8" });
    const i16 = mk({ $: "Int", _0: "I16" });
    const i32 = mk({ $: "Int", _0: "I32" });
    const i64 = mk({ $: "Int", _0: "I64" });
    const i128 = mk({ $: "Int", _0: "I128" });
    const usize = mk({ $: "Uint", _0: "Usize" });
    const u8 = mk({ $: "Uint", _0: "U8" });
    const u16 = mk({ $: "Uint", _0: "U16" });
    const u32 = mk({ $: "Uint", _0: "U32" });
    const u64 = mk({ $: "Uint", _0: "U64" });
    const u128 = mk({ $: "Uint", _0: "U128" });
    const f16 = mk({ $: "Float", _0: "F16" });
    const f32 = mk({ $: "Float", _0: "F32" });
    const f64 = mk({ $: "Float", _0: "F64" });
    const f128 = mk({ $: "Float", _0: "F128" });
    const str_ = mk({ $: "Str" });
    const self_param = mk({ $: "Param", _0: { index: 0, name: kw.SelfUpper } });

    const trait_object_dummy_self = fresh_tys[0]!;

    return new CommonTypes(
      unit, bool, char, isize, i8, i16, i32, i64, i128, usize, u8, u16, u32, u64, u128, f16, f32, f64, f128, str_, never, self_param,
      trait_object_dummy_self, ty_vars, fresh_tys, fresh_int_tys, fresh_float_tys, anon_bound_tys, anon_canonical_bound_tys,
    );
  }
}

// rustc-type: compiler/rustc_middle/src/ty/context.rs:385 CommonLifetimes
export class CommonLifetimes {
  constructor(
    /// `ReStatic`
    public re_static: Region,
    /// Erased region, used outside of type inference.
    public re_erased: Region,
    /// Pre-interned `ReVar(ty::RegionVar(n))` for small values of `n`.
    public re_vars: Region[],
    /// Pre-interned values of the form:
    /// `ReBound(BoundVarIndexKind::Bound(DebruijnIndex(i)), BoundRegion { var: v, kind: BoundRegionKind::Anon })`
    /// for small values of `i` and `v`.
    public anon_re_bounds: Region[][],
    // Pre-interned values of the form:
    // `ReBound(BoundVarIndexKind::Canonical, BoundRegion { var: v, kind: BoundRegionKind::Anon })`
    // for small values of `v`.
    public anon_re_canonical_bounds: Region[],
  ) {}

  // rustc: compiler/rustc_middle/src/ty/context.rs:486 new
  static new(interners: CtxtInterners): CommonLifetimes {
    const mk = (r: RegionKind): Region => Interned.new_unchecked(interners.region.intern(r, intern_key(r), (r) => new Region(r)));

    const re_vars = range(NUM_PREINTERNED_RE_VARS).map((n) => mk({ $: "ReVar", _0: n as RegionVid }));

    const anon_re_bounds = range(NUM_PREINTERNED_ANON_RE_BOUNDS_I).map((i) =>
      range(NUM_PREINTERNED_ANON_RE_BOUNDS_V).map((v) =>
        mk({
          $: "ReBound",
          _0: { $: "Bound", _0: i as DebruijnIndex },
          _1: { var: v as BoundVar, kind: { $: "Anon" } },
        }),
      ),
    );

    const anon_re_canonical_bounds = range(NUM_PREINTERNED_ANON_RE_BOUNDS_V).map((v) =>
      mk({
        $: "ReBound",
        _0: { $: "Canonical" },
        _1: { var: v as BoundVar, kind: { $: "Anon" } },
      }),
    );

    return new CommonLifetimes(mk({ $: "ReStatic" }), mk({ $: "ReErased" }), re_vars, anon_re_bounds, anon_re_canonical_bounds);
  }
}

// rustc-type: compiler/rustc_middle/src/ty/context.rs:406 CommonConsts
export class CommonConsts {
  constructor(
    public unit: Const,
    public true_: Const,
    public false_: Const,
    /// Use [`ty::ValTree::zst`] instead.
    public valtree_zst: unknown,
  ) {}

  // rustc: compiler/rustc_middle/src/ty/context.rs:532 new
  static new(interners: CtxtInterners, types: CommonTypes): CommonConsts {
    const mk_const = (c: ConstKind): Const => interners.intern_const(c);

    // PORT: `ty::ValTree(Interned::new_unchecked(interners.valtree.intern(v, ..)))`: the `ValTree` class and
    // `ScalarInt::TRUE` / `FALSE` are lane ty-results' (ty/consts/valtree.rs, ty/consts/int.rs).
    const mk_valtree = (_v: ValTreeKind): ValTree => unported("rustc_middle::ty::context::CommonConsts::new: ValTree interning (ValTree class, ty/consts/valtree.rs)");

    const valtree_zst = mk_valtree({ $: "Branch", _0: RawList.empty() } as unknown as ValTreeKind);
    const valtree_true = mk_valtree(unported("rustc_middle::ty::consts::int::ScalarInt::TRUE"));
    const valtree_false = mk_valtree(unported("rustc_middle::ty::consts::int::ScalarInt::FALSE"));

    return new CommonConsts(
      mk_const({ $: "Value", _0: { ty: types.unit, valtree: valtree_zst } } as unknown as ConstKind),
      mk_const({ $: "Value", _0: { ty: types.bool, valtree: valtree_true } } as unknown as ConstKind),
      mk_const({ $: "Value", _0: { ty: types.bool, valtree: valtree_false } } as unknown as ConstKind),
      valtree_zst,
    );
  }
}

/// This struct contains information regarding a free parameter region,
/// either a `ReEarlyParam` or `ReLateParam`.
// rustc-type: compiler/rustc_middle/src/ty/context.rs:566 FreeRegionInfo
export interface FreeRegionInfo {
  /// `LocalDefId` of the scope.
  scope: LocalDefId;
  /// the `DefId` of the free region.
  region_def_id: DefId;
  /// checks if bound region is in Impl Item
  is_impl_item: boolean;
}

/** `#[derive(Debug)]` of `FreeRegionInfo`. */
export const debug_FreeRegionInfo: Debug<FreeRegionInfo> = (v, f) =>
  debug_struct(f, "FreeRegionInfo", [
    ["scope", debug_LocalDefId(v.scope, f)],
    ["region_def_id", debug_DefId(v.region_def_id, f)],
    ["is_impl_item", debug_bool(v.is_impl_item, f)],
  ]);

/** `(0..n)` collected. */
function range(n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(i);
  return out;
}

// Explicitly implement `DynSync` and `DynSend` for `TyCtxt` to short circuit trait resolution. Its
// field are asserted to implement these traits below, so this is trivially safe, and it greatly
// speeds-up compilation of this crate and its dependents.
// rustc: compiler/rustc_middle/src/ty/context.rs:725 _assert_tcx_fields
// PORT: compile-time trait assertions only (`sync::assert_dyn_sync::<&GlobalCtxt>()`, `assert_dyn_send`); the port is
// single-threaded, so the body is empty.
export function _assert_tcx_fields(): void {}

/// This struct should only be created by `create_def`.
export class TyCtxtFeed<K> {
  constructor(
    public tcx: TyCtxt,
    // Do not allow direct access, as downstream code must not mutate this field.
    private readonly key_: K,
  ) {}

  // rustc: compiler/rustc_middle/src/ty/context.rs:635 key
  key(): K {
    return this.key_;
  }

  // rustc: compiler/rustc_middle/src/ty/context.rs:642 def_id
  def_id(this: TyCtxtFeed<LocalDefId>): LocalDefId {
    return this.key_;
  }

  // Caller must ensure that `self.key` ID is indeed an owner.
  // rustc: compiler/rustc_middle/src/ty/context.rs:647 feed_owner_id
  feed_owner_id(this: TyCtxtFeed<LocalDefId>): TyCtxtFeed<OwnerId> {
    return new TyCtxtFeed(this.tcx, new OwnerId(this.key_));
  }

  // Fills in all the important parts needed by HIR queries
  // rustc: compiler/rustc_middle/src/ty/context.rs:652 feed_hir
  feed_hir(this: TyCtxtFeed<LocalDefId>): void {
    // `self.hir_owner(ProjectedMaybeOwner::Owner(..))` + `hir_attr_map(hir::AttributeMap::EMPTY)`
    unported("rustc_middle::ty::context::TyCtxtFeed::feed_hir (HIR, M3)");
  }
}

/// An assortment of global caches used by various parts of the compiler.
///
/// The individual fields are mostly unrelated to each other, but have been grouped together to
/// reduce the number of top-level fields in [`GlobalCtxt`].
// rustc-type: compiler/rustc_middle/src/ty/context.rs:669 GlobalCaches
// PORT: `Lock<..>` is the inner value (PORTING §5). The cache types of traits/ (`SelectionCache`, `EvaluationCache`),
// the new solver's `search_graph::GlobalCache` / `CanonicalParamEnvCache` and infer's `CanonicalParamEnvCache` are not
// ported (lanes middle-traits-thir, tyir-solve, infcx-contract), so `#[derive(Default)]` stops as UNPORTED and
// `GlobalCtxt.caches` is built on first read.
export class GlobalCaches {
  constructor(
    // Internal caches for metadata decoding. No need to track deps on this.
    public ty_rcache: Map<string, Ty>,

    /// Caches the results of trait selection. This cache is used
    /// for things that do not have to do with the parameters in scope.
    public selection_cache: Pending<"traits::SelectionCache">,

    /// Caches the results of trait evaluation. This cache is used
    /// for things that do not have to do with the parameters in scope.
    /// Merge this with `selection_cache`?
    public evaluation_cache: Pending<"traits::EvaluationCache">,

    /// Caches the results of goal evaluation in the new solver.
    public new_solver_evaluation_cache: GlobalCache,
    public new_solver_canonical_param_env_cache: CanonicalParamEnvCache,

    public canonical_param_env_cache: Pending<"infer::canonical::CanonicalParamEnvCache">,

    /// Caches the index of the highest bound var in clauses in a canonical binder.
    public highest_var_in_clauses_cache: Map<Clauses, number>,

    /// Caches the instantiation of a canonical binder given a set of args.
    public clauses_cache: Map<string, Clauses>,
  ) {}

  /** `#[derive(Default)]` (PORT: see the type comment). */
  static default_(): GlobalCaches {
    return unported("rustc_middle::ty::context::GlobalCaches: Default (traits::SelectionCache / EvaluationCache, search_graph::GlobalCache, CanonicalParamEnvCache)");
  }
}

/// The central data structure of the compiler. It stores references
/// to the various **arenas** and also houses the results of the
/// various **compiler queries** that have been performed. See the
/// [rustc dev guide] for more details.
///
/// [rustc dev guide]: https://rustc-dev-guide.rust-lang.org/ty.html
///
/// An implementation detail: `TyCtxt` is a wrapper type for [GlobalCtxt],
/// which is the struct that actually holds all the data. `TyCtxt` derefs to
/// `GlobalCtxt`, and in practice `TyCtxt` is passed around everywhere, and all
/// operations are done via `TyCtxt`. A `TyCtxt` is obtained for a `GlobalCtxt`
/// by calling `enter` with a closure `f`. That function creates both the
/// `TyCtxt`, and an `ImplicitCtxt` around it that is put into TLS. Within `f`:
/// - The `ImplicitCtxt` is available implicitly via TLS.
/// - The `TyCtxt` is available explicitly via the `tcx` parameter, and also
///   implicitly within the `ImplicitCtxt`. Explicit access is preferred when
///   possible.
export class TyCtxt {
  constructor(readonly gcx: GlobalCtxt) {}

  // impl Deref for TyCtxt { type Target = &'tcx GlobalCtxt<'tcx>; }
  // rustc: compiler/rustc_middle/src/ty/context.rs:733 deref
  // PORT: `Deref` is realised as the getters below, one per `GlobalCtxt` field the port reads through `tcx`.
  get sess(): Session {
    return this.gcx.sess;
  }
  get dep_graph(): DepGraph {
    return this.gcx.dep_graph;
  }
  get prof(): SelfProfilerRef {
    return this.gcx.prof;
  }
  get hooks(): HookProviders {
    return this.gcx.hooks;
  }
  get query_system(): QuerySystem {
    return this.gcx.query_system;
  }
  /** `interners` (private to rustc_middle upstream) */
  get interners(): CtxtInterners {
    return this.gcx.interners;
  }
  /// Common types, pre-interned for your convenience.
  get types(): CommonTypes {
    return this.gcx.types;
  }
  /// Common lifetimes, pre-interned for your convenience.
  get lifetimes(): CommonLifetimes {
    return this.gcx.lifetimes;
  }
  /// Common consts, pre-interned for your convenience.
  get consts(): CommonConsts {
    return this.gcx.consts;
  }
  get caches(): GlobalCaches {
    return this.gcx.caches;
  }

  // ---- methods ported in other files (PORTING §8: declared here, bodies there) ----
  // query/calls.rs
  typeck(def_id: IntoQueryKey<LocalDefId>): unknown {
    return calls.TyCtxt_typeck(this, def_id);
  }
  at(span: Span): TyCtxtAt {
    return calls.TyCtxt_at(this, span);
  }
  ensure_ok(): TyCtxtEnsureOk {
    return calls.TyCtxt_ensure_ok(this);
  }
  ensure_result(): TyCtxtEnsureResult {
    return calls.TyCtxt_ensure_result(this);
  }
  ensure_done(): TyCtxtEnsureDone {
    return calls.TyCtxt_ensure_done(this);
  }
  // ty/mod.rs
  opt_parent(id: DefId): DefId | undefined {
    return ty_mod.TyCtxt_opt_parent(this, id);
  }
  parent(id: DefId): DefId {
    return ty_mod.TyCtxt_parent(this, id);
  }
  opt_local_parent(id: LocalDefId): LocalDefId | undefined {
    return ty_mod.TyCtxt_opt_local_parent(this, id);
  }
  local_parent(id: LocalDefId | LocalModId): LocalDefId {
    return ty_mod.TyCtxt_local_parent(this, id);
  }
  def_id_partial_cmp(lhs: DefId, rhs: DefId): Ordering | undefined {
    return ty_mod.TyCtxt_def_id_partial_cmp(this, lhs, rhs);
  }
  is_descendant_of(descendant: IntoQueryKey<DefId>, ancestor: IntoQueryKey<DefId>): boolean {
    return ty_mod.TyCtxt_is_descendant_of(this, descendant, ancestor);
  }
  opt_item_name(def_id: IntoQueryKey<DefId>): Symbol | undefined {
    return ty_mod.TyCtxt_opt_item_name(this, def_id);
  }
  item_name(id: IntoQueryKey<DefId>): Symbol {
    return ty_mod.TyCtxt_item_name(this, id);
  }
  // ty/mod.rs, not ported yet (stubs `TyCtxt_<name>` at the end of mod.ts; lane ty-mod-*), upstream order:
  typeck_body(body: BodyId): TypeckResults {
    return ty_mod.TyCtxt_typeck_body(this, body);
  }
  provided_trait_methods(id: DefId): Iterable<AssocItem> {
    return ty_mod.TyCtxt_provided_trait_methods(this, id);
  }
  repr_options_of_def(did: LocalDefId): ReprOptions {
    return ty_mod.TyCtxt_repr_options_of_def(this, did);
  }
  opt_item_ident(def_id: IntoQueryKey<DefId>): Ident | undefined {
    return ty_mod.TyCtxt_opt_item_ident(this, def_id);
  }
  item_ident(def_id: IntoQueryKey<DefId>): Ident {
    return ty_mod.TyCtxt_item_ident(this, def_id);
  }
  opt_associated_item(def_id: DefId): AssocItem | undefined {
    return ty_mod.TyCtxt_opt_associated_item(this, def_id);
  }
  opt_rpitit_info(def_id: DefId): ImplTraitInTraitData | undefined {
    return ty_mod.TyCtxt_opt_rpitit_info(this, def_id);
  }
  find_field_index(ident: Ident, variant: VariantDef): FieldIdx | undefined {
    return ty_mod.TyCtxt_find_field_index(this, ident, variant);
  }
  impls_are_allowed_to_overlap(def_id1: DefId, def_id2: DefId): ImplOverlapKind | undefined {
    return ty_mod.TyCtxt_impls_are_allowed_to_overlap(this, def_id1, def_id2);
  }
  expect_variant_res(res: Res): VariantDef {
    return ty_mod.TyCtxt_expect_variant_res(this, res);
  }
  instance_mir(instance: InstanceKind): Body {
    return ty_mod.TyCtxt_instance_mir(this, instance);
  }
  get_attrs(did: DefId, attr: Symbol): Iterable<Attribute> {
    return ty_mod.TyCtxt_get_attrs(this, did, attr);
  }
  get_all_attrs(did: DefId): readonly Attribute[] {
    return ty_mod.TyCtxt_get_all_attrs(this, did);
  }
  get_attrs_by_path(did: DefId, attr: readonly Symbol[]): Iterable<Attribute> {
    return ty_mod.TyCtxt_get_attrs_by_path(this, did, attr);
  }
  trait_is_auto(trait_def_id: DefId): boolean {
    return ty_mod.TyCtxt_trait_is_auto(this, trait_def_id);
  }
  trait_is_coinductive(trait_def_id: DefId): boolean {
    return ty_mod.TyCtxt_trait_is_coinductive(this, trait_def_id);
  }
  trait_is_alias(trait_def_id: DefId): boolean {
    return ty_mod.TyCtxt_trait_is_alias(this, trait_def_id);
  }
  layout_error(err: LayoutError): LayoutError {
    return ty_mod.TyCtxt_layout_error(this, err);
  }
  ordinary_coroutine_layout(def_id: DefId, args: GenericArgs): Result<CoroutineLayout, LayoutError> {
    return ty_mod.TyCtxt_ordinary_coroutine_layout(this, def_id, args);
  }
  async_drop_coroutine_layout(def_id: DefId, args: GenericArgs): Result<CoroutineLayout, LayoutError> {
    return ty_mod.TyCtxt_async_drop_coroutine_layout(this, def_id, args);
  }
  coroutine_layout(def_id: DefId, args: GenericArgs): Result<CoroutineLayout, LayoutError> {
    return ty_mod.TyCtxt_coroutine_layout(this, def_id, args);
  }
  assoc_parent(def_id: DefId): [DefId, DefKind] | undefined {
    return ty_mod.TyCtxt_assoc_parent(this, def_id);
  }
  trait_item_of(def_id: IntoQueryKey<DefId>): DefId | undefined {
    return ty_mod.TyCtxt_trait_item_of(this, def_id);
  }
  trait_of_assoc(def_id: DefId): DefId | undefined {
    return ty_mod.TyCtxt_trait_of_assoc(this, def_id);
  }
  impl_is_of_trait(def_id: IntoQueryKey<DefId>): boolean {
    return ty_mod.TyCtxt_impl_is_of_trait(this, def_id);
  }
  impl_of_assoc(def_id: DefId): DefId | undefined {
    return ty_mod.TyCtxt_impl_of_assoc(this, def_id);
  }
  inherent_impl_of_assoc(def_id: DefId): DefId | undefined {
    return ty_mod.TyCtxt_inherent_impl_of_assoc(this, def_id);
  }
  trait_impl_of_assoc(def_id: DefId): DefId | undefined {
    return ty_mod.TyCtxt_trait_impl_of_assoc(this, def_id);
  }
  impl_polarity(def_id: IntoQueryKey<DefId>): ImplPolarity {
    return ty_mod.TyCtxt_impl_polarity(this, def_id);
  }
  impl_trait_ref(def_id: IntoQueryKey<DefId>): EarlyBinder<TraitRef> {
    return ty_mod.TyCtxt_impl_trait_ref(this, def_id);
  }
  impl_opt_trait_ref(def_id: IntoQueryKey<DefId>): EarlyBinder<TraitRef> | undefined {
    return ty_mod.TyCtxt_impl_opt_trait_ref(this, def_id);
  }
  impl_trait_id(def_id: IntoQueryKey<DefId>): DefId {
    return ty_mod.TyCtxt_impl_trait_id(this, def_id);
  }
  impl_opt_trait_id(def_id: IntoQueryKey<DefId>): DefId | undefined {
    return ty_mod.TyCtxt_impl_opt_trait_id(this, def_id);
  }
  is_exportable(def_id: DefId): boolean {
    return ty_mod.TyCtxt_is_exportable(this, def_id);
  }
  is_builtin_derived(def_id: DefId): boolean {
    return ty_mod.TyCtxt_is_builtin_derived(this, def_id);
  }
  is_automatically_derived(def_id: DefId): boolean {
    return ty_mod.TyCtxt_is_automatically_derived(this, def_id);
  }
  span_of_impl(impl_def_id: DefId): Result<Span, Symbol> {
    return ty_mod.TyCtxt_span_of_impl(this, impl_def_id);
  }
  hygienic_eq(use_ident: Ident, def_ident: Ident, def_parent_def_id: DefId): boolean {
    return ty_mod.TyCtxt_hygienic_eq(this, use_ident, def_ident, def_parent_def_id);
  }
  adjust_ident(ident: Ident, scope: DefId): Ident {
    return ty_mod.TyCtxt_adjust_ident(this, ident, scope);
  }
  adjust_ident_and_get_scope(ident: Ident, scope: DefId, mod_id: LocalModId): [Ident, ModId] {
    return ty_mod.TyCtxt_adjust_ident_and_get_scope(this, ident, scope, mod_id);
  }
  is_const_fn(def_id: IntoQueryKey<DefId>): boolean {
    return ty_mod.TyCtxt_is_const_fn(this, def_id);
  }
  is_conditionally_const(def_id: DefId): boolean {
    return ty_mod.TyCtxt_is_conditionally_const(this, def_id);
  }
  is_const_trait(def_id: DefId): boolean {
    return ty_mod.TyCtxt_is_const_trait(this, def_id);
  }
  impl_method_has_trait_impl_trait_tys(def_id: DefId): boolean {
    return ty_mod.TyCtxt_impl_method_has_trait_impl_trait_tys(this, def_id);
  }
  fn_abi_of_instance(query: PseudoCanonicalInput<[Instance, List<Ty>]>): Result<FnAbi<Ty>, FnAbiError> {
    return ty_mod.TyCtxt_fn_abi_of_instance(this, query);
  }
  // hir/mod.rs, hir/map.rs: attached to `TyCtxt.prototype` by rustc_middle/hir/{mod,map}.ts (lane middle-hir), which
  // rustc_middle/lib.ts loads after this module.
  // ty/print/pretty.rs
  def_path_str(def_id: IntoQueryKey<DefId>): string {
    void def_id;
    return unported("rustc_middle::ty::print::pretty::TyCtxt::def_path_str (ty::print, M3)");
  }

  /// Can only be fed before queries are run, and is thus exempt from any
  /// incremental issues. Do not use except for the initial query feeding.
  // rustc: compiler/rustc_middle/src/ty/context.rs:593 feed_unit_query
  feed_unit_query(): TyCtxtFeed<null> {
    this.dep_graph.assert_ignored();
    return new TyCtxtFeed(this, null);
  }

  /// Only used in the resolver to register the `CRATE_DEF_ID` `DefId` and feed
  /// some queries for it. It will panic if used twice.
  // rustc: compiler/rustc_middle/src/ty/context.rs:600 create_local_crate_def_id
  create_local_crate_def_id(span: Span): TyCtxtFeed<LocalDefId> {
    // `AppendOnlyIndexVec::push` returns the new index.
    const source_span = this.untracked().source_span;
    source_span.push(span);
    const key = LocalDefId.new(source_span.length - 1);
    assert_eq(key, CRATE_DEF_ID, (v) => String(v));
    return new TyCtxtFeed(this, key);
  }

  /// In order to break cycles involving `AnonConst`, we need to set the expected type by side
  /// effect. However, we do not want this as a general capability, so this interface restricts
  /// to the only allowed case.
  // rustc: compiler/rustc_middle/src/ty/context.rs:609 feed_anon_const_type
  feed_anon_const_type(key: LocalDefId, value: QueryTypes["type_of"]["ProvidedValue"]): void {
    // debug_assert_eq!(self.def_kind(key), DefKind::AnonConst);
    // debug_assert!(self.anon_const_kind(key) != ty::AnonConstKind::NonTypeSystemInline);
    new TyCtxtFeed(this, key).type_of(value);
  }

  // Trait impl item visibility is inherited from its trait when not specified
  // explicitly. In that case we cannot determine it in early resolve,
  // but instead are feeding it in late resolve, where we don't have access to the
  // `TyCtxtFeed` anymore.
  // To avoid having to hash the `LocalDefId` multiple times for inserting and removing the
  // `TyCtxtFeed` from a hash table, we add this hack to feed the visibility.
  // Do not use outside of the resolver query.
  // rustc: compiler/rustc_middle/src/ty/context.rs:622 feed_visibility_for_trait_impl_item
  feed_visibility_for_trait_impl_item(key: LocalDefId, vis: Visibility<LocalModId>): void {
    // `if cfg!(debug_assertions) { .. }`: rustc ships without debug assertions.
    new TyCtxtFeed(this, key).visibility(Visibility.to_mod_id(vis));
  }

  // rustc: compiler/rustc_middle/src/ty/context.rs:846 has_typeck_results
  has_typeck_results(def_id: LocalDefId): boolean {
    // Closures' typeck results come from their outermost function,
    // as they are part of the same "inference environment".
    const root = this.typeck_root_def_id_local(def_id);
    return Node.body_id(this.hir_node_by_def_id(root)) !== undefined;
  }

  /// Expects a body and returns its codegen attributes.
  ///
  /// Unlike `codegen_fn_attrs`, this returns `CodegenFnAttrs::EMPTY` for
  /// constants.
  // rustc: compiler/rustc_middle/src/ty/context.rs:857 body_codegen_attrs
  body_codegen_attrs(def_id: DefId): CodegenFnAttrs {
    const def_kind = this.def_kind(def_id);
    if (DefKind.has_codegen_attrs(def_kind)) {
      return this.codegen_fn_attrs(def_id) as CodegenFnAttrs;
    } else if (def_kind.$ === "AnonConst" || def_kind.$ === "AssocConst" || def_kind.$ === "Const" || def_kind.$ === "GlobalAsm") {
      return unported("rustc_middle::middle::codegen_fn_attrs::CodegenFnAttrs::EMPTY (middle/codegen_fn_attrs.rs)");
    } else {
      return panic(`body_codegen_fn_attrs called on unexpected definition: ${debug_DefId(def_id, PLAIN)} ${debug_DefKind(def_kind, PLAIN)}`);
    }
  }

  // rustc: compiler/rustc_middle/src/ty/context.rs:875 alloc_steal_thir
  alloc_steal_thir(thir: Thir): Steal<Thir> {
    return Steal.new(thir, "rustc_middle::thir::Thir");
  }

  // rustc: compiler/rustc_middle/src/ty/context.rs:879 alloc_steal_mir
  alloc_steal_mir(mir: Body): Steal<Body> {
    return Steal.new(mir, "rustc_middle::mir::Body");
  }

  // rustc: compiler/rustc_middle/src/ty/context.rs:883 alloc_steal_promoted
  alloc_steal_promoted(promoted: Body[]): Steal<Body[]> {
    return Steal.new(promoted, "rustc_index::vec::IndexVec<rustc_middle::mir::Promoted, rustc_middle::mir::Body>");
  }

  // rustc: compiler/rustc_middle/src/ty/context.rs:890 mk_adt_def
  mk_adt_def(did: DefId, kind: AdtKind, variants: VariantDef[], repr: ReprOptions): AdtDef {
    void [did, kind, variants, repr];
    return this.mk_adt_def_from_data(unported("rustc_middle::ty::adt::AdtDefData::new (ty/adt.rs, lane ty-adt-assoc)"));
  }

  /// Allocates a read-only byte or string literal for `mir::interpret` with alignment 1.
  /// Returns the same `AllocId` if called again with the same bytes.
  // rustc: compiler/rustc_middle/src/ty/context.rs:902 allocate_bytes_dedup
  allocate_bytes_dedup(bytes: Uint8Array, salt: number): AllocId {
    // Create an allocation that just contains these bytes.
    void [bytes, salt];
    return unported("rustc_middle::mir::interpret::Allocation::from_bytes_byte_aligned_immutable / reserve_and_set_memory_dedup (MIR interpret, M4)");
  }

  /// Traits added on all bounds by default, excluding `Sized` which is treated separately.
  // rustc: compiler/rustc_middle/src/ty/context.rs:914 default_traits
  default_traits(): readonly LangItem[] {
    if (this.sess.opts.unstable_opts.experimental_default_bounds) {
      return ["DefaultTrait1", "DefaultTrait2", "DefaultTrait3", "DefaultTrait4"];
    } else {
      return [];
    }
  }

  // rustc: compiler/rustc_middle/src/ty/context.rs:927 is_default_trait
  is_default_trait(def_id: DefId): boolean {
    return this.default_traits().some((default_trait) => this.is_lang_item(def_id, default_trait));
  }

  // rustc: compiler/rustc_middle/src/ty/context.rs:931 is_sizedness_trait
  is_sizedness_trait(def_id: DefId): boolean {
    const l = this.as_lang_item(def_id);
    return l === "Sized" || l === "MetaSized";
  }

  // rustc: compiler/rustc_middle/src/ty/context.rs:935 lift
  // PORT: `value.lift_to_interner(self)`. rustc's `Lift` impls are skipped (PORTING §3): every `Lift<TyCtxt>` impl of
  // rustc_middle (`nop_lift!`, `nop_list_lift!`, the `Interned` ones, and the derived ones over them) returns its
  // input after asserting it is interned in this `TyCtxt`, and the port has one `TyCtxt` whose interners made every
  // hash-consed value, so `lift` is the identity.
  lift<T>(value: T): T {
    return value;
  }

  /// Creates a type context. To use the context call `fn enter` which
  /// provides a `TyCtxt`.
  ///
  /// By only providing the `TyCtxt` inside of the closure we enforce that the type
  /// context and any interned value (types, args, etc.) can only be used while `ty::tls`
  /// has a valid reference to the context, to allow formatting values that need it.
  // rustc: compiler/rustc_middle/src/ty/context.rs:945 create_global_ctxt
  static create_global_ctxt<T>(
    gcx_cell: { value: GlobalCtxt | undefined },
    sess: Session,
    crate_types: CrateType[],
    stable_crate_id: StableCrateId,
    untracked: Untracked,
    incr_comp_session: undefined,
    dep_graph: DepGraph,
    query_system: QuerySystem,
    hooks: HookProviders,
    current_gcx: CurrentGcx,
    f: (tcx: TyCtxt) => T,
  ): T {
    // PORT: `let data_layout = sess.target.parse_data_layout().unwrap_or_else(..)` is deferred to the
    // first read of `gcx.data_layout` (module comment).
    const interners = CtxtInterners.new(undefined);
    // PORT: `CommonTypes::new(&interners)`, `CommonLifetimes::new(&interners)` and
    // `CommonConsts::new(&interners, &common_types)` run on the first read of `types` / `lifetimes` / `consts`
    // (module comment).
    if (gcx_cell.value === undefined) {
      gcx_cell.value = new GlobalCtxt(sess, crate_types, stable_crate_id, interners, incr_comp_session, dep_graph, sess.prof, hooks, untracked, query_system, current_gcx);
    }
    const gcx = gcx_cell.value;

    // This is a separate function to work around a crash with parallel rustc (#135870)
    return gcx.enter(f);
  }

  /// Obtain all lang items of this crate and all dependencies (recursively)
  // rustc: compiler/rustc_middle/src/ty/context.rs:995 lang_items
  lang_items(): LanguageItems {
    return this.get_lang_items(null);
  }

  /// Gets a `Ty` representing the [`LangItem::OrderingEnum`]
  // rustc: compiler/rustc_middle/src/ty/context.rs:1001 ty_ordering_enum
  ty_ordering_enum(span: Span): Ty {
    const ordering_enum = this.require_lang_item("OrderingEnum", span);
    return unwrap(EarlyBinder.no_bound_vars(this.type_of(ordering_enum) as EarlyBinder<Ty>, standin_fold_Ty));
  }

  /// Obtain the given diagnostic item's `DefId`. Use `is_diagnostic_item` if you just want to
  /// compare against another `DefId`, since `is_diagnostic_item` is cheaper.
  // rustc: compiler/rustc_middle/src/ty/context.rs:1008 get_diagnostic_item
  get_diagnostic_item(name: Symbol): DefId | undefined {
    return this.all_diagnostic_items(null).name_to_id.get(name);
  }

  /// Obtain the diagnostic item's name
  // rustc: compiler/rustc_middle/src/ty/context.rs:1013 get_diagnostic_name
  get_diagnostic_name(id: DefId): Symbol | undefined {
    return this.diagnostic_items(id.krate).id_to_name.get(id);
  }

  /// Check whether the diagnostic item with the given `name` has the given `DefId`.
  // rustc: compiler/rustc_middle/src/ty/context.rs:1018 is_diagnostic_item
  is_diagnostic_item(name: Symbol, did: DefId): boolean {
    const id = this.diagnostic_items(did.krate).name_to_id.get(name);
    return id !== undefined && DefId_eq(id, did);
  }

  // rustc: compiler/rustc_middle/src/ty/context.rs:1022 is_coroutine
  is_coroutine(def_id: DefId): boolean {
    return this.coroutine_kind(def_id) !== undefined;
  }

  // rustc: compiler/rustc_middle/src/ty/context.rs:1026 is_async_drop_in_place_coroutine
  is_async_drop_in_place_coroutine(def_id: DefId): boolean {
    return this.is_lang_item(this.parent(def_id), "AsyncDropInPlace");
  }

  /// Returns true if the const is guaranteed to have a directly represented RHS. This is either
  /// because it has a directly represented RHS, or is a trait definition that is marked as
  /// requiring its implementation to have a directly represented RHS.
  ///
  /// Note: Be very careful with using this method - under `gca_const_items`, a trait can
  /// declare a regular const, but an `impl` could implement it with a directly represented const
  /// (a la refinement). This method would return false in such a case.
  // rustc: compiler/rustc_middle/src/ty/context.rs:1037 is_direct_const
  is_direct_const(def_id: DefId): boolean {
    // debug_assert_matches!(self.def_kind(def_id), DefKind::Const | DefKind::AssocConst);
    return this.is_always_gca(def_id) || this.const_of_item(def_id) !== undefined;
  }

  /// Whether this is a projection const marked with `#[always_gca]`
  // rustc: compiler/rustc_middle/src/ty/context.rs:1043 is_always_gca
  is_always_gca(def_id: DefId): boolean {
    return find_attr(HasAttrs_DefId_get_attrs(def_id, this), (k) => (k.$ === "AlwaysGca" ? null : undefined)) !== undefined;
  }

  /// Returns the movability of the coroutine of `def_id`, or panics
  /// if given a `def_id` that is not a coroutine.
  // rustc: compiler/rustc_middle/src/ty/context.rs:1049 coroutine_movability
  coroutine_movability(def_id: DefId): Movability {
    return CoroutineKind.movability(unwrap(this.coroutine_kind(def_id) as CoroutineKind | undefined, "expected a coroutine"));
  }

  /// Returns `true` if the node pointed to by `def_id` is a coroutine for an async construct.
  // rustc: compiler/rustc_middle/src/ty/context.rs:1054 coroutine_is_async
  coroutine_is_async(def_id: DefId): boolean {
    const k = this.coroutine_kind(def_id) as CoroutineKind | undefined;
    return k !== undefined && k.$ === "Desugared" && k._0 === "Async";
  }

  // Whether the body owner is synthetic, which in this case means it does not correspond to
  // meaningful HIR. This is currently used to skip over MIR borrowck.
  // rustc: compiler/rustc_middle/src/ty/context.rs:1063 is_synthetic_mir
  is_synthetic_mir(def_id: IntoQueryKey<DefId>): boolean {
    return this.def_kind(into_query_key_DefId(def_id)).$ === "SyntheticCoroutineBody";
  }

  /// Returns `true` if the node pointed to by `def_id` is a general coroutine that implements `Coroutine`.
  /// This means it is neither an `async` or `gen` construct.
  // rustc: compiler/rustc_middle/src/ty/context.rs:1069 is_general_coroutine
  is_general_coroutine(def_id: DefId): boolean {
    const k = this.coroutine_kind(def_id) as CoroutineKind | undefined;
    return k !== undefined && k.$ === "Coroutine";
  }

  /// Returns `true` if the node pointed to by `def_id` is a coroutine for a `gen` construct.
  // rustc: compiler/rustc_middle/src/ty/context.rs:1074 coroutine_is_gen
  coroutine_is_gen(def_id: DefId): boolean {
    const k = this.coroutine_kind(def_id) as CoroutineKind | undefined;
    return k !== undefined && k.$ === "Desugared" && k._0 === "Gen";
  }

  /// Returns `true` if the node pointed to by `def_id` is a coroutine for a `async gen` construct.
  // rustc: compiler/rustc_middle/src/ty/context.rs:1082 coroutine_is_async_gen
  coroutine_is_async_gen(def_id: DefId): boolean {
    const k = this.coroutine_kind(def_id) as CoroutineKind | undefined;
    return k !== undefined && k.$ === "Desugared" && k._0 === "AsyncGen";
  }

  // rustc: compiler/rustc_middle/src/ty/context.rs:1089 features
  features(): Features {
    return this.features_query(null) as Features;
  }

  // rustc: compiler/rustc_middle/src/ty/context.rs:1093 def_key
  def_key(id: IntoQueryKey<DefId>): DefKey {
    const id_ = into_query_key_DefId(id);
    // Accessing the DefKey is ok, since it is part of DefPathHash.
    const local = id_.as_local();
    if (local !== undefined) {
      return this.definitions_untracked().def_key(local);
    } else {
      return this.cstore_untracked().def_key(id_);
    }
  }

  /// Converts a `DefId` into its fully expanded `DefPath` (every
  /// `DefId` is really just an interned `DefPath`).
  ///
  /// Note that if `id` is not local to this crate, the result will
  ///  be a non-local `DefPath`.
  // rustc: compiler/rustc_middle/src/ty/context.rs:1108 def_path
  def_path(id: DefId): DefPath {
    // Accessing the DefPath is ok, since it is part of DefPathHash.
    const local = id.as_local();
    if (local !== undefined) {
      return this.definitions_untracked().def_path(local);
    } else {
      return this.cstore_untracked().def_path(id);
    }
  }

  // rustc: compiler/rustc_middle/src/ty/context.rs:1118 def_path_hash
  def_path_hash(def_id: DefId): DefPathHash {
    // Accessing the DefPathHash is ok, it is incr. comp. stable.
    const local = def_id.as_local();
    if (local !== undefined) {
      return this.definitions_untracked().def_path_hash(local);
    } else {
      return this.cstore_untracked().def_path_hash(def_id);
    }
  }

  // rustc: compiler/rustc_middle/src/ty/context.rs:1128 crate_types
  crate_types(): readonly CrateType[] {
    return this.gcx.crate_types;
  }

  // rustc: compiler/rustc_middle/src/ty/context.rs:1132 needs_metadata
  needs_metadata(): boolean {
    return (
      this.crate_types().some((ty) => {
        switch (ty) {
          case "Executable":
          case "StaticLib":
          case "Cdylib":
          case "Sdylib":
            return false;
          case "Rlib":
          case "Dylib":
          case "ProcMacro":
            return true;
        }
      }) && !this.sess.opts.actually_rustdoc
    );
  }

  // rustc: compiler/rustc_middle/src/ty/context.rs:1142 needs_hir_hash
  needs_hir_hash(): boolean {
    // Why is the hir hash needed for these configurations?
    // - debug_assertions: for the "fingerprint the result" check in
    //   `rustc_query_impl::execution::execute_job`.
    // - incremental: for query lookups.
    // - needs_metadata: it is included in the crate metadata through the crate_hash query
    // - instrument_coverage: for putting into coverage data (see
    //   `hash_mir_source`).
    // - metrics_dir: metrics use the strict version hash in the filenames
    //   for dumped metrics files to prevent overwriting distinct metrics
    //   for similar source builds (may change in the future, this is part
    //   of the proof of concept impl for the metrics initiative project goal)
    // PORT: `cfg!(debug_assertions)` is false (the oracle is a release build).
    return (
      false ||
      this.sess.opts.incremental !== undefined ||
      this.needs_metadata() ||
      this.sess.instrument_coverage() ||
      this.sess.opts.unstable_opts.metrics_dir !== undefined
    );
  }

  /// Whether the combined per-owner HIR hash (`OwnerInfo::opt_hash`, which folds `parenting`,
  /// `trait_map` and `children` on top of the node/attr hashes) needs to be computed during
  /// lowering.
  ///
  /// This is a strict subset of [`Self::needs_hir_hash`]: notably it drops the plain
  /// `needs_metadata` case. With metadata-based crate hashing (the default) the crate hash is
  /// built from the encoded metadata plus each owner's cheaper `OwnerInfo::fingerprint` (just the
  /// node and attr sub-hashes), so the combined hash is never read and computing it is wasted
  /// work. It is still required for:
  /// - `-Z metadata-crate-hash=no`, where `crate_hash` falls back to hashing each `OwnerInfo`;
  /// - incremental, where the `lower_to_hir` result is fingerprinted for red/green tracking;
  /// - debug assertions, where every query result is fingerprinted to catch nondeterminism.
  ///
  /// The `needs_hir_hash()` conjunct guarantees the node/attr sub-hashes it folds in are present.
  // rustc: compiler/rustc_middle/src/ty/context.rs:1175 needs_owner_info_hash
  needs_owner_info_hash(): boolean {
    // PORT: `cfg!(debug_assertions)` is false (the oracle is a release build).
    return this.needs_hir_hash() && (!this.sess.opts.unstable_opts.metadata_crate_hash || this.sess.opts.incremental !== undefined || false);
  }

  // rustc: compiler/rustc_middle/src/ty/context.rs:1183 stable_crate_id
  stable_crate_id(crate_num: CrateNum): StableCrateId {
    if (crate_num === LOCAL_CRATE) {
      return this.gcx.stable_crate_id;
    } else {
      return this.cstore_untracked().stable_crate_id(crate_num);
    }
  }

  /// Maps a StableCrateId to the corresponding CrateNum. This method assumes
  /// that the crate in question has already been loaded by the CrateStore.
  // rustc: compiler/rustc_middle/src/ty/context.rs:1194 stable_crate_id_to_crate_num
  stable_crate_id_to_crate_num(stable_crate_id: StableCrateId): CrateNum {
    if (stable_crate_id === this.stable_crate_id(LOCAL_CRATE)) {
      return LOCAL_CRATE;
    } else {
      const cnum = this.untracked().stable_crate_ids.get(stable_crate_id);
      if (cnum === undefined) panic(`uninterned StableCrateId: ${debug_StableCrateId(stable_crate_id, PLAIN)}`);
      return cnum;
    }
  }

  /// Converts a `DefPathHash` to its corresponding `DefId` in the current compilation
  /// session, if it still exists. This is used during incremental compilation to
  /// turn a deserialized `DefPathHash` into its current `DefId`.
  // rustc: compiler/rustc_middle/src/ty/context.rs:1210 def_path_hash_to_def_id
  def_path_hash_to_def_id(hash: DefPathHash): DefId | undefined {
    // debug!("def_path_hash_to_def_id({:?})", hash);

    const stable_crate_id = DefPathHash.stable_crate_id(hash);

    // If this is a DefPathHash from the local crate, we can look up the
    // DefId in the tcx's `Definitions`.
    if (stable_crate_id === this.stable_crate_id(LOCAL_CRATE)) {
      const local = this.gcx.untracked.definitions.local_def_path_hash_to_def_id(hash);
      if (local === undefined) return undefined;
      return LocalDefId.to_def_id(local);
    } else {
      return this.def_path_hash_to_def_id_extern(hash, stable_crate_id);
    }
  }

  // rustc: compiler/rustc_middle/src/ty/context.rs:1224 def_path_debug_str
  def_path_debug_str(def_id: DefId): string {
    // We are explicitly not going through queries here in order to get
    // crate name and stable crate id since this code is called from debug!()
    // statements within the query system and we'd run into endless
    // recursion otherwise.
    let crate_name: Symbol;
    let stable_crate_id: StableCrateId;
    if (def_id.is_local()) {
      [crate_name, stable_crate_id] = [this.crate_name(LOCAL_CRATE), this.stable_crate_id(LOCAL_CRATE)];
    } else {
      const cstore = this.cstore_untracked();
      [crate_name, stable_crate_id] = [cstore.crate_name(def_id.krate), cstore.stable_crate_id(def_id.krate)];
    }

    return `${Symbol.as_str(crate_name)}[${
      // Don't print the whole stable crate id. That's just
      // annoying in debug output.
      (StableCrateId.as_u64(stable_crate_id) >> BigInt(8 * 6)).toString(16).padStart(4, "0")
    }]${this.def_path(def_id).to_string_no_crate_verbose()}`;
  }

  // rustc: compiler/rustc_middle/src/ty/context.rs:1246 dcx
  dcx(): DiagCtxtHandle {
    return this.sess.dcx();
  }

  /// Checks to see if the caller (`body_features`) has all the features required by the callee
  /// (`callee_features`).
  // rustc: compiler/rustc_middle/src/ty/context.rs:1252 is_target_feature_call_safe
  is_target_feature_call_safe(callee_features: readonly TargetFeature[], body_features: readonly TargetFeature[]): boolean {
    // If the called function has target features the calling function hasn't,
    // the call requires `unsafe`. Don't check this on wasm
    // targets, though. For more information on wasm see the
    // is_like_wasm check in hir_analysis/src/collect.rs
    return this.sess.target.options.is_like_wasm || callee_features.every((feature) => body_features.some((f) => f.name === feature.name));
  }

  /// Returns the safe version of the signature of the given function, if calling it
  /// would be safe in the context of the given caller.
  // rustc: compiler/rustc_middle/src/ty/context.rs:1269 adjust_target_feature_sig
  adjust_target_feature_sig(fun_def: DefId, fun_sig: Binder<FnSig>, caller: DefId): Binder<FnSig> | undefined {
    const fun_features = (this.codegen_fn_attrs(fun_def) as CodegenFnAttrs).target_features;
    const caller_features = this.body_codegen_attrs(caller).target_features;
    if (this.is_target_feature_call_safe(fun_features, caller_features)) {
      return Binder.map_bound(fun_sig, (sig) => ({
        ...sig,
        fn_sig_kind: FnSigKind.set_safety(PolyFnSig.fn_sig_kind(fun_sig), "Safe"),
      }));
    }
    return undefined;
  }

  /// Helper to get a tracked environment variable via. [`TyCtxt::env_var_os`] and converting to
  /// UTF-8 like [`std::env::var`].
  // rustc: compiler/rustc_middle/src/ty/context.rs:1288 env_var
  // PORT: `&OsStr` is a JS string (rustc_interface passes.ts `env_var_os`), so `to_str()` is always `Some`.
  env_var(key: string): Result<string, VarError> {
    const value = this.env_var_os(key) as string | undefined;
    if (value !== undefined) {
      return Ok(value);
    } else {
      return Err({ $: "NotPresent" });
    }
  }

  // rustc: compiler/rustc_middle/src/ty/context.rs:1295 is_method
  is_method(id: DefId): boolean {
    const item = this.opt_associated_item(id);
    return item !== undefined && AssocItem_is_method(item);
  }

  /// `tcx`-dependent operations performed for every created definition.
  // rustc: compiler/rustc_middle/src/ty/context.rs:1320 create_def
  create_def(
    parent: LocalDefId,
    name: Symbol | undefined,
    def_kind: DefKind,
    override_def_path_data: DefPathData | undefined,
    disambiguator: PerParentDisambiguatorState,
  ): TyCtxtFeed<LocalDefId> {
    const data = override_def_path_data ?? DefKind.def_path_data(def_kind, name);
    // The following call has the side effect of modifying the tables inside `definitions`.
    // These very tables are relied on by the incr. comp. engine to decode DepNodes and to
    // decode the on-disk cache.
    //
    // Any LocalDefId which is used within queries, either as key or result, either:
    // - has been created before the construction of the TyCtxt;
    // - has been created by this call to `create_def`.
    // As a consequence, this LocalDefId is always re-created before it is needed by the incr.
    // comp. engine itself.
    const def_id = this.gcx.untracked.definitions.create_def(parent, data, disambiguator);

    // This function modifies `self.definitions` using a side-effect.
    // We need to ensure that these side effects are re-run by the incr. comp. engine.
    // Depending on the forever-red node will tell the graph that the calling query
    // needs to be re-evaluated.
    this.dep_graph.read_index(DepNodeIndex.FOREVER_RED_NODE);

    const feed = new TyCtxtFeed(this, def_id);
    feed.def_kind(def_kind);
    // Unique types created for closures participate in type privacy checking.
    // They have visibilities inherited from the module they are defined in.
    // Visibilities for opaque types are meaningless, but still provided
    // so that all items have visibilities.
    if (def_kind.$ === "Closure" || def_kind.$ === "OpaqueTy") {
      const parent_mod = this.parent_module_from_def_id(def_id);
      feed.visibility(Visibility.Restricted(LocalModId.to_mod_id(parent_mod)));
    }

    return feed;
  }

  // rustc: compiler/rustc_middle/src/ty/context.rs:1360 create_crate_num
  create_crate_num(stable_crate_id: StableCrateId): Result<TyCtxtFeed<CrateNum>, CrateNum> {
    const lock = this.untracked().stable_crate_ids;
    const existing = lock.get(stable_crate_id);
    if (existing !== undefined) {
      return Err(existing);
    }
    const num = lock.size as CrateNum; // `CrateNum::new(lock.len())`
    lock.set(stable_crate_id, num);
    return Ok(new TyCtxtFeed(this, num));
  }

  // rustc: compiler/rustc_middle/src/ty/context.rs:1373 iter_local_def_id
  iter_local_def_id(): Iterable<LocalDefId> {
    // Depend on the `analysis` query to ensure compilation if finished.
    this.ensure_ok().analysis(null);

    const definitions = this.gcx.untracked.definitions;
    // PORT: the `gen { .. }` block is this generator.
    return (function* () {
      let i = 0;

      // Recompute the number of definitions each time, because our caller may be creating
      // new ones.
      while (i < definitions.num_definitions()) {
        const local_def_index = DefIndex.from_usize(i);
        yield LocalDefId.of(local_def_index);
        i += 1;
      }

      // Freeze definitions once we finish iterating on them, to prevent adding new ones.
      // PORT: `FreezeLock::freeze` is a no-op (PORTING §5: the lock is its inner value).
    })();
  }

  // rustc: compiler/rustc_middle/src/ty/context.rs:1394 definitions
  definitions(): Definitions {
    // Depend on the `analysis` query to ensure compilation if finished.
    this.ensure_ok().analysis(null);

    // Freeze definitions once we start iterating on them, to prevent adding new ones
    // while iterating. If some query needs to add definitions, it should be `ensure`d above.
    // PORT: `FreezeLock::freeze` is a no-op (PORTING §5: the lock is its inner value).
    return this.gcx.untracked.definitions;
  }

  // rustc: compiler/rustc_middle/src/ty/context.rs:1403 def_path_hash_to_def_index_map
  def_path_hash_to_def_index_map(): DefPathToIndexMap {
    // Create a dependency to the crate to be sure we re-execute this when the amount of
    // definitions change.
    this.ensure_ok().hir_crate_items(null);
    // Freeze definitions once we start iterating on them, to prevent adding new ones
    // while iterating. If some query needs to add definitions, it should be `ensure`d above.
    // PORT: `FreezeLock::freeze` is a no-op (PORTING §5).
    return this.gcx.untracked.definitions.def_path_hash_to_def_index_map();
  }

  /// Note that this is *untracked* and should only be used within the query
  /// system if the result is otherwise tracked through queries
  // rustc: compiler/rustc_middle/src/ty/context.rs:1415 cstore_untracked
  cstore_untracked(): CrateStoreDyn {
    return this.gcx.untracked.cstore;
  }

  /// Give out access to the untracked data without any sanity checks.
  // rustc: compiler/rustc_middle/src/ty/context.rs:1420 untracked
  untracked(): Untracked {
    return this.gcx.untracked;
  }

  /// Note that this is *untracked* and should only be used within the query
  /// system if the result is otherwise tracked through queries
  // rustc: compiler/rustc_middle/src/ty/context.rs:1426 definitions_untracked
  definitions_untracked(): Definitions {
    return this.gcx.untracked.definitions;
  }

  // rustc: compiler/rustc_middle/src/ty/context.rs:1431 with_stable_hashing_context
  with_stable_hashing_context<R>(f: (hcx: StableHashState) => R): R {
    return f(StableHashState.new(this.sess, this.gcx.untracked));
  }

  // rustc: compiler/rustc_middle/src/ty/context.rs:1436 local_crate_exports_generics
  local_crate_exports_generics(): boolean {
    // compiler-builtins has some special treatment in codegen, which can result in confusing
    // behavior if another crate ends up calling into its monomorphizations.
    // https://github.com/rust-lang/rust/issues/150173
    if (this.is_compiler_builtins(LOCAL_CRATE)) {
      return false;
    }
    return this.crate_types().some((crate_type) => {
      switch (crate_type) {
        case "Executable":
        case "StaticLib":
        case "ProcMacro":
        case "Cdylib":
        case "Sdylib":
          return false;

        // FIXME rust-lang/rust#64319, rust-lang/rust#64872:
        // We want to block export of generics from dylibs,
        // but we must fix rust-lang/rust#65890 before we can
        // do that robustly.
        case "Dylib":
          return true;

        case "Rlib":
          return true;
      }
    });
  }

  /// Returns the `DefId` and the `BoundRegionKind` corresponding to the given region.
  // rustc: compiler/rustc_middle/src/ty/context.rs:1463 is_suitable_region
  is_suitable_region(generic_param_scope: LocalDefId, region: Region): FreeRegionInfo | undefined {
    let suitable_region_binding_scope: LocalDefId;
    let region_def_id: DefId;
    for (;;) {
      const param_def_id = region.opt_param_def_id(this, LocalDefId.to_def_id(generic_param_scope));
      if (param_def_id === undefined) return undefined;
      const def_id = param_def_id.as_local();
      if (def_id === undefined) return undefined;
      const scope = this.local_parent(def_id);
      if (this.def_kind(scope).$ === "OpaqueTy") {
        // Lifetime params of opaque types are synthetic and thus irrelevant to
        // diagnostics. Map them back to their origin!
        region = this.map_opaque_lifetime_to_parent_lifetime(def_id);
        continue;
      }
      [suitable_region_binding_scope, region_def_id] = [scope, LocalDefId.to_def_id(def_id)];
      break;
    }

    let is_impl_item: boolean;
    const node = this.hir_node_by_def_id(suitable_region_binding_scope);
    switch (node.$) {
      case "Item":
      case "TraitItem":
        is_impl_item = false;
        break;
      case "ImplItem":
        switch (node._0.impl_kind.$) {
          // For now, we do not try to target impls of traits. This is
          // because this message is going to suggest that the user
          // change the fn signature, but they may not be free to do so,
          // since the signature must match the trait.
          //
          // FIXME(#42706) -- in some cases, we could do better here.
          case "Trait":
            is_impl_item = true;
            break;
          default:
            is_impl_item = false;
        }
        break;
      default:
        is_impl_item = false;
    }

    return { scope: suitable_region_binding_scope, region_def_id, is_impl_item };
  }

  /// Given a `DefId` for an `fn`, return all the `dyn` and `impl` traits in its return type.
  // rustc: compiler/rustc_middle/src/ty/context.rs:1500 return_type_impl_or_dyn_traits
  return_type_impl_or_dyn_traits(scope_def_id: LocalDefId): HirTy[] {
    const hir_id = this.local_def_id_to_hir_id(scope_def_id);
    const decl = this.hir_fn_decl_by_hir_id(hir_id);
    if (decl === undefined || decl.output.$ !== "Return") {
      return [];
    }
    const hir_output = decl.output._0;

    void hir_output;
    // let mut v = TraitObjectVisitor(vec![]); v.visit_ty_unambig(hir_output); v.0
    return unported("rustc_middle::ty::diagnostics::TraitObjectVisitor (ty/diagnostics.rs, lane ty-results)");
  }

  /// Given a `DefId` for an `fn`, return all the `dyn` and `impl` traits in
  /// its return type, and the associated alias span when type alias is used,
  /// along with a span for lifetime suggestion (if there are existing generics).
  // rustc: compiler/rustc_middle/src/ty/context.rs:1519 return_type_impl_or_dyn_traits_with_type_alias
  return_type_impl_or_dyn_traits_with_type_alias(scope_def_id: LocalDefId): [HirTy[], Span, Span | undefined] | undefined {
    const hir_id = this.local_def_id_to_hir_id(scope_def_id);
    // let mut v = TraitObjectVisitor(vec![]);
    // when the return type is a type alias
    const decl = this.hir_fn_decl_by_hir_id(hir_id);
    if (decl !== undefined && decl.output.$ === "Return") {
      const hir_output = decl.output._0;
      if (hir_output.kind.$ === "Path" && hir_output.kind._0.$ === "Resolved" && hir_output.kind._0._0 === undefined) {
        const res = hir_output.kind._0._1.res;
        if (res.$ === "Def" && res._0.$ === "TyAlias") {
          const local_id = res._1.as_local();
          if (local_id !== undefined) {
            const alias_ty = Node.alias_ty(this.hir_node_by_def_id(local_id)); // it is type alias
            if (alias_ty !== undefined) {
              const alias_generics = Node.generics(this.hir_node_by_def_id(local_id));
              if (alias_generics !== undefined) {
                // v.visit_ty_unambig(alias_ty); if !v.0.is_empty() { return Some((v.0, alias_generics.span,
                // alias_generics.span_for_lifetime_suggestion())); }
                return unported("rustc_middle::ty::diagnostics::TraitObjectVisitor (ty/diagnostics.rs, lane ty-results)");
              }
            }
          }
        }
      }
    }
    return undefined;
  }

  /// Determines whether identifiers in the assembly have strict naming rules.
  /// Currently, only NVPTX* targets need it.
  // rustc: compiler/rustc_middle/src/ty/context.rs:1548 has_strict_asm_symbol_naming
  has_strict_asm_symbol_naming(): boolean {
    return this.sess.target.llvm_target.startsWith("nvptx");
  }

  /// Returns `&'static core::panic::Location<'static>`.
  // rustc: compiler/rustc_middle/src/ty/context.rs:1553 caller_location_ty
  caller_location_ty(): Ty {
    const location = this.type_of(this.require_lang_item("PanicLocation", DUMMY_SP)) as EarlyBinder<Ty>;
    return Ty.new_imm_ref(this, this.lifetimes.re_static, Unnormalized.skip_norm_wip(EarlyBinder.instantiate(location, this, this.mk_args([GenericArg.from_Region(this.lifetimes.re_static)]), standin_fold_Ty)));
  }

  /// Returns a displayable description and article for the given `def_id` (e.g. `("a", "struct")`).
  // rustc: compiler/rustc_middle/src/ty/context.rs:1564 article_and_description
  article_and_description(def_id: DefId): [string, string] {
    const kind = this.def_kind(def_id);
    return [this.def_kind_descr_article(kind, def_id), this.def_kind_descr(kind, def_id)];
  }

  // rustc: compiler/rustc_middle/src/ty/context.rs:1569 type_length_limit
  type_length_limit(): Limit {
    return this.limits(null).type_length_limit;
  }

  // rustc: compiler/rustc_middle/src/ty/context.rs:1573 recursion_limit
  recursion_limit(): Limit {
    return this.limits(null).recursion_limit;
  }

  // rustc: compiler/rustc_middle/src/ty/context.rs:1577 move_size_limit
  move_size_limit(): Limit {
    return this.limits(null).move_size_limit;
  }

  // rustc: compiler/rustc_middle/src/ty/context.rs:1581 pattern_complexity_limit
  pattern_complexity_limit(): Limit {
    return this.limits(null).pattern_complexity_limit;
  }

  /// All traits in the crate graph, including those not visible to the user.
  // rustc: compiler/rustc_middle/src/ty/context.rs:1586 all_traits_including_private
  all_traits_including_private(): Iterable<DefId> {
    // PORT: the iterator adaptors are lazy; `self.crates(())` is evaluated when the chain is built.
    const crates = this.crates(null);
    const tcx = this;
    return (function* () {
      for (const cnum of chain_once(LOCAL_CRATE, crates)) {
        yield* tcx.traits(cnum);
      }
    })();
  }

  /// All traits that are visible within the crate graph (i.e. excluding private dependencies).
  // rustc: compiler/rustc_middle/src/ty/context.rs:1593 visible_traits
  visible_traits(): Iterable<DefId> {
    // PORT: the iterator adaptors are lazy (`filter` runs as the chain is consumed); `self.crates(())` is
    // evaluated when the chain is built.
    const crates = this.crates(null);
    const tcx = this;
    const visible_crates = (function* () {
      for (const cnum of crates) if (tcx.is_user_visible_dep(cnum)) yield cnum;
    })();

    return (function* () {
      for (const cnum of chain_once(LOCAL_CRATE, visible_crates)) {
        yield* tcx.traits(cnum);
      }
    })();
  }

  // rustc: compiler/rustc_middle/src/ty/context.rs:1603 local_visibility
  local_visibility(def_id: LocalDefId): Visibility<LocalModId> {
    return Visibility.expect_local(this.visibility(def_id));
  }

  /// Returns the origin of the opaque type `def_id`.
  // rustc: compiler/rustc_middle/src/ty/context.rs:1609 local_opaque_ty_origin
  local_opaque_ty_origin(def_id: LocalDefId): OpaqueTyOrigin<LocalDefId> {
    return this.hir_expect_opaque_ty(def_id).origin;
  }

  // rustc: compiler/rustc_middle/src/ty/context.rs:1613 finish
  finish(): void {
    // We assume that no queries are run past here. If there are new queries
    // after this point, they'll show up as "<unknown>" in self-profiling data.
    this.alloc_self_profile_query_strings();

    this.save_dep_graph();
    this.verify_query_key_hashes();

    const r = this.dep_graph.finish_encoding();
    if (r.$ !== "Ok") {
      // self.sess.dcx().emit_fatal(crate::diagnostics::FailedWritingFile { path: &path, error });
      unported("rustc_middle::diagnostics::FailedWritingFile (dep graph encoding, D3)");
    }
  }

  // rustc: compiler/rustc_middle/src/ty/context.rs:1628 report_unused_features
  report_unused_features(): void {
    // #[derive(Diagnostic)]
    // #[diag("feature `{$feature}` is declared but not used")]
    // struct UnusedFeature { feature: Symbol }

    // Collect first to avoid holding the lock while linting.
    const used_features = this.query_system.used_features;
    const unused_features = this.features()
      .enabled_features_iter_stable_order()
      .filter(
        ([f, _]) =>
          !used_features.has(f) &&
          // FIXME: `restricted_std` is used to tell a standard library built
          // for a platform that it doesn't know how to support. But it
          // could only gate a private mod (see `__restricted_std_workaround`)
          // with `cfg(not(restricted_std))`, so it cannot be recorded as used
          // in downstream crates. It should never be linted, but should we
          // hack this in the linter to ignore it?
          Symbol.as_str(f) !== "restricted_std" &&
          // `doc_cfg` affects rustdoc behavior: rustdoc checks it via
          // `tcx.features().doc_cfg()`, but a normal rustc compilation may
          // never observe that use. Do not lint it as unused here.
          f !== sym.doc_cfg,
      );

    for (const [feature, span] of unused_features) {
      void [feature, span];
      // self.emit_node_span_lint(UNUSED_FEATURES, CRATE_HIR_ID, span, UnusedFeature { feature });
      unported("rustc_middle::ty::context::report_unused_features::UnusedFeature (#[derive(Diagnostic)], tools/codegen)");
    }
  }

  // rustc: compiler/rustc_middle/src/ty/context.rs:1847 debug_stats
  // PORT: `impl fmt::Debug` (`fmt::from_fn`) is a `Debug<null>` closure over `self`.
  debug_stats(): Debug<null> {
    return (_v, fmt) => {
      let out = sty_debug_print_go(fmt, this, [
        "Adt",
        "Array",
        "Slice",
        "RawPtr",
        "Ref",
        "FnDef",
        "FnPtr",
        "UnsafeBinder",
        "Placeholder",
        "Coroutine",
        "CoroutineWitness",
        "Dynamic",
        "Closure",
        "CoroutineClosure",
        "Tuple",
        "Bound",
        "Param",
        "Infer",
        "Alias",
        "Pat",
        "Foreign",
      ]);

      out += `GenericArgs interner: #${this.interners.args.len()}\n`;
      out += `Region interner: #${this.interners.region.len()}\n`;
      out += `Const Allocation interner: #${this.interners.const_allocation.len()}\n`;
      out += `Layout interner: #${this.interners.layout.len()}\n`;

      return out;
    };
  }

  // ---- interning (context.rs:1975-2620; lane ty-contract) ----

  // PORT: `direct_interners!` (context.rs:1975) expands, per entry, `Borrow`/`PartialEq`/`Hash` impls for
  // `InternedInSet<$ty>` (the canonical intern key, module comment) and `fn $method(self, v: $ty) -> $ret_ty`.
  // rustc-macro: compiler/rustc_middle/src/ty/context.rs:2014 direct_interners! intern_region
  intern_region(v: RegionKind): Region {
    return Interned.new_unchecked(this.interners.region.intern(v, intern_key(v), (v) => new Region(v)));
  }
  /** Stub (`direct_interners!` `intern_valtree`, context.rs:2016): the `ValTree` class is lane ty-results'. */
  intern_valtree(_v: ValTreeKind): ValTree {
    return unported("rustc_middle::ty::context::TyCtxt::intern_valtree (ValTree class)");
  }
  /** Stub (`direct_interners!` `mk_pat`, context.rs:2017): the `Pattern` class is lane ty-results'. */
  mk_pat(_v: PatternKind): Pattern {
    return unported("rustc_middle::ty::context::TyCtxt::mk_pat (Pattern class)");
  }
  /** Stub (`direct_interners!` `mk_const_alloc`, context.rs:2018): MIR allocations (M4). */
  mk_const_alloc(_v: Allocation): ConstAllocation {
    return unported("rustc_middle::ty::context::TyCtxt::mk_const_alloc (ConstAllocation, M4)");
  }
  /** Stub (`direct_interners!` `mk_layout`, context.rs:2019): layouts (M4). */
  mk_layout(_v: LayoutData): Layout {
    return unported("rustc_middle::ty::context::TyCtxt::mk_layout (Layout, M4)");
  }
  /** Stub (`direct_interners!` `mk_adt_def_from_data`, context.rs:2020): the `AdtDef` class is lane ty-adt-assoc's. */
  mk_adt_def_from_data(_v: AdtDefData): AdtDef {
    return unported("rustc_middle::ty::context::TyCtxt::mk_adt_def_from_data (AdtDef class)");
  }
  /** Stub (`direct_interners!` `mk_external_constraints`, context.rs:2021): the class is lane middle-traits-thir's. */
  mk_external_constraints(_v: ExternalConstraintsData): ExternalConstraints {
    return unported("rustc_middle::ty::context::TyCtxt::mk_external_constraints (ExternalConstraints class)");
  }
  /** Stub (`direct_interners!` `intern_canonical_input`, context.rs:2023): the class is lane middle-traits-thir's. */
  intern_canonical_input(_v: CanonicalInputData): CanonicalInput {
    return unported("rustc_middle::ty::context::TyCtxt::intern_canonical_input (CanonicalInput class)");
  }

  // PORT: `slice_interners!` (context.rs:2026) expands, per entry, `fn $method(self, v: &[$ty]) -> &List<$ty>`:
  // `List::empty()` for an empty slice, else the interned list (`intern_ref` + `List::from_arena(arena, (), v)`).
  // These functions intern slices. They all have a corresponding
  // `mk_foo_from_iter` function that interns an iterator. The slice version
  // should be used when possible, because it's faster.
  private slice_intern<T>(set: InternedSetImpl<List<T>>, v: readonly T[]): List<T> {
    if (v.length === 0) {
      return RawList.empty<T>();
    } else {
      return set.intern_ref(v, intern_key(v), () => RawList.from_arena(undefined, null, v));
    }
  }
  // rustc-macro: compiler/rustc_middle/src/ty/context.rs:2045 slice_interners! mk_const_list
  mk_const_list(v: readonly Const[]): List<Const> {
    return this.slice_intern(this.interners.const_lists, v);
  }
  // rustc-macro: compiler/rustc_middle/src/ty/context.rs:2045 slice_interners! mk_args
  mk_args(v: readonly GenericArg[]): GenericArgs {
    return this.slice_intern(this.interners.args, v);
  }
  // rustc-macro: compiler/rustc_middle/src/ty/context.rs:2045 slice_interners! mk_type_list
  mk_type_list(v: readonly Ty[]): List<Ty> {
    return this.slice_intern(this.interners.type_lists, v);
  }
  // rustc-macro: compiler/rustc_middle/src/ty/context.rs:2045 slice_interners! mk_canonical_var_kinds
  mk_canonical_var_kinds(v: readonly CanonicalVarKind[]): List<CanonicalVarKind> {
    return this.slice_intern(this.interners.canonical_var_kinds, v);
  }
  // rustc-macro: compiler/rustc_middle/src/ty/context.rs:2045 slice_interners! intern_poly_existential_predicates
  intern_poly_existential_predicates(v: readonly PolyExistentialPredicate[]): List<PolyExistentialPredicate> {
    return this.slice_intern(this.interners.poly_existential_predicates, v);
  }
  // rustc-macro: compiler/rustc_middle/src/ty/context.rs:2045 slice_interners! mk_projs
  mk_projs(v: readonly ProjectionKind[]): List<ProjectionKind> {
    return this.slice_intern(this.interners.projs, v);
  }
  // rustc-macro: compiler/rustc_middle/src/ty/context.rs:2045 slice_interners! mk_place_elems
  mk_place_elems(v: readonly PlaceElem[]): List<PlaceElem> {
    return this.slice_intern(this.interners.place_elems, v);
  }
  // rustc-macro: compiler/rustc_middle/src/ty/context.rs:2045 slice_interners! mk_bound_variable_kinds
  mk_bound_variable_kinds(v: readonly BoundVariableKind[]): List<BoundVariableKind> {
    return this.slice_intern(this.interners.bound_variable_kinds, v);
  }
  // rustc-macro: compiler/rustc_middle/src/ty/context.rs:2045 slice_interners! mk_fields
  mk_fields(v: readonly FieldIdx[]): List<FieldIdx> {
    return this.slice_intern(this.interners.fields, v);
  }
  // rustc-macro: compiler/rustc_middle/src/ty/context.rs:2045 slice_interners! intern_local_def_ids
  intern_local_def_ids(v: readonly LocalDefId[]): List<LocalDefId> {
    return this.slice_intern(this.interners.local_def_ids, v);
  }
  // rustc-macro: compiler/rustc_middle/src/ty/context.rs:2045 slice_interners! intern_captures
  intern_captures(v: readonly CapturedPlace[]): List<CapturedPlace> {
    return this.slice_intern(this.interners.captures, v);
  }
  // rustc-macro: compiler/rustc_middle/src/ty/context.rs:2045 slice_interners! mk_patterns
  mk_patterns(v: readonly Pattern[]): List<Pattern> {
    return this.slice_intern(this.interners.patterns, v);
  }
  // rustc-macro: compiler/rustc_middle/src/ty/context.rs:2045 slice_interners! mk_outlives
  mk_outlives(v: readonly ArgOutlivesClause[]): List<ArgOutlivesClause> {
    return this.slice_intern(this.interners.outlives, v);
  }
  // rustc-macro: compiler/rustc_middle/src/ty/context.rs:2045 slice_interners! mk_predefined_opaques_in_body
  mk_predefined_opaques_in_body(v: readonly [OpaqueTypeKey, Ty][]): List<[OpaqueTypeKey, Ty]> {
    return this.slice_intern(this.interners.predefined_opaques_in_body, v);
  }

  /// Given a `fn` sig, returns an equivalent `unsafe fn` type;
  /// that is, a `fn` type that is equivalent in every way for being
  /// unsafe.
  // rustc: compiler/rustc_middle/src/ty/context.rs:2066 safe_to_unsafe_fn_ty
  safe_to_unsafe_fn_ty(sig: Binder<FnSig>): Ty {
    assert(Safety.is_safe(PolyFnSig.safety(sig)), "assertion failed: sig.safety().is_safe()");
    return Ty.new_fn_ptr(
      this,
      Binder.map_bound(sig, (sig) => ({
        ...sig,
        fn_sig_kind: FnSigKind.set_safety(sig.fn_sig_kind, "Unsafe"),
      })),
    );
  }

  /// Given a `fn` sig, returns an equivalent `unsafe fn` sig;
  /// that is, a `fn` sig that is equivalent in every way for being
  /// unsafe.
  // rustc: compiler/rustc_middle/src/ty/context.rs:2080 safe_to_unsafe_sig
  safe_to_unsafe_sig(sig: Binder<FnSig>): Binder<FnSig> {
    assert(Safety.is_safe(PolyFnSig.safety(sig)), "assertion failed: sig.safety().is_safe()");
    return Binder.map_bound(sig, (sig) => ({
      ...sig,
      fn_sig_kind: FnSigKind.set_safety(sig.fn_sig_kind, "Unsafe"),
    }));
  }

  /// Given the def_id of a Trait `trait_def_id` and the name of an associated item `assoc_name`
  /// returns true if the `trait_def_id` defines an associated item of name `assoc_name`.
  // rustc: compiler/rustc_middle/src/ty/context.rs:2090 trait_may_define_assoc_item
  trait_may_define_assoc_item(trait_def_id: DefId, assoc_name: Ident): boolean {
    for (const trait_did of supertrait_def_ids(this, trait_def_id)) {
      void trait_did;
      // self.associated_items(trait_did).filter_by_name_unhygienic(assoc_name.name)
      //     .any(|item| self.hygienic_eq(assoc_name, item.ident(self), trait_did))
      return unported("rustc_middle::ty::assoc::AssocItems::filter_by_name_unhygienic (ty/assoc.rs, lane ty-adt-assoc)");
    }
    void assoc_name;
    return false;
  }

  /// Given a `ty`, return whether it's an `impl Future<...>`.
  // rustc: compiler/rustc_middle/src/ty/context.rs:2099 ty_is_opaque_future
  ty_is_opaque_future(ty: Ty): boolean {
    const kind = ty.kind();
    if (!(kind.$ === "Alias" && kind._1.kind.$ === "Opaque")) {
      return false;
    }
    const def_id = kind._1.kind.def_id;
    const future_trait = this.require_lang_item("Future", DUMMY_SP);

    void [def_id, future_trait];
    // self.explicit_item_self_bounds(def_id).skip_binder().iter().any(|&(predicate, _)| { .. })
    return unported("rustc_type_ir::binder::EarlyBinder::skip_binder (explicit_item_self_bounds; binder.rs, lane tyir-binder)");
  }

  /// Given a closure signature, returns an equivalent fn signature. Detuples
  /// and so forth -- so e.g., if we have a sig with `Fn<(u32, i32)>` then
  /// you would get a `fn(u32, i32)`.
  /// `unsafety` determines the unsafety of the fn signature. If you pass
  /// `hir::Safety::Unsafe` in the previous example, then you would get
  /// an `unsafe fn (u32, i32)`.
  /// It cannot convert a closure that requires unsafe.
  // rustc: compiler/rustc_middle/src/ty/context.rs:2121 signature_unclosure
  signature_unclosure(sig: Binder<FnSig>, safety: Safety): Binder<FnSig> {
    return Binder.map_bound(sig, (s) => {
      const k = FnSig.inputs(s)[0]!.kind();
      let params: List<Ty>;
      if (k.$ === "Tuple") {
        params = k._0;
      } else {
        return panic("internal error: entered unreachable code");
      }
      // Ignore splatting, it is unsupported on closures.
      assert(FnSig.splatted(s) === undefined, "assertion failed: s.splatted().is_none()");
      return this.mk_fn_sig(params, FnSig.output(s), FnSigKind.set_abi(FnSigKind.set_safety(s.fn_sig_kind, safety), { $: "Rust" }));
    });
  }

  // rustc: compiler/rustc_middle/src/ty/context.rs:2138 mk_predicate
  mk_predicate(binder: Binder<PredicateKind>): Predicate {
    return this.interners.intern_predicate(binder);
  }

  // rustc: compiler/rustc_middle/src/ty/context.rs:2143 reuse_or_mk_predicate
  reuse_or_mk_predicate(pred: Predicate, binder: Binder<PredicateKind>): Predicate {
    // PORT: `pred.kind() != binder` is the derived `PartialEq` of `Binder<PredicateKind>`: the intern key.
    return intern_key(pred.kind()) !== intern_key(binder) ? this.mk_predicate(binder) : pred;
  }

  /// If you have a [`ty::Alias`], you should almost certainly be calling
  /// [`Self::check_alias_term_args_compatible`] instead. This method assumes that inherent alias
  /// consts always have `impl`-form args, and will return an invalid result if the `def_id` comes
  /// from a [`ty::AliasConstKind::InherentSelf`] (see the doc on that for what "impl form args"
  /// means).
  // rustc: compiler/rustc_middle/src/ty/context.rs:2156 check_args_compatible
  check_args_compatible(def_id: DefId, args: readonly GenericArg[]): boolean {
    const is_inherent_assoc_ty = this.def_kind(def_id).$ === "AssocTy" && is_impl_of_trait(this.def_kind(this.parent(def_id)), false);
    return this.check_args_compatible_inner(def_id, args, is_inherent_assoc_ty);
  }

  // rustc: compiler/rustc_middle/src/ty/context.rs:2162 check_alias_term_args_compatible
  check_alias_term_args_compatible(kind: AliasTermKind, args: readonly GenericArg[]): boolean {
    const [def_id, is_self_args] = alias_term_def_id_and_is_self_args(kind);
    return this.check_args_compatible_inner(def_id, args, is_self_args);
  }

  // rustc: compiler/rustc_middle/src/ty/context.rs:2181 check_args_compatible_inner
  private check_args_compatible_inner(def_id: DefId, args: readonly GenericArg[], is_self_args: boolean): boolean {
    const generics = this.generics_of(def_id) as Generics;
    let own_args: readonly GenericArg[];
    if (is_self_args) {
      if (generics.own_params.length + 1 !== args.length) {
        return false;
      }

      if (!(GenericArg.kind(args[0]!).$ === "Type")) {
        return false;
      }

      own_args = args.slice(1);
    } else {
      if (generics.count() !== args.length) {
        return false;
      }

      const parent_args = args.slice(0, generics.parent_count);
      own_args = args.slice(generics.parent_count);

      // In the type system, IATs and IACs (inherent associated types/consts) themselves have a
      // weird arg setup (self + own args), but nested items *in* IATs (namely: opaques, i.e.
      // ATPITs) do not. So, set `is_self_args` to false for the parent generic check.
      const parent = generics.parent;
      if (parent !== undefined && !this.check_args_compatible_inner(parent, parent_args, false)) {
        return false;
      }
    }

    const n = Math.min(generics.own_params.length, own_args.length);
    for (let i = 0; i < n; i++) {
      const param = generics.own_params[i]!;
      const arg = own_args[i]!;
      const pk = param.kind.$;
      const ak = GenericArg.kind(arg).$;
      if ((pk === "Type" && ak === "Type") || (pk === "Lifetime" && ak === "Lifetime") || (pk === "Const" && ak === "Const")) {
        // ok
      } else {
        return false;
      }
    }

    return true;
  }

  /// With `cfg(debug_assertions)`, assert that args are compatible with their generics,
  /// and print out the args if not.
  ///
  /// If you have a [`ty::Alias`], you should use
  /// [`Self::debug_assert_alias_term_args_compatible`] instead. See note on
  /// [`Self::check_args_compatible`].
  // rustc: compiler/rustc_middle/src/ty/context.rs:2235 debug_assert_args_compatible
  debug_assert_args_compatible(def_id: DefId, args: readonly GenericArg[]): void {
    // PORT: `cfg!(debug_assertions)` is false (the oracle is a release build), so the body is skipped:
    // if cfg!(debug_assertions) && !self.check_args_compatible(def_id, args) {
    //     let is_inherent_assoc_ty = matches!(self.def_kind(def_id), DefKind::AssocTy)
    //         && matches!(self.def_kind(self.parent(def_id)), DefKind::Impl { of_trait: false });
    //     self.emit_bug_args_compatible(def_id, args, is_inherent_assoc_ty);
    // }
    void [def_id, args];
  }

  // rustc: compiler/rustc_middle/src/ty/context.rs:2243 debug_assert_alias_term_args_compatible
  debug_assert_alias_term_args_compatible(kind: AliasTermKind, args: GenericArgs): void {
    // PORT: `cfg!(debug_assertions)` is false (the oracle is a release build), so the body is skipped:
    // if cfg!(debug_assertions) {
    //     self.debug_assert_alias_term_kind_matches_def_kind(kind);
    //     if !self.check_alias_term_args_compatible(kind, args) {
    //         let (def_id, is_self_args) = match kind { .. };
    //         self.emit_bug_args_compatible(def_id, args, is_self_args);
    //     }
    // }
    void [kind, args];
  }

  // rustc: compiler/rustc_middle/src/ty/context.rs:2267 debug_assert_alias_term_kind_matches_def_kind
  private debug_assert_alias_term_kind_matches_def_kind(kind: AliasTermKind): void {
    // PORT: every arm is `debug_assert_matches!` (off in the release oracle, PORTING §3):
    // ProjectionTy: def_kind AssocTy, parent Trait | Impl { of_trait: true }
    // InherentTy: def_kind AssocTy, parent Impl { of_trait: false }
    // OpaqueTy: OpaqueTy; FreeTy: TyAlias; AnonConst: AnonConst
    // ProjectionConst: AssocConst, parent Trait | Impl { of_trait: true }
    // InherentConstSelf | InherentConstImpl: AssocConst, parent Impl { of_trait: false }
    // FreeConst: Const
    void kind;
  }

  // rustc: compiler/rustc_middle/src/ty/context.rs:2313 emit_bug_args_compatible
  private emit_bug_args_compatible(def_id: DefId, args: readonly GenericArg[], is_self_args: boolean): never {
    if (is_self_args) {
      return panic(
        `args not compatible with generics for ${this.def_path_str(def_id)}: args=${debug_vec(args, PRETTY, debug_GenericArg)}, generics=${debug_GenericArgs(
          // Make `[Self, GAT_ARGS...]` (this could be simplified)
          this.mk_args_from_iter(chain_once<GenericArg>(GenericArg.from_Ty(this.types.self_param), Generics_own_args(this.generics_of(def_id) as Generics, RawList.identity_for_item(this, def_id)))),
          PRETTY,
        )}`,
      );
    } else {
      return panic(
        `args not compatible with generics for ${this.def_path_str(def_id)}: args=${debug_vec(args, PRETTY, debug_GenericArg)}, generics=${debug_GenericArgs(RawList.identity_for_item(this, def_id), PRETTY)}`,
      );
    }
  }

  // rustc: compiler/rustc_middle/src/ty/context.rs:2345 check_and_mk_args
  check_and_mk_args(def_id: DefId, args: Iterable<GenericArg>): GenericArgs {
    // PORT: `Into<GenericArg>` is the identity (D3: `GenericArg` is `Ty | Region | Const`).
    const args_ = this.mk_args_from_iter(args);
    this.debug_assert_args_compatible(def_id, args_);
    return args_;
  }

  // rustc: compiler/rustc_middle/src/ty/context.rs:2356 mk_ct_from_kind
  mk_ct_from_kind(kind: ConstKind): Const {
    return this.interners.intern_const(kind);
  }

  // Avoid this in favour of more specific `Ty::new_*` methods, where possible.
  // rustc: compiler/rustc_middle/src/ty/context.rs:2363 mk_ty_from_kind
  mk_ty_from_kind(st: TyKind): Ty {
    return this.interners.intern_ty(st);
  }

  // rustc: compiler/rustc_middle/src/ty/context.rs:2367 mk_param_from_def
  mk_param_from_def(param: GenericParamDef): GenericArg {
    switch (param.kind.$) {
      case "Lifetime":
        return GenericArg.from_Region(Region.new_early_param(this, GenericParamDef_to_early_bound_region_data(param)));
      case "Type":
        return GenericArg.from_Ty(Ty.new_param(this, param.index, param.name));
      case "Const":
        return GenericArg.from_Const(Const.new_param(this, { index: param.index, name: param.name }));
    }
  }

  // rustc: compiler/rustc_middle/src/ty/context.rs:2380 mk_place_field
  mk_place_field(place: Place, f: FieldIdx, ty: Ty): Place {
    return this.mk_place_elem(place, { $: "Field", _0: f, _1: ty } as unknown as PlaceElem);
  }

  // rustc: compiler/rustc_middle/src/ty/context.rs:2384 mk_place_deref
  mk_place_deref(place: Place): Place {
    return this.mk_place_elem(place, { $: "Deref" } as unknown as PlaceElem);
  }

  // rustc: compiler/rustc_middle/src/ty/context.rs:2388 mk_place_downcast
  mk_place_downcast(place: Place, adt_def: AdtDef, variant_index: VariantIdx): Place {
    void [place, adt_def, variant_index];
    // self.mk_place_elem(place, PlaceElem::Downcast(Some(adt_def.variant(variant_index).name), variant_index))
    return unported("rustc_middle::ty::adt::AdtDef::variant (ty/adt.rs, lane ty-adt-assoc)");
  }

  // rustc: compiler/rustc_middle/src/ty/context.rs:2400 mk_place_downcast_unnamed
  mk_place_downcast_unnamed(place: Place, variant_index: VariantIdx): Place {
    return this.mk_place_elem(place, { $: "Downcast", _0: undefined, _1: variant_index } as unknown as PlaceElem);
  }

  // rustc: compiler/rustc_middle/src/ty/context.rs:2408 mk_place_index
  mk_place_index(place: Place, index: Local): Place {
    return this.mk_place_elem(place, { $: "Index", _0: index } as unknown as PlaceElem);
  }

  /// This method copies `Place`'s projection, add an element and reintern it. Should not be used
  /// to build a full `Place` it's just a convenient way to grab a projection and modify it in
  /// flight.
  // rustc: compiler/rustc_middle/src/ty/context.rs:2415 mk_place_elem
  mk_place_elem(place: Place, elem: PlaceElem): Place {
    return {
      local: place.local,
      projection: this.mk_place_elems_from_iter([...place.projection, elem]),
    };
  }

  // rustc: compiler/rustc_middle/src/ty/context.rs:2422 mk_poly_existential_predicates
  mk_poly_existential_predicates(eps: readonly PolyExistentialPredicate[]): List<PolyExistentialPredicate> {
    assert(!(eps.length === 0), "assertion failed: !eps.is_empty()");
    let sorted = true;
    for (let i = 0; i + 1 < eps.length; i++) {
      const [a, b] = [eps[i]!, eps[i + 1]!];
      if (ExistentialPredicate_stable_cmp(Binder.skip_binder(a), this, Binder.skip_binder(b)) === "Greater") {
        sorted = false;
        break;
      }
    }
    assert(sorted, "assertion failed: eps.array_windows().all(|[a, b]|\n        a.skip_binder().stable_cmp(self, &b.skip_binder()) != Ordering::Greater)");
    return this.intern_poly_existential_predicates(eps);
  }

  // rustc: compiler/rustc_middle/src/ty/context.rs:2435 mk_clauses
  mk_clauses(clauses: readonly Clause[]): Clauses {
    // FIXME consider asking the input slice to be sorted to avoid
    // re-interning permutations, in which case that would be asserted
    // here.
    return this.interners.intern_clauses(clauses);
  }

  // rustc: compiler/rustc_middle/src/ty/context.rs:2442 mk_local_def_ids
  mk_local_def_ids(def_ids: readonly LocalDefId[]): List<LocalDefId> {
    // FIXME consider asking the input slice to be sorted to avoid
    // re-interning permutations, in which case that would be asserted
    // here.
    return this.intern_local_def_ids(def_ids);
  }

  // PORT: every `mk_*_from_iter<I, T: CollectAndApply<..>>` is an overload pair: items `T` (the blanket impl) or,
  // with `CollectAndApply_Result` as the last argument, items `Result<T, E>` (rustc_type_ir/interner.ts).
  // rustc: compiler/rustc_middle/src/ty/context.rs:2449 mk_patterns_from_iter
  mk_patterns_from_iter(iter: Iterable<Pattern>): List<Pattern>;
  mk_patterns_from_iter<E>(iter: Iterable<Result<Pattern, E>>, c: CollectAndApply_Result): Result<List<Pattern>, E>;
  mk_patterns_from_iter(iter: Iterable<unknown>, c?: CollectAndApply_Result): unknown {
    return collect_and_apply(iter, c, (xs: readonly Pattern[]) => this.mk_patterns(xs));
  }

  // rustc: compiler/rustc_middle/src/ty/context.rs:2457 mk_local_def_ids_from_iter
  mk_local_def_ids_from_iter(iter: Iterable<LocalDefId>): List<LocalDefId>;
  mk_local_def_ids_from_iter<E>(iter: Iterable<Result<LocalDefId, E>>, c: CollectAndApply_Result): Result<List<LocalDefId>, E>;
  mk_local_def_ids_from_iter(iter: Iterable<unknown>, c?: CollectAndApply_Result): unknown {
    return collect_and_apply(iter, c, (xs: readonly LocalDefId[]) => this.mk_local_def_ids(xs));
  }

  // rustc: compiler/rustc_middle/src/ty/context.rs:2465 mk_captures_from_iter
  mk_captures_from_iter(iter: Iterable<CapturedPlace>): List<CapturedPlace>;
  mk_captures_from_iter<E>(iter: Iterable<Result<CapturedPlace, E>>, c: CollectAndApply_Result): Result<List<CapturedPlace>, E>;
  mk_captures_from_iter(iter: Iterable<unknown>, c?: CollectAndApply_Result): unknown {
    return collect_and_apply(iter, c, (xs: readonly CapturedPlace[]) => this.intern_captures(xs));
  }

  // rustc: compiler/rustc_middle/src/ty/context.rs:2476 mk_const_list_from_iter
  mk_const_list_from_iter(iter: Iterable<Const>): List<Const>;
  mk_const_list_from_iter<E>(iter: Iterable<Result<Const, E>>, c: CollectAndApply_Result): Result<List<Const>, E>;
  mk_const_list_from_iter(iter: Iterable<unknown>, c?: CollectAndApply_Result): unknown {
    return collect_and_apply(iter, c, (xs: readonly Const[]) => this.mk_const_list(xs));
  }

  // Unlike various other `mk_*_from_iter` functions, this one uses `I:
  // IntoIterator` instead of `I: Iterator`, and it doesn't have a slice
  // variant, because of the need to combine `inputs` and `output`. This
  // explains the lack of `_from_iter` suffix.
  // rustc: compiler/rustc_middle/src/ty/context.rs:2488 mk_fn_sig
  mk_fn_sig(inputs: Iterable<Ty>, output: Ty, fn_sig_kind: FnSigKind): FnSig;
  mk_fn_sig<E>(inputs: Iterable<Result<Ty, E>>, output: Result<Ty, E>, fn_sig_kind: FnSigKind, c: CollectAndApply_Result): Result<FnSig, E>;
  mk_fn_sig(inputs: Iterable<unknown>, output: unknown, fn_sig_kind: FnSigKind, c?: CollectAndApply_Result): unknown {
    return collect_and_apply(chain_end(inputs, output), c, (xs: readonly Ty[]): FnSig => ({
      inputs_and_output: this.mk_type_list(xs),
      fn_sig_kind,
    }));
  }

  /// `mk_fn_sig`, but with a Rust ABI, and no C-variadic argument.
  // rustc: compiler/rustc_middle/src/ty/context.rs:2505 mk_fn_sig_rust_abi
  mk_fn_sig_rust_abi(inputs: Iterable<Ty>, output: Ty, safety: Safety): FnSig;
  mk_fn_sig_rust_abi<E>(inputs: Iterable<Result<Ty, E>>, output: Result<Ty, E>, safety: Safety, c: CollectAndApply_Result): Result<FnSig, E>;
  mk_fn_sig_rust_abi(inputs: Iterable<unknown>, output: unknown, safety: Safety, c?: CollectAndApply_Result): unknown {
    return this.mk_fn_sig(inputs as Iterable<Result<Ty, unknown>>, output as Result<Ty, unknown>, FnSigKind.set_safety(FnSigKind.default_(), safety), c as CollectAndApply_Result);
  }

  /// `mk_fn_sig`, but with a safe Rust ABI, and no C-variadic argument.
  // rustc: compiler/rustc_middle/src/ty/context.rs:2519 mk_fn_sig_safe_rust_abi
  mk_fn_sig_safe_rust_abi(inputs: Iterable<Ty>, output: Ty): FnSig;
  mk_fn_sig_safe_rust_abi<E>(inputs: Iterable<Result<Ty, E>>, output: Result<Ty, E>, c: CollectAndApply_Result): Result<FnSig, E>;
  mk_fn_sig_safe_rust_abi(inputs: Iterable<unknown>, output: unknown, c?: CollectAndApply_Result): unknown {
    return this.mk_fn_sig(inputs as Iterable<Result<Ty, unknown>>, output as Result<Ty, unknown>, FnSigKind.set_safety(FnSigKind.default_(), "Safe"), c as CollectAndApply_Result);
  }

  /// `mk_fn_sig`, but with an **un**safe Rust ABI, and no C-variadic argument.
  // rustc: compiler/rustc_middle/src/ty/context.rs:2528 mk_fn_sig_unsafe_rust_abi
  mk_fn_sig_unsafe_rust_abi(inputs: Iterable<Ty>, output: Ty): FnSig;
  mk_fn_sig_unsafe_rust_abi<E>(inputs: Iterable<Result<Ty, E>>, output: Result<Ty, E>, c: CollectAndApply_Result): Result<FnSig, E>;
  mk_fn_sig_unsafe_rust_abi(inputs: Iterable<unknown>, output: unknown, c?: CollectAndApply_Result): unknown {
    return this.mk_fn_sig(inputs as Iterable<Result<Ty, unknown>>, output as Result<Ty, unknown>, FnSigKind.set_safety(FnSigKind.default_(), "Unsafe"), c as CollectAndApply_Result);
  }

  // rustc: compiler/rustc_middle/src/ty/context.rs:2536 mk_poly_existential_predicates_from_iter
  mk_poly_existential_predicates_from_iter(iter: Iterable<PolyExistentialPredicate>): List<PolyExistentialPredicate>;
  mk_poly_existential_predicates_from_iter<E>(iter: Iterable<Result<PolyExistentialPredicate, E>>, c: CollectAndApply_Result): Result<List<PolyExistentialPredicate>, E>;
  mk_poly_existential_predicates_from_iter(iter: Iterable<unknown>, c?: CollectAndApply_Result): unknown {
    return collect_and_apply(iter, c, (xs: readonly PolyExistentialPredicate[]) => this.mk_poly_existential_predicates(xs));
  }

  // rustc: compiler/rustc_middle/src/ty/context.rs:2547 mk_predefined_opaques_in_body_from_iter
  mk_predefined_opaques_in_body_from_iter(iter: Iterable<[OpaqueTypeKey, Ty]>): List<[OpaqueTypeKey, Ty]>;
  mk_predefined_opaques_in_body_from_iter<E>(iter: Iterable<Result<[OpaqueTypeKey, Ty], E>>, c: CollectAndApply_Result): Result<List<[OpaqueTypeKey, Ty]>, E>;
  mk_predefined_opaques_in_body_from_iter(iter: Iterable<unknown>, c?: CollectAndApply_Result): unknown {
    return collect_and_apply(iter, c, (xs: readonly [OpaqueTypeKey, Ty][]) => this.mk_predefined_opaques_in_body(xs));
  }

  // rustc: compiler/rustc_middle/src/ty/context.rs:2555 mk_clauses_from_iter
  mk_clauses_from_iter(iter: Iterable<Clause>): Clauses;
  mk_clauses_from_iter<E>(iter: Iterable<Result<Clause, E>>, c: CollectAndApply_Result): Result<Clauses, E>;
  mk_clauses_from_iter(iter: Iterable<unknown>, c?: CollectAndApply_Result): unknown {
    return collect_and_apply(iter, c, (xs: readonly Clause[]) => this.mk_clauses(xs));
  }

  // rustc: compiler/rustc_middle/src/ty/context.rs:2563 mk_type_list_from_iter
  mk_type_list_from_iter(iter: Iterable<Ty>): List<Ty>;
  mk_type_list_from_iter<E>(iter: Iterable<Result<Ty, E>>, c: CollectAndApply_Result): Result<List<Ty>, E>;
  mk_type_list_from_iter(iter: Iterable<unknown>, c?: CollectAndApply_Result): unknown {
    return collect_and_apply(iter, c, (xs: readonly Ty[]) => this.mk_type_list(xs));
  }

  // rustc: compiler/rustc_middle/src/ty/context.rs:2571 mk_args_from_iter
  mk_args_from_iter(iter: Iterable<GenericArg>): GenericArgs;
  mk_args_from_iter<E>(iter: Iterable<Result<GenericArg, E>>, c: CollectAndApply_Result): Result<GenericArgs, E>;
  mk_args_from_iter(iter: Iterable<unknown>, c?: CollectAndApply_Result): unknown {
    return collect_and_apply(iter, c, (xs: readonly GenericArg[]) => this.mk_args(xs));
  }

  // rustc: compiler/rustc_middle/src/ty/context.rs:2579 mk_canonical_var_infos_from_iter
  mk_canonical_var_infos_from_iter(iter: Iterable<CanonicalVarKind>): List<CanonicalVarKind>;
  mk_canonical_var_infos_from_iter<E>(iter: Iterable<Result<CanonicalVarKind, E>>, c: CollectAndApply_Result): Result<List<CanonicalVarKind>, E>;
  mk_canonical_var_infos_from_iter(iter: Iterable<unknown>, c?: CollectAndApply_Result): unknown {
    return collect_and_apply(iter, c, (xs: readonly CanonicalVarKind[]) => this.mk_canonical_var_kinds(xs));
  }

  // rustc: compiler/rustc_middle/src/ty/context.rs:2587 mk_place_elems_from_iter
  mk_place_elems_from_iter(iter: Iterable<PlaceElem>): List<PlaceElem>;
  mk_place_elems_from_iter<E>(iter: Iterable<Result<PlaceElem, E>>, c: CollectAndApply_Result): Result<List<PlaceElem>, E>;
  mk_place_elems_from_iter(iter: Iterable<unknown>, c?: CollectAndApply_Result): unknown {
    return collect_and_apply(iter, c, (xs: readonly PlaceElem[]) => this.mk_place_elems(xs));
  }

  // rustc: compiler/rustc_middle/src/ty/context.rs:2595 mk_fields_from_iter
  mk_fields_from_iter(iter: Iterable<FieldIdx>): List<FieldIdx>;
  mk_fields_from_iter<E>(iter: Iterable<Result<FieldIdx, E>>, c: CollectAndApply_Result): Result<List<FieldIdx>, E>;
  mk_fields_from_iter(iter: Iterable<unknown>, c?: CollectAndApply_Result): unknown {
    return collect_and_apply(iter, c, (xs: readonly FieldIdx[]) => this.mk_fields(xs));
  }

  // rustc: compiler/rustc_middle/src/ty/context.rs:2603 mk_args_trait
  mk_args_trait(self_ty: Ty, rest: Iterable<GenericArg>): GenericArgs {
    return this.mk_args_from_iter(chain_once<GenericArg>(GenericArg.from_Ty(self_ty), rest));
  }

  // rustc: compiler/rustc_middle/src/ty/context.rs:2611 mk_bound_variable_kinds_from_iter
  mk_bound_variable_kinds_from_iter(iter: Iterable<BoundVariableKind>): List<BoundVariableKind>;
  mk_bound_variable_kinds_from_iter<E>(iter: Iterable<Result<BoundVariableKind, E>>, c: CollectAndApply_Result): Result<List<BoundVariableKind>, E>;
  mk_bound_variable_kinds_from_iter(iter: Iterable<unknown>, c?: CollectAndApply_Result): unknown {
    return collect_and_apply(iter, c, (xs: readonly BoundVariableKind[]) => this.mk_bound_variable_kinds(xs));
  }

  // rustc: compiler/rustc_middle/src/ty/context.rs:2619 mk_outlives_from_iter
  mk_outlives_from_iter(iter: Iterable<ArgOutlivesClause>): List<ArgOutlivesClause>;
  mk_outlives_from_iter<E>(iter: Iterable<Result<ArgOutlivesClause, E>>, c: CollectAndApply_Result): Result<List<ArgOutlivesClause>, E>;
  mk_outlives_from_iter(iter: Iterable<unknown>, c?: CollectAndApply_Result): unknown {
    return collect_and_apply(iter, c, (xs: readonly ArgOutlivesClause[]) => this.mk_outlives(xs));
  }

  /// Emit a lint at `span` from a lint struct (some type that implements `Diagnostic`,
  /// typically generated by `#[derive(Diagnostic)]`).
  // rustc: compiler/rustc_middle/src/ty/context.rs:2633 emit_node_span_lint
  emit_node_span_lint(lint: Lint, hir_id: HirId, span: IntoMultiSpan, decorator: Diagnostic): void {
    const level_spec = this.lint_level_spec_at_node(lint, hir_id);
    const lint_mod = middle_lint();
    lint_mod.emit_lint_base(this.sess, lint, lint_mod.LevelSpec.from_StableLevelSpec(level_spec), into_MultiSpan(span), decorator);
  }

  /// Find the appropriate span where `use` and outer attributes can be inserted at.
  // rustc: compiler/rustc_middle/src/ty/context.rs:2645 crate_level_attribute_injection_span
  crate_level_attribute_injection_span(): Span {
    const node = this.hir_node(CRATE_HIR_ID);
    if (node.$ !== "Crate") {
      return panic("impossible case reached");
    }
    const m = node._0;
    return Span.shrink_to_lo(m.spans.inject_use_span);
  }

  // rustc: compiler/rustc_middle/src/ty/context.rs:2651 disabled_nightly_features
  disabled_nightly_features(diag: Diag, features: Iterable<[string, Symbol]>): void {
    if (!this.sess.is_nightly_build()) {
      return;
    }

    const span = this.crate_level_attribute_injection_span();
    for (const [desc, feature] of features) {
      // FIXME: make this string translatable
      const msg = `add \`#![feature(${Symbol.as_str(feature)})]\` to the crate attributes to enable${desc}`;
      diag.span_suggestion_verbose(span, msg, `#![feature(${Symbol.as_str(feature)})]\n`, "MaybeIncorrect");
    }
  }

  /// Emit a lint from a lint struct (some type that implements `Diagnostic`, typically generated
  /// by `#[derive(Diagnostic)]`).
  // rustc: compiler/rustc_middle/src/ty/context.rs:2677 emit_node_lint
  emit_node_lint(lint: Lint, id: HirId, decorator: Diagnostic): void {
    const level_spec = this.lint_level_spec_at_node(lint, id);
    const lint_mod = middle_lint();
    lint_mod.emit_lint_base(this.sess, lint, lint_mod.LevelSpec.from_StableLevelSpec(level_spec), undefined, decorator);
  }

  // rustc: compiler/rustc_middle/src/ty/context.rs:2687 in_scope_traits
  in_scope_traits(id: HirId): readonly TraitCandidate[] | undefined {
    const map = this.in_scope_traits_map(id.owner);
    if (map === undefined) return undefined;
    const candidates = map.get(id.local_id);
    if (candidates === undefined) return undefined;
    return candidates;
  }

  // rustc: compiler/rustc_middle/src/ty/context.rs:2693 named_bound_var
  named_bound_var(id: HirId): ResolvedArg | undefined {
    // debug!(?id, "named_region");
    return this.named_variable_map(id.owner).get(id.local_id) as ResolvedArg | undefined;
  }

  // rustc: compiler/rustc_middle/src/ty/context.rs:2698 is_late_bound
  is_late_bound(id: HirId): boolean {
    const set = this.is_late_bound_map(id.owner);
    return set !== undefined && set.has(id.local_id);
  }

  // rustc: compiler/rustc_middle/src/ty/context.rs:2702 late_bound_vars
  late_bound_vars(id: HirId): List<BoundVariableKind> {
    const vars = this.late_bound_vars_map(id.owner).get(id.local_id);
    if (vars === undefined) {
      return panic(`No bound vars found for ${this.hir_id_to_string(id)}`);
    }
    return this.mk_bound_variable_kinds(vars as readonly BoundVariableKind[]);
  }

  /// Given the def-id of an early-bound lifetime on an opaque corresponding to
  /// a duplicated captured lifetime, map it back to the early- or late-bound
  /// lifetime of the function from which it originally as captured. If it is
  /// a late-bound lifetime, this will represent the liberated (`ReLateParam`) lifetime
  /// of the signature.
  // FIXME(RPITIT): if we ever synthesize new lifetimes for RPITITs and not just
  // re-use the generics of the opaque, this function will need to be tweaked slightly.
  // rustc: compiler/rustc_middle/src/ty/context.rs:2719 map_opaque_lifetime_to_parent_lifetime
  map_opaque_lifetime_to_parent_lifetime(opaque_lifetime_param_def_id: LocalDefId): Region {
    // debug_assert!(matches!(self.def_kind(opaque_lifetime_param_def_id), DefKind::LifetimeParam), ..);

    for (;;) {
      const parent = this.local_parent(opaque_lifetime_param_def_id);
      const lifetime_mapping = this.opaque_captured_lifetimes(parent);

      const found = lifetime_mapping.find(([_, duplicated_param]) => duplicated_param === opaque_lifetime_param_def_id);
      if (found === undefined) {
        return panic("duplicated lifetime param should be present");
      }
      const lifetime = found[0] as ResolvedArg;

      switch (lifetime.$) {
        case "EarlyBound": {
          const ebv = lifetime._0 as LocalDefId;
          const new_parent = this.local_parent(ebv);

          // If we map to another opaque, then it should be a parent
          // of the opaque we mapped from. Continue mapping.
          if (this.def_kind(new_parent).$ === "OpaqueTy") {
            // debug_assert_eq!(self.local_parent(parent), new_parent);
            opaque_lifetime_param_def_id = ebv;
            continue;
          }

          const generics = this.generics_of(new_parent) as Generics;
          return Region.new_early_param(this, {
            index: unwrap(generics.param_def_id_to_index_(this, LocalDefId.to_def_id(ebv)), "early-bound var should be present in fn generics"),
            name: this.item_name(LocalDefId.to_def_id(ebv)),
          });
        }
        case "LateBound": {
          const lbv = lifetime._2 as LocalDefId;
          const new_parent = this.local_parent(lbv);
          return Region.new_late_param(this, LocalDefId.to_def_id(new_parent), { $: "Named", _0: LocalDefId.to_def_id(lbv) } as unknown as LateParamRegionKind);
        }
        case "Error": {
          const guar = lifetime._0 as ErrorGuaranteed;
          return Region.new_error(this, guar);
        }
        default: {
          return Region.new_error_with_message(this, this.def_span(opaque_lifetime_param_def_id), "cannot resolve lifetime");
        }
      }
    }
  }

  /// Whether `def_id` is a stable const fn (i.e., doesn't need any feature gates to be called).
  ///
  /// When this is `false`, the function may still be callable as a `const fn` due to features
  /// being enabled!
  // rustc: compiler/rustc_middle/src/ty/context.rs:2789 is_stable_const_fn
  is_stable_const_fn(def_id: DefId): boolean {
    if (!this.is_const_fn(def_id)) return false;
    const stability = this.lookup_const_stability(def_id) as ConstStability | undefined;
    if (stability === undefined) {
      return true; // a fn in a non-staged_api crate
    } else if (stability.is_const_stable()) {
      return true;
    } else {
      return false;
    }
  }

  /// Whether the trait impl is marked const. This does not consider stability or feature gates.
  // rustc: compiler/rustc_middle/src/ty/context.rs:2799 is_const_trait_impl
  is_const_trait_impl(def_id: DefId): boolean {
    if (!is_impl_of_trait(this.def_kind(def_id), true)) return false;
    const constness = (this.impl_trait_header(def_id) as { constness: Constness }).constness;
    return constness.$ === "Const" && constness.always === false;
  }

  // rustc: compiler/rustc_middle/src/ty/context.rs:2807 is_sdylib_interface_build
  is_sdylib_interface_build(): boolean {
    return this.sess.opts.unstable_opts.build_sdylib_interface;
  }

  // rustc: compiler/rustc_middle/src/ty/context.rs:2811 intrinsic
  intrinsic(def_id: IntoQueryKey<DefId>): IntrinsicDef | undefined {
    const def_id_ = into_query_key_DefId(def_id);
    switch (this.def_kind(def_id_).$) {
      case "Fn":
      case "AssocFn":
        return this.intrinsic_raw(def_id_) as IntrinsicDef | undefined;
      default:
        return undefined;
    }
  }

  // rustc: compiler/rustc_middle/src/ty/context.rs:2819 next_trait_solver_globally
  next_trait_solver_globally(): boolean {
    return this.sess.opts.unstable_opts.next_solver === "Globally" && !this.sess.opts.unstable_opts.higher_ranked_assumptions && !this.features().generic_const_exprs();
  }

  // rustc: compiler/rustc_middle/src/ty/context.rs:2825 disable_trait_solver_fast_paths
  disable_trait_solver_fast_paths(): boolean {
    return this.sess.opts.unstable_opts.disable_fast_paths;
  }

  // rustc: compiler/rustc_middle/src/ty/context.rs:2829 disable_param_env_normalization_hack
  disable_param_env_normalization_hack(): boolean {
    return this.sess.opts.unstable_opts.disable_param_env_normalization_hack;
  }

  // rustc: compiler/rustc_middle/src/ty/context.rs:2833 renormalize_rigid_aliases
  renormalize_rigid_aliases(): boolean {
    return this.sess.opts.unstable_opts.renormalize_rigid_aliases;
  }

  // rustc: compiler/rustc_middle/src/ty/context.rs:2838 use_typing_mode_post_typeck_until_borrowck
  use_typing_mode_post_typeck_until_borrowck(): boolean {
    return this.next_trait_solver_globally() || this.sess.opts.unstable_opts.typing_mode_post_typeck_until_borrowck;
  }

  // rustc: compiler/rustc_middle/src/ty/context.rs:2843 assumptions_on_binders
  assumptions_on_binders(): boolean {
    return this.sess.opts.unstable_opts.assumptions_on_binders;
  }

  // rustc: compiler/rustc_middle/src/ty/context.rs:2847 is_impl_trait_in_trait
  is_impl_trait_in_trait(def_id: DefId): boolean {
    return this.opt_rpitit_info(def_id) !== undefined;
  }

  // rustc: compiler/rustc_middle/src/ty/context.rs:2851 get_impl_future_output_ty
  get_impl_future_output_ty(ty: Ty): Ty | undefined {
    const kind = ty.kind();
    let def_id: DefId;
    let args: GenericArgs;
    if (kind.$ === "Alias" && kind._1.kind.$ === "Opaque") {
      [def_id, args] = [kind._1.kind.def_id, kind._1.args];
    } else if (kind.$ === "Alias" && kind._1.kind.$ === "Projection" && this.is_impl_trait_in_trait(kind._1.kind.def_id)) {
      [def_id, args] = [kind._1.kind.def_id, kind._1.args];
    } else {
      return undefined;
    }

    const future_trait = this.require_lang_item("Future", DUMMY_SP);
    const item_def_id = this.associated_item_def_ids(future_trait)[0]!;

    void [def_id, args, item_def_id];
    // self.explicit_item_self_bounds(def_id).iter_instantiated_copied(self, args).map(Unnormalized::skip_norm_wip)
    //     .find_map(|(predicate, _)| predicate.kind().map_bound(..).no_bound_vars().flatten())
    return unported("rustc_type_ir::binder::EarlyBinder::iter_instantiated_copied (binder.rs, lane tyir-binder)");
  }

  /// In addition to regular items this list also includes struct and variant constructors, and
  /// items inside `extern {}` blocks because all of them introduce names into parent module.
  ///
  /// Module here is understood in name resolution sense - it can be a `mod` item,
  /// or a crate root, or an enum, or a trait.
  ///
  /// This is not a query, making it a query causes perf regressions
  /// (probably due to hashing spans in `ModChild`ren).
  // rustc: compiler/rustc_middle/src/ty/context.rs:2893 module_children_local
  module_children_local(def_id: LocalDefId): readonly ModChild[] {
    return this.resolutions(null).module_children.get(def_id) ?? [];
  }

  /// Return the crate imported by given use item.
  // rustc: compiler/rustc_middle/src/ty/context.rs:2898 extern_mod_stmt_cnum
  extern_mod_stmt_cnum(def_id: LocalDefId): CrateNum | undefined {
    return this.resolutions(null).extern_crate_map.get(def_id);
  }

  // rustc: compiler/rustc_middle/src/ty/context.rs:2902 resolver_for_lowering
  resolver_for_lowering(): [Steal<ResolverAstLowering>, Steal<Crate>] {
    const [resolver, krate] = this.resolver_for_lowering_raw(null);
    return [resolver, krate];
  }

  // rustc: compiler/rustc_middle/src/ty/context.rs:2909 metadata_dep_node
  metadata_dep_node(): DepNode {
    // make_metadata(self)
    return unported("rustc_middle::dep_graph::dep_node::make_metadata (dep graph, D3)");
  }

  // rustc: compiler/rustc_middle/src/ty/context.rs:2913 needs_coroutine_by_move_body_def_id
  needs_coroutine_by_move_body_def_id(def_id: DefId): boolean {
    const k = this.coroutine_kind(def_id) as CoroutineKind | undefined;
    if (k !== undefined && k.$ === "Desugared" && k._1 === "Closure") {
      // && let ty::Coroutine(_, args) = self.type_of(def_id).instantiate_identity().skip_norm_wip().kind()
      // && args.as_coroutine().kind_ty().to_opt_closure_kind() != Some(ty::ClosureKind::FnOnce)
      return unported("rustc_type_ir::binder::EarlyBinder::instantiate_identity (binder.rs, lane tyir-binder)");
    } else {
      return false;
    }
  }

  /// Whether this is a trait implementation that has `#[diagnostic::do_not_recommend]`
  // rustc: compiler/rustc_middle/src/ty/context.rs:2927 do_not_recommend_impl
  do_not_recommend_impl(def_id: DefId): boolean {
    return find_attr(HasAttrs_DefId_get_attrs(def_id, this), (k) => (k.$ === "DoNotRecommend" ? null : undefined)) !== undefined;
  }

  // rustc: compiler/rustc_middle/src/ty/context.rs:2931 is_trivial_const
  is_trivial_const(def_id: IntoQueryKey<DefId>): boolean {
    const def_id_ = into_query_key_DefId(def_id);
    return this.trivial_const(def_id_) !== undefined;
  }

  /// Whether this def is one of the special bin crate entrypoint functions that must have a
  /// monomorphization and also not be internalized in the bin crate.
  // rustc: compiler/rustc_middle/src/ty/context.rs:2938 is_entrypoint
  is_entrypoint(def_id: DefId): boolean {
    if (this.is_lang_item(def_id, "Start")) {
      return true;
    }
    const entry = this.entry_fn(null);
    if (entry !== undefined && DefId_eq(entry[0], def_id)) {
      return true;
    }
    return false;
  }
}

// rustc's `Lift` (PORTING §3; see `TyCtxt::lift`):
// rustc-skip: compiler/rustc_middle/src/ty/context.rs:1672 lift_to_interner rustc's Lift impl (nop_lift!), PORTING §3
// rustc-skip: compiler/rustc_middle/src/ty/context.rs:1677 _intern_set_ty_from_interned_ty compile-time type check inside nop_lift! (Lift, PORTING §3)
// rustc-skip: compiler/rustc_middle/src/ty/context.rs:1682 _type_eq compile-time type check inside nop_lift! (Lift, PORTING §3)
// rustc-skip: compiler/rustc_middle/src/ty/context.rs:1683 _test compile-time type check inside nop_lift! (Lift, PORTING §3)
// rustc-skip: compiler/rustc_middle/src/ty/context.rs:1709 lift_to_interner rustc's Lift impl (nop_list_lift!), PORTING §3
// rustc-skip: compiler/rustc_middle/src/ty/context.rs:1739 lift_to_interner rustc's Lift impl (Interned<RegionKind>), PORTING §3
// rustc-skip: compiler/rustc_middle/src/ty/context.rs:1752 lift_to_interner rustc's Lift impl (Interned<WithCachedTypeInfo<ConstKind>>), PORTING §3

// `sty_debug_print!` (context.rs:1772): the `DebugStat` struct and `inner::go`, with the variant list as an argument.
interface DebugStat {
  total: number;
  lt_infer: number;
  ty_infer: number;
  ct_infer: number;
  all_infer: number;
}

// rustc: compiler/rustc_middle/src/ty/context.rs:1788 go
function sty_debug_print_go(fmt: Fmt, tcx: TyCtxt, variants: readonly TyKind["$"][]): string {
  void fmt;
  const total: DebugStat = { total: 0, lt_infer: 0, ty_infer: 0, ct_infer: 0, all_infer: 0 };
  const per_variant = new Map<string, DebugStat>(variants.map((v) => [v, { ...total }]));
  void [tcx, per_variant];

  // for shard in tcx.interners.type_.lock_shards() { for &(InternedInSet(t), ()) in shard.iter() { .. } }
  return unported("rustc_data_structures::sharded::Sharded::lock_shards (iterating an interner; TyCtxt::debug_stats)");
}

// This type holds a `T` in the interner. The `T` is stored in the arena and
// this type just holds a pointer to it, but it still effectively owns it. It
// impls `Borrow` so that it can be looked up using the original
// (non-arena-memory-owning) types.
// rustc-type: compiler/rustc_middle/src/ty/context.rs:1889 InternedInSet
// PORT (D2): the set stores the hash-consed object itself (no arena), and the `Borrow` / `PartialEq` / `Hash` impls
// below are what the canonical intern key realises: an `InternedSet` is keyed by `intern_key(borrow(x))`, so two
// entries are equal iff their borrowed forms have the same key. They are written out as functions over the stored
// object; the interners call `intern_key` on the borrowed value directly.
export const InternedInSet = {
  // rustc: compiler/rustc_middle/src/ty/context.rs:1892 clone
  clone<T>(self: T): T {
    return self;
  },

  // rustc: compiler/rustc_middle/src/ty/context.rs:1900 into_pointer
  /** PORT: the pointer is the object's identity. */
  into_pointer<T>(self: T): T {
    return self;
  },

  // `InternedInSet<WithCachedTypeInfo<T>>` (`Ty`, `Const`, `Predicate`: the kind is `internee`)
  // rustc: compiler/rustc_middle/src/ty/context.rs:1907 borrow
  borrow_WithCachedTypeInfo<T>(self: { internee: T }): T {
    return self.internee;
  },

  // rustc: compiler/rustc_middle/src/ty/context.rs:1913 eq
  eq_WithCachedTypeInfo<T>(self: { internee: T }, other: { internee: T }): boolean {
    // The `Borrow` trait requires that `x.borrow() == y.borrow()` equals
    // `x == y`.
    return intern_key(self.internee) === intern_key(other.internee);
  },

  // rustc: compiler/rustc_middle/src/ty/context.rs:1923 hash
  hash_WithCachedTypeInfo<T>(self: { internee: T }): string {
    // The `Borrow` trait requires that `x.borrow().hash(s) == x.hash(s)`.
    return intern_key(self.internee);
  },

  // `InternedInSet<List<T>>`
  // rustc: compiler/rustc_middle/src/ty/context.rs:1930 borrow
  borrow_List<T>(self: List<T>): readonly T[] {
    return self;
  },

  // rustc: compiler/rustc_middle/src/ty/context.rs:1936 eq
  eq_List<T>(self: List<T>, other: List<T>): boolean {
    // The `Borrow` trait requires that `x.borrow() == y.borrow()` equals
    // `x == y`.
    return intern_key([...self]) === intern_key([...other]);
  },

  // rustc: compiler/rustc_middle/src/ty/context.rs:1946 hash
  hash_List<T>(self: List<T>): string {
    // The `Borrow` trait requires that `x.borrow().hash(s) == x.hash(s)`.
    return intern_key([...self]);
  },

  // `InternedInSet<ListWithCachedTypeInfo<T>>` (`Clauses`)
  // rustc: compiler/rustc_middle/src/ty/context.rs:1953 borrow
  borrow_ListWithCachedTypeInfo<T>(self: ListWithCachedTypeInfo<T>): readonly T[] {
    return self;
  },

  // rustc: compiler/rustc_middle/src/ty/context.rs:1959 eq
  eq_ListWithCachedTypeInfo<T>(self: ListWithCachedTypeInfo<T>, other: ListWithCachedTypeInfo<T>): boolean {
    // The `Borrow` trait requires that `x.borrow() == y.borrow()` equals
    // `x == y`.
    return intern_key([...self]) === intern_key([...other]);
  },

  // rustc: compiler/rustc_middle/src/ty/context.rs:1969 hash
  hash_ListWithCachedTypeInfo<T>(self: ListWithCachedTypeInfo<T>): string {
    // The `Borrow` trait requires that `x.borrow().hash(s) == x.hash(s)`.
    return intern_key([...self]);
  },

  // `direct_interners!` (`InternedInSet<$ty>` for `RegionKind`, `ValTreeKind`, `PatternKind`, ...: the stored value is
  // the interned object, whose kind is its `internee` field (`Region`) or the object's own fields)
  // rustc: compiler/rustc_middle/src/ty/context.rs:1978 borrow
  borrow_direct<T>(self: { internee: T }): T {
    return self.internee;
  },

  // rustc: compiler/rustc_middle/src/ty/context.rs:1984 eq
  eq_direct<T>(self: { internee: T }, other: { internee: T }): boolean {
    // The `Borrow` trait requires that `x.borrow() == y.borrow()`
    // equals `x == y`.
    return intern_key(self.internee) === intern_key(other.internee);
  },

  // rustc: compiler/rustc_middle/src/ty/context.rs:1994 hash
  hash_direct<T>(self: { internee: T }): string {
    // The `Borrow` trait requires that `x.borrow().hash(s) ==
    // x.hash(s)`.
    return intern_key(self.internee);
  },
};


/// Create a new definition within the incr. comp. engine.
// rustc: compiler/rustc_middle/src/ty/context.rs:1302 create_def
export function TyCtxtAt_create_def(
  self: TyCtxtAt,
  parent: LocalDefId,
  name: Symbol | undefined,
  def_kind: DefKind,
  override_def_path_data: DefPathData | undefined,
  disambiguator: PerParentDisambiguatorState,
): TyCtxtFeed<LocalDefId> {
  const feed = self.tcx.create_def(parent, name, def_kind, override_def_path_data, disambiguator);

  feed.def_span(self.span);
  return feed;
}

/// See [TyCtxt] for details about this type.
export class GlobalCtxt {
  private data_layout_: unknown = undefined;
  private types_: CommonTypes | undefined = undefined;
  private lifetimes_: CommonLifetimes | undefined = undefined;
  private consts_: CommonConsts | undefined = undefined;
  private caches_: GlobalCaches | undefined = undefined;

  constructor(
    public sess: Session,
    public crate_types: CrateType[],
    /// The `stable_crate_id` is constructed out of the crate name and all the
    /// `-C metadata` arguments passed to the compiler. Its value forms a unique
    /// global identifier for the crate. It is used to allow multiple crates
    /// with the same name to coexist. See the
    /// `rustc_symbol_mangling` crate for more information.
    public stable_crate_id: StableCrateId,

    public interners: CtxtInterners,

    public incr_comp_session: undefined,
    public dep_graph: DepGraph,

    /// This duplicates `Session::prof` because this field is hot enough that accessing it via
    /// `self.sess.prof` is a measurable slowdown (see #161332).
    public prof: SelfProfilerRef,

    /// Hooks to be able to register functions in other crates that can then still
    /// be called from rustc_middle.
    public hooks: HookProviders,

    public untracked: Untracked,

    public query_system: QuerySystem,

    public current_gcx: CurrentGcx,
  ) {}

  /// Common types, pre-interned for your convenience.
  get types(): CommonTypes {
    // PORT: built on first read (module comment).
    if (this.types_ === undefined) this.types_ = CommonTypes.new(this.interners);
    return this.types_;
  }

  /// Common lifetimes, pre-interned for your convenience.
  get lifetimes(): CommonLifetimes {
    // PORT: built on first read (module comment).
    if (this.lifetimes_ === undefined) this.lifetimes_ = CommonLifetimes.new(this.interners);
    return this.lifetimes_;
  }

  /// Common consts, pre-interned for your convenience.
  get consts(): CommonConsts {
    // PORT: built on first read (module comment).
    if (this.consts_ === undefined) this.consts_ = CommonConsts.new(this.interners, this.types);
    return this.consts_;
  }

  get caches(): GlobalCaches {
    // PORT: `caches: Default::default()` runs on first read (GlobalCaches comment).
    if (this.caches_ === undefined) this.caches_ = GlobalCaches.default_();
    return this.caches_;
  }

  /// Data layout specification for the current target.
  get data_layout(): unknown {
    if (this.data_layout_ === undefined) {
      this.data_layout_ = unported("rustc_target::spec::Target::parse_data_layout (GlobalCtxt::data_layout; pending target-cfg / rustc_abi)");
    }
    return this.data_layout_;
  }

  /// Installs `self` in a `TyCtxt` and `ImplicitCtxt` for the duration of
  /// `f`.
  // rustc: compiler/rustc_middle/src/ty/context.rs:792 enter
  enter<R>(f: (tcx: TyCtxt) => R): R {
    const icx = ImplicitCtxt.new(this);

    // Set this `GlobalCtxt` as the current one.
    {
      assert(this.current_gcx.value === undefined, "no `GlobalCtxt` is currently set");
      this.current_gcx.value = this;
    }

    // Reset `current_gcx` to `None` when we exit.
    try {
      return enter_context(icx, () => f(icx.tcx));
    } finally {
      this.current_gcx.value = undefined;
    }
  }
}

/// This is used to get a reference to a `GlobalCtxt` if one is available.
///
/// This is needed to allow the deadlock handler access to `GlobalCtxt` to look for query cycles.
/// It cannot use the `TLV` global because that's only guaranteed to be defined on the thread
/// creating the `GlobalCtxt`. Other threads have access to the `TLV` only inside Rayon jobs, but
/// the deadlock handler is not called inside such a job.
export class CurrentGcx {
  /// This stores a pointer to a `GlobalCtxt`. This is set to `Some` inside `GlobalCtxt::enter`
  /// and reset to `None` when that function returns or unwinds.
  /** PORT: `Arc<RwLock<Option<*const ()>>>` -> the `GlobalCtxt` itself (single-threaded). */
  value: GlobalCtxt | undefined = undefined;

  // rustc: compiler/rustc_middle/src/ty/context.rs:831 new
  static new(): CurrentGcx {
    return new CurrentGcx();
  }

  // rustc: compiler/rustc_middle/src/ty/context.rs:835 access
  access<R>(f: (gcx: GlobalCtxt) => R): R {
    const gcx = this.value;
    if (gcx === undefined) panic("called `Option::unwrap()` on a `None` value");
    // SAFETY: We hold the read lock for the `GlobalCtxt` pointer. That prevents
    // `GlobalCtxt::enter` from returning as it would first acquire the write lock.
    // This ensures the `GlobalCtxt` is live during `f`.
    return f(gcx);
  }
}

// rustc: compiler/rustc_middle/src/ty/context.rs:2951 provide
export function provide(providers: import("../queries.gen.ts").Providers): void {
  // PORT: `find_attr!(tcx, crate, X)` is `find_attr(tcx.hir_krate_attrs(), ..)` (rustc_attr_ir lib.ts).
  providers.is_panic_runtime = (tcx, _local_crate) => find_attr(tcx.hir_krate_attrs(), (k) => (k.$ === "PanicRuntime" ? null : undefined)) !== undefined;
  providers.is_compiler_builtins = (tcx, _local_crate) => find_attr(tcx.hir_krate_attrs(), (k) => (k.$ === "CompilerBuiltins" ? null : undefined)) !== undefined;
  providers.has_panic_handler = (tcx, _local_crate) => {
    // We want to check if the panic handler was defined in this crate
    const did = tcx.lang_items().panic_impl();
    return did !== undefined && did.is_local();
  };
  providers.source_span = (tcx, def_id) => tcx.untracked().source_span[LocalDefId.index(def_id)] ?? DUMMY_SP;
}

/** PORT: `T::collect_and_apply(iter, f)` with the impl chosen by the caller (rustc_type_ir/interner.ts). */
function collect_and_apply<T, R>(iter: Iterable<unknown>, c: CollectAndApply_Result | undefined, f: (xs: readonly T[]) => R): unknown {
  return c === undefined ? CollectAndApply_T.collect_and_apply(iter as Iterable<T>, f) : c.collect_and_apply(iter as Iterable<Result<T, unknown>>, f);
}

/** `iter::once(x).chain(rest)` */
function* chain_once<T>(x: T, rest: Iterable<T>): Generator<T> {
  yield x;
  yield* rest;
}

/** `iter.chain(iter::once(x))` */
function* chain_end<T>(rest: Iterable<T>, x: T): Generator<T> {
  yield* rest;
  yield x;
}

/** PORT: `matches!(kind, DefKind::Impl { of_trait })`. */
function is_impl_of_trait(kind: DefKind, of_trait: boolean): boolean {
  return kind.$ === "Impl" && kind.of_trait === of_trait;
}

/** The `(def_id, is_self_args)` match shared by `check_alias_term_args_compatible` and
 * `debug_assert_alias_term_args_compatible` (context.rs:2167 / :2250). */
function alias_term_def_id_and_is_self_args(kind: AliasTermKind): [DefId, boolean] {
  switch (kind.$) {
    case "ProjectionTy":
    case "OpaqueTy":
    case "FreeTy":
    case "AnonConst":
    case "ProjectionConst":
    case "FreeConst":
    case "InherentConstImpl":
      return [kind.def_id, false];
    case "InherentTy":
    case "InherentConstSelf":
      return [kind.def_id, true];
  }
}

/**
 * PORT: rustc_middle/lint.ts is an extension module of `TyCtxt` (it assigns `TyCtxt.prototype`), so this defining
 * module must not import it (docs/handoff/ty-contract.md "Init order"); `emit_node_span_lint` / `emit_node_lint`
 * require it when they run, after every module has loaded.
 */
function middle_lint(): typeof import("../lint.ts") {
  return require("../lint.ts") as typeof import("../lint.ts");
}

// ---- stand-ins for fns of other upstream files that are not ported yet (not markers; repoint when they land) ----

/** PORT: stand-in for `impl HasAttrs for DefId` (ty/mod.rs:2349, lane ty-mod): the upstream body. */
function HasAttrs_DefId_get_attrs(self: DefId, tcx: TyCtxt): readonly Attribute_[] {
  const did = self.as_local();
  if (did !== undefined) {
    return tcx.hir_attrs(tcx.local_def_id_to_hir_id(did));
  } else {
    return tcx.attrs_for_def(self) as readonly Attribute_[];
  }
}

/** PORT: stand-in for `AssocItem::is_method` (ty/assoc.rs:156, lane ty-adt-assoc): the upstream body. */
function AssocItem_is_method(self: AssocItem): boolean {
  return self.kind.$ === "Fn" && self.kind.has_self === true;
}

/** PORT: stand-in for `GenericParamDef::to_early_bound_region_data` (ty/generics.rs, lane ty-args): the upstream body. */
function GenericParamDef_to_early_bound_region_data(self: GenericParamDef): EarlyParamRegion {
  if (self.kind.$ === "Lifetime") {
    return { index: self.index, name: self.name };
  } else {
    return panic("cannot convert a non-lifetime parameter def to an early bound region");
  }
}

/** PORT: stand-in for `Generics::own_args` (ty/generics.rs, lane ty-args). */
function Generics_own_args(_self: Generics, _args: GenericArgs): readonly GenericArg[] {
  return unported("rustc_middle::ty::generics::Generics::own_args (ty/generics.rs, lane ty-args)");
}

/** PORT: stand-in for `ExistentialPredicateStableCmpExt::stable_cmp` (ty/predicate.rs, lane ty-args). */
function ExistentialPredicate_stable_cmp(_self: unknown, _tcx: TyCtxt, _other: unknown): Ordering {
  return unported("rustc_middle::ty::predicate::ExistentialPredicateStableCmpExt::stable_cmp (ty/predicate.rs, lane ty-args)");
}

