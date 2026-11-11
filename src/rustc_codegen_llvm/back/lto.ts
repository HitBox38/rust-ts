// compiler/rustc_codegen_llvm/src/back/lto.rs: the SKELETON (lane cg-contract). The fill lane cg-lto-diag (plan-m7 §8 wave
// 43) owns this file and ports lto.rs here, replacing each `Stub (cg-contract)` with its port.
//
// What is here: the structs `ThinData` and `ModuleBuffer` (fields only; the `ModuleBuffer` and `ThinData` associated types
// of `impl WriteBackendMethods for LlvmCodegenBackend`), and typed stubs of the functions back/llvm_backend.ts calls.
import type { SelfProfilerRef } from "../../rustc_session/stand_ins.ts";
import type { PathBuf } from "../../rustc_error_messages/lib.ts";
import type { DiagCtxtHandle } from "../../rustc_errors/lib.ts";
import type { ThinModule } from "../../rustc_codegen_ssa/back/lto.ts";
import type { CodegenContext, FatLtoInput, SharedEmitter, TargetMachineFactoryFn, ThinLtoInput } from "../../rustc_codegen_ssa/back/write.ts";
import type { CompiledModule, ModuleCodegen } from "../../rustc_codegen_ssa/lib.ts";
import type { ModuleBufferMethods, WorkProduct } from "../../rustc_codegen_ssa/traits/write.ts";
import type { AutoDiff } from "../../rustc_session/config.ts";
import { unported } from "../../std/panic.ts";
import type { Buffer, Context, Module, ThinLTOData } from "../llvm/mod.ts";
import type { LlvmWriteTypes, ModuleLlvm } from "./llvm_backend.ts";

// Stub (cg-contract): run_fat (lto.rs:154)
export function run_fat(
  _cgcx: CodegenContext,
  _prof: SelfProfilerRef,
  _shared_emitter: SharedEmitter,
  _tm_factory: TargetMachineFactoryFn<LlvmWriteTypes>,
  _exported_symbols_for_lto: readonly string[],
  _each_linked_rlib_for_lto: readonly PathBuf[],
  _modules: FatLtoInput<LlvmWriteTypes>[],
): ModuleCodegen<ModuleLlvm> {
  return unported("cg-lto-diag: compiler/rustc_codegen_llvm/src/back/lto.rs run_fat");
}

// Stub (cg-contract): run_thin (lto.rs:184)
export function run_thin(
  _cgcx: CodegenContext,
  _prof: SelfProfilerRef,
  _dcx: DiagCtxtHandle,
  _exported_symbols_for_lto: readonly string[],
  _each_linked_rlib_for_lto: readonly PathBuf[],
  _modules: ThinLtoInput<LlvmWriteTypes>[],
): [ThinModule<LlvmWriteTypes>[], WorkProduct[]] {
  return unported("cg-lto-diag: compiler/rustc_codegen_llvm/src/back/lto.rs run_thin");
}

// Stub (cg-contract): enable_autodiff_settings (lto.rs:533; -Zautodiff, out of M7 per plan-m7 D18)
export function enable_autodiff_settings(_ad: readonly AutoDiff[]): void {
  return unported("cg-lto-diag: compiler/rustc_codegen_llvm/src/back/lto.rs enable_autodiff_settings");
}

// Stub (cg-contract): run_pass_manager (lto.rs:583)
export function run_pass_manager(_cgcx: CodegenContext, _prof: SelfProfilerRef, _dcx: DiagCtxtHandle, _module: ModuleCodegen<ModuleLlvm>, _thin: boolean): void {
  return unported("cg-lto-diag: compiler/rustc_codegen_llvm/src/back/lto.rs run_pass_manager");
}

/** `pub struct ThinData(&'static mut llvm::ThinLTOData);` */
export class ThinData {
  constructor(public _0: ThinLTOData) {}
}

/** `pub(crate) struct Buffer(&'static mut llvm::Buffer);` */
class Buffer_ {
  constructor(public _0: Buffer) {}
}

export class ModuleBuffer implements ModuleBufferMethods {
  constructor(
    /** private */
    public data_: Buffer_,
  ) {}

  // PORT (cg-contract): the field `data` is `data_`: `ModuleBufferMethods::data()` is a method of the same name.

  // Stub (cg-contract): ModuleBuffer::new (lto.rs:686)
  static new(_m: Module, _is_thin: boolean): ModuleBuffer {
    return unported("cg-lto-diag: compiler/rustc_codegen_llvm/src/back/lto.rs new");
  }

  // impl ModuleBufferMethods for ModuleBuffer
  // Stub (cg-contract): ModuleBufferMethods::data (lto.rs:695)
  data(): Uint8Array {
    return unported("cg-lto-diag: compiler/rustc_codegen_llvm/src/back/lto.rs data");
  }
}

// Stub (cg-contract): optimize_and_codegen_thin_module (lto.rs:700)
export function optimize_and_codegen_thin_module(
  _cgcx: CodegenContext,
  _prof: SelfProfilerRef,
  _shared_emitter: SharedEmitter,
  _tm_factory: TargetMachineFactoryFn<LlvmWriteTypes>,
  _thin_module: ThinModule<LlvmWriteTypes>,
): CompiledModule {
  return unported("cg-lto-diag: compiler/rustc_codegen_llvm/src/back/lto.rs optimize_and_codegen_thin_module");
}

/** `name: &CStr` (its bytes without the NUL, as a string). */
// Stub (cg-contract): parse_module (lto.rs:846)
export function parse_module(_cx: Context, _name: string, _data: Uint8Array, _dcx: DiagCtxtHandle): Module {
  return unported("cg-lto-diag: compiler/rustc_codegen_llvm/src/back/lto.rs parse_module");
}
