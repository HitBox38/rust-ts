// Port of compiler/rustc_middle/src/ty/fold.rs (lane tyir-binder: `BoundVarReplacer` and its `TyCtxt` entry points;
// contract stub by lane ty-contract).
//
// The `TyCtxt` methods are declared in ty/decls.ts (`// ty/fold.rs:<line>`) and assigned to `TyCtxt.prototype` here.
// Extension module (docs/handoff/ty-contract.md "Init order"): rustc_middle/lib.ts loads it after the classes; its
// top-level code touches only `TyCtxt.prototype`.
// PORT (D4): the generic methods take the descriptor `d_T` of `T` last (decls.ts signatures).
// PORT: `FxIndexMap<BoundRegion, Region>` (keyed by a struct) is a `KeyedMap` over `intern_key`; `FxIndexMap<BoundVar,
// BoundVariableKind>` is a `Map` (insertion order is the index order upstream relies on).
import { KeyedMap } from "../../rust_ts/keyed.ts";
import { intern_key } from "../../rust_ts/intern_key.ts";
import type { DefId } from "../../rustc_span/def_id.ts";
import { bug } from "../../rustc_span/macros.ts";
import { PLAIN } from "../../std/fmt.ts";
import { assert, assert_eq, unported } from "../../std/panic.ts";
import { Binder, type BoundConst, BoundConst as BoundConstC, type BoundRegion, type BoundTy, BoundVariableKind, debug_BoundTy, fold_Binder } from "../../rustc_type_ir/binder.ts";
import { debug_BoundConst } from "../../rustc_type_ir/binder.gen.ts";
import { DelayedMap } from "../../rustc_type_ir/data_structures/delayed_map.ts";
import { type PredicateProxy, shift_vars, type TypeFoldable, type TypeFolder, TypeFolder_provided } from "../../rustc_type_ir/fold.ts";
import { BoundVar, DebruijnIndex, debug_DebruijnIndex, INNERMOST } from "../../rustc_type_ir/lib.ts";
import { Const, fold_Const, Region } from "../../rustc_type_ir/sty/mod.ts";
import { TypeVisitableExt } from "../../rustc_type_ir/visit.ts";
import { TyCtxt } from "./context.ts";
import type { Clauses } from "./decls.ts";
import { Ty } from "./mod.ts";
import type { LateParamRegionKind } from "./region.ts";
import { fold_Clauses, fold_Ty } from "./structural_impls.ts";

///////////////////////////////////////////////////////////////////////////
// Some sample folders

// rustc-type: compiler/rustc_middle/src/ty/fold.rs:15 BottomUpFolder
export class BottomUpFolder implements TypeFolder {
  constructor(
    public tcx: TyCtxt,
    public ty_op: (ty: Ty) => Ty,
    public lt_op: (r: Region) => Region,
    public ct_op: (ct: Const) => Const,
  ) {}

  // rustc: compiler/rustc_middle/src/ty/fold.rs:33 cx
  cx(): TyCtxt {
    return this.tcx;
  }

  // rustc: compiler/rustc_middle/src/ty/fold.rs:37 fold_ty
  fold_ty(ty: Ty): Ty {
    const t = fold_Ty.super_fold_with(ty, this);
    return this.ty_op(t);
  }

  // rustc: compiler/rustc_middle/src/ty/fold.rs:42 fold_region
  fold_region(r: Region): Region {
    // This one is a little different, because `super_fold_with` is not
    // implemented on non-recursive `Region`.
    return this.lt_op(r);
  }

  // rustc: compiler/rustc_middle/src/ty/fold.rs:48 fold_const
  fold_const(ct_: Const): Const {
    const ct = fold_Const.super_fold_with(ct_, this);
    return this.ct_op(ct);
  }

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

///////////////////////////////////////////////////////////////////////////
// Bound vars replacer

/// A delegate used when instantiating bound vars.
///
/// Any implementation must make sure that each bound variable always
/// gets mapped to the same result. `BoundVarReplacer` caches by using
/// a `DelayedMap` which does not cache the first few types it encounters.
// rustc-trait: compiler/rustc_middle/src/ty/fold.rs:62 BoundVarReplacerDelegate
export interface BoundVarReplacerDelegate {
  // rustc: compiler/rustc_middle/src/ty/fold.rs:63 replace_region
  replace_region(br: BoundRegion): Region;
  // rustc: compiler/rustc_middle/src/ty/fold.rs:64 replace_ty
  replace_ty(bt: BoundTy): Ty;
  // rustc: compiler/rustc_middle/src/ty/fold.rs:65 replace_const
  replace_const(bc: BoundConst): Const;
}

/// A simple delegate taking 3 mutable functions. The used functions must
/// always return the same result for each bound variable, no matter how
/// frequently they are called.
// rustc-type: compiler/rustc_middle/src/ty/fold.rs:71 FnMutDelegate
export class FnMutDelegate implements BoundVarReplacerDelegate {
  constructor(
    public regions: (br: BoundRegion) => Region,
    public types: (bt: BoundTy) => Ty,
    public consts: (bc: BoundConst) => Const,
  ) {}

  // rustc: compiler/rustc_middle/src/ty/fold.rs:78 replace_region
  replace_region(br: BoundRegion): Region {
    return this.regions(br);
  }
  // rustc: compiler/rustc_middle/src/ty/fold.rs:81 replace_ty
  replace_ty(bt: BoundTy): Ty {
    return this.types(bt);
  }
  // rustc: compiler/rustc_middle/src/ty/fold.rs:84 replace_const
  replace_const(bc: BoundConst): Const {
    return this.consts(bc);
  }
}

/// Replaces the escaping bound vars (late bound regions or bound types) in a type.
// rustc-type: compiler/rustc_middle/src/ty/fold.rs:90 BoundVarReplacer
class BoundVarReplacer implements TypeFolder {
  constructor(
    public tcx: TyCtxt,

    /// As with `RegionFolder`, represents the index of a binder *just outside*
    /// the ones we have visited.
    public current_index: DebruijnIndex,

    public delegate: BoundVarReplacerDelegate,

    /// This cache only tracks the `DebruijnIndex` and assumes that it does not matter
    /// for the delegate how often its methods get used.
    public cache: DelayedMap<[DebruijnIndex, Ty], Ty>,
  ) {}

  // rustc: compiler/rustc_middle/src/ty/fold.rs:105 new
  static new(tcx: TyCtxt, delegate: BoundVarReplacerDelegate): BoundVarReplacer {
    return new BoundVarReplacer(tcx, INNERMOST, delegate, DelayedMap.default_(([d, t]) => `${d}#${t.id}`));
  }

  // rustc: compiler/rustc_middle/src/ty/fold.rs:114 cx
  cx(): TyCtxt {
    return this.tcx;
  }

  // rustc: compiler/rustc_middle/src/ty/fold.rs:118 fold_binder
  fold_binder<T>(t_: Binder<T>, d: TypeFoldable<T>): Binder<T> {
    this.current_index = DebruijnIndex.shifted_in(this.current_index, 1);
    const t = fold_Binder(d).super_fold_with(t_, this);
    this.current_index = DebruijnIndex.shifted_out(this.current_index, 1);
    return t;
  }

  // rustc: compiler/rustc_middle/src/ty/fold.rs:128 fold_ty
  fold_ty(t: Ty): Ty {
    const k = t.kind();
    if (k.$ === "Bound" && k._0.$ === "Bound" && k._0._0 === this.current_index) {
      const bound_ty = k._1;
      const ty = this.delegate.replace_ty(bound_ty);
      // debug_assert!(!ty.has_vars_bound_above(ty::INNERMOST));
      return shift_vars(this.tcx, ty, this.current_index, fold_Ty);
    } else {
      if (!TypeVisitableExt.has_vars_bound_at_or_above(t, this.current_index, fold_Ty)) {
        return t;
      }
      const t_ = this.cache.get([this.current_index, t]);
      if (t_ !== undefined) {
        return t_;
      } else {
        const res = fold_Ty.super_fold_with(t, this);
        assert(this.cache.insert([this.current_index, t], res), "assertion failed: self.cache.insert((self.current_index, t), res)");
        return res;
      }
    }
  }

  // rustc: compiler/rustc_middle/src/ty/fold.rs:151 fold_region
  fold_region(r: Region): Region {
    const k = r.kind();
    if (k.$ === "ReBound" && k._0.$ === "Bound" && k._0._0 === this.current_index) {
      const debruijn = k._0._0;
      const br = k._1;
      const region = this.delegate.replace_region(br);
      const rk = region.kind();
      if (rk.$ === "ReBound" && rk._0.$ === "Bound") {
        const debruijn1 = rk._0._0;
        const br = rk._1;
        // If the callback returns a bound region,
        // that region should always use the INNERMOST
        // debruijn index. Then we adjust it to the
        // correct depth.
        assert_eq(debruijn1, INNERMOST, (v) => debug_DebruijnIndex(v, PLAIN));
        return Region.new_bound(this.tcx, debruijn, br);
      } else {
        return region;
      }
    } else {
      return r;
    }
  }

  // rustc: compiler/rustc_middle/src/ty/fold.rs:172 fold_const
  fold_const(ct_: Const): Const {
    const k = ct_.kind();
    if (k.$ === "Bound" && k._0.$ === "Bound" && k._0._0 === this.current_index) {
      const bound_const = k._1;
      const ct = this.delegate.replace_const(bound_const);
      // debug_assert!(!ct.has_vars_bound_above(ty::INNERMOST));
      return shift_vars(this.tcx, ct, this.current_index, fold_Const);
    } else {
      return fold_Const.super_fold_with(ct_, this);
    }
  }

  // rustc: compiler/rustc_middle/src/ty/fold.rs:185 fold_predicate
  fold_predicate<P>(p: P, d: PredicateProxy<P>): P {
    if (TypeVisitableExt.has_vars_bound_at_or_above(p, this.current_index, d)) {
      return d.super_fold_with(p, this);
    } else {
      return p;
    }
  }

  // rustc: compiler/rustc_middle/src/ty/fold.rs:189 fold_clauses
  fold_clauses(c: Clauses): Clauses {
    if (TypeVisitableExt.has_vars_bound_at_or_above(c, this.current_index, fold_Clauses)) {
      return fold_Clauses.super_fold_with(c, this);
    } else {
      return c;
    }
  }
}

// ---- impl TyCtxt ---------------------------------------------------------------------------------------------------

/// Replaces all regions bound by the given `Binder` with the
/// results returned by the closure; the closure is expected to
/// return a free region (relative to this binder), and hence the
/// binder is removed in the return type. The closure is invoked
/// once for each unique `BoundRegionKind`; multiple references to the
/// same `BoundRegionKind` will reuse the previous result. A map is
/// returned at the end with each bound region and the free region
/// that replaced it.
///
/// # Panics
///
/// This method only replaces late bound regions. Any types or
/// constants bound by `value` will cause an ICE.
// rustc: compiler/rustc_middle/src/ty/fold.rs:208 instantiate_bound_regions
TyCtxt.prototype.instantiate_bound_regions = function <T>(
  this: TyCtxt,
  value_: Binder<T>,
  fld_r: (br: BoundRegion) => Region,
  d_T: TypeFoldable<T>,
): [T, Map<BoundRegion, Region>] {
  const region_map = new KeyedMap<BoundRegion, Region>(intern_key);
  const real_fld_r = (br: BoundRegion): Region => {
    let r = region_map.get(br);
    if (r === undefined) {
      r = fld_r(br);
      region_map.set(br, r);
    }
    return r;
  };
  const value = this.instantiate_bound_regions_uncached(value_, real_fld_r, d_T);
  return [value, region_map];
};

// rustc: compiler/rustc_middle/src/ty/fold.rs:224 instantiate_bound_regions_uncached
TyCtxt.prototype.instantiate_bound_regions_uncached = function <T>(
  this: TyCtxt,
  value_: Binder<T>,
  replace_regions: (br: BoundRegion) => Region,
  d_T: TypeFoldable<T>,
): T {
  const value = Binder.skip_binder(value_);
  if (!TypeVisitableExt.has_escaping_bound_vars(value, d_T)) {
    return value;
  } else {
    const delegate = new FnMutDelegate(
      replace_regions,
      (b) => bug(`unexpected bound ty in binder: ${debug_BoundTy(b, PLAIN)}`),
      (b) => bug(`unexpected bound ct in binder: ${debug_BoundConst(b, PLAIN)}`),
    );
    const replacer = BoundVarReplacer.new(this, delegate);
    return d_T.fold_with(value, replacer);
  }
};

/// Replaces all escaping bound vars. The `fld_r` closure replaces escaping
/// bound regions; the `fld_t` closure replaces escaping bound types and the `fld_c`
/// closure replaces escaping bound consts.
// rustc: compiler/rustc_middle/src/ty/fold.rs:250 replace_escaping_bound_vars_uncached
TyCtxt.prototype.replace_escaping_bound_vars_uncached = function <T>(
  this: TyCtxt,
  value: T,
  delegate: BoundVarReplacerDelegate,
  d_T: TypeFoldable<T>,
): T {
  if (!TypeVisitableExt.has_escaping_bound_vars(value, d_T)) {
    return value;
  } else {
    const replacer = BoundVarReplacer.new(this, delegate);
    return d_T.fold_with(value, replacer);
  }
};

/// Replaces all types or regions bound by the given `Binder`. The `fld_r`
/// closure replaces bound regions, the `fld_t` closure replaces bound
/// types, and `fld_c` replaces bound constants.
// rustc: compiler/rustc_middle/src/ty/fold.rs:266 replace_bound_vars_uncached
TyCtxt.prototype.replace_bound_vars_uncached = function <T>(
  this: TyCtxt,
  value: Binder<T>,
  delegate: BoundVarReplacerDelegate,
  d_T: TypeFoldable<T>,
): T {
  return this.replace_escaping_bound_vars_uncached(Binder.skip_binder(value), delegate, d_T);
};

/// Replaces any late-bound regions bound in `value` with
/// free variants attached to `all_outlive_scope`.
// rustc: compiler/rustc_middle/src/ty/fold.rs:276 liberate_late_bound_regions
TyCtxt.prototype.liberate_late_bound_regions = function <T>(this: TyCtxt, all_outlive_scope: DefId, value: Binder<T>, d_T: TypeFoldable<T>): T {
  return this.instantiate_bound_regions_uncached(
    value,
    (br) => {
      const kind = LateParamRegionKind_from_bound(br.var, br.kind);
      return Region.new_late_param(this, all_outlive_scope, kind);
    },
    d_T,
  );
};

// rustc: compiler/rustc_middle/src/ty/fold.rs:290 shift_bound_var_indices
TyCtxt.prototype.shift_bound_var_indices = function <T>(this: TyCtxt, bound_vars: number, value: T, d_T: TypeFoldable<T>): T {
  // PORT: `BoundVar + usize` (`newtype_index!`'s `Add<usize>`) is `from_usize(index + n)`.
  const shift_bv = (bv: BoundVar): BoundVar => BoundVar.from_usize(BoundVar.index(bv) + bound_vars);
  const delegate: BoundVarReplacerDelegate = new FnMutDelegate(
    (r: BoundRegion) => Region.new_bound(this, INNERMOST, { var: shift_bv(r.var), kind: r.kind }),
    (t: BoundTy) => Ty.new_bound(this, INNERMOST, { var: shift_bv(t.var), kind: t.kind }),
    (c) => Const.new_bound(this, INNERMOST, BoundConstC.new(shift_bv(c.var))),
  );
  return this.replace_escaping_bound_vars_uncached(value, delegate, d_T);
};

/// Replaces any late-bound regions bound in `value` with `'erased`. Useful in codegen but also
/// method lookup and a few other places where precise region relationships are not required.
// rustc: compiler/rustc_middle/src/ty/fold.rs:321 instantiate_bound_regions_with_erased
TyCtxt.prototype.instantiate_bound_regions_with_erased = function <T>(this: TyCtxt, value: Binder<T>, d_T: TypeFoldable<T>): T {
  return this.instantiate_bound_regions(value, (_) => this.lifetimes.re_erased, d_T)[0];
};

/// Anonymize all bound variables in `value`, this is mostly used to improve caching.
// rustc: compiler/rustc_middle/src/ty/fold.rs:329 anonymize_bound_vars
TyCtxt.prototype.anonymize_bound_vars = function <T>(this: TyCtxt, value: Binder<T>, d_T: TypeFoldable<T>): Binder<T> {
  const map = new Map<BoundVar, BoundVariableKind>();
  const delegate = new Anonymize(this, map);
  const inner = this.replace_escaping_bound_vars_uncached(Binder.skip_binder(value), delegate, d_T);
  const bound_vars = this.mk_bound_variable_kinds_from_iter(map.values());
  return Binder.bind_with_vars(inner, bound_vars);
};

// PORT: the fn-local `struct Anonymize` of `anonymize_bound_vars`, at module level.
// rustc-type: compiler/rustc_middle/src/ty/fold.rs:333 Anonymize
class Anonymize implements BoundVarReplacerDelegate {
  constructor(
    public tcx: TyCtxt,
    public map: Map<BoundVar, BoundVariableKind>,
  ) {}

  /** PORT: `self.map.entry(var)`: the entry's index (existing position, else the next one) and `or_insert_with`. */
  private entry(var_: BoundVar, default_: () => BoundVariableKind): [number, BoundVariableKind] {
    let index = 0;
    for (const k of this.map.keys()) {
      if (k === var_) return [index, this.map.get(k)!];
      index++;
    }
    const v = default_();
    this.map.set(var_, v);
    return [index, v];
  }

  // rustc: compiler/rustc_middle/src/ty/fold.rs:338 replace_region
  replace_region(br_: BoundRegion): Region {
    const [index, entry] = this.entry(br_.var, () => ({ $: "Region", _0: { $: "Anon" } }));
    const var_ = BoundVar.from_usize(index);
    const kind = BoundVariableKind.expect_region(entry);
    const br: BoundRegion = { var: var_, kind };
    return Region.new_bound(this.tcx, INNERMOST, br);
  }
  // rustc: compiler/rustc_middle/src/ty/fold.rs:348 replace_ty
  replace_ty(bt: BoundTy): Ty {
    const [index, entry] = this.entry(bt.var, () => ({ $: "Ty", _0: { $: "Anon" } }));
    const var_ = BoundVar.from_usize(index);
    const kind = BoundVariableKind.expect_ty(entry);
    return Ty.new_bound(this.tcx, INNERMOST, { var: var_, kind });
  }
  // rustc: compiler/rustc_middle/src/ty/fold.rs:357 replace_const
  replace_const(bc: BoundConst): Const {
    const [index, entry] = this.entry(bc.var, () => BoundVariableKind.Const);
    const var_ = BoundVar.from_usize(index);
    BoundVariableKind.expect_const(entry);
    return Const.new_bound(this.tcx, INNERMOST, BoundConstC.new(var_));
  }
}

// ---- PORT stand-ins for items of files that are not ported yet ----------------------------------------------------

/** PORT: stand-in for `LateParamRegionKind::from_bound` (rustc_middle ty/region.rs:92, not ported yet). */
function LateParamRegionKind_from_bound(_var: BoundVar, _br: BoundRegion["kind"]): LateParamRegionKind {
  return unported("rustc_middle::ty::region::LateParamRegionKind::from_bound");
}
