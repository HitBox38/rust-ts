// compiler/rustc_codegen_llvm/src/back/write.rs: the SKELETON (lane cg-contract). The fill lane cg-write (plan-m7 §8 wave
// 42) owns this file and ports write.rs here, replacing each `Stub (cg-contract)` with its port.
//
// What is here: typed stubs of the functions back/llvm_backend.ts calls.
import type { SelfProfilerRef } from "../../rustc_session/stand_ins.ts";
import type { CodegenContext, ModuleConfig, SharedEmitter, TargetMachineFactoryFn } from "../../rustc_codegen_ssa/back/write.ts";
import type { CompiledModule, ModuleCodegen } from "../../rustc_codegen_ssa/lib.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { OptLevel } from "../../rustc_session/config.ts";
import type { Session } from "../../rustc_session/session.ts";
import { unported } from "../../std/panic.ts";
import type { CodeModel } from "../../rustc_target/spec/mod.ts";
import type * as llvm from "../llvm/mod.ts";
import type { LlvmWriteTypes, ModuleLlvm } from "./llvm_backend.ts";
import type { OwnedTargetMachine } from "./owned_target_machine.ts";

// Stub (cg-contract): create_informational_target_machine (write.rs:100)
export function create_informational_target_machine(_sess: Session): OwnedTargetMachine {
  return unported("cg-write: compiler/rustc_codegen_llvm/src/back/write.rs create_informational_target_machine");
}

// Stub (cg-contract): create_target_machine (write.rs:105)
export function create_target_machine(_tcx: TyCtxt, _mod_name: string): OwnedTargetMachine {
  return unported("cg-write: compiler/rustc_codegen_llvm/src/back/write.rs create_target_machine");
}

// Stub (cg-contract): to_llvm_code_model (back/write.rs:160)
export function to_llvm_code_model(_code_model: CodeModel | undefined): llvm.CodeModel {
  return unported("cg-write: compiler/rustc_codegen_llvm/src/back/write.rs to_llvm_code_model");
}

// Stub (cg-contract): target_machine_factory (write.rs:179)
export function target_machine_factory(_sess: Session, _optlvl: OptLevel): TargetMachineFactoryFn<LlvmWriteTypes> {
  return unported("cg-write: compiler/rustc_codegen_llvm/src/back/write.rs target_machine_factory");
}

// Stub (cg-contract): optimize (write.rs:854)
export function optimize(
  _cgcx: CodegenContext,
  _prof: SelfProfilerRef,
  _shared_emitter: SharedEmitter,
  _module: ModuleCodegen<ModuleLlvm>,
  _config: ModuleConfig,
): void {
  return unported("cg-write: compiler/rustc_codegen_llvm/src/back/write.rs optimize");
}

// Stub (cg-contract): codegen (write.rs:942)
export function codegen(
  _cgcx: CodegenContext,
  _prof: SelfProfilerRef,
  _shared_emitter: SharedEmitter,
  _module: ModuleCodegen<ModuleLlvm>,
  _config: ModuleConfig,
): CompiledModule {
  return unported("cg-write: compiler/rustc_codegen_llvm/src/back/write.rs codegen");
}
