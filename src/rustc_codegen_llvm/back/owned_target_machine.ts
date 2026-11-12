// compiler/rustc_codegen_llvm/src/back/owned_target_machine.rs (lane cg-write, plan-m7 wave 42). Ported whole.
//
// `OwnedTargetMachine` is also the `TargetMachine` associated type of `impl WriteBackendMethods for LlvmCodegenBackend`
// (back/llvm_backend.ts). `LLVMRustCreateTargetMachine` and `LLVMDisposeTargetMachine` are the IR model's stops: the model
// keeps no target machine (docs/handoff/cg-write.md).
import { Err, Ok, type Result } from "../../std/result.ts";
import { utf8 } from "../../std/str.ts";
import type { LlvmError } from "../diagnostics.gen.ts";
import * as llvm from "../llvm/mod.ts";
import type { TargetMachine } from "../llvm/mod.ts";

/// Responsible for safely creating and disposing llvm::TargetMachine via ffi functions.
/// Not cloneable as there is no clone function for llvm::TargetMachine.
export class OwnedTargetMachine {
  constructor(
    /** `tm_unique: NonNull<llvm::TargetMachine>` */
    public tm_unique: TargetMachine,
  ) {}

  /** The `&CStr` parameters as their text. `large_data_threshold: u64` is a `bigint` (the model's `LLVMRustCreateTargetMachine` takes one). */
  // rustc: compiler/rustc_codegen_llvm/src/back/owned_target_machine.rs:16 new
  static new(
    triple: string,
    cpu: string,
    features: string,
    abi: string,
    model: llvm.CodeModel,
    reloc: llvm.RelocModel,
    level: llvm.CodeGenOptLevel,
    float_abi: llvm.FloatAbi,
    function_sections: boolean,
    data_sections: boolean,
    unique_section_names: boolean,
    trap_unreachable: boolean,
    singlethread: boolean,
    verbose_asm: boolean,
    emit_stack_size_section: boolean,
    relax_elf_relocations: boolean,
    use_init_array: boolean,
    split_dwarf_file: string,
    output_obj_file: string,
    debug_info_compression: llvm.CompressionKind,
    use_emulated_tls: boolean,
    use_wasm_eh: boolean,
    large_data_threshold: bigint,
  ): Result<OwnedTargetMachine, LlvmError> {
    // SAFETY: llvm::LLVMRustCreateTargetMachine copies pointed-to data.
    const tm_ptr = llvm.LLVMRustCreateTargetMachine(
      triple,
      cpu,
      features,
      abi,
      model,
      reloc,
      level,
      float_abi,
      function_sections,
      data_sections,
      unique_section_names,
      trap_unreachable,
      singlethread,
      verbose_asm,
      emit_stack_size_section,
      relax_elf_relocations,
      use_init_array,
      split_dwarf_file,
      output_obj_file,
      debug_info_compression,
      use_emulated_tls,
      use_wasm_eh,
      large_data_threshold,
    );

    // NonNull::new(tm_ptr).map(|tm_unique| Self { tm_unique })
    //     .ok_or_else(|| LlvmError::CreateTargetMachine { triple: SmallCStr::from(triple) })
    return tm_ptr !== undefined ? Ok(new OwnedTargetMachine(tm_ptr)) : Err({ $: "CreateTargetMachine", triple: utf8(triple) });
  }

  /// Returns inner `llvm::TargetMachine` type.
  ///
  /// This could be a `Deref` implementation, but `llvm::TargetMachine` is an extern type and
  /// `Deref::Target: ?Sized`.
  // rustc: compiler/rustc_codegen_llvm/src/back/owned_target_machine.rs:79 raw
  raw(): TargetMachine {
    // SAFETY: constructing ensures we have a valid pointer created by llvm::LLVMRustCreateTargetMachine.
    // (PORT: one line here: a comment line that starts with the `llvm:` path reads as a marker to coverage --check.)
    return this.tm_unique;
  }

  // impl Drop for OwnedTargetMachine
  // rustc: compiler/rustc_codegen_llvm/src/back/owned_target_machine.rs:87 drop
  drop(): void {
    // SAFETY: constructing ensures we have a valid pointer created by llvm::LLVMRustCreateTargetMachine
    // OwnedTargetMachine is not copyable so there is no double free or use after free.
    // (PORT: rewrapped: a comment line that starts with the `llvm:` path reads as a marker to coverage --check.)
    llvm.LLVMDisposeTargetMachine(this.tm_unique);
  }
}
