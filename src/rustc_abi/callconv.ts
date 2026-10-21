// Port of compiler/rustc_abi/src/callconv.rs (lane layout-contract: the types with their Debug; lane abi-lib: the fns). `TyAndLayout::homogeneous_aggregate`
// (callconv.rs:69) is declared in the `TyAndLayout` class body (layout/ty.ts, PORTING §8).
// Init order: lib.ts re-exports this module, so its top-level code must not touch lib.ts's values.
import { type Debug, debug_tuple } from "../std/fmt.ts";
import { Err, Ok, type Result } from "../std/result.ts";
import { debug_Reg, type Reg, Reg_eq } from "./callconv/reg.ts";

// mod reg;
export { Reg, RegKind, Reg_eq, RegKind_eq, debug_Reg, debug_RegKind } from "./callconv/reg.ts";

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
  // rustc: compiler/rustc_abi/src/callconv.rs:28 unit
  unit(self: HomogeneousAggregate): Reg | undefined {
    switch (self.$) {
      case "Homogeneous":
        return self._0;
      case "NoData":
        return undefined;
    }
  },

  /// Try to combine two `HomogeneousAggregate`s, e.g. from two fields in
  /// the same `struct`. Only succeeds if only one of them has any data,
  /// or both units are identical.
  // #[cfg(feature = "nightly")]
  // rustc: compiler/rustc_abi/src/callconv.rs:39 merge
  merge(self: HomogeneousAggregate, other: HomogeneousAggregate): Result<HomogeneousAggregate, Heterogeneous> {
    // (x, HomogeneousAggregate::NoData) | (HomogeneousAggregate::NoData, x) => Ok(x),
    if (other.$ === "NoData") return Ok(self);
    if (self.$ === "NoData") return Ok(other);

    // (HomogeneousAggregate::Homogeneous(a), HomogeneousAggregate::Homogeneous(b))
    const [a, b] = [self._0, other._0];
    if (!Reg_eq(a, b)) {
      return Err(Heterogeneous);
    }
    return Ok(self);
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
