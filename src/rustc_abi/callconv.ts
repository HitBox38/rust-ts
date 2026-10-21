// Port of compiler/rustc_abi/src/callconv.rs (lane layout-contract: the types with their Debug; the fns are
// `// stub:` declarations for lane abi-lib, docs/handoff/layout-contract.md). `TyAndLayout::homogeneous_aggregate`
// (callconv.rs:69) is declared in the `TyAndLayout` class body (layout/ty.ts, PORTING §8).
// Init order: lib.ts re-exports this module, so its top-level code must not touch lib.ts's values.
import { type Debug, debug_tuple } from "../std/fmt.ts";
import { unported } from "../std/panic.ts";
import type { Result } from "../std/result.ts";
import { debug_Reg, type Reg } from "./callconv/reg.ts";

// mod reg;
export { Reg, RegKind, debug_Reg, debug_RegKind } from "./callconv/reg.ts";

/// Return value from the `homogeneous_aggregate` test function.
// #[derive(Copy, Clone, Debug)]
export type HomogeneousAggregate =
  /// Yes, all the "leaf fields" of this struct are passed in the
  /// same way (specified in the `Reg` value).
  | { readonly $: "Homogeneous"; readonly _0: Reg }

  /// There are no leaf fields at all.
  | { readonly $: "NoData" };
export const HomogeneousAggregate = {
  NoData: Object.freeze({ $: "NoData" }) as HomogeneousAggregate,

  /// If this is a homogeneous aggregate, returns the homogeneous
  /// unit, else `None`.
  // stub: compiler/rustc_abi/src/callconv.rs:28 unit (lane abi-lib)
  unit(_self: HomogeneousAggregate): Reg | undefined {
    return unported("rustc_abi::callconv::HomogeneousAggregate::unit");
  },

  /// Try to combine two `HomogeneousAggregate`s, e.g. from two fields in
  /// the same `struct`. Only succeeds if only one of them has any data,
  /// or both units are identical.
  // #[cfg(feature = "nightly")]
  // stub: compiler/rustc_abi/src/callconv.rs:39 merge (lane abi-lib)
  merge(_self: HomogeneousAggregate, _other: HomogeneousAggregate): Result<HomogeneousAggregate, Heterogeneous> {
    return unported("rustc_abi::callconv::HomogeneousAggregate::merge");
  },
} as const;
// derive(Debug)
export const debug_HomogeneousAggregate: Debug<HomogeneousAggregate> = (v, f) => {
  switch (v.$) {
    case "Homogeneous":
      return debug_tuple(f, "Homogeneous", [debug_Reg(v._0, f)]);
    case "NoData":
      return "NoData";
  }
};

/// Error from the `homogeneous_aggregate` test function, indicating
/// there are distinct leaf fields passed in different ways,
/// or this is uninhabited.
// #[derive(Copy, Clone, Debug)]
// PORT (layout-contract): a unit struct is `null`.
export type Heterogeneous = null;
export const Heterogeneous: Heterogeneous = null;
// derive(Debug)
export const debug_Heterogeneous: Debug<Heterogeneous> = () => "Heterogeneous";
