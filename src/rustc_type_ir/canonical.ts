// Port of compiler/rustc_type_ir/src/canonical.rs (lane tyir-misc, sub-lane infer). The types with their derived
// Debug / TypeVisitable / TypeFoldable impls are generated into canonical.gen.ts (set rustc_ty of
// tools/codegen/types.ts); the working structs `CanonicalParamEnvCache` and `CanonicalizerState` (skipped by codegen)
// are ported here by hand.
//
// PORT (D3): `I: Interner` is erased; `cx: I` is typed `Interner` (the bodies only call trait methods). The methods of
// the generated types live on same-named companion consts taking `self` first (tyir-kind decision 1).
// PORT: the one-line `Placeholder*` / `Bound*` accessors of binder.rs (lane tyir-binder) are module-local stand-ins
// at the end of this file with the upstream bodies.
import { intern_key } from "../rust_ts/intern_key.ts";
import { KeyedMap } from "../rust_ts/keyed.ts";
import type { CanonicalVarKinds, ParamEnv } from "../rustc_middle/ty/decls.ts";
import type { GenericArg } from "../rustc_middle/ty/generic_args.ts";
import { debug_RawList } from "../rustc_middle/ty/list.ts";
import type { Ty } from "../rustc_middle/ty/mod.ts";
import { PLAIN } from "../std/fmt.ts";
import { assert, panic } from "../std/panic.ts";
import type { BoundRegion, Placeholder, PlaceholderConst, PlaceholderRegion, PlaceholderType } from "./binder.ts";
import * as gen from "./canonical.gen.ts";
import { DelayedMap } from "./data_structures/mod.ts";
import { debug_CanonicalVarKind } from "./canonical.gen.ts";
import type { Interner } from "./interner.ts";
import { type BoundVar, debug_UniverseIndex, UniverseIndex } from "./lib.ts";
import type { TyVid } from "./ty_kind.ts";

export * from "./canonical.gen.ts";

// ---- Canonical -----------------------------------------------------------------------------------------------------

export type Canonical<V> = gen.Canonical<V>;
export const Canonical = {
  /// Allows you to map the `value` of a canonical while keeping the
  /// same set of bound variables.
  ///
  /// **WARNING:** This function is very easy to mis-use, hence the
  /// name!  In particular, the new value `W` must use all **the
  /// same type/region variables** in **precisely the same order**
  /// as the original! (The ordering is defined by the
  /// `TypeFoldable` implementation of the type in question.)
  ///
  /// An example of a **correct** use of this:
  ///
  /// ```rust,ignore (not real code)
  /// let a: Canonical<I, T> = ...;
  /// let b: Canonical<I, (T,)> = a.unchecked_map(|v| (v, ));
  /// ```
  ///
  /// An example of an **incorrect** use of this:
  ///
  /// ```rust,ignore (not real code)
  /// let a: Canonical<I, T> = ...;
  /// let ty: Ty<I> = ...;
  /// let b: Canonical<I, (T, Ty<I>)> = a.unchecked_map(|v| (v, ty));
  /// ```
  // rustc: compiler/rustc_type_ir/src/canonical.rs:70 unchecked_map
  unchecked_map<V, W>(self: Canonical<V>, map_op: (value: V) => W): Canonical<W> {
    const { max_universe, var_kinds, value } = self;
    return { max_universe, var_kinds, value: map_op(value) };
  },
};

/** `impl<I: Interner, V: fmt::Display> fmt::Display for Canonical<I, V>`; `display_V` is `V`'s Display. */
// rustc: compiler/rustc_type_ir/src/canonical.rs:77 fmt
export function display_Canonical<V>(self: Canonical<V>, display_V: (v: V) => string): string {
  const { value, max_universe, var_kinds } = self;
  return `Canonical { value: ${display_V(value)}, max_universe: ${debug_UniverseIndex(max_universe, PLAIN)}, var_kinds: ${debug_CanonicalVarKinds(var_kinds)} }`;
}

/** PORT: `Debug` of `I::CanonicalVarKinds` (`&List<CanonicalVarKind>`: the slice's Debug). */
function debug_CanonicalVarKinds(v: CanonicalVarKinds): string {
  return debug_RawList(v, PLAIN, debug_CanonicalVarKind);
}

// ---- CanonicalVarKind ----------------------------------------------------------------------------------------------

export type CanonicalVarKind = gen.CanonicalVarKind;
export const CanonicalVarKind = {
  ...gen.CanonicalVarKind,

  // rustc: compiler/rustc_type_ir/src/canonical.rs:131 universe
  universe(self: CanonicalVarKind): UniverseIndex {
    switch (self.$) {
      case "Ty":
        return self.ui;
      case "Region":
        return self._0;
      case "Const":
        return self._0;
      case "PlaceholderTy":
        return PlaceholderType_universe(self._0);
      case "PlaceholderRegion":
        return PlaceholderRegion_universe(self._0);
      case "PlaceholderConst":
        return PlaceholderConst_universe(self._0);
      case "Float":
      case "Int":
        return UniverseIndex.ROOT;
    }
  },

  /// Replaces the universe of this canonical variable with `ui`.
  ///
  /// In case this is a float or int variable, this causes an ICE if
  /// the updated universe is not the root.
  // rustc: compiler/rustc_type_ir/src/canonical.rs:147 with_updated_universe
  with_updated_universe(self: CanonicalVarKind, ui: UniverseIndex): CanonicalVarKind {
    switch (self.$) {
      case "Ty":
        return { $: "Ty", ui, sub_root: self.sub_root };
      case "Region":
        return { $: "Region", _0: ui };
      case "Const":
        return { $: "Const", _0: ui };

      case "PlaceholderTy":
        return { $: "PlaceholderTy", _0: PlaceholderType_with_updated_universe(self._0, ui) };
      case "PlaceholderRegion":
        return { $: "PlaceholderRegion", _0: PlaceholderRegion_with_updated_universe(self._0, ui) };
      case "PlaceholderConst":
        return { $: "PlaceholderConst", _0: PlaceholderConst_with_updated_universe(self._0, ui) };
      case "Int":
      case "Float":
        assert(
          ui === UniverseIndex.ROOT,
          `assertion \`left == right\` failed\n  left: ${debug_UniverseIndex(ui, PLAIN)}\n right: ${debug_UniverseIndex(UniverseIndex.ROOT, PLAIN)}`,
        );
        return self;
    }
  },

  // rustc: compiler/rustc_type_ir/src/canonical.rs:169 is_existential
  is_existential(self: CanonicalVarKind): boolean {
    switch (self.$) {
      case "Ty":
      case "Int":
      case "Float":
      case "Region":
      case "Const":
        return true;
      case "PlaceholderTy":
      case "PlaceholderRegion":
      case "PlaceholderConst":
        return false;
    }
  },

  // rustc: compiler/rustc_type_ir/src/canonical.rs:182 is_region
  is_region(self: CanonicalVarKind): boolean {
    switch (self.$) {
      case "Region":
      case "PlaceholderRegion":
        return true;
      case "Ty":
      case "Int":
      case "Float":
      case "PlaceholderTy":
      case "Const":
      case "PlaceholderConst":
        return false;
    }
  },

  // rustc: compiler/rustc_type_ir/src/canonical.rs:194 expect_placeholder_index
  expect_placeholder_index(self: CanonicalVarKind): number {
    switch (self.$) {
      case "Ty":
      case "Int":
      case "Float":
      case "Region":
      case "Const":
        return panic(`expected placeholder: ${debug_CanonicalVarKind(self, PLAIN)}`);

      case "PlaceholderRegion":
        return PlaceholderRegion_var(self._0);
      case "PlaceholderTy":
        return PlaceholderType_var(self._0);
      case "PlaceholderConst":
        return PlaceholderConst_var(self._0);
    }
  },
};

// ---- CanonicalVarValues --------------------------------------------------------------------------------------------

export type CanonicalVarValues = gen.CanonicalVarValues;
export const CanonicalVarValues = {
  // rustc: compiler/rustc_type_ir/src/canonical.rs:233 instantiate
  instantiate(
    cx: Interner,
    var_kinds: CanonicalVarKinds,
    f: (var_values: readonly GenericArg[], info: CanonicalVarKind) => GenericArg,
  ): CanonicalVarValues {
    // Instantiating `CanonicalVarValues` is really hot, but limited to less than
    // 4 most of the time. Avoid creating a `Vec` here.
    if (var_kinds.length <= 4) {
      // PORT: `ArrayVec::<_, 4>` is an array.
      const var_values: GenericArg[] = [];
      for (const info of var_kinds) {
        var_values.push(f(var_values, info));
      }
      return { var_values: cx.mk_args(var_values) };
    } else {
      return CanonicalVarValues.instantiate_cold(cx, var_kinds, f);
    }
  },

  // rustc: compiler/rustc_type_ir/src/canonical.rs:252 instantiate_cold
  instantiate_cold(
    cx: Interner,
    var_kinds: CanonicalVarKinds,
    f: (var_values: readonly GenericArg[], info: CanonicalVarKind) => GenericArg,
  ): CanonicalVarValues {
    const var_values: GenericArg[] = [];
    for (const info of var_kinds) {
      var_values.push(f(var_values, info));
    }
    return { var_values: cx.mk_args(var_values) };
  },

  // rustc: compiler/rustc_type_ir/src/canonical.rs:265 len
  len(self: CanonicalVarValues): number {
    return self.var_values.length;
  },
};

// ---- CanonicalParamEnvCache / CanonicalizerState (working structs, skipped by codegen) ------------------------------

// PORT: the `HashMap<I::ParamEnv, _>` key is a struct compared by value: a `KeyedMap` keyed by `intern_key` (D5).
// rustc-type: compiler/rustc_type_ir/src/canonical.rs:271 CanonicalParamEnvCache
export class CanonicalParamEnvCache {
  constructor(public _0: Map<ParamEnv, gen.CanonicalParamEnvCacheEntry>) {}

  /** `#[derive_where(Default)]` */
  static default_(): CanonicalParamEnvCache {
    return new CanonicalParamEnvCache(new KeyedMap<ParamEnv, gen.CanonicalParamEnvCacheEntry>(intern_key));
  }
}

/// State used and modified by a canonicalizer during canonicalization. To avoid many allocations,
/// this state is reused by many canonicalizers from a single `InferCtxt`.
// rustc-type: compiler/rustc_type_ir/src/canonical.rs:288 CanonicalizerState
export class CanonicalizerState {
  constructor(
    public variables: GenericArg[],
    public var_kinds: CanonicalVarKind[],
    public variable_lookup_table: Map<GenericArg, number>,

    /// Maps each `sub_unification_table_root_var` to the index of the first
    /// variable which used it.
    ///
    /// This means in case two type variables have the same sub relations root,
    /// we set the `sub_root` of the second variable to the position of the first.
    /// Otherwise the `sub_root` of each type variable is just its own position.
    public sub_root_lookup_table: Map<TyVid, number>,

    /// We can simply cache based on the ty itself, because we use
    /// `ty::BoundVarIndexKind::Canonical`.
    public cache: DelayedMap<Ty, Ty>,
  ) {}

  /** `#[derive_where(Default)]` */
  static default_(): CanonicalizerState {
    return new CanonicalizerState([], [], new Map(), new Map(), DelayedMap.default_<Ty, Ty>());
  }

  // rustc: compiler/rustc_type_ir/src/canonical.rs:307 clear
  clear(): void {
    // Deconstruct to ensure no fields are missed.
    const { variables, var_kinds, variable_lookup_table, sub_root_lookup_table, cache } = this;
    variables.length = 0;
    var_kinds.length = 0;
    variable_lookup_table.clear();
    sub_root_lookup_table.clear();
    cache.clear();
  }
}

// ---- PORT stand-ins for fns of other files that are not ported yet (module header) -----------------------------------

/** PORT: stand-in for `PlaceholderRegion::universe` (binder.rs:1146, lane tyir-binder): `self.universe`. */
function PlaceholderRegion_universe(self: PlaceholderRegion): UniverseIndex {
  return self.universe;
}
/** PORT: stand-in for `PlaceholderRegion::var` (binder.rs:1150): `self.bound.var()` (`BoundRegion::var`: `self.var`). */
function PlaceholderRegion_var(self: PlaceholderRegion): BoundVar {
  return BoundRegion_var(self.bound);
}
/** PORT: stand-in for `BoundRegion::var` (binder.rs:1134): `self.var`. */
function BoundRegion_var(self: BoundRegion): BoundVar {
  return self.var;
}
/** PORT: stand-in for `PlaceholderRegion::with_updated_universe` (binder.rs:1154). */
function PlaceholderRegion_with_updated_universe(self: PlaceholderRegion, ui: UniverseIndex): PlaceholderRegion {
  return Placeholder_with_universe(self, ui);
}
/** PORT: stand-in for `PlaceholderType::universe` (binder.rs:1202): `self.universe`. */
function PlaceholderType_universe(self: PlaceholderType): UniverseIndex {
  return self.universe;
}
/** PORT: stand-in for `PlaceholderType::var` (binder.rs:1206): `self.bound.var`. */
function PlaceholderType_var(self: PlaceholderType): BoundVar {
  return self.bound.var;
}
/** PORT: stand-in for `PlaceholderType::with_updated_universe` (binder.rs:1210). */
function PlaceholderType_with_updated_universe(self: PlaceholderType, ui: UniverseIndex): PlaceholderType {
  return Placeholder_with_universe(self, ui);
}
/** PORT: stand-in for `PlaceholderConst::universe` (binder.rs:1258): `self.universe`. */
function PlaceholderConst_universe(self: PlaceholderConst): UniverseIndex {
  return self.universe;
}
/** PORT: stand-in for `PlaceholderConst::var` (binder.rs:1262): `self.bound.var`. */
function PlaceholderConst_var(self: PlaceholderConst): BoundVar {
  return self.bound.var;
}
/** PORT: stand-in for `PlaceholderConst::with_updated_universe` (binder.rs:1266). */
function PlaceholderConst_with_updated_universe(self: PlaceholderConst, ui: UniverseIndex): PlaceholderConst {
  return Placeholder_with_universe(self, ui);
}
/** `Self { universe: ui, bound: self.bound, _tcx: PhantomData }` (the three `with_updated_universe` bodies). */
function Placeholder_with_universe<T>(self: Placeholder<T>, ui: UniverseIndex): Placeholder<T> {
  return { universe: ui, bound: self.bound, _tcx: undefined };
}

