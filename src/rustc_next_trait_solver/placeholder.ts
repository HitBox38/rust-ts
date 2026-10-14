// Contract stub for compiler/rustc_next_trait_solver/src/placeholder.rs (lane evalctxt-contract; the file belongs to lane
// nts-canonical). The folder classes are final; their methods (inherent statics and `TypeFolder`) are stubs with final
// signatures: fill each in place and add the `// rustc:` marker. Extension module (docs/handoff/evalctxt-contract.md
// "Init order").
//
// PORT: generic over `Infcx: InferCtxtLike` (the `InferCtxtLike` interface). The `IndexMap<Placeholder*, Bound*>` maps
// are keyed by structs compared by value: build them as `KeyedMap`s over `intern_key` (rust_ts/keyed.ts; they are
// `Map`s, insertion-ordered like `IndexMap`). `universe_indices: &'a mut Vec<..>` is the caller's array, mutated in place.
// `TypeFolder::fold_clauses` (not overridden upstream; `PlaceholderReplacer` also keeps the default `fold_predicate`)
// forwards to `TypeFolder_provided`.
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { Clauses } from "../rustc_middle/ty/decls.ts";
import { Ty } from "../rustc_middle/ty/mod.ts";
import { debug_Ty, fold_Ty } from "../rustc_middle/ty/structural_impls.ts";
import { intern_key } from "../rust_ts/intern_key.ts";
import { KeyedMap } from "../rust_ts/keyed.ts";
import { type Binder, fold_Binder, PlaceholderConst, PlaceholderRegion, PlaceholderType } from "../rustc_type_ir/binder.ts";
import type { BoundConst, BoundRegion, BoundTy } from "../rustc_type_ir/decls.ts";
import { type PredicateProxy, type TypeFoldable, type TypeFolder, TypeFolder_provided } from "../rustc_type_ir/fold.ts";
import type { InferCtxtLike } from "../rustc_type_ir/infer_ctxt.ts";
import { DebruijnIndex, debug_UniverseIndex, INNERMOST, UniverseIndex } from "../rustc_type_ir/lib.ts";
import { Assumptions } from "../rustc_type_ir/region_constraint.ts";
import { Const, debug_Const, fold_Const } from "../rustc_type_ir/sty/consts.ts";
import { debug_Region, Region } from "../rustc_type_ir/sty/mod.ts";
import { TypeVisitableExt } from "../rustc_type_ir/visit.ts";
import { debug_option, debug_vec, PRETTY } from "../std/fmt.ts";
import { field_mut } from "../std/mut_ref.ts";
import { panic } from "../std/panic.ts";

export class BoundVarReplacer implements TypeFolder {
  constructor(
    public infcx: InferCtxtLike,
    // These three maps track the bound variable that were replaced by placeholders. It might be
    // nice to remove these since we already have the `kind` in the placeholder; we really just need
    // the `var` (but we *could* bring that into scope if we were to track them as we pass them).
    public mapped_regions: Map<PlaceholderRegion, BoundRegion>,
    public mapped_types: Map<PlaceholderType, BoundTy>,
    public mapped_consts: Map<PlaceholderConst, BoundConst>,
    // The current depth relative to *this* folding, *not* the entire normalization. In other words,
    // the depth of binders we've passed here.
    public current_index: DebruijnIndex,
    // The `UniverseIndex` of the binding levels above us. These are optional, since we are lazy:
    // we don't actually create a universe until we see a bound var we have to replace.
    public universe_indices: (UniverseIndex | undefined)[],
  ) {}

  /// Returns a type with all bound vars replaced by placeholders,
  /// together with mappings from the new placeholders back to the original variable.
  ///
  /// Panics if there are any bound vars that use a binding level above `universe_indices.len()`.
  // PORT: D4 descriptor `d_T`.
  // rustc: compiler/rustc_next_trait_solver/src/placeholder.rs:41 replace_bound_vars
  static replace_bound_vars<T>(
    infcx: InferCtxtLike,
    universe_indices: (UniverseIndex | undefined)[],
    value: T,
    d_T: TypeFoldable<T>,
  ): [T, Map<PlaceholderRegion, BoundRegion>, Map<PlaceholderType, BoundTy>, Map<PlaceholderConst, BoundConst>] {
    const old_universes = [...universe_indices];
    const replacer = new BoundVarReplacer(
      infcx,
      new KeyedMap<PlaceholderRegion, BoundRegion>(intern_key),
      new KeyedMap<PlaceholderType, BoundTy>(intern_key),
      new KeyedMap<PlaceholderConst, BoundConst>(intern_key),
      INNERMOST,
      universe_indices,
    );

    value = d_T.fold_with(value, replacer);
    const { mapped_regions, mapped_types, mapped_consts } = replacer;

    if (infcx.cx().assumptions_on_binders()) {
      const n = Math.min(old_universes.length, universe_indices.length);
      for (let i = 0; i < n; i++) {
        const old = old_universes[i];
        const new_ = universe_indices[i];
        if (old === undefined && new_ !== undefined) {
          // FIXME(-Zassumptions-on-binders): `replace_bound_vars` does not have enough
          // context to compute placeholder assumptions for the binders it enters.
          infcx.insert_placeholder_assumptions(new_, Assumptions.empty());
        }
      }
    }

    return [value, mapped_regions, mapped_types, mapped_consts];
  }

  // rustc: compiler/rustc_next_trait_solver/src/placeholder.rs:87 universe_for
  universe_for(debruijn: DebruijnIndex): UniverseIndex {
    const infcx = this.infcx;
    const index =
      this.universe_indices.length + DebruijnIndex.as_usize(this.current_index) - DebruijnIndex.as_usize(debruijn) - 1;
    let universe = index_get(this.universe_indices, index);
    if (universe === undefined) {
      for (let i = 0; i < Math.min(index + 1, this.universe_indices.length); i++) {
        this.universe_indices[i] = this.universe_indices[i] ?? infcx.create_next_universe();
      }
      universe = this.universe_indices[index]!;
    }
    return universe;
  }

  // ---- impl TypeFolder for BoundVarReplacer ----
  // rustc: compiler/rustc_next_trait_solver/src/placeholder.rs:106 cx
  cx(): TyCtxt {
    return this.infcx.cx();
  }

  // rustc: compiler/rustc_next_trait_solver/src/placeholder.rs:110 fold_binder
  fold_binder<T>(t: Binder<T>, d: TypeFoldable<T>): Binder<T> {
    DebruijnIndex.shift_in(field_mut(this, "current_index"), 1);
    t = fold_Binder(d).super_fold_with(t, this);
    DebruijnIndex.shift_out(field_mut(this, "current_index"), 1);
    return t;
  }

  // rustc: compiler/rustc_next_trait_solver/src/placeholder.rs:117 fold_region
  fold_region(r: Region): Region {
    const k = r.kind();
    if (
      k.$ === "ReBound" &&
      k._0.$ === "Bound" &&
      DebruijnIndex.as_usize(k._0._0) >= DebruijnIndex.as_usize(this.current_index) + this.universe_indices.length
    ) {
      return panic(
        `Bound vars ${debug_Region(r, PRETTY)} outside of \`self.universe_indices\`: ${debug_universe_indices(this.universe_indices)}`,
      );
    } else if (k.$ === "ReBound" && k._0.$ === "Bound" && k._0._0 >= this.current_index) {
      const debruijn = k._0._0;
      const br = k._1;
      const universe = this.universe_for(debruijn);
      const p = PlaceholderRegion.new(universe, br);
      this.mapped_regions.set(p, br);
      return Region.new_placeholder(this.cx(), p);
    } else {
      return r;
    }
  }

  // rustc: compiler/rustc_next_trait_solver/src/placeholder.rs:140 fold_ty
  fold_ty(t: Ty): Ty {
    const k = t.kind();
    if (
      k.$ === "Bound" &&
      k._0.$ === "Bound" &&
      DebruijnIndex.as_usize(k._0._0) + 1 > DebruijnIndex.as_usize(this.current_index) + this.universe_indices.length
    ) {
      return panic(
        `Bound vars ${debug_Ty(t, PRETTY)} outside of \`self.universe_indices\`: ${debug_universe_indices(this.universe_indices)}`,
      );
    } else if (k.$ === "Bound" && k._0.$ === "Bound" && k._0._0 >= this.current_index) {
      const debruijn = k._0._0;
      const bound_ty = k._1;
      const universe = this.universe_for(debruijn);
      const p = PlaceholderType.new(universe, bound_ty);
      this.mapped_types.set(p, bound_ty);
      return Ty.new_placeholder(this.cx(), p);
    } else if (TypeVisitableExt.has_vars_bound_at_or_above(t, this.current_index, fold_Ty)) {
      return fold_Ty.super_fold_with(t, this);
    } else {
      return t;
    }
  }

  // rustc: compiler/rustc_next_trait_solver/src/placeholder.rs:164 fold_const
  fold_const(ct: Const): Const {
    const k = ct.kind();
    if (
      k.$ === "Bound" &&
      k._0.$ === "Bound" &&
      DebruijnIndex.as_usize(k._0._0) + 1 > DebruijnIndex.as_usize(this.current_index) + this.universe_indices.length
    ) {
      return panic(
        `Bound vars ${debug_Const(ct, PRETTY)} outside of \`self.universe_indices\`: ${debug_universe_indices(this.universe_indices)}`,
      );
    } else if (k.$ === "Bound" && k._0.$ === "Bound" && k._0._0 >= this.current_index) {
      const debruijn = k._0._0;
      const bound_const = k._1;
      const universe = this.universe_for(debruijn);
      const p = PlaceholderConst.new(universe, bound_const);
      this.mapped_consts.set(p, bound_const);
      return Const.new_placeholder(this.cx(), p);
    } else {
      return fold_Const.super_fold_with(ct, this);
    }
  }

  // rustc: compiler/rustc_next_trait_solver/src/placeholder.rs:187 fold_predicate
  fold_predicate<P>(p: P, d: PredicateProxy<P>): P {
    return TypeVisitableExt.has_vars_bound_at_or_above(p, this.current_index, d) ? d.super_fold_with(p, this) : p;
  }

  fold_clauses(c: Clauses): Clauses {
    return TypeFolder_provided.fold_clauses(this, c);
  }
}

/// The inverse of [`BoundVarReplacer`]: replaces placeholders with the bound vars from which they came.
export class PlaceholderReplacer implements TypeFolder {
  constructor(
    public infcx: InferCtxtLike,
    public mapped_regions: Map<PlaceholderRegion, BoundRegion>,
    public mapped_types: Map<PlaceholderType, BoundTy>,
    public mapped_consts: Map<PlaceholderConst, BoundConst>,
    public universe_indices: readonly (UniverseIndex | undefined)[],
    public current_index: DebruijnIndex,
  ) {}

  // PORT: D4 descriptor `d_T`.
  // rustc: compiler/rustc_next_trait_solver/src/placeholder.rs:211 replace_placeholders
  static replace_placeholders<T>(
    infcx: InferCtxtLike,
    mapped_regions: Map<PlaceholderRegion, BoundRegion>,
    mapped_types: Map<PlaceholderType, BoundTy>,
    mapped_consts: Map<PlaceholderConst, BoundConst>,
    universe_indices: readonly (UniverseIndex | undefined)[],
    value: T,
    d_T: TypeFoldable<T>,
  ): T {
    const replacer = new PlaceholderReplacer(infcx, mapped_regions, mapped_types, mapped_consts, universe_indices, INNERMOST);
    return d_T.fold_with(value, replacer);
  }

  // ---- impl TypeFolder for PlaceholderReplacer ----
  // rustc: compiler/rustc_next_trait_solver/src/placeholder.rs:236 cx
  cx(): TyCtxt {
    return this.infcx.cx();
  }

  // rustc: compiler/rustc_next_trait_solver/src/placeholder.rs:240 fold_binder
  fold_binder<T>(t: Binder<T>, d: TypeFoldable<T>): Binder<T> {
    const d_binder = fold_Binder(d);
    if (!TypeVisitableExt.has_placeholders(t, d_binder) && !TypeVisitableExt.has_infer(t, d_binder)) {
      return t;
    }
    DebruijnIndex.shift_in(field_mut(this, "current_index"), 1);
    t = d_binder.super_fold_with(t, this);
    DebruijnIndex.shift_out(field_mut(this, "current_index"), 1);
    return t;
  }

  // rustc: compiler/rustc_next_trait_solver/src/placeholder.rs:250 fold_region
  fold_region(r0: Region): Region {
    const k0 = r0.kind();
    const r1 = k0.$ === "ReVar" ? this.infcx.shallow_resolve_region_var(k0._0) : r0;

    let r2: Region;
    const k1 = r1.kind();
    if (k1.$ === "RePlaceholder") {
      const p = k1._0;
      const replace_var = this.mapped_regions.get(p);
      if (replace_var !== undefined) {
        const index = this.universe_indices.findIndex((u) => u !== undefined && u === p.universe);
        if (index === -1) panic("Unexpected placeholder universe.");
        const db = DebruijnIndex.from_usize(this.universe_indices.length - index + DebruijnIndex.as_usize(this.current_index) - 1);
        r2 = Region.new_bound(this.cx(), db, replace_var);
      } else {
        r2 = r1;
      }
    } else {
      r2 = r1;
    }

    // debug!(?r0, ?r1, ?r2, "fold_region");

    return r2;
  }

  // rustc: compiler/rustc_next_trait_solver/src/placeholder.rs:282 fold_ty
  fold_ty(ty: Ty): Ty {
    ty = this.infcx.shallow_resolve(ty);
    const k = ty.kind();
    if (k.$ === "Placeholder") {
      const p = k._0;
      const replace_var = this.mapped_types.get(p);
      if (replace_var !== undefined) {
        const index = this.universe_indices.findIndex((u) => u !== undefined && u === p.universe);
        if (index === -1) panic("Unexpected placeholder universe.");
        const db = DebruijnIndex.from_usize(this.universe_indices.length - index + DebruijnIndex.as_usize(this.current_index) - 1);
        return Ty.new_bound(this.infcx.cx(), db, replace_var);
      } else {
        if (TypeVisitableExt.has_infer(ty, fold_Ty)) {
          return fold_Ty.super_fold_with(ty, this);
        } else {
          return ty;
        }
      }
    } else if (TypeVisitableExt.has_placeholders(ty, fold_Ty) || TypeVisitableExt.has_infer(ty, fold_Ty)) {
      return fold_Ty.super_fold_with(ty, this);
    } else {
      return ty;
    }
  }

  // rustc: compiler/rustc_next_trait_solver/src/placeholder.rs:314 fold_const
  fold_const(ct: Const): Const {
    ct = this.infcx.shallow_resolve_const(ct);
    const k = ct.kind();
    if (k.$ === "Placeholder") {
      const p = k._0;
      const replace_var = this.mapped_consts.get(p);
      if (replace_var !== undefined) {
        const index = this.universe_indices.findIndex((u) => u !== undefined && u === p.universe);
        if (index === -1) panic("Unexpected placeholder universe.");
        const db = DebruijnIndex.from_usize(this.universe_indices.length - index + DebruijnIndex.as_usize(this.current_index) - 1);
        return Const.new_bound(this.infcx.cx(), db, replace_var);
      } else {
        if (TypeVisitableExt.has_infer(ct, fold_Const)) {
          return fold_Const.super_fold_with(ct, this);
        } else {
          return ct;
        }
      }
    } else {
      return fold_Const.super_fold_with(ct, this);
    }
  }

  fold_predicate<P>(p: P, d: PredicateProxy<P>): P {
    return TypeFolder_provided.fold_predicate(this, p, d);
  }

  fold_clauses(c: Clauses): Clauses {
    return TypeFolder_provided.fold_clauses(this, c);
  }
}

/** PORT: `self.universe_indices[index]` with core's bounds-check panic. */
function index_get<T>(v: readonly T[], idx: number): T {
  if (idx >= v.length) panic(`index out of bounds: the len is ${v.length} but the index is ${idx}`);
  return v[idx]!;
}

/** `{:#?}` of `&mut Vec<Option<ty::UniverseIndex>>`. */
function debug_universe_indices(v: readonly (UniverseIndex | undefined)[]): string {
  return debug_vec(v, PRETTY, (u, f) => debug_option(u, f, debug_UniverseIndex));
}
