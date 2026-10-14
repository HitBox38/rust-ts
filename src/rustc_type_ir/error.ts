// Port of compiler/rustc_type_ir/src/error.rs (lane tyir-misc, sub-lane lib-sty). The types with their derived Debug /
// TypeVisitable / TypeFoldable impls are generated into error.gen.ts (set rustc_ty of tools/codegen/types.ts); this
// file holds the inherent methods and the `From` impls.
// PORT: methods of the generated `ExpectedFound` / `TypeError` live on same-named companion consts taking `self` first
// (tyir-kind decision 1). The `From<TypeError>` impls for `NoSolution` / `NoSolutionOrRerunNonErased` are free fns
// `<Y>_from_TypeError` here, because the companions of those solve/mod.rs types are lane tyir-solve's.
import * as gen from "./error.gen.ts";
import type { NoSolution, NoSolutionOrRerunNonErased } from "./solve/mod.ts";

export * from "./error.gen.ts";

export type ExpectedFound<T> = gen.ExpectedFound<T>;
export const ExpectedFound = {
  // rustc: compiler/rustc_type_ir/src/error.rs:16 new
  new<T>(expected: T, found: T): ExpectedFound<T> {
    return { expected, found };
  },
};

export type TypeError = gen.TypeError;
export const TypeError = {
  ...gen.TypeError,

  // rustc: compiler/rustc_type_ir/src/error.rs:66 involves_regions
  involves_regions(self: TypeError): boolean {
    switch (self.$) {
      case "RegionsDoesNotOutlive":
      case "RegionsInsufficientlyPolymorphic":
      case "RegionsPlaceholderMismatch":
        return true;
      default:
        return false;
    }
  },

  // rustc: compiler/rustc_type_ir/src/error.rs:75 must_include_note
  must_include_note(self: TypeError): boolean {
    switch (self.$) {
      case "CyclicTy":
      case "CyclicConst":
      case "SafetyMismatch":
      case "PolarityMismatch":
      case "Mismatch":
      case "AbiMismatch":
      case "ArraySize":
      case "ArgumentSorts":
      case "Sorts":
      case "VariadicMismatch":
      case "SplatMismatch":
      case "TargetFeatureCast":
        return false;

      case "Mutability":
      case "ArgumentMutability":
      case "TupleSize":
      case "ArgCount":
      case "RegionsDoesNotOutlive":
      case "RegionsInsufficientlyPolymorphic":
      case "RegionsPlaceholderMismatch":
      case "Traits":
      case "ProjectionMismatched":
      case "ExistentialMismatch":
      case "ConstMismatch":
      case "ForceInlineCast":
      case "IntrinsicCast":
        return true;
    }
  },
};

// rustc: compiler/rustc_type_ir/src/error.rs:100 from
export function NoSolution_from_TypeError(_: TypeError): NoSolution {
  return {};
}

// rustc: compiler/rustc_type_ir/src/error.rs:106 from
export function NoSolutionOrRerunNonErased_from_TypeError(_: TypeError): NoSolutionOrRerunNonErased {
  return { $: "NoSolution", _0: {} };
}
