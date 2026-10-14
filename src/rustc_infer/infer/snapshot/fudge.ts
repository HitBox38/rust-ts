// Port of compiler/rustc_infer/src/infer/snapshot/fudge.rs (lane infer-opaque-snapshot). `SnapshotVarData` and
// `InferenceFudger` are generated (fudge.gen.ts); `InferenceFudger` (an interface there) is the `TypeFolder` class
// `InferenceFudgerFolder` here. Init order: other rustc_infer modules are read inside function bodies only.
//
// PORT: `Range<T>` is ena's `{ start, end }` (vendor/ena unify/mod.ts); `range.contains(&x)` is `start <= x < end` on
// the index; `.collect()` builds arrays. `#[instrument]` (tracing) is left out.

import { InferCtxt, type InferCtxtInner } from "../../decls.ts";
import { SnapshotVarData } from "./fudge.gen.ts";

export * from "./fudge.gen.ts";

import type { TyCtxt } from "../../../rustc_middle/ty/context.ts";
import type { Clauses, Const, Region, Ty } from "../../../rustc_middle/ty/decls.ts";
import { fold_Ty } from "../../../rustc_middle/ty/structural_impls.ts";
import { DUMMY_SP } from "../../../rustc_span/lib.ts";
import type { Binder } from "../../../rustc_type_ir/binder.ts";
import { ConstVid as ConstVidC, type ConstVid } from "../../../rustc_type_ir/const_kind.ts";
import { type PredicateProxy, type TypeFoldable, type TypeFolder, TypeFolder_provided } from "../../../rustc_type_ir/fold.ts";
import { RegionVid as RegionVidC } from "../../../rustc_type_ir/region_kind.ts";
import { fold_Const } from "../../../rustc_type_ir/sty/mod.ts";
import { FloatVid as FloatVidC, type FloatVid, IntVid as IntVidC, TyVid as TyVidC } from "../../../rustc_type_ir/ty_kind.ts";
import { TypeVisitableExt } from "../../../rustc_type_ir/visit.ts";
import type { Result } from "../../../std/result.ts";
import { unreachable } from "../../../std/panic.ts";
import type { Range } from "../../../vendor/ena/unify/mod.ts";
import type { FloatVariableOrigin } from "../type_variable.ts";
import type { UnificationTable } from "../mod.ts";
import type { ConstVariableOrigin, ConstVariableValue, ConstVidKey } from "../unify_key.ts";
import { ConstVidKey_from } from "../unify_key.ts";
import type { VariableLengths } from "./mod.ts";

// rustc: compiler/rustc_infer/src/infer/snapshot/fudge.rs:19 vars_since_snapshot
function vars_since_snapshot<T, V, E>(table: UnificationTable<T, V, E>, snapshot_var_len: number): Range<T> {
  return { start: table.values.Key.from_index(snapshot_var_len >>> 0), end: table.values.Key.from_index(table.len() >>> 0) };
}

// rustc: compiler/rustc_infer/src/infer/snapshot/fudge.rs:30 float_vars_since_snapshot
function float_vars_since_snapshot(inner: InferCtxtInner, snapshot_var_len: number): [Range<FloatVid>, FloatVariableOrigin[]] {
  const range = vars_since_snapshot(inner.float_unification_table(), snapshot_var_len);
  const origins: FloatVariableOrigin[] = [];
  for (let index = FloatVidC.as_usize(range.start); index < FloatVidC.as_usize(range.end); index++) {
    origins.push(inner.float_origin_origin_storage[index]!);
  }
  return [{ start: range.start, end: range.end }, origins];
}

// rustc: compiler/rustc_infer/src/infer/snapshot/fudge.rs:38 const_vars_since_snapshot
function const_vars_since_snapshot(
  table: UnificationTable<ConstVidKey, ConstVariableValue>,
  snapshot_var_len: number,
): [Range<ConstVid>, ConstVariableOrigin[]] {
  const range_ = vars_since_snapshot(table, snapshot_var_len);
  const range: Range<ConstVid> = { start: range_.start.vid, end: range_.end.vid };

  const origins: ConstVariableOrigin[] = [];
  for (let i = ConstVidC.as_usize(range.start); i < ConstVidC.as_usize(range.end); i++) {
    const index = ConstVidC.from_usize(i);
    const value = table.probe_value(ConstVidKey_from(index));
    switch (value.$) {
      case "Known":
        origins.push({ param_def_id: undefined, span: DUMMY_SP });
        break;
      case "Unknown":
        origins.push(value.origin);
        break;
    }
  }
  return [{ start: range.start, end: range.end }, origins];
}

// ---- impl InferCtxt --------------------------------------------------------------------------------------------------

/// This rather funky routine is used while processing expected
/// types. What happens here is that we want to propagate a
/// coercion through the return type of a fn to its
/// argument. Consider the type of `Option::Some`, which is
/// basically `for<T> fn(T) -> Option<T>`. So if we have an
/// expression `Some(&[1, 2, 3])`, and that has the expected type
/// `Option<&[u32]>`, we would like to type check `&[1, 2, 3]`
/// with the expectation of `&[u32]`. This will cause us to coerce
/// from `&[u32; 3]` to `&[u32]` and make the users life more
/// pleasant.
///
/// The way we do this is using `fudge_inference_if_ok`. What the
/// routine actually does is to start a snapshot and execute the
/// closure `f`. In our example above, what this closure will do
/// is to unify the expectation (`Option<&[u32]>`) with the actual
/// return type (`Option<?T>`, where `?T` represents the variable
/// instantiated for `T`). This will cause `?T` to be unified
/// with `&?a [u32]`, where `?a` is a fresh lifetime variable. The
/// input type (`?T`) is then returned by `f()`.
///
/// At this point, `fudge_inference_if_ok` will normalize all type
/// variables, converting `?T` to `&?a [u32]` and end the
/// snapshot. The problem is that we can't just return this type
/// out, because it references the region variable `?a`, and that
/// region variable was popped when we popped the snapshot.
///
/// So what we do is to keep a list (`region_vars`, in the code below)
/// of region variables created during the snapshot (here, `?a`). We
/// fold the return value and replace any such regions with a *new*
/// region variable (e.g., `?b`) and return the result (`&?b [u32]`).
/// This can then be used as the expectation for the fn argument.
///
/// The important point here is that, for soundness purposes, the
/// regions in question are not particularly important. We will
/// use the expected types to guide coercions, but we will still
/// type-check the resulting types from those coercions against
/// the actual types (`?T`, `Option<?T>`) -- and remember that
/// after the snapshot is popped, the variable `?T` is no longer
/// unified.
// #[instrument(skip(self, f), level = "debug", ret)]
// rustc: compiler/rustc_infer/src/infer/snapshot/fudge.rs:99 fudge_inference_if_ok
InferCtxt.prototype.fudge_inference_if_ok = function <T, E>(this: InferCtxt, f: () => Result<T, E>, d_T: TypeFoldable<T>): Result<T, E> {
  const variable_lengths = this.variable_lengths();
  const r = this.probe((_): Result<[SnapshotVarData, T], E> => {
    const value = f();
    if (value.$ === "Err") return value;
    // At this point, `value` could in principle refer
    // to inference variables that have been created during
    // the snapshot. Once we exit `probe()`, those are
    // going to be popped, so we will have to
    // eliminate any references to them.
    const snapshot_vars = SnapshotVarData.new(this, variable_lengths);
    return { $: "Ok", _0: [snapshot_vars, this.deeply_resolve_ignoring_regions(value._0, d_T)] };
  });
  if (r.$ === "Err") return r;
  const [snapshot_vars, value] = r._0;

  // At this point, we need to replace any of the now-popped
  // type/region variables that appear in `value` with a fresh
  // variable of the appropriate kind. We can't do this during
  // the probe because they would just get popped then too. =)
  return { $: "Ok", _0: this.fudge_inference(snapshot_vars, value, d_T) };
};

// rustc: compiler/rustc_infer/src/infer/snapshot/fudge.rs:124 fudge_inference
InferCtxt.prototype.fudge_inference = function <T>(this: InferCtxt, snapshot_vars: SnapshotVarData, value: T, d_T: TypeFoldable<T>): T {
  // Micro-optimization: if no variables have been created, then
  // `value` can't refer to any of them. =) So we can just return it.
  if (snapshot_vars.is_empty()) {
    return value;
  } else {
    return d_T.fold_with(value, new InferenceFudgerFolder(this, snapshot_vars));
  }
};

// ---- impl SnapshotVarData --------------------------------------------------------------------------------------------

// rustc: compiler/rustc_infer/src/infer/snapshot/fudge.rs:148 new
(SnapshotVarData as unknown as { new: typeof SnapshotVarData.new }).new = function (infcx: InferCtxt, vars_pre_snapshot: VariableLengths): SnapshotVarData {
  const inner = infcx.inner;
  const region_vars = inner.unwrap_region_constraints().vars_since_snapshot(vars_pre_snapshot.region_constraints_len);
  const type_vars = inner.type_variables().vars_since_snapshot(vars_pre_snapshot.type_var_len);
  const int_vars = vars_since_snapshot(inner.int_unification_table(), vars_pre_snapshot.int_var_len);
  const float_vars = float_vars_since_snapshot(inner, vars_pre_snapshot.float_var_len);

  const const_vars = const_vars_since_snapshot(inner.const_unification_table(), vars_pre_snapshot.const_var_len);
  return new SnapshotVarData(
    [{ start: region_vars[0].start, end: region_vars[0].end }, region_vars[1]],
    [{ start: type_vars[0].start, end: type_vars[0].end }, type_vars[1]],
    { start: int_vars.start, end: int_vars.end },
    float_vars,
    const_vars,
  );
};

// rustc: compiler/rustc_infer/src/infer/snapshot/fudge.rs:165 is_empty
SnapshotVarData.prototype.is_empty = function (this: SnapshotVarData): boolean {
  const { region_vars, type_vars, int_vars, float_vars, const_vars } = this;
  return (
    range_is_empty(region_vars[0], RegionVidC.index) &&
    range_is_empty(type_vars[0], TyVidC.index) &&
    range_is_empty(int_vars, IntVidC.index) &&
    range_is_empty(float_vars[0], FloatVidC.index) &&
    range_is_empty(const_vars[0], ConstVidC.index)
  );
};

// ---- InferenceFudger -------------------------------------------------------------------------------------------------

// PORT: `struct InferenceFudger<'a, 'tcx>` (fudge.rs:175, generated as an interface) with its `TypeFolder` impl.
class InferenceFudgerFolder implements TypeFolder {
  constructor(
    readonly infcx: InferCtxt,
    readonly snapshot_vars: SnapshotVarData,
  ) {}

  // rustc: compiler/rustc_infer/src/infer/snapshot/fudge.rs:181 cx
  cx(): TyCtxt {
    return this.infcx.tcx;
  }

  // rustc: compiler/rustc_infer/src/infer/snapshot/fudge.rs:185 fold_ty
  fold_ty(ty: Ty): Ty {
    const kind = ty.kind();
    if (kind.$ === "Infer") {
      const infer_ty = kind._0;
      switch (infer_ty.$) {
        case "TyVar": {
          const vid = infer_ty._0;
          if (range_contains(this.snapshot_vars.type_vars[0], vid, TyVidC.index)) {
            // This variable was created during the fudging.
            // Recreate it with a fresh variable here.
            const idx = TyVidC.as_usize(vid) - TyVidC.as_usize(this.snapshot_vars.type_vars[0].start);
            const origin = this.snapshot_vars.type_vars[1][idx]!;
            return this.infcx.next_ty_var_with_origin(origin);
          } else {
            // This variable was created before the
            // "fudging". Since we refresh all type
            // variables to their binding anyhow, we know
            // that it is unbound, so we can just return
            // it.
            // debug_assert!(
            //     self.infcx.inner.borrow_mut().type_variables().probe(vid).is_unknown()
            // );
            return ty;
          }
        }
        case "IntVar": {
          const vid = infer_ty._0;
          if (range_contains(this.snapshot_vars.int_vars, vid, IntVidC.index)) {
            return this.infcx.next_int_var();
          } else {
            return ty;
          }
        }
        case "FloatVar": {
          const vid = infer_ty._0;
          if (range_contains(this.snapshot_vars.float_vars[0], vid, FloatVidC.index)) {
            const idx = FloatVidC.as_usize(vid) - FloatVidC.as_usize(this.snapshot_vars.float_vars[0].start);
            const { span, lint_id } = this.snapshot_vars.float_vars[1][idx]!;
            return this.infcx.next_float_var(span, lint_id);
          } else {
            return ty;
          }
        }
        case "FreshTy":
        case "FreshIntTy":
        case "FreshFloatTy":
          return unreachable("internal error: entered unreachable code: unexpected fresh infcx var");
      }
    } else if (TypeVisitableExt.has_infer(ty, fold_Ty)) {
      return fold_Ty.super_fold_with(ty, this);
    } else {
      return ty;
    }
  }

  // rustc: compiler/rustc_infer/src/infer/snapshot/fudge.rs:235 fold_region
  fold_region(r: Region): Region {
    const kind = r.kind();
    if (kind.$ === "ReVar") {
      const vid = kind._0;
      if (range_contains(this.snapshot_vars.region_vars[0], vid, RegionVidC.index)) {
        const idx = RegionVidC.index(vid) - RegionVidC.index(this.snapshot_vars.region_vars[0].start);
        const origin = this.snapshot_vars.region_vars[1][idx]!;
        return this.infcx.next_region_var(origin);
      } else {
        return r;
      }
    } else {
      return r;
    }
  }

  // rustc: compiler/rustc_infer/src/infer/snapshot/fudge.rs:249 fold_const
  fold_const(ct: Const): Const {
    const kind = ct.kind();
    if (kind.$ === "Infer") {
      const infer_ct = kind._0;
      switch (infer_ct.$) {
        case "Var": {
          const vid = infer_ct._0;
          if (range_contains(this.snapshot_vars.const_vars[0], vid, ConstVidC.index)) {
            const idx = ConstVidC.index(vid) - ConstVidC.index(this.snapshot_vars.const_vars[0].start);
            const origin = this.snapshot_vars.const_vars[1][idx]!;
            return this.infcx.next_const_var_with_origin(origin);
          } else {
            return ct;
          }
        }
        case "Fresh":
          return unreachable("internal error: entered unreachable code: unexpected fresh infcx var");
      }
    } else if (TypeVisitableExt.has_infer(ct, fold_Const)) {
      return fold_Const.super_fold_with(ct, this);
    } else {
      return ct;
    }
  }

  // The provided `TypeFolder` methods (fold.rs).
  fold_binder<T>(t: Binder<T>, d: TypeFoldable<T>): Binder<T> {
    return TypeFolder_provided.fold_binder(this, t, d);
  }

  fold_predicate<P>(p: P, d: PredicateProxy<P>): P {
    return TypeFolder_provided.fold_predicate(this, p, d);
  }

  fold_clauses(c: Clauses): Clauses {
    return TypeFolder_provided.fold_clauses(this, c);
  }
}

/** `Range::is_empty` (`!(start < end)`) over a newtype index. */
function range_is_empty<I>(range: Range<I>, index: (i: I) => number): boolean {
  return !(index(range.start) < index(range.end));
}

/** `Range::contains` (`start <= x && x < end`) over a newtype index. */
function range_contains<I>(range: Range<I>, x: I, index: (i: I) => number): boolean {
  return index(range.start) <= index(x) && index(x) < index(range.end);
}
