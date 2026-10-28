// Port of compiler/rustc_type_ir/src/region_kind.rs (lane tyir-kind). The types with their derived Debug / TypeVisitable /
// TypeFoldable impls are generated into region_kind.gen.ts (set rustc_ty of tools/codegen/types.ts, lane codegen-tyir);
// this file holds the manual impls.
// PORT: `write!(f, "{:?}", x)` formats `x` with fresh options (no `{:#?}`), so those operands use `PLAIN`.
import { stable_hash_Discriminant, type StableHashCtxt, type StableHasher } from "../rustc_data_structures/stable_hash.ts";
import { debug_EarlyParamRegion } from "../rustc_middle/ty/region.ts";
import { panic } from "../std/panic.ts";
import { type Debug, PLAIN } from "../std/fmt.ts";
import { debug_BoundRegion, debug_Placeholder } from "./binder.ts";
import { debug_RegionVid, type RegionKind } from "./region_kind.gen.ts";
import { debug_LateParamRegion } from "./sty/mod.ts";
import { debug_bound_var } from "./lib.ts";

export * from "./region_kind.gen.ts";

// rustc: compiler/rustc_type_ir/src/region_kind.rs:191 fmt
export const debug_RegionKind: Debug<RegionKind> = (self, _f) => {
  switch (self.$) {
    case "ReEarlyParam":
      return debug_EarlyParamRegion(self._0, PLAIN);

    case "ReBound": {
      return "'" + debug_bound_var(self._0, self._1, debug_BoundRegion);
    }

    case "ReLateParam":
      return debug_LateParamRegion(self._0, PLAIN);

    case "ReStatic":
      return "'static";

    case "ReVar":
      return debug_RegionVid(self._0, PLAIN);

    case "RePlaceholder":
      return `'${debug_Placeholder(self._0, PLAIN, debug_BoundRegion)}`;

    // Use `'{erased}` as the output instead of `'erased` so that its more obviously distinct from
    // a `ReEarlyParam` named `'erased`. Technically that would print as `'erased/#IDX` so this is
    // not strictly necessary but *shrug*
    case "ReErased":
      return "'{erased}";

    case "ReError":
      return "'{region error}";
  }
};

// PORT (init order): the generated StableHash module reaches most of rustc_middle at load, so it is required lazily
// (the precedent of the `tyir_*` accessors in rustc_middle ty/mod.ts).
function ty_stable_hash(): typeof import("./ty_stable_hash.gen.ts") {
  return (ty_stable_hash__m ??= require("./ty_stable_hash.gen.ts") as typeof import("./ty_stable_hash.gen.ts"));
}
var ty_stable_hash__m: typeof import("./ty_stable_hash.gen.ts") | undefined;
function middle_ty_stable_hash(): typeof import("../rustc_middle/ty_stable_hash.gen.ts") {
  return (middle_ty_stable_hash__m ??= require("../rustc_middle/ty_stable_hash.gen.ts") as typeof import("../rustc_middle/ty_stable_hash.gen.ts"));
}
var middle_ty_stable_hash__m: typeof import("../rustc_middle/ty_stable_hash.gen.ts") | undefined;
// This impl could be derived with `StableHash_NoContext`, but we instead write it by hand in order
// to panic on `ReVar`.
// PORT: `mem::discriminant(self)`: the variant index in declaration order (region_kind.rs:146).
const RegionKind__discriminant = { ReEarlyParam: 0, ReBound: 1, ReLateParam: 2, ReStatic: 3, ReVar: 4, RePlaceholder: 5, ReErased: 6, ReError: 7 } as const;
// rustc: compiler/rustc_type_ir/src/region_kind.rs:228 stable_hash
export function stable_hash_RegionKind(self: RegionKind, hcx: StableHashCtxt, hasher: StableHasher): void {
  stable_hash_Discriminant(RegionKind__discriminant[self.$], hcx, hasher);
  switch (self.$) {
    case "ReErased":
    case "ReStatic":
    case "ReError":
      // No variant fields to hash for these ...
      break;
    case "ReBound":
      ty_stable_hash().stable_hash_BoundVarIndexKind(self._0, hcx, hasher);
      ty_stable_hash().stable_hash_BoundRegion(self._1, hcx, hasher);
      break;
    case "ReEarlyParam":
      middle_ty_stable_hash().stable_hash_EarlyParamRegion(self._0, hcx, hasher);
      break;
    case "ReLateParam":
      ty_stable_hash().stable_hash_LateParamRegion(self._0, hcx, hasher);
      break;
    case "RePlaceholder":
      ty_stable_hash().stable_hash_Placeholder(self._0, hcx, hasher, ty_stable_hash().stable_hash_BoundRegion);
      break;
    case "ReVar":
      panic(`region variables should not be hashed: ${debug_RegionKind(self, PLAIN)}`);
  }
}
