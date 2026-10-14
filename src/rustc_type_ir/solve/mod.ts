// Port of compiler/rustc_type_ir/src/solve/mod.rs (lane tyir-solve). The types with their derived Debug /
// TypeVisitable / TypeFoldable impls are generated into mod.gen.ts (set rustc_ty of tools/codegen/types.ts, lane
// codegen-tyir); this file ports the fns and manual impls.
//
// PORT (tyir-kind decision 1, PORTING §8): methods of generated enums and structs live on a same-named companion
// const that spreads the generated one (`SmallCopySet`, `RerunCondition`, `AccessedOpaques`, `Goal`,
// `CandidatePreferenceMode`, `Response`, `ExternalRegionConstraints`, `ExternalConstraintsData`,
// `VisibleForLeakCheck`, `NestedNormalizationGoals`, `MaybeInfo`, `OpaqueTypesJank`, `StalledOnCoroutines`,
// `Certainty`, `MaybeCause`, `SizedTraitKind`, `TyOrConstInferVar`); `self` is the first parameter.
// PORT (D3): `I: Interner` is erased; `cx: I` is `Interner`, except where the body needs rustc_middle's inherent API
// (`I::Ty::new_var`, typed `TyCtxt`).
// PORT: `debug!` (tracing) lines are kept as comments; the oracle never enables them.
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { GenericArg, type GenericArgs } from "../../rustc_middle/ty/generic_args.ts";
import { Term, Ty } from "../../rustc_middle/ty/mod.ts";
import type { LocalDefId } from "../../rustc_span/def_id.ts";
import type { DefId } from "../../rustc_span/def_id.ts";
import { unported, unreachable } from "../../std/panic.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
import type { Interner } from "../interner.ts";
import { SolverTraitLangItem } from "../lang_items.ts";
import { BoundVar } from "../lib.ts";
import type { RegionConstraint as region_constraint_RegionConstraint } from "../region_constraint.ts";
import type { Const } from "../sty/consts.ts";
import * as gen from "./mod.gen.ts";
import type { NoSolution, RerunNonErased, RerunReason } from "./mod.gen.ts";

export * from "./mod.gen.ts";


// ---- PORT stand-ins for fns of other rustc_type_ir files that are not ported yet ----------------------------------

/** PORT: stand-in for `RegionConstraint::new_true` (region_constraint.rs:495, not ported yet). */
function RegionConstraint_new_true(): region_constraint_RegionConstraint {
  return unported("rustc_type_ir::region_constraint::RegionConstraint::new_true");
}

/** PORT: stand-in for `RegionConstraint::is_true` (region_constraint.rs:499, not ported yet). */
function RegionConstraint_is_true(_self: region_constraint_RegionConstraint): boolean {
  return unported("rustc_type_ir::region_constraint::RegionConstraint::is_true");
}

/** PORT: `impl Upcast<I, P>` (upcast.rs, `predicate.upcast(cx)`) is passed as the function doing the upcast
 * (D4-style: the trait impl as a parameter, last). */
export type UpcastFn<T, P> = (self: T, interner: Interner) => P;

// ---- RerunResultExt ------------------------------------------------------------------------------------------------

export interface RerunResultExt<T> {
  // rustc: compiler/rustc_type_ir/src/solve/mod.rs:41 map_err_to_rerun
  map_err_to_rerun(self: Result<T, NoSolutionOrRerunNonErased>): Result<Result<T, NoSolution>, RerunNonErased>;
}

/** `impl<T> RerunResultExt<T> for Result<T, NoSolutionOrRerunNonErased>` */
export const RerunResultExt_for_Result = {
  // rustc: compiler/rustc_type_ir/src/solve/mod.rs:45 map_err_to_rerun
  map_err_to_rerun<T>(self: Result<T, NoSolutionOrRerunNonErased>): Result<Result<T, NoSolution>, RerunNonErased> {
    if (self.$ === "Ok") {
      return Ok(Ok(self._0));
    } else if (self._0.$ === "NoSolution") {
      return Ok(Err(self._0._0));
    } else {
      return Err(self._0._0);
    }
  },
};

export type NoSolutionOrRerunNonErased = gen.NoSolutionOrRerunNonErased;
export const NoSolutionOrRerunNonErased = {
  // impl From<NoSolution> for NoSolutionOrRerunNonErased
  // rustc: compiler/rustc_type_ir/src/solve/mod.rs:72 from
  from_NoSolution(value: NoSolution): NoSolutionOrRerunNonErased {
    return { $: "NoSolution", _0: value };
  },

  // impl From<RerunNonErased> for NoSolutionOrRerunNonErased
  // rustc: compiler/rustc_type_ir/src/solve/mod.rs:78 from
  from_RerunNonErased(value: RerunNonErased): NoSolutionOrRerunNonErased {
    return { $: "RerunNonErased", _0: value };
  },
};

// ---- SmallCopySet --------------------------------------------------------------------------------------------------

// PORT: `T: Eq` — `SmallCopySet` is only instantiated with `I::LocalDefId` (a branded number), so `==` is `===`.
export type SmallCopySet<T> = gen.SmallCopySet<T>;
export const SmallCopySet = {
  ...gen.SmallCopySet,

  // rustc: compiler/rustc_type_ir/src/solve/mod.rs:98 empty
  empty<T>(): SmallCopySet<T> {
    return SmallCopySet.Empty;
  },

  // rustc: compiler/rustc_type_ir/src/solve/mod.rs:102 new
  new<T>(first: T): SmallCopySet<T> {
    return { $: "One", _0: [first] };
  },

  /// Computes the union of two lists. Duplicates are removed.
  ///
  /// Since the set can hold at most 3 elements, returns `None` if the resulting set cannot be
  /// represented.
  ///
  /// In the context of [`RerunCondition`], this means we fall back to rerunning unconditionally.
  /// This can be beneficial, since at some point, tracking all the conditions under which a query
  /// has to be rerun becomes slower than just rerunning unconditionally. This is especially so,
  /// since as long as rerun conditions are tracked, we keep executing the current query. As soon as
  /// we cannot track anymore, and unconditionally rerun, we also abort the current query.
  /// By at some point opting to abort early, we may save a lot of time skipping further work
  /// that will have to likely be redone anyway.
  ///
  /// note that *not* all cases are handled. you can union two lists of two elements with equal
  /// elements, and still get `none` back. checking for all cases is more work than just rerunning
  /// in some cases.
  // rustc: compiler/rustc_type_ir/src/solve/mod.rs:122 union
  union<T>(self: SmallCopySet<T>, other: SmallCopySet<T>): SmallCopySet<T> | undefined {
    // (Self::Empty, other) | (other, Self::Empty) => Some(other)
    if (self.$ === "Empty") return other;
    if (other.$ === "Empty") return self;

    if (self.$ === "One" && other.$ === "One") {
      const [a] = self._0 as [T];
      const [b] = other._0 as [T];
      if (a === b) return { $: "One", _0: [a] };
      return { $: "Two", _0: [a, b] };
    }
    // (Self::One([a]), Self::Two([b, c])) | (Self::Two([a, b]), Self::One([c]))
    let abc: [T, T, T] | undefined;
    if (self.$ === "One" && other.$ === "Two") {
      abc = [self._0[0]!, other._0[0]!, other._0[1]!];
    } else if (self.$ === "Two" && other.$ === "One") {
      abc = [self._0[0]!, self._0[1]!, other._0[0]!];
    }
    if (abc !== undefined) {
      const [a, b, c] = abc;
      if (a === b && b === c) {
        return { $: "One", _0: [a] };
      }
      if (a === b) {
        return { $: "Two", _0: [a, c] };
      }
      if (a === c) {
        return { $: "Two", _0: [a, b] };
      }
      if (b === c) {
        return { $: "Two", _0: [a, b] };
      }
      return { $: "Three", _0: [a, b, c] };
    }
    // There are some more cases we could handle, like 2 + 2 => 3 if there's one duplicate,
    // But the check seems to be more expensive than the gain. Even then, the difference is
    // tiny, and could just be noise. Not worth it regardless.
    return undefined;
  },

  // impl AsRef<[T]> for SmallCopySet<T>
  // rustc: compiler/rustc_type_ir/src/solve/mod.rs:154 as_ref
  as_ref<T>(self: SmallCopySet<T>): readonly T[] {
    switch (self.$) {
      case "Empty":
        return [];
      case "One":
        return self._0;
      case "Two":
        return self._0;
      case "Three":
        return self._0;
    }
  },
};

// ---- RerunCondition ------------------------------------------------------------------------------------------------

export type RerunCondition = gen.RerunCondition;
export const RerunCondition = {
  ...gen.RerunCondition,

  /// Merge two rerun states according to the following transition diagram
  /// (some cells are empty because the table is symmetric, i.e. `a.merge(b)` == `b.merge(a)`).
  ///
  /// - "self" here means the current state, i.e. the state of the current column
  /// - square brackets represents that this is a list of things. Even if the state doesn't
  /// change, we might grow the list to effectively end up in a different state anyway
  /// - `[o. in s.]` abbreviates "opaque in storage"
  ///
  ///
  /// |                                 | never  | always | [opaque in storage] | opaque has infer as hidden | [o. in s.] or i. as hidden |
  /// | ------------------------------- | ------ | ------ | ------------------- | -------------------------- | -------------------------- |
  /// | never                           | self   | self   | self                | self                       | self                       |
  /// | always                          |        | always | always              | always                     | always                     |
  /// | [opaque in storage]             |        |        | concat self         | [o. in s.] or i. as hidden | concat to self             |
  /// | opaque has infer as hidden type |        |        |                     | self                       | to self                    |
  ///
  // rustc: compiler/rustc_type_ir/src/solve/mod.rs:218 merge
  merge(self: RerunCondition, other: RerunCondition): RerunCondition {
    const merged = ((): RerunCondition => {
      // (Self::Never, other) | (other, Self::Never) => other
      if (self.$ === "Never") return other;
      if (other.$ === "Never") return self;
      if (self.$ === "Always" || other.$ === "Always") return RerunCondition.Always;

      if (self.$ === "OpaqueInStorage" && other.$ === "OpaqueInStorage") {
        const u = SmallCopySet.union(self._0, other._0);
        return u !== undefined ? { $: "OpaqueInStorage", _0: u } : RerunCondition.Always;
      }
      if (self.$ === "AnyOpaqueHasInferAsHidden" && other.$ === "AnyOpaqueHasInferAsHidden") {
        return RerunCondition.AnyOpaqueHasInferAsHidden;
      }
      if (self.$ === "AnyOpaqueHasInferAsHidden" && other.$ === "OpaqueInStorageOrAnyOpaqueHasInferAsHidden") {
        return { $: "OpaqueInStorage", _0: other._0 };
      }
      if (self.$ === "OpaqueInStorageOrAnyOpaqueHasInferAsHidden" && other.$ === "AnyOpaqueHasInferAsHidden") {
        return { $: "OpaqueInStorage", _0: self._0 };
      }

      if (
        self.$ === "OpaqueInStorageOrAnyOpaqueHasInferAsHidden" &&
        other.$ === "OpaqueInStorageOrAnyOpaqueHasInferAsHidden"
      ) {
        const u = SmallCopySet.union(self._0, other._0);
        return u !== undefined ? { $: "OpaqueInStorageOrAnyOpaqueHasInferAsHidden", _0: u } : RerunCondition.Always;
      }

      // (Self::OpaqueInStorage(a), Self::OpaqueInStorageOrAnyOpaqueHasInferAsHidden(b))
      // | (Self::OpaqueInStorageOrAnyOpaqueHasInferAsHidden(b), Self::OpaqueInStorage(a)) => a.union(b)
      if (self.$ === "OpaqueInStorage" && other.$ === "OpaqueInStorageOrAnyOpaqueHasInferAsHidden") {
        const u = SmallCopySet.union(self._0, other._0);
        return u !== undefined ? { $: "OpaqueInStorageOrAnyOpaqueHasInferAsHidden", _0: u } : RerunCondition.Always;
      }
      if (self.$ === "OpaqueInStorageOrAnyOpaqueHasInferAsHidden" && other.$ === "OpaqueInStorage") {
        const u = SmallCopySet.union(other._0, self._0);
        return u !== undefined ? { $: "OpaqueInStorageOrAnyOpaqueHasInferAsHidden", _0: u } : RerunCondition.Always;
      }

      // (Self::OpaqueInStorage(a), Self::AnyOpaqueHasInferAsHidden)
      // | (Self::AnyOpaqueHasInferAsHidden, Self::OpaqueInStorage(a))
      if (self.$ === "OpaqueInStorage" && other.$ === "AnyOpaqueHasInferAsHidden") {
        return { $: "OpaqueInStorageOrAnyOpaqueHasInferAsHidden", _0: self._0 };
      }
      if (self.$ === "AnyOpaqueHasInferAsHidden" && other.$ === "OpaqueInStorage") {
        return { $: "OpaqueInStorageOrAnyOpaqueHasInferAsHidden", _0: other._0 };
      }
      return unreachable();
    })();
    // debug!("merging rerun state {self:?} + {other:?} => {merged:?}");
    return merged;
  },

  // rustc: compiler/rustc_type_ir/src/solve/mod.rs:262 should_bail
  should_bail(self: RerunCondition): Result<null, RerunNonErased> {
    switch (self.$) {
      case "Always":
        return Err({ _0: null });
      case "Never":
      case "OpaqueInStorage":
      case "OpaqueInStorageOrAnyOpaqueHasInferAsHidden":
      case "AnyOpaqueHasInferAsHidden":
        return Ok(null);
    }
  },

  /// Returns true when any access of opaques was attempted.
  /// i.e. when `self != Self::Never`
  // rustc: compiler/rustc_type_ir/src/solve/mod.rs:275 might_rerun
  might_rerun(self: RerunCondition): boolean {
    switch (self.$) {
      case "Never":
        return false;
      case "Always":
      case "OpaqueInStorageOrAnyOpaqueHasInferAsHidden":
      case "OpaqueInStorage":
      case "AnyOpaqueHasInferAsHidden":
        return true;
    }
  },
};

// ---- AccessedOpaques -----------------------------------------------------------------------------------------------

export type AccessedOpaques = gen.AccessedOpaques;
export const AccessedOpaques = {
  // impl Default for AccessedOpaques
  // rustc: compiler/rustc_type_ir/src/solve/mod.rs:314 default
  default_(): AccessedOpaques {
    return { reason: undefined, rerun: RerunCondition.Never };
  },

  // rustc: compiler/rustc_type_ir/src/solve/mod.rs:320 update
  update(self: AccessedOpaques, other: AccessedOpaques): Result<null, RerunNonErased> {
    // `*self = Self { .. }`: both fields are computed from the old values before either is written.
    const reason = other.reason ?? self.reason;
    const rerun = RerunCondition.merge(self.rerun, other.rerun);
    // prefer the newest reason
    self.reason = reason;
    // merging accessed states can only result in MultipleOrUnknown
    self.rerun = rerun;

    return AccessedOpaques.should_bail(self);
  },

  // rustc: compiler/rustc_type_ir/src/solve/mod.rs:332 might_rerun
  might_rerun(self: AccessedOpaques): boolean {
    return RerunCondition.might_rerun(self.rerun);
  },

  // rustc: compiler/rustc_type_ir/src/solve/mod.rs:337 should_bail
  should_bail(self: AccessedOpaques): Result<null, RerunNonErased> {
    return RerunCondition.should_bail(self.rerun);
  },

  // PORT: `Result<Infallible, RerunNonErased>`: the `Ok` side is uninhabited (`never`).
  // rustc: compiler/rustc_type_ir/src/solve/mod.rs:341 rerun_always
  rerun_always(self: AccessedOpaques, reason: RerunReason): Result<never, RerunNonErased> {
    // debug!("set rerun always");
    const r = AccessedOpaques.update(self, { reason, rerun: RerunCondition.Always });
    if (r.$ === "Ok") {
      return unreachable();
    } else {
      return Err(r._0);
    }
  },

  // rustc: compiler/rustc_type_ir/src/solve/mod.rs:349 rerun_if_in_post_analysis
  rerun_if_in_post_analysis(self: AccessedOpaques, reason: RerunReason): Result<null, RerunNonErased> {
    // debug!("set rerun if post analysis");
    return AccessedOpaques.update(self, {
      reason,
      rerun: { $: "OpaqueInStorage", _0: SmallCopySet.empty() },
    });
  },

  // rustc: compiler/rustc_type_ir/src/solve/mod.rs:357 rerun_if_opaque_in_opaque_type_storage
  rerun_if_opaque_in_opaque_type_storage(
    self: AccessedOpaques,
    reason: RerunReason,
    defid: LocalDefId,
  ): Result<null, RerunNonErased> {
    // debug!("set rerun if opaque type {defid:?} in storage");
    return AccessedOpaques.update(self, {
      reason,
      // `defid.into()`: `I::LocalOpaqueTyId` is `LocalDefId` (interner.ts header).
      rerun: { $: "OpaqueInStorage", _0: SmallCopySet.new(defid) },
    });
  },

  // rustc: compiler/rustc_type_ir/src/solve/mod.rs:369 rerun_if_any_opaque_has_infer_as_hidden_type
  rerun_if_any_opaque_has_infer_as_hidden_type(self: AccessedOpaques, reason: RerunReason): Result<null, RerunNonErased> {
    // debug!("set rerun if any opaque in the storage has a hidden type that is an infer var");
    return AccessedOpaques.update(self, {
      reason,
      rerun: RerunCondition.AnyOpaqueHasInferAsHidden,
    });
  },
};

// ---- Goal ----------------------------------------------------------------------------------------------------------

export type Goal<P> = gen.Goal<P>;
export const Goal = {
  // PORT: `predicate: impl Upcast<I, P>` is `predicate` plus its `upcast` (last parameter).
  // rustc: compiler/rustc_type_ir/src/solve/mod.rs:401 new
  new<P, T>(cx: Interner, param_env: gen.Goal<P>["param_env"], predicate: T, upcast: UpcastFn<T, P>): Goal<P> {
    return { param_env, predicate: upcast(predicate, cx) };
  },

  /// Updates the goal to one with a different `predicate` but the same `param_env`.
  // rustc: compiler/rustc_type_ir/src/solve/mod.rs:406 with
  with<P, Q, T>(self: Goal<P>, cx: Interner, predicate: T, upcast: UpcastFn<T, Q>): Goal<Q> {
    return { param_env: self.param_env, predicate: upcast(predicate, cx) };
  },
};

// ---- CandidatePreferenceMode ---------------------------------------------------------------------------------------

export type CandidatePreferenceMode = gen.CandidatePreferenceMode;
export const CandidatePreferenceMode = {
  ...gen.CandidatePreferenceMode,

  /// Given `trait_def_id`, which candidate preference mode should be used?
  // rustc: compiler/rustc_type_ir/src/solve/mod.rs:463 compute
  compute(cx: Interner, trait_id: DefId): CandidatePreferenceMode {
    const is_sizedness_or_auto_or_default_goal =
      cx.is_sizedness_trait(trait_id) || cx.trait_is_auto(trait_id) || cx.is_default_trait(trait_id);
    if (is_sizedness_or_auto_or_default_goal) {
      return CandidatePreferenceMode.Marker;
    } else {
      return CandidatePreferenceMode.Default;
    }
  },
};

// ---- Response ------------------------------------------------------------------------------------------------------

export type Response = gen.Response;
export const Response = {
  // rustc: compiler/rustc_type_ir/src/solve/mod.rs:596 is_identity
  is_identity(self: Response): boolean {
    const var_values: GenericArgs = self.var_values;
    return var_values.every((arg, bv) => {
      const k = GenericArg.kind(arg);
      switch (k.$) {
        case "Lifetime": {
          const r = k._0.kind();
          return r.$ === "ReBound" && r._0.$ === "Canonical" && BoundVar.as_usize(r._1.var) === bv;
        }
        case "Type": {
          const ty = k._0.kind();
          return ty.$ === "Bound" && ty._0.$ === "Canonical" && BoundVar.as_usize(ty._1.var) === bv;
        }
        case "Const": {
          const ct = k._0.kind();
          return ct.$ === "Bound" && ct._0.$ === "Canonical" && BoundVar.as_usize(ct._1.var) === bv;
        }
      }
    });
  },

  // rustc: compiler/rustc_type_ir/src/solve/mod.rs:610 is_identity_modulo_regions
  is_identity_modulo_regions(self: Response): boolean {
    let var_ = BoundVar.ZERO;
    for (const arg of self.var_values) {
      const k = GenericArg.kind(arg);
      switch (k.$) {
        case "Lifetime": {
          const r = k._0.kind();
          if (r.$ === "ReBound" && r._0.$ === "Canonical" && var_ === r._1.var) {
            var_ = BoundVar.from_usize(var_ + 1);
          } else {
            // It's ok if this region var isn't an identity variable
          }
          break;
        }
        case "Type": {
          const ty = k._0.kind();
          if (ty.$ === "Bound" && ty._0.$ === "Canonical" && var_ === ty._1.var) {
            var_ = BoundVar.from_usize(var_ + 1);
          } else {
            return false;
          }
          break;
        }
        case "Const": {
          const ct = k._0.kind();
          if (ct.$ === "Bound" && ct._0.$ === "Canonical" && var_ === ct._1.var) {
            var_ = BoundVar.from_usize(var_ + 1);
          } else {
            return false;
          }
          break;
        }
      }
    }

    return true;
  },
};

// ---- ExternalRegionConstraints / ExternalConstraintsData -----------------------------------------------------------

export type ExternalRegionConstraints = gen.ExternalRegionConstraints;
export const ExternalRegionConstraints = {
  // rustc: compiler/rustc_type_ir/src/solve/mod.rs:659 is_empty
  is_empty(self: ExternalRegionConstraints): boolean {
    switch (self.$) {
      case "Old":
        return self._0.length === 0;
      case "NextGen":
        return RegionConstraint_is_true(self._0);
    }
  },
};

export type ExternalConstraintsData = gen.ExternalConstraintsData;
export const ExternalConstraintsData = {
  // rustc: compiler/rustc_type_ir/src/solve/mod.rs:680 new
  new(cx: Interner): ExternalConstraintsData {
    let region_constraints: ExternalRegionConstraints;
    if (cx.assumptions_on_binders()) {
      region_constraints = { $: "NextGen", _0: RegionConstraint_new_true() };
    } else {
      region_constraints = { $: "Old", _0: [] };
    }

    return {
      region_constraints,
      opaque_types: [],
      normalization_nested_goals: NestedNormalizationGoals.default_(),
    };
  },

  // rustc: compiler/rustc_type_ir/src/solve/mod.rs:693 is_empty
  is_empty(self: ExternalConstraintsData): boolean {
    const { region_constraints, opaque_types, normalization_nested_goals } = self;
    return (
      ExternalRegionConstraints.is_empty(region_constraints) &&
      opaque_types.length === 0 &&
      NestedNormalizationGoals.is_empty(normalization_nested_goals)
    );
  },
};

// ---- VisibleForLeakCheck -------------------------------------------------------------------------------------------

export type VisibleForLeakCheck = gen.VisibleForLeakCheck;
export const VisibleForLeakCheck = {
  ...gen.VisibleForLeakCheck,

  // rustc: compiler/rustc_type_ir/src/solve/mod.rs:719 and
  and(self: VisibleForLeakCheck, other: VisibleForLeakCheck): VisibleForLeakCheck {
    // Make sure that we never overwrite that constraints shouldn't
    // be encountered by the leak checked
    if (self === "Unreachable" || other === "Unreachable") {
      return "Unreachable";
    }
    if (self === "No" || other === "No") return "No";
    // (VisibleForLeakCheck::Yes, VisibleForLeakCheck::Yes)
    return "Yes";
  },

  // rustc: compiler/rustc_type_ir/src/solve/mod.rs:731 or
  or(self: VisibleForLeakCheck, other: VisibleForLeakCheck): VisibleForLeakCheck {
    // Make sure that we never overwrite that constraints shouldn't
    // be encountered by the leak checked
    if (self === "Unreachable" || other === "Unreachable") {
      return "Unreachable";
    }
    if (self === "Yes" || other === "Yes") {
      return "Yes";
    }
    // (VisibleForLeakCheck::No, VisibleForLeakCheck::No)
    return "No";
  },
};

// ---- NestedNormalizationGoals --------------------------------------------------------------------------------------

export type NestedNormalizationGoals = gen.NestedNormalizationGoals;
export const NestedNormalizationGoals = {
  /** `#[derive_where(Default)]` */
  default_(): NestedNormalizationGoals {
    return { _0: [] };
  },

  // rustc: compiler/rustc_type_ir/src/solve/mod.rs:754 empty
  empty(): NestedNormalizationGoals {
    return { _0: [] };
  },

  // rustc: compiler/rustc_type_ir/src/solve/mod.rs:758 is_empty
  is_empty(self: NestedNormalizationGoals): boolean {
    return self._0.length === 0;
  },
};

// ---- MaybeInfo / OpaqueTypesJank / StalledOnCoroutines / Certainty / MaybeCause ------------------------------------

export type MaybeInfo = gen.MaybeInfo;
export const MaybeInfo = {
  AMBIGUOUS: Object.freeze<MaybeInfo>({
    cause: gen.MaybeCause.Ambiguity,
    opaque_types_jank: "AllGood",
    stalled_on_coroutines: "No",
  }),

  // rustc: compiler/rustc_type_ir/src/solve/mod.rs:785 and
  and(self: MaybeInfo, other: MaybeInfo): MaybeInfo {
    return {
      cause: MaybeCause.and(self.cause, other.cause),
      opaque_types_jank: OpaqueTypesJank.and(self.opaque_types_jank, other.opaque_types_jank),
      stalled_on_coroutines: StalledOnCoroutines.and(self.stalled_on_coroutines, other.stalled_on_coroutines),
    };
  },

  // rustc: compiler/rustc_type_ir/src/solve/mod.rs:793 or
  or(self: MaybeInfo, other: MaybeInfo): MaybeInfo {
    return {
      cause: MaybeCause.or(self.cause, other.cause),
      opaque_types_jank: OpaqueTypesJank.or(self.opaque_types_jank, other.opaque_types_jank),
      stalled_on_coroutines: StalledOnCoroutines.or(self.stalled_on_coroutines, other.stalled_on_coroutines),
    };
  },
};

export type OpaqueTypesJank = gen.OpaqueTypesJank;
export const OpaqueTypesJank = {
  ...gen.OpaqueTypesJank,

  // rustc: compiler/rustc_type_ir/src/solve/mod.rs:837 and
  and(self: OpaqueTypesJank, other: OpaqueTypesJank): OpaqueTypesJank {
    if (self === "AllGood" && other === "AllGood") return "AllGood";
    // (OpaqueTypesJank::ErrorIfRigidSelfTy, _) | (_, OpaqueTypesJank::ErrorIfRigidSelfTy)
    return "ErrorIfRigidSelfTy";
  },

  // rustc: compiler/rustc_type_ir/src/solve/mod.rs:846 or
  or(self: OpaqueTypesJank, other: OpaqueTypesJank): OpaqueTypesJank {
    if (self === "ErrorIfRigidSelfTy" && other === "ErrorIfRigidSelfTy") {
      return "ErrorIfRigidSelfTy";
    }
    // (OpaqueTypesJank::AllGood, _) | (_, OpaqueTypesJank::AllGood)
    return "AllGood";
  },
};

export type StalledOnCoroutines = gen.StalledOnCoroutines;
export const StalledOnCoroutines = {
  ...gen.StalledOnCoroutines,

  // rustc: compiler/rustc_type_ir/src/solve/mod.rs:866 and
  and(self: StalledOnCoroutines, other: StalledOnCoroutines): StalledOnCoroutines {
    if (self === "No" && other === "No") return "No";
    // (StalledOnCoroutines::Yes, _) | (_, StalledOnCoroutines::Yes)
    return "Yes";
  },

  // rustc: compiler/rustc_type_ir/src/solve/mod.rs:875 or
  or(self: StalledOnCoroutines, other: StalledOnCoroutines): StalledOnCoroutines {
    // `StalledOnCoroutines::Yes` is contagious: obtaining `Certainty::Maybe`
    // while a candidate is stalled on a coroutine might have been
    // `Certainty::Yes` or `NoSolution` if it were not stalled.
    return StalledOnCoroutines.and(self, other);
  },
};

export type Certainty = gen.Certainty;
export const Certainty = {
  ...gen.Certainty,

  AMBIGUOUS: Object.freeze<Certainty>({ $: "Maybe", _0: MaybeInfo.AMBIGUOUS }),

  /// Use this function to merge the certainty of multiple nested subgoals.
  ///
  /// Given an impl like `impl<T: Foo + Bar> Baz for T {}`, we have 2 nested
  /// subgoals whenever we use the impl as a candidate: `T: Foo` and `T: Bar`.
  /// If evaluating `T: Foo` results in ambiguity and `T: Bar` results in
  /// success, we merge these two responses. This results in ambiguity.
  ///
  /// If we unify ambiguity with overflow, we return overflow. This doesn't matter
  /// inside of the solver as we do not distinguish ambiguity from overflow. It does
  /// however matter for diagnostics. If `T: Foo` resulted in overflow and `T: Bar`
  /// in ambiguity without changing the inference state, we still want to tell the
  /// user that `T: Baz` results in overflow.
  // rustc: compiler/rustc_type_ir/src/solve/mod.rs:898 and
  and(self: Certainty, other: Certainty): Certainty {
    if (self.$ === "Yes" && other.$ === "Yes") return Certainty.Yes;
    if (self.$ === "Yes" && other.$ === "Maybe") return other;
    if (self.$ === "Maybe" && other.$ === "Yes") return self;
    // (Certainty::Maybe(a_maybe), Certainty::Maybe(b_maybe))
    const a_maybe = (self as { _0: MaybeInfo })._0;
    const b_maybe = (other as { _0: MaybeInfo })._0;
    return { $: "Maybe", _0: MaybeInfo.and(a_maybe, b_maybe) };
  },

  // rustc: compiler/rustc_type_ir/src/solve/mod.rs:909 overflow
  overflow(suggest_increasing_limit: boolean): Certainty {
    return {
      $: "Maybe",
      _0: {
        cause: { $: "Overflow", suggest_increasing_limit, keep_constraints: false },
        opaque_types_jank: "AllGood",
        stalled_on_coroutines: "No",
      },
    };
  },

  // rustc: compiler/rustc_type_ir/src/solve/mod.rs:917 is_yes
  is_yes(self: Certainty): boolean {
    switch (self.$) {
      case "Yes":
        return true;
      case "Maybe":
        return false;
    }
  },

  // rustc: compiler/rustc_type_ir/src/solve/mod.rs:924 is_overflow
  is_overflow(self: Certainty): boolean {
    if (self.$ === "Maybe" && self._0.cause.$ === "Overflow") {
      return true;
    }
    return false;
  },
};

export type MaybeCause = gen.MaybeCause;
export const MaybeCause = {
  ...gen.MaybeCause,

  // rustc: compiler/rustc_type_ir/src/solve/mod.rs:945 and
  and(self: MaybeCause, other: MaybeCause): MaybeCause {
    if (self.$ === "Ambiguity" && other.$ === "Ambiguity") return MaybeCause.Ambiguity;
    if (self.$ === "Ambiguity" && other.$ === "Overflow") return other;
    if (self.$ === "Overflow" && other.$ === "Ambiguity") return self;
    const { suggest_increasing_limit: limit_a, keep_constraints: keep_a } = self as Extract<MaybeCause, { $: "Overflow" }>;
    const { suggest_increasing_limit: limit_b, keep_constraints: keep_b } = other as Extract<MaybeCause, { $: "Overflow" }>;
    return {
      $: "Overflow",
      suggest_increasing_limit: limit_a && limit_b,
      keep_constraints: keep_a && keep_b,
    };
  },

  // rustc: compiler/rustc_type_ir/src/solve/mod.rs:966 or
  or(self: MaybeCause, other: MaybeCause): MaybeCause {
    if (self.$ === "Ambiguity" && other.$ === "Ambiguity") return MaybeCause.Ambiguity;

    // When combining ambiguity + overflow, we can keep constraints.
    if (self.$ === "Ambiguity" && other.$ === "Overflow") {
      return { $: "Overflow", suggest_increasing_limit: other.suggest_increasing_limit, keep_constraints: true };
    }
    if (self.$ === "Overflow" && other.$ === "Ambiguity") {
      return { $: "Overflow", suggest_increasing_limit: self.suggest_increasing_limit, keep_constraints: true };
    }

    const { suggest_increasing_limit: limit_a, keep_constraints: keep_a } = self as Extract<MaybeCause, { $: "Overflow" }>;
    const { suggest_increasing_limit: limit_b, keep_constraints: keep_b } = other as Extract<MaybeCause, { $: "Overflow" }>;
    return {
      $: "Overflow",
      suggest_increasing_limit: limit_a || limit_b,
      keep_constraints: keep_a || keep_b,
    };
  },
};

// ---- SizedTraitKind ------------------------------------------------------------------------------------------------

export type SizedTraitKind = gen.SizedTraitKind;
export const SizedTraitKind = {
  ...gen.SizedTraitKind,

  /// Returns `DefId` of corresponding language item.
  // rustc: compiler/rustc_type_ir/src/solve/mod.rs:1017 require_lang_item
  require_lang_item(self: SizedTraitKind, cx: Interner): DefId {
    let lang_item: SolverTraitLangItem;
    switch (self) {
      case "Sized":
        lang_item = SolverTraitLangItem.Sized;
        break;
      case "MetaSized":
        lang_item = SolverTraitLangItem.MetaSized;
        break;
    }
    return cx.require_trait_lang_item(lang_item);
  },
};

// ---- TyOrConstInferVar ---------------------------------------------------------------------------------------------

export type TyOrConstInferVar = gen.TyOrConstInferVar;
export const TyOrConstInferVar = {
  // rustc: compiler/rustc_type_ir/src/solve/mod.rs:1090 as_type
  as_type(self: TyOrConstInferVar, interner: TyCtxt): Ty | undefined {
    switch (self.$) {
      case "Ty":
        return Ty.new_var(interner, self._0);
      case "TyInt":
      case "TyFloat":
      case "Const":
        return undefined;
    }
  },

  /// Tries to extract an inference variable from a type or a constant, returns `None`
  /// for types other than `ty::Infer(_)` (or `InferTy::Fresh*`) and
  /// for constants other than `ty::ConstKind::Infer(_)` (or `InferConst::Fresh`).
  // rustc: compiler/rustc_type_ir/src/solve/mod.rs:1100 maybe_from_generic_arg
  maybe_from_generic_arg(arg: GenericArg): TyOrConstInferVar | undefined {
    const k = GenericArg.kind(arg);
    switch (k.$) {
      case "Type":
        return TyOrConstInferVar.maybe_from_ty(k._0);
      case "Const":
        return TyOrConstInferVar.maybe_from_const(k._0);
      case "Lifetime":
        return undefined;
    }
  },

  /// Tries to extract an inference variable from a type or a constant, returns `None`
  /// for types other than `ty::Infer(_)` (or `InferTy::Fresh*`) and
  /// for constants other than `ty::ConstKind::Infer(_)` (or `InferConst::Fresh`).
  // rustc: compiler/rustc_type_ir/src/solve/mod.rs:1111 maybe_from_term
  maybe_from_term(term: Term): TyOrConstInferVar | undefined {
    const k = Term.kind(term);
    switch (k.$) {
      case "Ty":
        return TyOrConstInferVar.maybe_from_ty(k._0);
      case "Const":
        return TyOrConstInferVar.maybe_from_const(k._0);
    }
  },

  /// Tries to extract an inference variable from a type, returns `None`
  /// for types other than `ty::Infer(_)` (or `InferTy::Fresh*`).
  // rustc: compiler/rustc_type_ir/src/solve/mod.rs:1120 maybe_from_ty
  maybe_from_ty(ty: Ty): TyOrConstInferVar | undefined {
    const k = ty.kind();
    if (k.$ === "Infer") {
      const i = k._0;
      if (i.$ === "TyVar") return { $: "Ty", _0: i._0 };
      if (i.$ === "IntVar") return { $: "TyInt", _0: i._0 };
      if (i.$ === "FloatVar") return { $: "TyFloat", _0: i._0 };
    }
    return undefined;
  },

  /// Tries to extract an inference variable from a constant, returns `None`
  /// for constants other than `ty::ConstKind::Infer(_)` (or `InferConst::Fresh`).
  // rustc: compiler/rustc_type_ir/src/solve/mod.rs:1131 maybe_from_const
  maybe_from_const(ct: Const): TyOrConstInferVar | undefined {
    const k = ct.kind();
    if (k.$ === "Infer" && k._0.$ === "Var") {
      return { $: "Const", _0: k._0._0 };
    }
    return undefined;
  },
};
