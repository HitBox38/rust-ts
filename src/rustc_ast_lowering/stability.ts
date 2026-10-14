// Port of compiler/rustc_ast_lowering/src/stability.rs (STUB, lane lower-index-diag: see
// docs/handoff/lowering-contract.md "How to fill a stub").
// `pub mod stability` of the crate root (lib.ts `export * as stability`).
import type { ExternAbi } from "../rustc_abi/extern_abi.ts";
import type { Features } from "../rustc_feature/unstable.ts";
import type { Session } from "../rustc_session/session.ts";
import type { Span } from "../rustc_span/lib.ts";
import { unported } from "../std/panic.ts";
import type { Result } from "../std/result.ts";

// Types of this file (PORT: `unknown` until codegen set rustc_ast_lowering generates stability.gen.ts).
/** stability.rs:42 `pub struct UnstableAbi` (+ `impl Display`, stability.rs:54) */
export type UnstableAbi = unknown;
/** stability.rs:48 `enum GateReason` */
export type GateReason = unknown;

// Free fns of this file (stubs; final signatures: decls.ts `FreeFns`).
// stability.rs:10
export function enabled_names(_features: Features, _span: Span): string[] {
  return unported("rustc_ast_lowering::stability::enabled_names");
}
// stability.rs:18
export function extern_abi_enabled(_features: Features, _span: Span, _abi: ExternAbi): Result<undefined, UnstableAbi> {
  return unported("rustc_ast_lowering::stability::extern_abi_enabled");
}
// stability.rs:32
export function gate_unstable_abi(_sess: Session, _features: Features, _span: Span, _abi: ExternAbi): void {
  return unported("rustc_ast_lowering::stability::gate_unstable_abi");
}
// stability.rs:67
export function extern_abi_stability(_abi: ExternAbi): Result<undefined, UnstableAbi> {
  return unported("rustc_ast_lowering::stability::extern_abi_stability");
}
