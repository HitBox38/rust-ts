// Port of compiler/rustc_type_ir/src/region_kind.rs (lane tyir-kind). The types with their derived Debug / TypeVisitable /
// TypeFoldable impls are generated into region_kind.gen.ts (set rustc_ty of tools/codegen/types.ts, lane codegen-tyir);
// this file holds the manual impls.
// PORT: `write!(f, "{:?}", x)` formats `x` with fresh options (no `{:#?}`), so those operands use `PLAIN`.
import { debug_EarlyParamRegion } from "../rustc_middle/ty/region.ts";
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

// This impl could be derived with `StableHash_NoContext`, but we instead write it by hand in order
// to panic on `ReVar`.
// rustc-skip: compiler/rustc_type_ir/src/region_kind.rs:228 stable_hash StableHash impl (incremental, M5)
