// Port of compiler/rustc_infer/src/infer/unify_key.rs (lane infcx-contract: ported in full, the ena glue that
// `InferCtxtInner::new` needs). The types (with their derived Debug / Clone) are generated into unify_key.gen.ts.
//
// PORT: `impl UnifyKey for K` / `impl UnifyValue for V` are dictionaries (`UnifyKey_<K>` / `UnifyValue_<V>`, the
// shape of vendor ena's `UnifyKey<K, V, E>` / `UnifyValue<V, E>`, as rustc_type_ir ty_kind.ts's `UnifyKey_IntVid`);
// `impl From<Vid> for K` is `<K>_from`. The `PhantomData` fields are `undefined`. Keys compare by `vid` (derived
// `PartialEq`).
// PORT: inherent methods of the generated enums are companion functions taking `self` first (PORTING §8).
import { bug } from "../../rustc_span/macros.ts";
import { type ConstVid, ConstVid as ConstVidC } from "../../rustc_type_ir/const_kind.ts";
import { UniverseIndex } from "../../rustc_type_ir/lib.ts";
import { type RegionVid, RegionVid as RegionVidC } from "../../rustc_type_ir/region_kind.ts";
import type { Const } from "../../rustc_type_ir/sty/consts.ts";
import type { Region } from "../../rustc_type_ir/sty/mod.ts";
import { unreachable } from "../../std/panic.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
import { type NoError, type UnifyKey, UnifyKey_provided, type UnifyValue } from "../../vendor/ena/unify/mod.ts";
import type { ConstVidKey, RegionVariableValue, RegionVidKey } from "./unify_key.gen.ts";
import type * as gen from "./unify_key.gen.ts";

export * from "./unify_key.gen.ts";

// ---- RegionVidKey ----------------------------------------------------------------------------------------------------

/** `impl From<ty::RegionVid> for RegionVidKey` */
// rustc: compiler/rustc_infer/src/infer/unify_key.rs:22 from
export function RegionVidKey_from(vid: RegionVid): RegionVidKey {
  return { vid, phantom: undefined };
}

/** `impl UnifyKey for RegionVidKey` (`type Value = RegionVariableValue`). */
export const UnifyKey_RegionVidKey: UnifyKey<RegionVidKey, RegionVariableValue, RegionUnificationError> = {
  get Value(): UnifyValue<RegionVariableValue, RegionUnificationError> {
    return UnifyValue_RegionVariableValue;
  },
  eq: (a, b) => a.vid === b.vid,

  // rustc: compiler/rustc_infer/src/infer/unify_key.rs:30 index
  index(self: RegionVidKey): number {
    return RegionVidC.as_u32(self.vid);
  },

  // rustc: compiler/rustc_infer/src/infer/unify_key.rs:34 from_index
  from_index(i: number): RegionVidKey {
    return RegionVidKey_from(RegionVidC.from_u32(i));
  },

  // rustc: compiler/rustc_infer/src/infer/unify_key.rs:37 tag
  tag(): string {
    return "RegionVidKey";
  },

  order_roots: UnifyKey_provided.order_roots,
};

/** The value of the unit struct `RegionUnificationError`. */
export type RegionUnificationError = gen.RegionUnificationError;
export const RegionUnificationError: RegionUnificationError = Object.freeze({});

/** `impl UnifyValue for RegionVariableValue` (`type Error = RegionUnificationError`). */
export const UnifyValue_RegionVariableValue: UnifyValue<RegionVariableValue, RegionUnificationError> = {
  clone: (v) => v,

  // rustc: compiler/rustc_infer/src/infer/unify_key.rs:47 unify_values
  unify_values(value1: RegionVariableValue, value2: RegionVariableValue): Result<RegionVariableValue, RegionUnificationError> {
    if (value1.$ === "Known" && value2.$ === "Known") {
      return Err(RegionUnificationError);
    } else if (value1.$ === "Unknown" && value2.$ === "Unknown") {
      const a = value1.universe;
      const b = value2.universe;
      // If we unify two unconstrained regions then whatever
      // value they wind up taking (which must be the same value) must
      // be nameable by both universes. Therefore, the resulting
      // universe is the minimum of the two universes, because that is
      // the one which contains the fewest names in scope.
      return Ok({ $: "Unknown", universe: (a < b ? a : b) });
    } else {
      // PORT: the or-pattern `(Known { value }, Unknown { universe }) | (Unknown { universe }, Known { value })`.
      let value: Region;
      let universe: UniverseIndex;
      if (value1.$ === "Known" && value2.$ === "Unknown") {
        value = value1.value;
        universe = value2.universe;
      } else if (value1.$ === "Unknown" && value2.$ === "Known") {
        universe = value1.universe;
        value = value2.value;
      } else {
        return unreachable();
      }
      let universe_of_value: UniverseIndex;
      const kind = value.kind();
      switch (kind.$) {
        case "ReStatic":
        case "ReErased":
        case "ReLateParam":
        case "ReEarlyParam":
        case "ReError":
          universe_of_value = UniverseIndex.ROOT;
          break;
        case "RePlaceholder":
          universe_of_value = kind._0.universe;
          break;
        case "ReVar":
        case "ReBound":
          return bug("not a universal region");
      }

      if (UniverseIndex.can_name(universe, universe_of_value)) {
        return Ok({ $: "Known", value });
      } else {
        return Err(RegionUnificationError);
      }
    }
  },
};

// Generic consts.

// ---- ConstVariableValue ----------------------------------------------------------------------------------------------

export type ConstVariableValue = gen.ConstVariableValue;
export const ConstVariableValue = {
  /// If this value is known, returns the const it is known to be.
  /// Otherwise, `None`.
  // rustc: compiler/rustc_infer/src/infer/unify_key.rs:107 known
  known(self: ConstVariableValue): Const | undefined {
    switch (self.$) {
      case "Unknown":
        return undefined;
      case "Known":
        return self.value;
    }
  },

  // rustc: compiler/rustc_infer/src/infer/unify_key.rs:114 is_unknown
  is_unknown(self: ConstVariableValue): boolean {
    switch (self.$) {
      case "Unknown":
        return true;
      case "Known":
        return false;
    }
  },
};

// ---- ConstVidKey -----------------------------------------------------------------------------------------------------

/** `impl From<ty::ConstVid> for ConstVidKey` */
// rustc: compiler/rustc_infer/src/infer/unify_key.rs:129 from
export function ConstVidKey_from(vid: ConstVid): ConstVidKey {
  return { vid, phantom: undefined };
}

/** `impl UnifyKey for ConstVidKey` (`type Value = ConstVariableValue`). */
export const UnifyKey_ConstVidKey: UnifyKey<ConstVidKey, ConstVariableValue, NoError> = {
  get Value(): UnifyValue<ConstVariableValue, NoError> {
    return UnifyValue_ConstVariableValue;
  },
  eq: (a, b) => a.vid === b.vid,

  // rustc: compiler/rustc_infer/src/infer/unify_key.rs:137 index
  index(self: ConstVidKey): number {
    return ConstVidC.as_u32(self.vid);
  },

  // rustc: compiler/rustc_infer/src/infer/unify_key.rs:141 from_index
  from_index(i: number): ConstVidKey {
    return ConstVidKey_from(ConstVidC.from_u32(i));
  },

  // rustc: compiler/rustc_infer/src/infer/unify_key.rs:144 tag
  tag(): string {
    return "ConstVidKey";
  },

  // rustc: compiler/rustc_infer/src/infer/unify_key.rs:147 order_roots
  order_roots(a: ConstVidKey, _a_value: ConstVariableValue, b: ConstVidKey, _b_value: ConstVariableValue): [ConstVidKey, ConstVidKey] | undefined {
    if (ConstVidC.as_u32(a.vid) < ConstVidC.as_u32(b.vid)) {
      return [a, b];
    } else {
      return [b, a];
    }
  },
};

/** `impl UnifyValue for ConstVariableValue` (`type Error = NoError`). */
export const UnifyValue_ConstVariableValue: UnifyValue<ConstVariableValue, NoError> = {
  clone: (v) => v,

  // rustc: compiler/rustc_infer/src/infer/unify_key.rs:155 unify_values
  unify_values(value1: ConstVariableValue, value2: ConstVariableValue): Result<ConstVariableValue, NoError> {
    if (value1.$ === "Known" && value2.$ === "Known") {
      return bug("equating two const variables, both of which have known values");
    } else if (value1.$ === "Known" && value2.$ === "Unknown") {
      // If one side is known, prefer that one.
      return Ok(value1);
    } else if (value1.$ === "Unknown" && value2.$ === "Known") {
      return Ok(value2);
    } else if (value1.$ === "Unknown" && value2.$ === "Unknown") {
      // If both sides are *unknown*, it hardly matters, does it?
      const origin = value1.origin;
      const universe1 = value1.universe;
      const universe2 = value2.universe;
      // If we unify two unbound variables, ?T and ?U, then whatever
      // value they wind up taking (which must be the same value) must
      // be nameable by both universes. Therefore, the resulting
      // universe is the minimum of the two universes, because that is
      // the one which contains the fewest names in scope.
      const universe = universe1 < universe2 ? universe1 : universe2;
      return Ok({ $: "Unknown", origin, universe });
    } else {
      return unreachable();
    }
  },
};
