// compiler/rustc_codegen_llvm/src/back/owned_mc_subtarget_info.rs (lane cg-write, plan-m7 wave 42: `back/owned_*`). Ported whole.
//
// `LLVMRustCreateMCSubtargetInfo`, `LLVMRustMCSubtargetInfoCheckFeatures` and `LLVMRustDisposeMCSubtargetInfo` are the IR
// model's stops: the model has no subtarget tables (docs/handoff/cg-write.md).
import { Err, Ok, type Result } from "../../std/result.ts";
import { utf8 } from "../../std/str.ts";
import type { LlvmError } from "../diagnostics.gen.ts";
import * as llvm from "../llvm/mod.ts";
import type { LLVMFeature } from "../llvm_util.ts";

/// Responsible for safely creating and disposing llvm::MCSubtargetInfo via ffi functions.
/// Not cloneable as there is no clone function for llvm::MCSubtargetInfo.
export class OwnedMCSubtargetInfo {
  constructor(
    /** `info_unique: NonNull<llvm::MCSubtargetInfo>` */
    public info_unique: llvm.MCSubtargetInfo,
  ) {}

  /** `triple`, `cpu`, `features`: `&CStr`, as their text. */
  // rustc: compiler/rustc_codegen_llvm/src/back/owned_mc_subtarget_info.rs:16 new
  static new(triple: string, cpu: string, features: string): Result<OwnedMCSubtargetInfo, LlvmError> {
    // SAFETY: llvm::LLVMRustCreateMCSubtargetInfo copies pointed-to data.
    const info_ptr = llvm.LLVMRustCreateMCSubtargetInfo(triple, cpu, features);

    // NonNull::new(info_ptr).map(|info_unique| Self { info_unique })
    //     .ok_or_else(|| LlvmError::CreateMCSubtargetInfo { triple: SmallCStr::from(triple) })
    return info_ptr !== undefined ? Ok(new OwnedMCSubtargetInfo(info_ptr)) : Err({ $: "CreateMCSubtargetInfo", triple: utf8(triple) });
  }

  // rustc: compiler/rustc_codegen_llvm/src/back/owned_mc_subtarget_info.rs:31 has_features
  has_features(features: LLVMFeature): boolean {
    // Convert to a feature string expected by LLVM's `SubtargetFeatures`.
    // All of the required LLVM features must be enabled.
    // (The trailing comma is OK, as `SubtargetFeatures::Split` discards empty substrings.)
    const features_ = features
      .into_iter()
      .flatMap((feat) => ["+", feat, ","])
      .join("");

    // SAFETY: `info_unique` is a valid pointer created by
    // `llvm::LLVMRustCreateMCSubtargetInfo`.
    return llvm.LLVMRustMCSubtargetInfoCheckFeatures(this.info_unique, features_, utf8(features_).length);
  }

  // impl Drop for OwnedMCSubtargetInfo
  // rustc: compiler/rustc_codegen_llvm/src/back/owned_mc_subtarget_info.rs:50 drop
  drop(): void {
    // SAFETY: `new` ensures we have a valid pointer created by
    // `llvm::LLVMRustCreateMCSubtargetInfo` and `OwnedMCSubtargetInfo` is not copyable so
    // there is no double free or use after free.
    llvm.LLVMRustDisposeMCSubtargetInfo(this.info_unique);
  }
}
