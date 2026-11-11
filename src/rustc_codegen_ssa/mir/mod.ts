// compiler/rustc_codegen_ssa/src/mir/mod.rs: NOT PORTED YET (lane ssa-mir-core, plan-m7 wave 41).
//
// PORT (ssa-contract): the type surface the traits (traits/intrinsic.ts) need, placed in the file lane ssa-mir-core
// will port: `IntrinsicResult`, an enum with data (a `$`-tagged union, PORTING §5, with its unit variant's frozen singleton
// on the companion const).
import type { Instance } from "../../rustc_middle/ty/instance.ts";
import type { ErrorGuaranteed } from "../../rustc_span/lib.ts";
import type { OperandValue } from "./operand.ts";

export type IntrinsicResult<V> =
  /// This intrinsic created an operand without using the `result_place` argument.
  ///
  /// `codegen_call_terminator` will handle writing the result into the place,
  /// if doing so is needed.
  ///
  /// The vast majority of intrinsics can do this, see MCP#970
  | { readonly $: "Operand"; _0: OperandValue<V> }

  /// The intrinsic wrote its result into the `result_place` argument.
  ///
  /// Most things don't need to do this, but there are some: `volatile_load`
  /// of a non-scalar type, for example, has to.
  | { readonly $: "WroteIntoPlace" }

  /// Another instance should be called instead. This is used to invoke intrinsic
  /// default bodies in case an intrinsic is not implemented by the backend.
  | { readonly $: "Fallback"; _0: Instance }

  /// Arguably this shouldn't exist, per MCP#620, but a bunch do it.
  | { readonly $: "Err"; _0: ErrorGuaranteed };
export const IntrinsicResult = {
  /** Shared frozen singleton of the unit variant (PORTING §5; docs/reviews/ssa-contract.md N2). */
  WroteIntoPlace: Object.freeze({ $: "WroteIntoPlace" }) as { readonly $: "WroteIntoPlace" },
} as const;
