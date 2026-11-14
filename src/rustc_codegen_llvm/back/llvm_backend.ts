//! Module containing [`LlvmCodegenBackend`], which implements [`CodegenBackend`]
//! and related traits for the LLVM codegen backend.
//
// Port of compiler/rustc_codegen_llvm/src/back/llvm_backend.rs (lane cg-contract: plan-m7 §8 names this content "lib.rs",
// whose `pub use crate::back::llvm_backend::{LlvmCodegenBackend, ModuleLlvm}` re-exports it at the pin).
//
// PORT (cg-contract):
// - `LlvmCodegenBackend(())` is a class with no fields. It implements `CodegenBackend`, `ExtraBackendMethods<ModuleLlvm>`
//   and `WriteBackendMethods<LlvmWriteTypes>` (ssa-contract decisions 1 and 4: the write associated types are the record
//   `LlvmWriteTypes`; the no-`self` fns are members, called on the backend value).
// - `print`, `has_zstd` and `has_mnemonic` are methods of the class, though `CodegenBackend` has no such members
//   (ssa-contract decision 9): rustc_driver_impl reaches them only when it calls them on this class.
// - `rustc_codegen_ssa::base::codegen_crate` (ssa-base) and back/write.rs's `OngoingCodegen`, `TargetMachineFactoryConfig`
//   and `CodegenContext` (ssa-write) are imported (root at integ-w54/55). The Enzyme / offload wrappers stop (out of M7,
//   plan-m7 D18).
// - `ModuleLlvm`'s `Drop` is a `drop()` method (llvm/mod.ts header); `ManuallyDrop` is erased.
// - Registered by forwarding (lane cg-register, decision 2026-11-14): rustc_interface constructs src/rust_ts/codegen_backend.ts's
//   stand-in, which keeps `init`, `target_config` and the print requests (its oracle tables) and forwards `codegen_crate`,
//   `join_codegen`, `link` and the statistics to this class, loaded through lib.ts at the first forward.
import type { AllocatorMethod } from "../../rustc_ast/expand/allocator.gen.ts";
import type { ThinModule } from "../../rustc_codegen_ssa/back/lto.ts";
import { type CodegenContext, type FatLtoInput, type ModuleConfig, OngoingCodegen, type SharedEmitter, TargetMachineFactoryConfig, type TargetMachineFactoryFn, type ThinLtoInput } from "../../rustc_codegen_ssa/back/write.ts";
import type { CodegenBackend, ExtraBackendMethods } from "../../rustc_codegen_ssa/traits/backend.ts";
import { CodegenBackend_provided } from "../../rustc_codegen_ssa/traits/backend.ts";
import { type WorkProduct, type WriteBackendMethods, WriteBackendMethods_provided, type WriteBackendTypes } from "../../rustc_codegen_ssa/traits/write.ts";
import type { CompiledModule, CompiledModules, CrateInfo, ModuleCodegen } from "../../rustc_codegen_ssa/lib.ts";
import { link_binary } from "../../rustc_codegen_ssa/back/link.ts";
import type { MetadataLoaderDyn } from "../../rustc_metadata/creader.ts";
import type { PathBuf } from "../../rustc_error_messages/lib.ts";
import { DiagCtxt, type DiagCtxtHandle } from "../../rustc_errors/lib.ts";
import type { IncrCompSession, TargetConfig, WorkProductMap } from "../../rustc_interface/stand_ins.ts";
import type { EncodedMetadata } from "../../rustc_metadata/lib.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { OptLevel, OutputFilenames } from "../../rustc_session/config.ts";
import type { PrintRequest } from "../../rustc_session/config/print_request.ts";
import type { SelfProfilerRef } from "../../rustc_session/stand_ins.ts";
import type { CodegenBackendInit, EarlySession, Session } from "../../rustc_session/session.ts";
import "../../rustc_session/utils.ts";
import { type Symbol, sym } from "../../rustc_span/symbol.ts";
import type { CrateType } from "../../rustc_structures/crate_type.ts";
import { RelocModel, TlsModel } from "../../rustc_target/spec/mod.ts";
import type { MutRef } from "../../std/mut_ref.ts";
import { panic, unported } from "../../std/panic.ts";
import { unwrap_result } from "../../std/result.ts";
import { std_print } from "../../rustc_session/config.ts";
import * as allocator from "../allocator.ts";
import * as base from "../base.ts";
import { SimpleCx, create_module } from "../context.ts";
import * as llvm from "../llvm/mod.ts";
import * as llvm_util from "../llvm_util.ts";
import { LlvmArchiveBuilderBuilder } from "./archive.ts";
import * as lto from "./lto.ts";
import type { ModuleBuffer, ThinData } from "./lto.ts";
import type { OwnedTargetMachine } from "./owned_target_machine.ts";
import * as write from "./write.ts";
import { create_informational_target_machine, create_target_machine } from "./write.ts";
import { codegen_crate } from "../../rustc_codegen_ssa/base.ts";

/** The associated types of `impl WriteBackendMethods for LlvmCodegenBackend` (header). */
export interface LlvmWriteTypes extends WriteBackendTypes {
  Module: ModuleLlvm;
  ModuleBuffer: ModuleBuffer;
  TargetMachine: OwnedTargetMachine;
  ThinData: ThinData;
}

class TimeTraceProfiler {
  // rustc: compiler/rustc_codegen_llvm/src/back/llvm_backend.rs:40 new
  static new(): TimeTraceProfiler {
    llvm.LLVMRustTimeTraceProfilerInitialize();
    return new TimeTraceProfiler();
  }

  // impl Drop for TimeTraceProfiler
  // rustc: compiler/rustc_codegen_llvm/src/back/llvm_backend.rs:47 drop
  drop(): void {
    llvm.LLVMRustTimeTraceProfilerFinishThread();
  }
}

// #[derive(Clone)]
export class LlvmCodegenBackend implements CodegenBackend, ExtraBackendMethods<ModuleLlvm>, WriteBackendMethods<LlvmWriteTypes> {
  /** PORT (plan-m6 D3): type-level only (never set). */
  declare readonly __write_backend_types?: LlvmWriteTypes;

  // ---- impl ExtraBackendMethods for LlvmCodegenBackend ----
  // type Module = ModuleLlvm;

  // rustc: compiler/rustc_codegen_llvm/src/back/llvm_backend.rs:55 codegen_allocator
  codegen_allocator(tcx: TyCtxt, module_name: string, methods: readonly AllocatorMethod[]): ModuleLlvm {
    const module_llvm = ModuleLlvm.new_metadata(tcx, module_name);
    const cx = SimpleCx.new(module_llvm.llmod(), module_llvm.llcx, tcx.data_layout().pointer_size());
    allocator.codegen(tcx, cx, module_name, methods);
    return module_llvm;
  }
  // rustc: compiler/rustc_codegen_llvm/src/back/llvm_backend.rs:69 compile_codegen_unit
  compile_codegen_unit(tcx: TyCtxt, cgu_name: Symbol, bitcode_needed: boolean): [ModuleCodegen<ModuleLlvm>, number] {
    return base.compile_codegen_unit(tcx, cgu_name, bitcode_needed);
  }

  // ---- impl WriteBackendMethods for LlvmCodegenBackend ----
  // type Module = ModuleLlvm;
  // type ModuleBuffer = back::lto::ModuleBuffer;
  // type TargetMachine = OwnedTargetMachine;
  // type ThinData = back::lto::ThinData;

  // (provided) traits/write.rs:25 supports_parallel -> WriteBackendMethods_provided.supports_parallel
  supports_parallel(): boolean {
    return WriteBackendMethods_provided.supports_parallel(this);
  }
  /** `-> Box<dyn Any>` */
  // rustc: compiler/rustc_codegen_llvm/src/back/llvm_backend.rs:85 thread_profiler
  thread_profiler(): unknown {
    return TimeTraceProfiler.new();
  }
  // rustc: compiler/rustc_codegen_llvm/src/back/llvm_backend.rs:88 target_machine_factory
  target_machine_factory(sess: Session, optlvl: OptLevel): TargetMachineFactoryFn<LlvmWriteTypes> {
    return write.target_machine_factory(sess, optlvl);
  }
  // rustc: compiler/rustc_codegen_llvm/src/back/llvm_backend.rs:95 optimize_and_codegen_fat_lto
  optimize_and_codegen_fat_lto(
    sess: Session,
    cgcx: CodegenContext,
    shared_emitter: SharedEmitter,
    tm_factory: TargetMachineFactoryFn<LlvmWriteTypes>,
    exported_symbols_for_lto: readonly string[],
    each_linked_rlib_for_lto: readonly PathBuf[],
    modules: FatLtoInput<LlvmWriteTypes>[],
  ): CompiledModule {
    const module = lto.run_fat(cgcx, sess.prof, shared_emitter, tm_factory, exported_symbols_for_lto, each_linked_rlib_for_lto, modules);

    // let dcx = DiagCtxt::new(Box::new(shared_emitter.clone()));
    // let dcx = dcx.handle();
    const dcx_ = DiagCtxt.new(shared_emitter.clone());
    const dcx: DiagCtxtHandle = dcx_.handle();
    lto.run_pass_manager(cgcx, sess.prof, dcx, module, false);

    return write.codegen(cgcx, sess.prof, shared_emitter, module, cgcx.module_config);
  }
  // rustc: compiler/rustc_codegen_llvm/src/back/llvm_backend.rs:120 run_thin_lto
  run_thin_lto(
    cgcx: CodegenContext,
    prof: SelfProfilerRef,
    dcx: DiagCtxtHandle,
    exported_symbols_for_lto: readonly string[],
    each_linked_rlib_for_lto: readonly PathBuf[],
    modules: ThinLtoInput<LlvmWriteTypes>[],
  ): [ThinModule<LlvmWriteTypes>[], WorkProduct[]] {
    return lto.run_thin(cgcx, prof, dcx, exported_symbols_for_lto, each_linked_rlib_for_lto, modules);
  }
  /** `module: &mut ModuleCodegen<Self::Module>` */
  // rustc: compiler/rustc_codegen_llvm/src/back/llvm_backend.rs:137 optimize
  optimize(cgcx: CodegenContext, prof: SelfProfilerRef, shared_emitter: SharedEmitter, module: ModuleCodegen<ModuleLlvm>, config: ModuleConfig): void {
    write.optimize(cgcx, prof, shared_emitter, module, config);
  }
  // rustc: compiler/rustc_codegen_llvm/src/back/llvm_backend.rs:146 optimize_and_codegen_thin
  optimize_and_codegen_thin(
    cgcx: CodegenContext,
    prof: SelfProfilerRef,
    shared_emitter: SharedEmitter,
    tm_factory: TargetMachineFactoryFn<LlvmWriteTypes>,
    thin: ThinModule<LlvmWriteTypes>,
  ): CompiledModule {
    return lto.optimize_and_codegen_thin_module(cgcx, prof, shared_emitter, tm_factory, thin);
  }
  // rustc: compiler/rustc_codegen_llvm/src/back/llvm_backend.rs:155 codegen
  codegen(cgcx: CodegenContext, prof: SelfProfilerRef, shared_emitter: SharedEmitter, module: ModuleCodegen<ModuleLlvm>, config: ModuleConfig): CompiledModule {
    return write.codegen(cgcx, prof, shared_emitter, module, config);
  }
  // rustc: compiler/rustc_codegen_llvm/src/back/llvm_backend.rs:164 serialize_module
  serialize_module(module: ModuleLlvm, is_thin: boolean): ModuleBuffer {
    return lto.ModuleBuffer.new(module.llmod(), is_thin);
  }

  // ---- impl LlvmCodegenBackend ----
  /** `-> Box<dyn CodegenBackend>` */
  // rustc: compiler/rustc_codegen_llvm/src/back/llvm_backend.rs:170 new
  static new(): CodegenBackend {
    return new LlvmCodegenBackend();
  }

  // ---- impl CodegenBackend for LlvmCodegenBackend ----
  // rustc: compiler/rustc_codegen_llvm/src/back/llvm_backend.rs:176 name
  name(): string {
    return "llvm";
  }

  // rustc: compiler/rustc_codegen_llvm/src/back/llvm_backend.rs:180 init
  init(sess: EarlySession): CodegenBackendInit {
    llvm_util.init(sess); // Make sure llvm is inited

    const global_backend_features = llvm_util.global_llvm_features(sess, /* for_cfg */ false);

    // autodiff is based on Enzyme, a library which we might not have available, when it was
    // neither build, nor downloaded via rustup. If autodiff is used, but not available we emit
    // an early error here and abort compilation.
    {
      // use rustc_session::config::AutoDiff;
      //
      // use crate::back::lto::enable_autodiff_settings;
      if (sess.opts.unstable_opts.autodiff.some((ad) => ad.$ === "Enable")) {
        // match llvm::EnzymeWrapper::get_or_init(&sess.opts.sysroot) { .. }
        // PORT: llvm/enzyme_ffi.rs is out of M7 (harness/scope.json, plan-m7 D18); its `AutoDiffComponentMissing` /
        // `AutoDiffComponentUnavailable` errors come from loading the Enzyme library, which the port has no form of.
        unported("rustc_codegen_llvm::llvm::EnzymeWrapper::get_or_init (-Zautodiff=Enable; plan-m7 D18)");
        lto.enable_autodiff_settings(sess.opts.unstable_opts.autodiff);
      }
    }

    // Intrinsics whose fallback body will not be used by the LLVM backend.
    const replaced_intrinsics = (() => {
      // #[rustfmt::skip]
      const will_not_use_fallback = [
        // These are mapped to LLVM intrinsics instead.
        sym.unchecked_funnel_shl,
        sym.unchecked_funnel_shr,
        sym.carrying_mul_add,
        sym.carryless_mul,
        sym.integer_max,
        sym.integer_min,

        // Fallback via libm, but the LLVM intrinsic is used instead.
        sym.sin,
        sym.cos,
        sym.powf16, sym.powf32, sym.powf64,
        sym.exp,
        sym.exp2,
        sym.log,
        sym.log10,
        sym.log2,

        // Fallback via f32 or f64, but the LLVM intrinsic is used instead.
        sym.floorf16, sym.ceilf16, sym.truncf16,
        sym.round_ties_even_f16, sym.roundf16,
        sym.sqrtf16, sym.powif16,
        sym.fmaf16,

        sym.copysignf16, sym.copysignf32, sym.copysignf64, sym.copysignf128,
      ];

      return will_not_use_fallback;
    })();

    // `type_id_eq` is a safe choice since *all* backends use the fallback body for that. When
    // adding more intrinsics, keep in mind that the distributed standard library is compiled
    // with the LLVM backend but might later be included in a project built with cranelift or
    // GCC. Adding an intrinsic here can therefore mean the fallback body is used with
    // cranelift/GCC even if they have dedicated implementations.
    const fallback_intrinsics = [sym.type_id_eq];

    return {
      global_backend_features,
      replaced_intrinsics,
      fallback_intrinsics,
      thin_lto_supported: true,
    };
  }

  /** `out: &mut String` */
  // rustc: compiler/rustc_codegen_llvm/src/back/llvm_backend.rs:257 print
  print(req: PrintRequest, out: MutRef<string>, sess: Session): void {
    // use std::fmt::Write;
    switch (req.kind) {
      case "RelocationModels": {
        out.value += "Available relocation models:\n";
        for (const name of [...RelocModel.ALL.map(RelocModel.desc), "default"]) {
          out.value += `    ${name}\n`;
        }
        out.value += "\n";
        break;
      }
      case "CodeModels": {
        out.value += "Available code models:\n";
        for (const name of ["tiny", "small", "kernel", "medium", "large"]) {
          out.value += `    ${name}\n`;
        }
        out.value += "\n";
        break;
      }
      case "TlsModels": {
        out.value += "Available TLS models:\n";
        for (const name of TlsModel.ALL.map(TlsModel.desc)) {
          out.value += `    ${name}\n`;
        }
        out.value += "\n";
        break;
      }
      case "StackProtectorStrategies": {
        out.value += `Available stack protector strategies:
    all
        Generate stack canaries in all functions.

    strong
        Generate stack canaries in a function if it either:
        - has a local variable of \`[T; N]\` type, regardless of \`T\` and \`N\`
        - takes the address of a local variable.

          (Note that a local variable being borrowed is not equivalent to its
          address being taken: e.g. some borrows may be removed by optimization,
          while by-value argument passing may be implemented with reference to a
          local stack variable in the ABI.)

    basic
        Generate stack canaries in functions with local variables of \`[T; N]\`
        type, where \`T\` is byte-sized and \`N\` >= 8.

    none
        Do not generate stack canaries.

`;
        break;
      }
      default:
        llvm_util.print(req, out, sess);
    }
  }

  // rustc: compiler/rustc_codegen_llvm/src/back/llvm_backend.rs:312 print_passes
  print_passes(): void {
    llvm_util.print_passes();
  }

  // rustc: compiler/rustc_codegen_llvm/src/back/llvm_backend.rs:316 print_version
  print_version(): void {
    llvm_util.print_version();
  }

  // rustc: compiler/rustc_codegen_llvm/src/back/llvm_backend.rs:320 has_zstd
  has_zstd(): boolean {
    return llvm.LLVMRustLLVMHasZstdCompression();
  }

  // rustc: compiler/rustc_codegen_llvm/src/back/llvm_backend.rs:324 has_mnemonic
  has_mnemonic(sess: Session, mnemonic: string): boolean {
    return llvm_util.target_has_mnemonic(sess, mnemonic);
  }

  // rustc: compiler/rustc_codegen_llvm/src/back/llvm_backend.rs:328 target_config
  target_config(sess: EarlySession): TargetConfig {
    return llvm_util.target_config(sess);
  }

  // (provided) traits/backend.rs:61 supported_crate_types -> CodegenBackend_provided.supported_crate_types
  supported_crate_types(sess: Session): CrateType[] {
    return CodegenBackend_provided.supported_crate_types(this, sess);
  }

  // (provided) traits/backend.rs:97 metadata_loader -> CodegenBackend_provided.metadata_loader
  metadata_loader(): MetadataLoaderDyn {
    return CodegenBackend_provided.metadata_loader(this);
  }

  // rustc: compiler/rustc_codegen_llvm/src/back/llvm_backend.rs:332 target_cpu
  target_cpu(sess: Session): string {
    // `crate::llvm_util::target_cpu(sess)`: `&Session` auto-derefs to the `&EarlySession` it takes.
    return llvm_util.target_cpu(sess.early_sess);
  }

  /** `-> Box<dyn Any>` */
  // rustc: compiler/rustc_codegen_llvm/src/back/llvm_backend.rs:336 codegen_crate
  codegen_crate(tcx: TyCtxt): unknown {
    // use rustc_session::config::Offload;

    if (tcx.sess.opts.unstable_opts.offload.some((o) => o.$ === "Device") || tcx.sess.opts.unstable_opts.offload.some((o) => o.$ === "Host")) {
      // match llvm::RustOffloadWrapper::get_or_init(&tcx.sess.opts.sysroot) { .. }
      // PORT: llvm/offload_ffi.rs is out of M7 (harness/scope.json, plan-m7 D18), as `init`'s Enzyme check.
      unported("rustc_codegen_llvm::llvm::RustOffloadWrapper::get_or_init (-Zoffload; plan-m7 D18)");
    }

    return codegen_crate(new LlvmCodegenBackend(), tcx);
  }

  // rustc: compiler/rustc_codegen_llvm/src/back/llvm_backend.rs:360 join_codegen
  join_codegen(
    ongoing_codegen: unknown,
    sess: Session,
    incr_comp_session: IncrCompSession | undefined,
    outputs: OutputFilenames,
    crate_info: CrateInfo,
  ): [CompiledModules, WorkProductMap] {
    // `ongoing_codegen.downcast::<OngoingCodegen<LlvmCodegenBackend>>().expect("Expected LlvmCodegenBackend's OngoingCodegen, found Box<Any>")`
    // (`Result::expect` panics with `{msg}: {err:?}`; `Box<dyn Any>`'s Debug is `Any { .. }`.)
    if (!(ongoing_codegen instanceof OngoingCodegen)) {
      return panic("Expected LlvmCodegenBackend's OngoingCodegen, found Box<Any>: Any { .. }");
    }
    const [compiled_modules, work_products] = (ongoing_codegen as OngoingCodegen<LlvmWriteTypes>).join(sess, incr_comp_session, crate_info);

    if (sess.opts.unstable_opts.llvm_time_trace) {
      sess.time("llvm_dump_timing_file", () => {
        const file_name = outputs.with_extension("llvm_timings.json");
        llvm_util.time_trace_profiler_finish(file_name);
      });
    }

    return [compiled_modules, work_products];
  }

  // rustc: compiler/rustc_codegen_llvm/src/back/llvm_backend.rs:383 print_pass_timings
  print_pass_timings(): void {
    const timings = unwrap_result(
      llvm.build_string((s) => llvm.LLVMRustPrintPassTimings(s)),
      llvm.debug_FromUtf8Error,
    );
    std_print(timings);
  }

  // rustc: compiler/rustc_codegen_llvm/src/back/llvm_backend.rs:388 print_statistics
  print_statistics(): void {
    const stats = unwrap_result(
      llvm.build_string((s) => llvm.LLVMRustPrintStatistics(s)),
      llvm.debug_FromUtf8Error,
    );
    std_print(stats);
  }

  // rustc: compiler/rustc_codegen_llvm/src/back/llvm_backend.rs:393 print_statistics_json
  print_statistics_json(): string {
    return unwrap_result(
      llvm.build_string((s) => llvm.LLVMRustPrintStatisticsJSON(s)),
      llvm.debug_FromUtf8Error,
    );
  }

  // rustc: compiler/rustc_codegen_llvm/src/back/llvm_backend.rs:397 link
  link(sess: Session, compiled_modules: CompiledModules, crate_info: CrateInfo, metadata: EncodedMetadata, outputs: OutputFilenames): void {
    // use rustc_codegen_ssa::back::link::link_binary;
    //
    // use crate::back::archive::LlvmArchiveBuilderBuilder;

    // Run the linker on any artifacts that resulted from the LLVM run.
    // This should produce either a finished executable or library.
    link_binary(sess, LlvmArchiveBuilderBuilder, compiled_modules, crate_info, metadata, outputs, this.name());
  }
}

export class ModuleLlvm {
  constructor(
    /** `pub(crate) llcx: &'static mut llvm::Context` */
    public llcx: llvm.Context,
    /** private: `llmod_raw: *const llvm::Module` */
    public llmod_raw: llvm.Module,

    // This field is `ManuallyDrop` because it is important that the `TargetMachine`
    // is disposed prior to the `Context` being disposed otherwise UAFs can occur.
    /** `pub(crate) tm: ManuallyDrop<OwnedTargetMachine>` */
    public tm: OwnedTargetMachine,
  ) {}

  // unsafe impl Send for ModuleLlvm {}
  // unsafe impl Sync for ModuleLlvm {}

  // rustc: compiler/rustc_codegen_llvm/src/back/llvm_backend.rs:436 new
  static new(tcx: TyCtxt, mod_name: string): ModuleLlvm {
    const llcx = llvm.LLVMContextCreate();
    llvm.LLVMContextSetDiscardValueNames(llcx, llvm.to_llvm_bool(tcx.sess.fewer_names()));
    const llmod_raw = create_module(tcx, llcx, mod_name);
    return new ModuleLlvm(llcx, llmod_raw, create_target_machine(tcx, mod_name));
  }

  // rustc: compiler/rustc_codegen_llvm/src/back/llvm_backend.rs:449 new_metadata
  static new_metadata(tcx: TyCtxt, mod_name: string): ModuleLlvm {
    const llcx = llvm.LLVMContextCreate();
    llvm.LLVMContextSetDiscardValueNames(llcx, llvm.to_llvm_bool(tcx.sess.fewer_names()));
    const llmod_raw = create_module(tcx, llcx, mod_name);
    return new ModuleLlvm(llcx, llmod_raw, create_informational_target_machine(tcx.sess));
  }

  /** `name: &CStr` (its bytes without the NUL, as a string) */
  // rustc: compiler/rustc_codegen_llvm/src/back/llvm_backend.rs:462 parse
  static parse(cgcx: CodegenContext, tm_factory: TargetMachineFactoryFn<LlvmWriteTypes>, name: string, buffer: Uint8Array, dcx: DiagCtxtHandle): ModuleLlvm {
    const llcx = llvm.LLVMContextCreate();
    llvm.LLVMContextSetDiscardValueNames(llcx, llvm.to_llvm_bool(cgcx.fewer_names));
    const llmod_raw = lto.parse_module(llcx, name, buffer, dcx);
    const tm = tm_factory(dcx, TargetMachineFactoryConfig.new(cgcx, name));

    return new ModuleLlvm(llcx, llmod_raw, tm);
  }

  // rustc: compiler/rustc_codegen_llvm/src/back/llvm_backend.rs:479 llmod
  llmod(): llvm.Module {
    return this.llmod_raw;
  }

  // impl Drop for ModuleLlvm
  // rustc: compiler/rustc_codegen_llvm/src/back/llvm_backend.rs:485 drop
  drop(): void {
    // ManuallyDrop::drop(&mut self.tm);
    this.tm.drop();
    llvm.LLVMContextDispose(this.llcx);
  }
}
