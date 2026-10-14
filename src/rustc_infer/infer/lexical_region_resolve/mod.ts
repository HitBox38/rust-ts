// Port of compiler/rustc_infer/src/infer/lexical_region_resolve/mod.rs (lane infer-regions).
//
//! Lexical region resolution.
//
// The types of this file (`LexicalRegionResolutions`, `VarValue`, `RegionResolutionError`, `RegionAndOrigin`,
// `LexicalResolver`, with their derived Debug / Clone) are generated into mod.gen.ts; the methods are assigned onto the
// generated classes here, `RegionResolutionError::origin` lives on its companion, `resolve` is a free fn.
//
// PORT: `&mut VarValue` places (`var_values.value_mut(vid)`, `b_data: &mut VarValue`) are `MutRef<VarValue>` views onto
// the `values` slot (`value_slot`); `value_mut` itself returns the element, as decls.ts declares.
//
// Init order: top-level code here may touch only ../../decls.ts, this file's .gen.ts and other crates; every other
// rustc_infer export is read inside function bodies only.

import { intern_key } from "../../../rust_ts/intern_key.ts";
import { KeyedSet } from "../../../rust_ts/keyed.ts";
import type { TyCtxt } from "../../../rustc_middle/ty/context.ts";
import type { Ty } from "../../../rustc_middle/ty/mod.ts";
import { fold_Ty } from "../../../rustc_middle/ty/structural_impls.ts";
import { bug, span_bug } from "../../../rustc_span/macros.ts";
import { type Binder, fold_Binder } from "../../../rustc_type_ir/binder.ts";
import { fold_regions, type TypeFoldable } from "../../../rustc_type_ir/fold.ts";
import { debug_UniverseIndex, UniverseIndex } from "../../../rustc_type_ir/lib.ts";
import { RegionVid } from "../../../rustc_type_ir/region_kind.ts";
import { debug_Region, fold_Region, Region } from "../../../rustc_type_ir/sty/mod.ts";
import { type Debug, debug_vec, type Fmt, PLAIN, PRETTY } from "../../../std/fmt.ts";
import type { MutRef } from "../../../std/mut_ref.ts";
import { assert, panic, unreachable, unwrap } from "../../../std/panic.ts";
import type { Companions } from "../../decls.ts";
import type { RegionRelations } from "../free_regions.ts";
import { clone_SubregionOrigin, debug_SubregionOrigin, RegionVariableOrigin, type SubregionOrigin } from "../mod.ts";
import * as test_type_match from "../outlives/test_type_match.ts";
import {
  Constraint,
  GenericKind,
  RegionConstraintData,
  type VarInfos,
  type VerifyBound,
  type VerifyIfEq,
  fold_with_VerifyIfEq,
  try_fold_with_VerifyIfEq,
  visit_with_VerifyIfEq,
} from "../region_constraints/mod.ts";
import { type EdgeDirection, IndexedConstraintEdges } from "./indexed_edges.ts";
import * as gen from "./mod.gen.ts";
import { LexicalRegionResolutions, LexicalResolver, type RegionAndOrigin, type VarValue } from "./mod.gen.ts";

export * from "./mod.gen.ts";

// mod indexed_edges; (loaded by ../../lib.ts)

declare module "./mod.gen.ts" {
  interface LexicalResolver {
    // mod.rs:139
    tcx(): TyCtxt;
    // mod.rs:143
    infer_variable_values(errors: gen.RegionResolutionError[]): LexicalRegionResolutions;
    // mod.rs:167
    num_vars(): number;
    // mod.rs:173
    construct_var_data(): LexicalRegionResolutions;
    // mod.rs:186
    dump_constraints(): void;
    // mod.rs:192
    expansion(var_values: LexicalRegionResolutions): void;
    // mod.rs:325
    expand_node(a_region: Region, b_vid: RegionVid, b_data: MutRef<VarValue>): boolean;
    // mod.rs:392
    sub_region_values(a: VarValue, b: VarValue): boolean;
    // mod.rs:473
    sub_concrete_regions(a: Region, b: Region): boolean;
    // mod.rs:503
    lub_concrete_regions(a: Region, b: Region): Region;
    // mod.rs:548
    collect_errors(var_data: LexicalRegionResolutions, errors: gen.RegionResolutionError[]): void;
    // mod.rs:630
    collect_var_errors(var_data: LexicalRegionResolutions, errors: gen.RegionResolutionError[]): void;
    // mod.rs:694
    collect_error_for_expanding_node(
      edges: IndexedConstraintEdges,
      dup_vec: (RegionVid | undefined)[],
      node_idx: RegionVid,
      errors: gen.RegionResolutionError[],
    ): void;
    // mod.rs:812
    collect_bounding_regions(
      edges: IndexedConstraintEdges,
      orig_node_idx: RegionVid,
      dir: EdgeDirection,
      dup_vec: (RegionVid | undefined)[] | undefined,
    ): [RegionAndOrigin[], Set<RegionVid>, boolean];
    // mod.rs:900
    bound_is_met(bound: VerifyBound, var_values: LexicalRegionResolutions, generic_ty: Ty, min: Region): boolean;
  }
}

/** `IndexVec` indexing (panics out of bounds). */
function at<T>(v: readonly T[], i: number): T {
  assert(i < v.length, `index out of bounds: the len is ${v.length} but the index is ${i}`);
  return v[i]!;
}

/** `&mut var_values.values[rid]` (`LexicalRegionResolutions::value_mut`) as a `MutRef` view onto the slot. */
function value_slot(var_values: LexicalRegionResolutions, rid: RegionVid): MutRef<VarValue> {
  const values = var_values.values;
  const i = RegionVid.as_usize(rid);
  at(values, i);
  return {
    get value(): VarValue {
      return values[i]!;
    },
    set value(v: VarValue) {
      values[i] = v;
    },
  };
}

/** `VarValue::Value(Region(Interned(ReStatic, _))) | VarValue::ErrorValue` */
function is_static_or_error(v: VarValue): boolean {
  return (v.$ === "Value" && v._0.kind().$ === "ReStatic") || v.$ === "ErrorValue";
}

/** `TypeFoldable` descriptor of `ty::Binder<VerifyIfEq>` (D4). */
const fold_Binder_VerifyIfEq: TypeFoldable<Binder<VerifyIfEq>> = fold_Binder<VerifyIfEq>({
  visit_with: visit_with_VerifyIfEq,
  try_fold_with: try_fold_with_VerifyIfEq,
  fold_with: fold_with_VerifyIfEq,
});

/// This function performs lexical region resolution given a complete
/// set of constraints and variable origins. It performs a fixed-point
/// iteration to find region values which satisfy all constraints,
/// assuming such values can be found. It returns the final values of
/// all the variables as well as a set of errors that must be reported.
// #[instrument(level = "debug", skip(region_rels, var_infos, data))]
// rustc: compiler/rustc_infer/src/infer/lexical_region_resolve/mod.rs:31 resolve
export function resolve(
  region_rels: RegionRelations,
  var_infos: VarInfos,
  data: RegionConstraintData,
): [LexicalRegionResolutions, gen.RegionResolutionError[]] {
  assert(
    data.constraints.every(([c]) => {
      switch (c.kind) {
        case "VarSubVar":
        case "RegSubVar":
        case "VarSubReg":
        case "RegSubReg":
          return true;

        case "VarEqVar":
        case "VarEqReg":
        case "RegEqReg":
          return false;
      }
    }),
    "Every constraint should be decomposed into outlives here",
  );

  const errors: gen.RegionResolutionError[] = [];
  const resolver = new LexicalResolver(region_rels, var_infos, data);
  const values = resolver.infer_variable_values(errors);
  return [values, errors];
}

// ---- impl RegionResolutionError ----------------------------------------------------------------------------------------

export type RegionResolutionError = gen.RegionResolutionError;
export const RegionResolutionError: Companions["RegionResolutionError"] = {
  // rustc: compiler/rustc_infer/src/infer/lexical_region_resolve/mod.rs:116 origin
  origin(self: RegionResolutionError): SubregionOrigin {
    switch (self.$) {
      case "ConcreteFailure":
        return self._0;
      case "GenericBoundFailure":
        return self._0;
      case "SubSupConflict":
        return self._2;
      case "UpperBoundUniverseConflict":
        return self._3;
      case "CannotNormalize":
        return self._1;
    }
  },
};

// ---- impl LexicalResolver ----------------------------------------------------------------------------------------------

// rustc: compiler/rustc_infer/src/infer/lexical_region_resolve/mod.rs:139 tcx
LexicalResolver.prototype.tcx = function (this: LexicalResolver): TyCtxt {
  return this.region_rels.tcx;
};

// rustc: compiler/rustc_infer/src/infer/lexical_region_resolve/mod.rs:143 infer_variable_values
LexicalResolver.prototype.infer_variable_values = function (this: LexicalResolver, errors: gen.RegionResolutionError[]): LexicalRegionResolutions {
  const var_data = this.construct_var_data();

  // Deduplicating constraints is shown to have a positive perf impact.
  // PORT: `UnordSet<Constraint>` (derived `Hash` + `Eq`) is a `KeyedSet` on `intern_key`; only `insert` is used. The
  // `retain_mut` builds new `Constraint`s (they are `Copy`) in a new `RegionConstraintData`, so the caller's data is not
  // mutated (upstream moves it into the resolver).
  const seen = new KeyedSet<Constraint>(intern_key);
  const retained: [Constraint, SubregionOrigin][] = [];
  for (const [c, origin] of this.data.constraints) {
    // We don't want to discern constraints by leak check visibility here
    const constraint = new Constraint(c.kind, c.sub, c.sup, "Unreachable");
    const inserted = !seen.has(constraint);
    seen.add(constraint);
    if (inserted) retained.push([constraint, origin]);
  }
  this.data = new RegionConstraintData(retained, this.data.verifys);

  // if cfg!(debug_assertions) { self.dump_constraints(); }  (rustc ships without debug assertions)

  this.expansion(var_data);
  this.collect_errors(var_data, errors);
  this.collect_var_errors(var_data, errors);
  return var_data;
};

// rustc: compiler/rustc_infer/src/infer/lexical_region_resolve/mod.rs:167 num_vars
LexicalResolver.prototype.num_vars = function (this: LexicalResolver): number {
  return this.var_infos.length;
};

/// Initially, the value for all variables is set to `'empty`, the
/// empty region. The `expansion` phase will grow this larger.
// rustc: compiler/rustc_infer/src/infer/lexical_region_resolve/mod.rs:173 construct_var_data
LexicalResolver.prototype.construct_var_data = function (this: LexicalResolver): LexicalRegionResolutions {
  const values: VarValue[] = [];
  const n = this.num_vars();
  for (let i = 0; i < n; i++) {
    const vid_universe = at(this.var_infos, i).universe;
    values.push({ $: "Empty", _0: vid_universe });
  }
  return new LexicalRegionResolutions(values);
};

// #[instrument(level = "debug", skip(self))]
// rustc: compiler/rustc_infer/src/infer/lexical_region_resolve/mod.rs:186 dump_constraints
LexicalResolver.prototype.dump_constraints = function (this: LexicalResolver): void {
  // for (idx, (constraint, _)) in self.data.constraints.iter().enumerate() {
  //     debug!("Constraint {} => {:?}", idx, constraint);
  // }
};

// rustc: compiler/rustc_infer/src/infer/lexical_region_resolve/mod.rs:192 expansion
LexicalResolver.prototype.expansion = function (this: LexicalResolver, var_values: LexicalRegionResolutions): void {
  // In the first pass, we expand region vids according to constraints we
  // have previously found. In the second pass, we loop through the region
  // vids we expanded and expand *across* region vids (effectively
  // "expanding" new `RegSubVar` constraints).

  // Tracks the `VarSubVar` constraints generated for each region vid. We
  // later use this to expand across vids.
  const constraints: [RegionVid, RegionVid][][] = var_values.values.map(() => []);
  // Tracks the changed region vids.
  const changes: RegionVid[] = [];
  for (const [c] of this.data.constraints) {
    switch (c.kind) {
      case "RegSubVar": {
        const sup_vid = c.sup.as_var();
        const sup_data = value_slot(var_values, sup_vid);

        if (this.expand_node(c.sub, sup_vid, sup_data)) {
          changes.push(sup_vid);
        }
        break;
      }
      case "VarSubVar": {
        const sub_vid = c.sub.as_var();
        const sup_vid = c.sup.as_var();
        const sub_value = var_values.value(sub_vid);
        switch (sub_value.$) {
          case "ErrorValue":
            continue;
          case "Empty": {
            const sub_universe = sub_value._0;
            const sup_data = value_slot(var_values, sup_vid);

            let changed: boolean;
            const sup_value = sup_data.value;
            switch (sup_value.$) {
              case "Empty": {
                const sup_universe = sup_value._0;
                // Empty regions are ordered according to the universe
                // they are associated with.
                const ui = sub_universe < sup_universe ? sub_universe : sup_universe;

                // debug!("Expanding value of {:?} from empty lifetime with universe {:?} to empty lifetime with universe {:?}", sup_vid, sup_universe, ui);

                sup_data.value = { $: "Empty", _0: ui };
                changed = true;
                break;
              }
              case "Value": {
                const cur_region = sup_value._0;
                const kind = cur_region.kind();
                // If this empty region is from a universe that can name
                // the placeholder universe, then the LUB is the
                // Placeholder region (which is the cur_region). Otherwise,
                // the LUB is the Static lifetime.
                if (kind.$ === "RePlaceholder" && !UniverseIndex.can_name(sub_universe, kind._0.universe)) {
                  const lub = this.tcx().lifetimes.re_static;
                  // debug!("Expanding value of {:?} from {:?} to {:?}", sup_vid, cur_region, lub);

                  sup_data.value = { $: "Value", _0: lub };
                  changed = true;
                } else {
                  changed = false;
                }
                break;
              }

              case "ErrorValue":
                changed = false;
                break;
            }

            if (changed) {
              changes.push(sup_vid);
            }
            if (!is_static_or_error(sup_data.value)) {
              at(constraints, RegionVid.as_usize(sub_vid)).push([sub_vid, sup_vid]);
              at(constraints, RegionVid.as_usize(sup_vid)).push([sub_vid, sup_vid]);
            }
            break;
          }
          case "Value": {
            const sub_region = sub_value._0;
            const sup_data = value_slot(var_values, sup_vid);

            if (this.expand_node(sub_region, sup_vid, sup_data)) {
              changes.push(sup_vid);
            }
            if (!is_static_or_error(sup_data.value)) {
              at(constraints, RegionVid.as_usize(sub_vid)).push([sub_vid, sup_vid]);
              at(constraints, RegionVid.as_usize(sup_vid)).push([sub_vid, sup_vid]);
            }
            break;
          }
        }
        break;
      }
      case "RegSubReg":
      case "VarSubReg":
        // These constraints are checked after expansion
        // is done, in `collect_errors`.
        continue;

      case "VarEqVar":
      case "VarEqReg":
      case "RegEqReg":
        unreachable();
    }
  }

  let vid: RegionVid | undefined;
  while ((vid = changes.pop()) !== undefined) {
    const i = RegionVid.as_usize(vid);
    // `Vec::retain` (in order, the closure once per element)
    constraints[i] = at(constraints, i).filter(([a_vid, b_vid]) => {
      const a_value = var_values.value(a_vid);
      if (a_value.$ !== "Value") {
        return false;
      }
      const a_region = a_value._0;
      const b_data = value_slot(var_values, b_vid);
      if (this.expand_node(a_region, b_vid, b_data)) {
        changes.push(b_vid);
      }
      return !is_static_or_error(b_data.value);
    });
  }
};

/// Expands the value of the region represented with `b_vid` with current
/// value `b_data` to the lub of `b_data` and `a_region`. The corresponds
/// with the constraint `'?b: 'a` (`'a <: '?b`), where `'a` is some known
/// region and `'?b` is some region variable.
// rustc: compiler/rustc_infer/src/infer/lexical_region_resolve/mod.rs:325 expand_node
LexicalResolver.prototype.expand_node = function (this: LexicalResolver, a_region: Region, b_vid: RegionVid, b_data: MutRef<VarValue>): boolean {
  // debug!("expand_node({:?}, {:?} == {:?})", a_region, b_vid, b_data);

  const b_value = b_data.value;
  switch (b_value.$) {
    case "Empty": {
      const empty_ui = b_value._0;
      let lub: Region;
      const a_kind = a_region.kind();
      if (a_kind.$ === "RePlaceholder") {
        const placeholder = a_kind._0;
        // If this empty region is from a universe that can
        // name the placeholder, then the placeholder is
        // larger; otherwise, the only ancestor is `'static`.
        if (UniverseIndex.can_name(empty_ui, placeholder.universe)) {
          lub = Region.new_placeholder(this.tcx(), placeholder);
        } else {
          lub = this.tcx().lifetimes.re_static;
        }
      } else {
        lub = a_region;
      }

      // debug!("Expanding value of {:?} from empty lifetime to {:?}", b_vid, lub);

      b_data.value = { $: "Value", _0: lub };
      return true;
    }
    case "Value": {
      const cur_region = b_value._0;
      // This is a specialized version of the `lub_concrete_regions`
      // check below for a common case, here purely as an
      // optimization.
      const b_universe = at(this.var_infos, RegionVid.as_usize(b_vid)).universe;

      let lub = this.lub_concrete_regions(a_region, cur_region);
      if (lub === cur_region) {
        return false;
      }

      // Watch out for `'b: !1` relationships, where the
      // universe of `'b` can't name the placeholder `!1`. In
      // that case, we have to grow `'b` to be `'static` for the
      // relationship to hold. This is obviously a kind of sub-optimal
      // choice -- in the future, when we incorporate a knowledge
      // of the parameter environment, we might be able to find a
      // tighter bound than `'static`.
      //
      // (This might e.g. arise from being asked to prove `for<'a> { 'b: 'a }`.)
      const lub_kind = lub.kind();
      if (lub_kind.$ === "RePlaceholder" && UniverseIndex.cannot_name(b_universe, lub_kind._0.universe)) {
        lub = this.tcx().lifetimes.re_static;
      }

      // debug!("Expanding value of {:?} from {:?} to {:?}", b_vid, cur_region, lub);

      b_data.value = { $: "Value", _0: lub };
      return true;
    }

    case "ErrorValue":
      return false;
  }
};

/// True if `a <= b`.
// rustc: compiler/rustc_infer/src/infer/lexical_region_resolve/mod.rs:392 sub_region_values
LexicalResolver.prototype.sub_region_values = function (this: LexicalResolver, a: VarValue, b: VarValue): boolean {
  // Error region is `'static`
  if (a.$ === "ErrorValue" || b.$ === "ErrorValue") {
    return true;
  } else if (a.$ === "Empty" && b.$ === "Empty") {
    const a_ui = a._0;
    const b_ui = b._0;
    // Empty regions are ordered according to the universe
    // they are associated with.
    return (a_ui < b_ui ? a_ui : b_ui) === b_ui;
  } else if (a.$ === "Value" && b.$ === "Empty") {
    const a_r = a._0;
    const kind = a_r.kind();
    switch (kind.$) {
      // this is always on an error path,
      // so it doesn't really matter if it's shorter or longer than an empty region
      case "ReError":
        return false;

      case "ReBound":
      case "ReErased":
        return bug(`cannot relate region: ${debug_Region(a_r, PLAIN)}`);

      case "ReVar":
        return span_bug(
          RegionVariableOrigin.span(at(this.var_infos, RegionVid.as_usize(kind._0)).origin),
          `lub_concrete_regions invoked with non-concrete region: ${debug_Region(a_r, PLAIN)}`,
        );

      case "ReStatic":
      case "ReEarlyParam":
      case "ReLateParam":
        // nothing lives longer than `'static`

        // All empty regions are less than early-bound, free,
        // and scope regions.

        return false;

      case "RePlaceholder":
        // The LUB is either `a` or `'static`
        return false;
    }
  } else if (a.$ === "Empty" && b.$ === "Value") {
    const a_ui = a._0;
    const b_r = b._0;
    const kind = b_r.kind();
    switch (kind.$) {
      // this is always on an error path,
      // so it doesn't really matter if it's shorter or longer than an empty region
      case "ReError":
        return false;

      case "ReBound":
      case "ReErased":
        return bug(`cannot relate region: ${debug_Region(b_r, PLAIN)}`);

      case "ReVar":
        return span_bug(
          RegionVariableOrigin.span(at(this.var_infos, RegionVid.as_usize(kind._0)).origin),
          `lub_concrete_regions invoked with non-concrete regions: ${debug_Region(b_r, PLAIN)}`,
        );

      case "ReStatic":
      case "ReEarlyParam":
      case "ReLateParam":
        // nothing lives longer than `'static`
        // All empty regions are less than early-bound, late-bound,
        // and scope regions.
        return true;

      case "RePlaceholder": {
        const placeholder = kind._0;
        // If this empty region is from a universe that can
        // name the placeholder, then the placeholder is
        // larger; otherwise, the only ancestor is `'static`.
        return UniverseIndex.can_name(a_ui, placeholder.universe);
      }
    }
  } else if (a.$ === "Value" && b.$ === "Value") {
    return this.sub_concrete_regions(a._0, b._0);
  }
  return unreachable();
};

/// True if `a <= b`, but not defined over inference variables.
// #[instrument(level = "trace", skip(self))]
// rustc: compiler/rustc_infer/src/infer/lexical_region_resolve/mod.rs:473 sub_concrete_regions
LexicalResolver.prototype.sub_concrete_regions = function (this: LexicalResolver, a: Region, b: Region): boolean {
  const tcx = this.tcx();
  const sub_free_regions = (r1: Region, r2: Region): boolean => this.region_rels.free_regions.sub_free_regions(tcx, r1, r2);

  // Check for the case where we know that `'b: 'static` -- in that case,
  // `a <= b` for all `a`.
  if (b.is_free() && sub_free_regions(tcx.lifetimes.re_static, b)) {
    return true;
  }

  // If both `a` and `b` are free, consult the declared
  // relationships. Note that this can be more precise than the
  // `lub` relationship defined below, since sometimes the "lub"
  // is actually the `postdom_upper_bound` (see
  // `TransitiveRelation` for more details).
  if (a.is_free() && b.is_free()) {
    return sub_free_regions(a, b);
  }

  // For other cases, leverage the LUB code to find the LUB and
  // check if it is equal to `b`.
  return this.lub_concrete_regions(a, b) === b;
};

/// Returns the least-upper-bound of `a` and `b`; i.e., the
/// smallest region `c` such that `a <= c` and `b <= c`.
///
/// Neither `a` nor `b` may be an inference variable (hence the
/// term "concrete regions").
// #[instrument(level = "trace", skip(self), ret)]
// rustc: compiler/rustc_infer/src/infer/lexical_region_resolve/mod.rs:503 lub_concrete_regions
LexicalResolver.prototype.lub_concrete_regions = function (this: LexicalResolver, a: Region, b: Region): Region {
  const ak = a.kind();
  const bk = b.kind();
  if (ak.$ === "ReBound" || bk.$ === "ReBound" || ak.$ === "ReErased" || bk.$ === "ReErased") {
    return bug(`cannot relate region: LUB(${debug_Region(a, PLAIN)}, ${debug_Region(b, PLAIN)})`);
  } else if (ak.$ === "ReVar" || bk.$ === "ReVar") {
    const v_id = ak.$ === "ReVar" ? ak._0 : (bk as { _0: RegionVid })._0;
    return span_bug(
      RegionVariableOrigin.span(at(this.var_infos, RegionVid.as_usize(v_id)).origin),
      `lub_concrete_regions invoked with non-concrete regions: ${debug_Region(a, PLAIN)}, ${debug_Region(b, PLAIN)}`,
    );
  } else if (ak.$ === "ReError") {
    return a;
  } else if (bk.$ === "ReError") {
    return b;
  } else if (ak.$ === "ReStatic" || bk.$ === "ReStatic") {
    // nothing lives longer than `'static`
    return this.tcx().lifetimes.re_static;
  } else if ((ak.$ === "ReEarlyParam" || ak.$ === "ReLateParam") && (bk.$ === "ReEarlyParam" || bk.$ === "ReLateParam")) {
    return this.region_rels.lub_param_regions(a, b);
  } else {
    // For these types, we cannot define any additional
    // relationship:
    // (RePlaceholder(..), _) | (_, RePlaceholder(..))
    if (a === b) {
      return a;
    } else {
      return this.tcx().lifetimes.re_static;
    }
  }
};

/// After expansion is complete, go and check upper bounds (i.e.,
/// cases where the region cannot grow larger than a fixed point)
/// and check that they are satisfied.
// #[instrument(skip(self, var_data, errors))]
// rustc: compiler/rustc_infer/src/infer/lexical_region_resolve/mod.rs:548 collect_errors
LexicalResolver.prototype.collect_errors = function (this: LexicalResolver, var_data: LexicalRegionResolutions, errors: gen.RegionResolutionError[]): void {
  for (const [c, origin] of this.data.constraints) {
    // debug!(?c, ?origin);
    switch (c.kind) {
      case "RegSubVar":
      case "VarSubVar":
        // Expansion will ensure that these constraints hold. Ignore.
        break;

      case "RegSubReg": {
        if (this.sub_concrete_regions(c.sub, c.sup)) {
          continue;
        }

        // debug!("region error at {:?}: cannot verify that {:?} <= {:?}", origin, c.sub, c.sup);

        errors.push({ $: "ConcreteFailure", _0: clone_SubregionOrigin(origin), _1: c.sub, _2: c.sup });
        break;
      }

      case "VarSubReg": {
        const sub_vid = c.sub.as_var();
        const sub_data = value_slot(var_data, sub_vid);
        // debug!("contraction: {:?} == {:?}, {:?}", sub_vid, sub_data, c.sup);

        const sub_value = sub_data.value;
        if (sub_value.$ !== "Value") {
          continue;
        }
        const sub_region = sub_value._0;

        // Do not report these errors immediately:
        // instead, set the variable value to error and
        // collect them later.
        if (!this.sub_concrete_regions(sub_region, c.sup)) {
          // debug!("region error at {:?}: cannot verify that {:?}={:?} <= {:?}", origin, sub_vid, sub_region, c.sup);
          sub_data.value = gen.VarValue.ErrorValue;
        }
        break;
      }

      case "VarEqVar":
      case "VarEqReg":
      case "RegEqReg":
        unreachable();
    }
  }

  for (const verify of this.data.verifys) {
    // debug!("collect_errors: verify={:?}", verify);
    const sub = var_data.normalize(this.tcx(), verify.region, fold_Region);

    let verify_kind_ty = GenericKind.to_ty(verify.kind, this.tcx());
    verify_kind_ty = var_data.normalize(this.tcx(), verify_kind_ty, fold_Ty);
    if (this.bound_is_met(verify.bound, var_data, verify_kind_ty, sub)) {
      continue;
    }

    // debug!("collect_errors: region error at {:?}: cannot verify that {:?} <= {:?}", verify.origin, verify.region, verify.bound);

    errors.push({ $: "GenericBoundFailure", _0: clone_SubregionOrigin(verify.origin), _1: verify.kind, _2: sub });
  }
};

/// Go over the variables that were declared to be error variables
/// and create a `RegionResolutionError` for each of them.
// rustc: compiler/rustc_infer/src/infer/lexical_region_resolve/mod.rs:630 collect_var_errors
LexicalResolver.prototype.collect_var_errors = function (this: LexicalResolver, var_data: LexicalRegionResolutions, errors: gen.RegionResolutionError[]): void {
  // debug!("collect_var_errors, var_data = {:#?}", var_data.values);

  // This is the best way that I have found to suppress
  // duplicate and related errors. Basically we keep a set of
  // flags for every node. Whenever an error occurs, we will
  // walk some portion of the graph looking to find pairs of
  // conflicting regions to report to the user. As we walk, we
  // trip the flags from false to true, and if we find that
  // we've already reported an error involving any particular
  // node we just stop and don't report the current error. The
  // idea is to report errors that derive from independent
  // regions of the graph, but not those that derive from
  // overlapping locations.
  const dup_vec: (RegionVid | undefined)[] = new Array<RegionVid | undefined>(this.num_vars()).fill(undefined);

  // Only construct the edge index when necessary, because it's moderately expensive.
  let edges: IndexedConstraintEdges | undefined = undefined;

  for (let i = 0; i < var_data.values.length; i++) {
    const node_vid = RegionVid.from_usize(i);
    const value = var_data.values[i]!;
    switch (value.$) {
      case "Empty":
      case "Value":
        /* Inference successful */
        break;
      case "ErrorValue": {
        // Inference impossible: this value contains
        // inconsistent constraints.
        //
        // I think that in this case we should report an
        // error now -- unlike the case above, we can't
        // wait to see whether the user needs the result
        // of this variable. The reason is that the mere
        // existence of this variable implies that the
        // region graph is inconsistent, whether or not it
        // is used.
        //
        // For example, we may have created a region
        // variable that is the GLB of two other regions
        // which do not have a GLB. Even if that variable
        // is not used, it implies that those two regions
        // *should* have a GLB.
        //
        // At least I think this is true. It may be that
        // the mere existence of a conflict in a region
        // variable that is not used is not a problem, so
        // if this rule starts to create problems we'll
        // have to revisit this portion of the code and
        // think hard about it. =) -- nikomatsakis

        // Obtain the spans for all the places that can
        // influence the constraints on this value for
        // richer diagnostics in `static_impl_trait`.

        edges ??= IndexedConstraintEdges.build_index(this.num_vars(), this.data);
        const e = edges;
        this.collect_error_for_expanding_node(e, dup_vec, node_vid, errors);
        break;
      }
    }
  }
};

// rustc: compiler/rustc_infer/src/infer/lexical_region_resolve/mod.rs:694 collect_error_for_expanding_node
LexicalResolver.prototype.collect_error_for_expanding_node = function (
  this: LexicalResolver,
  edges: IndexedConstraintEdges,
  dup_vec: (RegionVid | undefined)[],
  node_idx: RegionVid,
  errors: gen.RegionResolutionError[],
): void {
  // Errors in expanding nodes result from a lower-bound that is
  // not contained by an upper-bound.
  const [lower_bounds, lower_vid_bounds, lower_dup] = this.collect_bounding_regions(edges, node_idx, "In", dup_vec);
  const [upper_bounds, , upper_dup] = this.collect_bounding_regions(edges, node_idx, "Out", dup_vec);

  if (lower_dup || upper_dup) {
    return;
  }

  // We place late-bound regions first because we are special casing
  // SubSupConflict(ReLateParam, ReLateParam) when reporting error, and so
  // the user will more likely get a specific suggestion.
  // PORT: `sort_by_key` is a stable sort, as `Array.prototype.sort`.
  lower_bounds.sort((x, y) => region_order_key(x) - region_order_key(y));
  upper_bounds.sort((x, y) => region_order_key(x) - region_order_key(y));

  const node_universe = at(this.var_infos, RegionVid.as_usize(node_idx)).universe;

  for (const lower_bound of lower_bounds) {
    let effective_lower_bound: Region;
    const lk = lower_bound.region.kind();
    if (lk.$ === "RePlaceholder") {
      const p = lk._0;
      if (UniverseIndex.cannot_name(node_universe, p.universe)) {
        effective_lower_bound = this.tcx().lifetimes.re_static;
      } else {
        effective_lower_bound = lower_bound.region;
      }
    } else {
      effective_lower_bound = lower_bound.region;
    }

    for (const upper_bound of upper_bounds) {
      if (!this.sub_concrete_regions(effective_lower_bound, upper_bound.region)) {
        const origin = at(this.var_infos, RegionVid.as_usize(node_idx)).origin;
        // debug!("region inference error at {:?} for {:?}: SubSupConflict sub: {:?} sup: {:?}", origin, node_idx, lower_bound.region, upper_bound.region);

        errors.push({
          $: "SubSupConflict",
          _0: node_idx,
          _1: origin,
          _2: clone_SubregionOrigin(lower_bound.origin),
          _3: lower_bound.region,
          _4: clone_SubregionOrigin(upper_bound.origin),
          _5: upper_bound.region,
          _6: [],
        });
        return;
      }
    }
  }

  // If we have a scenario like `exists<'a> { forall<'b> { 'b:
  // 'a } }`, we wind up without any lower-bound -- all we have
  // are placeholders as upper bounds, but the universe of the
  // variable `'a`, or some variable that `'a` has to outlive, doesn't
  // permit those placeholders.
  //
  // We only iterate to find the min, which means it doesn't cause reproducibility issues
  let min_universe_opt: UniverseIndex | undefined = undefined;
  for (const vid of lower_vid_bounds) {
    const u = at(this.var_infos, RegionVid.as_usize(vid)).universe;
    if (min_universe_opt === undefined || u < min_universe_opt) min_universe_opt = u;
  }
  const min_universe = unwrap(min_universe_opt, "lower_vid_bounds should at least include `node_idx`");

  for (const upper_bound of upper_bounds) {
    const uk = upper_bound.region.kind();
    if (uk.$ === "RePlaceholder") {
      const p = uk._0;
      if (UniverseIndex.cannot_name(min_universe, p.universe)) {
        const origin = at(this.var_infos, RegionVid.as_usize(node_idx)).origin;
        errors.push({
          $: "UpperBoundUniverseConflict",
          _0: node_idx,
          _1: origin,
          _2: min_universe,
          _3: clone_SubregionOrigin(upper_bound.origin),
          _4: upper_bound.region,
        });
        return;
      }
    }
  }

  // Errors in earlier passes can yield error variables without
  // resolution errors here; ICE if no errors have been emitted yet.
  if (this.tcx().dcx().has_errors() === undefined) {
    panic(
      `collect_error_for_expanding_node() could not find error for var ${RegionVid.debug(node_idx, PLAIN)} in ` +
        `universe ${debug_UniverseIndex(node_universe, PLAIN)}, lower_bounds=${debug_vec(lower_bounds, PRETTY, debug_RegionAndOrigin)}, ` +
        `upper_bounds=${debug_vec(upper_bounds, PRETTY, debug_RegionAndOrigin)}`,
    );
  }
};

// rustc: compiler/rustc_infer/src/infer/lexical_region_resolve/mod.rs:715 region_order_key
function region_order_key(x: RegionAndOrigin): number {
  switch (x.region.kind().$) {
    case "ReEarlyParam":
      return 0;
    case "ReLateParam":
      return 1;
    default:
      return 2;
  }
}

/** The local `struct WalkState` of `collect_bounding_regions`. */
interface WalkState {
  set: Set<RegionVid>;
  stack: RegionVid[];
  result: RegionAndOrigin[];
  dup_found: boolean;
}

/// Collects all regions that "bound" the variable `orig_node_idx` in the
/// given direction.
///
/// If `dup_vec` is `Some` it's used to track duplicates between successive
/// calls of this function.
///
/// The return tuple fields are:
/// - a list of all concrete regions bounding the given region.
/// - the set of all region variables bounding the given region.
/// - a `bool` that's true if the returned region variables overlap with
///   those returned by a previous call for another region.
// rustc: compiler/rustc_infer/src/infer/lexical_region_resolve/mod.rs:812 collect_bounding_regions
LexicalResolver.prototype.collect_bounding_regions = function (
  this: LexicalResolver,
  edges: IndexedConstraintEdges,
  orig_node_idx: RegionVid,
  dir: EdgeDirection,
  dup_vec: (RegionVid | undefined)[] | undefined,
): [RegionAndOrigin[], Set<RegionVid>, boolean] {
  // PORT: `FxHashSet<RegionVid>`: only `insert` and an order-independent `min` read it.
  const state: WalkState = {
    set: new Set(),
    stack: [orig_node_idx],
    result: [],
    dup_found: false,
  };
  state.set.add(orig_node_idx);

  // to start off the process, walk the source node in the
  // direction specified
  process_edges(state, edges, orig_node_idx, dir);

  let node_idx: RegionVid | undefined;
  while ((node_idx = state.stack.pop()) !== undefined) {
    // check whether we've visited this node on some previous walk
    if (dup_vec !== undefined) {
      const i = RegionVid.as_usize(node_idx);
      const d = at(dup_vec, i);
      if (d === undefined) {
        dup_vec[i] = orig_node_idx;
      } else if (d !== orig_node_idx) {
        state.dup_found = true;
      }

      // debug!("collect_concrete_regions(orig_node_idx={:?}, node_idx={:?})", orig_node_idx, node_idx);
    }

    process_edges(state, edges, node_idx, dir);
  }

  const { result, dup_found, set } = state;
  return [result, set, dup_found];
};

// rustc: compiler/rustc_infer/src/infer/lexical_region_resolve/mod.rs:858 process_edges
function process_edges(state: WalkState, edges: IndexedConstraintEdges, source_vid: RegionVid, dir: EdgeDirection): void {
  // debug!("process_edges(source_vid={:?}, dir={:?})", source_vid, dir);

  for (const [c, origin0] of edges.adjacent_edges(source_vid, dir)) {
    switch (c.kind) {
      case "VarSubVar": {
        const from_vid = c.sub.as_var();
        const to_vid = c.sup.as_var();
        const opp_vid = from_vid === source_vid ? to_vid : from_vid;
        if (!state.set.has(opp_vid)) {
          state.set.add(opp_vid);
          state.stack.push(opp_vid);
        }
        break;
      }

      case "RegSubVar": {
        const origin = clone_SubregionOrigin(origin0);
        state.result.push({ region: c.sub, origin });
        break;
      }

      case "VarSubReg": {
        const origin = clone_SubregionOrigin(origin0);
        state.result.push({ region: c.sup, origin });
        break;
      }

      case "RegSubReg":
        panic("cannot reach reg-sub-reg edge in region inference post-processing");
        break;

      case "VarEqVar":
      case "VarEqReg":
      case "RegEqReg":
        unreachable();
    }
  }
}

// rustc: compiler/rustc_infer/src/infer/lexical_region_resolve/mod.rs:900 bound_is_met
LexicalResolver.prototype.bound_is_met = function (
  this: LexicalResolver,
  bound: VerifyBound,
  var_values: LexicalRegionResolutions,
  generic_ty: Ty,
  min: Region,
): boolean {
  if (min.kind().$ === "ReError") {
    return true;
  }

  switch (bound.$) {
    case "IfEq": {
      const verify_if_eq_b = var_values.normalize(this.region_rels.tcx, bound._0, fold_Binder_VerifyIfEq);
      const r = test_type_match.extract_verify_if_eq(this.tcx(), verify_if_eq_b, generic_ty);
      if (r !== undefined) {
        return this.bound_is_met({ $: "OutlivedBy", _0: r }, var_values, generic_ty, min);
      } else {
        return false;
      }
    }

    case "OutlivedBy": {
      const r = bound._0;
      const mk = min.kind();
      const a: VarValue = mk.$ === "ReVar" ? at(var_values.values, RegionVid.as_usize(mk._0)) : { $: "Value", _0: min };
      const rk = r.kind();
      const b: VarValue = rk.$ === "ReVar" ? at(var_values.values, RegionVid.as_usize(rk._0)) : { $: "Value", _0: r };
      return this.sub_region_values(a, b);
    }

    case "IsEmpty": {
      const mk = min.kind();
      if (mk.$ === "ReVar") {
        const v = at(var_values.values, RegionVid.as_usize(mk._0));
        switch (v.$) {
          case "ErrorValue":
            return false;
          case "Empty":
            return true;
          case "Value":
            return false;
        }
      }
      return false;
    }

    case "AnyBound":
      return bound._0.some((b) => this.bound_is_met(b, var_values, generic_ty, min));

    case "AllBounds":
      return bound._0.every((b) => this.bound_is_met(b, var_values, generic_ty, min));
  }
};

// rustc: compiler/rustc_infer/src/infer/lexical_region_resolve/mod.rs:957 fmt
export const debug_RegionAndOrigin: Debug<RegionAndOrigin> = (v: RegionAndOrigin, _f: Fmt) =>
  `RegionAndOrigin(${debug_Region(v.region, PLAIN)},${debug_SubregionOrigin(v.origin, PLAIN)})`;

// ---- impl LexicalRegionResolutions -------------------------------------------------------------------------------------

// rustc: compiler/rustc_infer/src/infer/lexical_region_resolve/mod.rs:963 normalize
LexicalRegionResolutions.prototype.normalize = function <T>(this: LexicalRegionResolutions, tcx: TyCtxt, value: T, d_T: TypeFoldable<T>): T {
  return fold_regions(tcx, value, (r, _db) => this.resolve_region(tcx, r), d_T);
};

// rustc: compiler/rustc_infer/src/infer/lexical_region_resolve/mod.rs:970 value
LexicalRegionResolutions.prototype.value = function (this: LexicalRegionResolutions, rid: RegionVid): VarValue {
  return at(this.values, RegionVid.as_usize(rid));
};

// PORT: `&mut VarValue` is the element (decls.ts); the callers in this file use `value_slot` (header).
// rustc: compiler/rustc_infer/src/infer/lexical_region_resolve/mod.rs:974 value_mut
LexicalRegionResolutions.prototype.value_mut = function (this: LexicalRegionResolutions, rid: RegionVid): VarValue {
  return at(this.values, RegionVid.as_usize(rid));
};

// rustc: compiler/rustc_infer/src/infer/lexical_region_resolve/mod.rs:978 resolve_region
LexicalRegionResolutions.prototype.resolve_region = function (this: LexicalRegionResolutions, tcx: TyCtxt, r: Region): Region {
  let result: Region;
  const kind = r.kind();
  if (kind.$ === "ReVar") {
    const v = at(this.values, RegionVid.as_usize(kind._0));
    switch (v.$) {
      case "Empty":
        result = r;
        break;
      case "Value":
        result = v._0;
        break;
      case "ErrorValue":
        result = tcx.lifetimes.re_static;
        break;
    }
  } else {
    result = r;
  }
  // debug!("resolve_region({:?}) = {:?}", r, result);
  return result;
};
