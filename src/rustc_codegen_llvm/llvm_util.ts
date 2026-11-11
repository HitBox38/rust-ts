// compiler/rustc_codegen_llvm/src/llvm_util.rs: the SKELETON (lane cg-contract). The fill lane cg-write (plan-m7 §8 wave 42)
// owns this file and ports llvm_util.rs here, replacing each `Stub (cg-contract)` with its port. src/rust_ts/codegen_backend.ts
// (the stand-in backend, still the one rustc_interface constructs) holds the oracle tables and the partial ports of
// `global_llvm_features`, `target_config` and `target_cpu` that this lane's port must reproduce (plan-m7 §2e).
//
// What is here: typed stubs of the functions back/llvm_backend.ts calls.
import type { TargetConfig } from "../rustc_interface/stand_ins.ts";
import type { PrintRequest } from "../rustc_session/config/print_request.ts";
import type { EarlySession, Session } from "../rustc_session/session.ts";
import type { PathBuf } from "../rustc_error_messages/lib.ts";
import type { MutRef } from "../std/mut_ref.ts";
import { unported } from "../std/panic.ts";
import type { Target } from "../rustc_target/spec/mod.ts";

// Stub (cg-contract): init (llvm_util.rs:31)
export function init(_sess: EarlySession): void {
  return unported("cg-write: compiler/rustc_codegen_llvm/src/llvm_util.rs init");
}

/** `file_name: &Path` */
// Stub (cg-contract): time_trace_profiler_finish (llvm_util.rs:171)
export function time_trace_profiler_finish(_file_name: PathBuf): void {
  return unported("cg-write: compiler/rustc_codegen_llvm/src/llvm_util.rs time_trace_profiler_finish");
}

// The type surface other fill lanes use (review F2): `LLVMFeature` (fields only) and `TargetFeatureFoldStrength`.
export type TargetFeatureFoldStrength =
  // The feature is only tied when enabling the feature, disabling
  // this feature shouldn't disable the tied feature.
  | { readonly $: "EnableOnly"; readonly _0: string }
  // The feature is tied for both enabling and disabling this feature.
  | { readonly $: "Both"; readonly _0: string };

export class LLVMFeature {
  constructor(
    /** private */
    public llvm_feature_name: string,
    /** private. `SmallVec<[TargetFeatureFoldStrength<'a>; 1]>` */
    public dependencies: TargetFeatureFoldStrength[],
  ) {}

  /** `impl<'a> IntoIterator for LLVMFeature<'a>` (`type IntoIter = impl Iterator<Item = &'a str>`): the names, eagerly. */
  // Stub (cg-contract): into_iter (llvm_util.rs:217)
  into_iter(): string[] {
    return unported("cg-write: compiler/rustc_codegen_llvm/src/llvm_util.rs into_iter");
  }
}

// Stub (cg-contract): to_llvm_features (llvm_util.rs:239)
export function to_llvm_features(_target: Target, _s: string): LLVMFeature | undefined {
  return unported("cg-write: compiler/rustc_codegen_llvm/src/llvm_util.rs to_llvm_features");
}

// Stub (cg-contract): target_config (llvm_util.rs:325)
export function target_config(_sess: EarlySession): TargetConfig {
  return unported("cg-write: compiler/rustc_codegen_llvm/src/llvm_util.rs target_config");
}

// Stub (cg-contract): print_version (llvm_util.rs:463)
export function print_version(): void {
  return unported("cg-write: compiler/rustc_codegen_llvm/src/llvm_util.rs print_version");
}

// Stub (cg-contract): get_version (llvm_util.rs:469)
export function get_version(): [number, number, number] {
  return unported("cg-write: compiler/rustc_codegen_llvm/src/llvm_util.rs get_version");
}

// Stub (cg-contract): print_passes (llvm_util.rs:477)
export function print_passes(): void {
  return unported("cg-write: compiler/rustc_codegen_llvm/src/llvm_util.rs print_passes");
}

/** `out: &mut String` */
// Stub (cg-contract): print (llvm_util.rs:507)
export function print(_req: PrintRequest, _out: MutRef<string>, _sess: Session): void {
  return unported("cg-write: compiler/rustc_codegen_llvm/src/llvm_util.rs print");
}

// Stub (cg-contract): target_cpu (llvm_util.rs:657)
export function target_cpu(_sess: EarlySession): string {
  return unported("cg-write: compiler/rustc_codegen_llvm/src/llvm_util.rs target_cpu");
}

// Stub (cg-contract): global_llvm_features (llvm_util.rs:688)
export function global_llvm_features(_sess: EarlySession, _for_cfg: boolean): string[] {
  return unported("cg-write: compiler/rustc_codegen_llvm/src/llvm_util.rs global_llvm_features");
}

// Stub (cg-contract): tune_cpu (llvm_util.rs:800)
export function tune_cpu(_sess: Session): string | undefined {
  return unported("cg-write: compiler/rustc_codegen_llvm/src/llvm_util.rs tune_cpu");
}

// Stub (cg-contract): target_has_mnemonic (llvm_util.rs:805)
export function target_has_mnemonic(_sess: Session, _mnemonic: string): boolean {
  return unported("cg-write: compiler/rustc_codegen_llvm/src/llvm_util.rs target_has_mnemonic");
}
