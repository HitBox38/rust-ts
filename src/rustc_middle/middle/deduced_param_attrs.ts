// Port of compiler/rustc_middle/src/middle/deduced_param_attrs.rs (lane fn-abi: rustc_ty_utils abi.rs
// `apply_deduced_attributes` reads it).
//
// PORT: hand-written types. `UsageSummary` (`bitflags!` on a `u8` newtype) is a branded number with the `Flags`
// companion (as rustc_abi's `ReprFlags`); its derived `Debug` prints the newtype (`UsageSummary(<u8>)`). `DeducedParamAttrs` is `Copy` data without `&mut self` methods:
// an interface; its methods are on the companion.
import type { TyCtxt } from "../ty/context.ts";
import type { Ty, TypingEnv } from "../ty/mod.ts";
import { type Debug, debug_int, debug_struct, debug_tuple } from "../../std/fmt.ts";
import { flags_companion } from "../../vendor/bitflags/traits.ts";

/// Summarizes how a parameter (a return place or an argument) is used inside a MIR body.
// #[derive(Clone, Copy, PartialEq, Debug, Decodable, Encodable, StableHash)]
// pub struct UsageSummary(u8);
export type UsageSummary = number & { readonly __brand: "UsageSummary" };
export const UsageSummary = flags_companion<
  UsageSummary,
  {
    DROP: UsageSummary;
    SHARED_BORROW: UsageSummary;
    MUTATE: UsageSummary;
    CAPTURE: UsageSummary;
  }
>(
  8,
  {
    /// This parameter is dropped when it `needs_drop`.
    DROP: (1 << 0) as UsageSummary,
    /// There is a shared borrow to this parameter.
    /// It allows for mutation unless parameter is `Freeze`.
    SHARED_BORROW: (1 << 1) as UsageSummary,
    /// This parameter is mutated (excluding through a drop or a shared borrow).
    MUTATE: (1 << 2) as UsageSummary,
    /// This parameter is captured (excluding through a drop).
    CAPTURE: (1 << 3) as UsageSummary,
  },
  [
    ["DROP", (1 << 0) as UsageSummary],
    ["SHARED_BORROW", (1 << 1) as UsageSummary],
    ["MUTATE", (1 << 2) as UsageSummary],
    ["CAPTURE", (1 << 3) as UsageSummary],
  ],
);
// derive(Debug) of the `u8` newtype (bitflags' "impl" form adds no Debug): `UsageSummary(<u8>)`.
export const debug_UsageSummary: Debug<UsageSummary> = (v, f) => debug_tuple(f, "UsageSummary", [debug_int(v, f)]);

/// Parameter attributes that can only be determined by examining the body of a function instead
/// of just its signature.
///
/// These can be useful for optimization purposes when a function is directly called. We compute
/// them and store them into the crate metadata so that downstream crates can make use of them.
///
/// Right now, we have `readonly` and `captures(none)`, but `no_alias` might be useful in the
/// future.
// #[derive(Clone, Copy, PartialEq, Debug, Decodable, Encodable, StableHash)]
export interface DeducedParamAttrs {
  readonly usage: UsageSummary;
}
// derive(Debug)
export const debug_DeducedParamAttrs: Debug<DeducedParamAttrs> = (v, f) => debug_struct(f, "DeducedParamAttrs", [["usage", debug_UsageSummary(v.usage, f)]]);

export const DeducedParamAttrs = {
  /// Returns true if no attributes have been deduced.
  // #[inline]
  // rustc: compiler/rustc_middle/src/middle/deduced_param_attrs.rs:39 is_default
  is_default(self: DeducedParamAttrs): boolean {
    return UsageSummary.contains(self.usage, UsageSummary.union(UsageSummary.MUTATE, UsageSummary.CAPTURE));
  },

  /// For parameters passed indirectly, returns true if pointer is never written through.
  // rustc: compiler/rustc_middle/src/middle/deduced_param_attrs.rs:44 read_only
  read_only(self: DeducedParamAttrs, tcx: TyCtxt, typing_env: TypingEnv, ty: Ty): boolean {
    // Only if all checks pass is this truly read-only.
    if (UsageSummary.contains(self.usage, UsageSummary.MUTATE)) {
      return false;
    }
    if (UsageSummary.contains(self.usage, UsageSummary.DROP) && ty.needs_drop(tcx, typing_env)) {
      return false;
    }
    if (UsageSummary.contains(self.usage, UsageSummary.SHARED_BORROW) && !ty.is_freeze(tcx, typing_env)) {
      return false;
    }
    return true;
  },

  /// For parameters passed indirectly, returns true if pointer is not captured, i.e., its
  /// address is not captured, and pointer is used neither for reads nor writes after function
  /// returns.
  // rustc: compiler/rustc_middle/src/middle/deduced_param_attrs.rs:66 captures_none
  captures_none(self: DeducedParamAttrs, tcx: TyCtxt, typing_env: TypingEnv, ty: Ty): boolean {
    if (UsageSummary.contains(self.usage, UsageSummary.CAPTURE)) {
      return false;
    }
    if (UsageSummary.contains(self.usage, UsageSummary.DROP) && ty.needs_drop(tcx, typing_env)) {
      return false;
    }
    return true;
  },
};
