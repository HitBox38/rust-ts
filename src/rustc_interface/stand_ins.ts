// Not an upstream mirror. PORT: stand-ins for crates the driver path reaches but that are not ported:
//   rustc_codegen_ssa::TargetConfig (lib.rs); `CodegenBackend` is re-exported from rustc_codegen_ssa/traits/backend.ts
//   (the LLVM backend stand-in is src/rust_ts/codegen_backend.ts)
// Each keeps only what can be copied verbatim or is observable-free on the paths the port runs; everything
// else calls `unported(...)`. Replace by the real modules when those crates are ported.
import type { Symbol } from "../rustc_span/symbol.ts";


/// `rustc_codegen_ssa::TargetConfig` (rustc_codegen_ssa/src/lib.rs:309)
export interface TargetConfig {
  /// Options to be set in `sess.internal_target_features`.
  internal_target_features: Set<Symbol>;
  /// Option for `cfg(target_has_reliable_f16)`, true if `f16` basic arithmetic works.
  has_reliable_f16: boolean;
  /// Option for `cfg(target_has_reliable_f16_math)`, true if `f16` math calls work.
  has_reliable_f16_math: boolean;
  /// Option for `cfg(target_has_reliable_f16b)`, presently true if both the ABI
  /// and LLVM version supports `f16b`.
  has_reliable_f16b: boolean;
  /// Option for `cfg(target_has_reliable_f128)`, true if `f128` basic arithmetic works.
  has_reliable_f128: boolean;
  /// Option for `cfg(target_has_reliable_f128_math)`, true if `f128` math calls work.
  has_reliable_f128_math: boolean;
}

/** `rustc_codegen_ssa::traits::CodegenBackend` and its provided methods: ported in rustc_codegen_ssa/traits/backend.ts
 *  (lane ssa-contract), re-exported here for the existing imports. */
export { type CodegenBackend, CodegenBackend_provided } from "../rustc_codegen_ssa/traits/backend.ts";

/** PORT: `rustc_session::IncrCompSession` (session.rs): no incremental compilation (D3), so never constructed. */
export type IncrCompSession = never;

/** PORT: `rustc_middle::dep_graph::WorkProductMap` (`UnordMap<WorkProductId, WorkProduct>`): no incremental (D3). */
export type WorkProductMap = Map<unknown, unknown>;

/** `rustc_middle::ty::CurrentGcx`: the real type (re-exported for the existing imports). */
export { CurrentGcx } from "../rustc_middle/ty/context.ts";
