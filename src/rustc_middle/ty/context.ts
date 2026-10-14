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
import { DefKind } from "../../rustc_hir/def.ts";
import type { DefKey, DefPath, DefPathData, Definitions, PerParentDisambiguatorState } from "../../rustc_hir_id/definitions.ts";
import { OwnerId } from "../../rustc_hir_id/lib.ts";
import type { Session } from "../../rustc_session/session.ts";
import type { SelfProfilerRef } from "../../rustc_session/stand_ins.ts";
import { CRATE_DEF_ID, type CrateNum, type DefId, type DefPathHash, LOCAL_CRATE, LocalDefId, LocalModId, type ModId, StableCrateId, debug_StableCrateId } from "../../rustc_span/def_id.ts";
import { DUMMY_SP, type Span } from "../../rustc_span/lib.ts";
import { Symbol } from "../../rustc_span/symbol.ts";
import type { CrateType } from "../../rustc_structures/lib.ts";
import type { Limit } from "../../rustc_structures/lib.ts";
import { PLAIN } from "../../std/fmt.ts";
import { assert, assert_eq, panic, unported } from "../../std/panic.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
import type { Steal } from "../../rustc_data_structures/steal.ts";
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
import type { ArgOutlivesClause, Binder, BoundVar, BoundVariableKind, CanonicalInputData, CanonicalVarKind, ConstKind, DebruijnIndex, EarlyBinder, ExternalConstraintsData, ImplPolarity, OpaqueTypeKey, PatternKind, PolyExistentialPredicate, PredicateKind, RegionKind, RegionVid, TraitRef, TyKind, TyVid, ValTreeKind } from "../../rustc_type_ir/decls.ts";
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
import { unported_methods } from "../../rust_ts/stubs.ts";

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

  /** Stub (`CommonConsts::new`, context.rs:532): needs `ValTree` + `ScalarInt::TRUE/FALSE` (lane ty-results). */
  static new(_interners: CtxtInterners, _types: CommonTypes): CommonConsts {
    return unported("rustc_middle::ty::context::CommonConsts::new (ValTree / ScalarInt, ty/consts)");
  }
}

/** `(0..n)` collected. */
function range(n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(i);
  return out;
}

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

  // rustc: compiler/rustc_middle/src/ty/context.rs:1394 definitions
  definitions(): Definitions {
    // Depend on the `analysis` query to ensure compilation if finished.
    this.ensure_ok().analysis(null);

    // Freeze definitions once we start iterating on them, to prevent adding new ones
    // while iterating. If some query needs to add definitions, it should be `ensure`d above.
    // PORT: `FreezeLock::freeze` is a no-op (PORTING §5: the lock is its inner value).
    return this.gcx.untracked.definitions;
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

  // rustc: compiler/rustc_middle/src/ty/context.rs:1603 local_visibility
  local_visibility(def_id: LocalDefId): Visibility<LocalModId> {
    return Visibility.expect_local(this.visibility(def_id));
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

  // rustc: compiler/rustc_middle/src/ty/context.rs:2138 mk_predicate
  mk_predicate(binder: Binder<PredicateKind>): Predicate {
    return this.interners.intern_predicate(binder);
  }

  // rustc: compiler/rustc_middle/src/ty/context.rs:2143 reuse_or_mk_predicate
  reuse_or_mk_predicate(pred: Predicate, binder: Binder<PredicateKind>): Predicate {
    // PORT: `pred.kind() != binder` is the derived `PartialEq` of `Binder<PredicateKind>`: the intern key.
    return intern_key(pred.kind()) !== intern_key(binder) ? this.mk_predicate(binder) : pred;
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

  /** Stub (`mk_poly_existential_predicates`, context.rs:2422): its `assert!` needs `stable_cmp` (predicate.rs). */
  mk_poly_existential_predicates(_eps: readonly PolyExistentialPredicate[]): List<PolyExistentialPredicate> {
    return unported("rustc_middle::ty::context::TyCtxt::mk_poly_existential_predicates (stable_cmp)");
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
}

// PORT: the inherent `TyCtxt` methods of context.rs that serve `impl Interner for TyCtxt` (impl_interner.rs) and are
// not ported yet (lane ty-ctxt). Placeholders so the generic rustc_type_ir code that calls them through the
// `Interner` (e.g. `AliasTy::new_projection_from_args`, `IsRigid::yes_if_next_solver`) stops as UNPORTED instead of a
// TypeError (merge-w14). contract.test.ts still counts them as missing.
unported_methods(TyCtxt.prototype, "rustc_middle::ty::context::TyCtxt", [
  "assumptions_on_binders",
  "check_alias_term_args_compatible",
  "coroutine_is_async",
  "coroutine_is_async_gen",
  "coroutine_is_gen",
  "coroutine_movability",
  "debug_assert_alias_term_args_compatible",
  "debug_assert_args_compatible",
  "is_default_trait",
  "is_general_coroutine",
  "is_impl_trait_in_trait",
  "is_sizedness_trait",
  "next_trait_solver_globally",
  "renormalize_rigid_aliases",
]);


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
  providers.is_panic_runtime = (_tcx, _local_crate) => unported("rustc_middle::ty::context::provide: is_panic_runtime (`find_attr!(tcx, crate, PanicRuntime)`, pending attribute parsing)");
  providers.is_compiler_builtins = (_tcx, _local_crate) => unported("rustc_middle::ty::context::provide: is_compiler_builtins (`find_attr!(tcx, crate, CompilerBuiltins)`, pending attribute parsing)");
  providers.has_panic_handler = (_tcx, _local_crate) => {
    // We want to check if the panic handler was defined in this crate
    return unported("rustc_middle::ty::context::provide: has_panic_handler (`tcx.lang_items().panic_impl()`, pending lang items)");
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
