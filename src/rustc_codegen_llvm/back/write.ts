// compiler/rustc_codegen_llvm/src/back/write.rs (lane cg-write, plan-m7 wave 42). Ported whole, in upstream order.
//
// LLVM work goes to the IR model (src/rust_ts/llvm/ffi.ts) under its ffi.rs names. `LLVMRustPrintModule` (`--emit=llvm-ir`) is
// the model's printer. What the model cannot do stays its stop, by name (plan-m7 D8: `opt`/`llc` are the later `llir-tools`
// lane's): `LLVMRustOptimize` (every `optimize` with an opt level), `LLVMRustWriteOutputFile` (asm and object output),
// `LLVMRustCreateTargetMachine` / `LLVMDisposeTargetMachine` (owned_target_machine.ts), `LLVMWriteBitcodeToFile`,
// `LLVMCloneModule`, `LLVMRustContext{Get,Set,Configure}DiagnosticHandler`, `LLVMRustWriteDiagnosticInfoToString`,
// `LLVMRustLLVMHas{Zlib,Zstd}Compression`, `LLVMRustModuleInstructionStats`, `LLVMRustAppendModuleInlineAsm` (docs/handoff/
// cg-write.md lists them with their callers).
//
// The structs of rustc_codegen_ssa's back/write.rs (`CodegenContext`, `ModuleConfig`, `SharedEmitter`, `EmitObj`,
// `InlineAsmError`) are lane ssa-write's, which runs in parallel with this one: today they are ssa-contract's opaque
// placeholders. This file reads them through the views at its end, under their upstream field names (PORT there).
import { existsSync, statSync, writeFileSync } from "node:fs";
import { basename, isAbsolute } from "node:path";
import { ensure_removed } from "../../rustc_codegen_ssa/back/link.ts";
import { versioned_llvm_target } from "../../rustc_codegen_ssa/back/mod.ts";
import type { CodegenContext, ModuleConfig, SharedEmitter, TargetMachineFactoryConfig, TargetMachineFactoryFn } from "../../rustc_codegen_ssa/back/write.ts";
import { wants_wasm_eh } from "../../rustc_codegen_ssa/base.ts";
import type { TypeKind } from "../../rustc_codegen_ssa/common.ts";
import { type CompiledModule, ModuleCodegen, ModuleKind } from "../../rustc_codegen_ssa/lib.ts";
import type { PathBuf } from "../../rustc_error_messages/lib.ts";
import { DiagCtxt, type DiagCtxtHandle, Level } from "../../rustc_errors/lib.ts";
import type { Emitter } from "../../rustc_errors/emitter.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { type AutoDiff, type Lto, type Offload, type OptLevel, OutFileName, type OutputFilenames, type OutputType, type Passes, type SplitDwarfKind, type SwitchWithOptPath } from "../../rustc_session/config.ts";
import type { Session } from "../../rustc_session/session.ts";
import type { SelfProfilerRef, VerboseTimingGuard } from "../../rustc_session/stand_ins.ts";
import { BytePos, type InnerSpan, RemapPathScopeComponents, Span } from "../../rustc_span/lib.ts";
import { DUMMY_SP } from "../../rustc_span/span_encoding.ts";
import type { Size } from "../../rustc_abi/lib.ts";
import { type CodeModel, type FloatAbi, LlvmAbi, type RelocModel, SanitizerSet, type SplitDebuginfo } from "../../rustc_target/spec/mod.ts";
import { display_IoError, io_error_from_node, type IoError, type IoResult } from "../../std/io.ts";
import { assert, panic, unported } from "../../std/panic.ts";
import { Err, Ok } from "../../std/result.ts";
import { utf8 } from "../../std/str.ts";
import { display_Demangle, try_demangle } from "../../vendor/rustc_demangle/lib.ts";
import type { SimpleCx } from "../context.ts";
import {
  CopyBitcode_diagnostic,
  FromLlvmDiag_diagnostic,
  FromLlvmOptimizationDiag_diagnostic,
  type LlvmError,
  LlvmError_diagnostic,
  OffloadBundleImagesFailed_diagnostic,
  OffloadNonexistingPath_diagnostic,
  OffloadWithoutAbsPath_diagnostic,
  OffloadWrapImagesFailed_diagnostic,
  OffloadWrongFileName_diagnostic,
  type ParseTargetMachineConfig,
  UnsupportedCompression_diagnostic,
  type WithLlvmError,
  WriteBytecode_diagnostic,
} from "../diagnostics.gen.ts";
import * as llvm from "../llvm/mod.ts";
import * as llvm_util from "../llvm_util.ts";
import type { LlvmWriteTypes, ModuleLlvm } from "./llvm_backend.ts";
import type { ModuleBuffer } from "./lto.ts";
import { OwnedTargetMachine } from "./owned_target_machine.ts";
import { LlvmSelfProfiler, selfprofile_after_pass_callback, selfprofile_before_pass_callback } from "./profiling.ts";

/** `-> !` */
// rustc: compiler/rustc_codegen_llvm/src/back/write.rs:46 llvm_err
export function llvm_err(dcx: DiagCtxtHandle, err: LlvmError): never {
  const llvm_err_ = llvm.last_error();
  if (llvm_err_ !== undefined) {
    return dcx.emit_fatal(WithLlvmError_diagnostic({ _0: err, _1: llvm_err_ }));
  } else {
    return dcx.emit_fatal(LlvmError_diagnostic(err));
  }
}

// rustc: compiler/rustc_codegen_llvm/src/back/write.rs:53 write_output_file
function write_output_file(
  dcx: DiagCtxtHandle,
  target: llvm.TargetMachine,
  no_builtins: boolean,
  m: llvm.Module,
  output: PathBuf,
  dwo_output: PathBuf | undefined,
  file_type: llvm.FileType,
  self_profiler_ref: SelfProfilerRef,
  verify_llvm_ir: boolean,
): void {
  // debug!("write_output_file output={:?} dwo_output={:?}", output, dwo_output);
  const output_c = path_to_c_string(output);
  let dwo_output_c: string;
  let dwo_output_ptr: string | undefined;
  if (dwo_output !== undefined) {
    dwo_output_c = path_to_c_string(dwo_output);
    dwo_output_ptr = dwo_output_c;
  } else {
    dwo_output_ptr = undefined;
  }
  const result = llvm.LLVMRustWriteOutputFile(target, m, output_c, dwo_output_ptr, file_type, verify_llvm_ir, no_builtins);

  // Record artifact sizes for self-profiling
  if (result === llvm.LLVMRustResult.Success) {
    let artifact_kind: string;
    switch (file_type) {
      case "ObjectFile":
        artifact_kind = "object_file";
        break;
      case "AssemblyFile":
        artifact_kind = "assembly_file";
        break;
    }
    record_artifact_size(self_profiler_ref, artifact_kind, output);
    if (dwo_output !== undefined) {
      const dwo_file = dwo_output;
      record_artifact_size(self_profiler_ref, "dwo_file", dwo_file);
    }
  }

  // result.into_result().unwrap_or_else(|()| llvm_err(dcx, LlvmError::WriteOutput { path: output }))
  if (llvm.LLVMRustResult_impl.into_result(result).$ === "Err") llvm_err(dcx, { $: "WriteOutput", path: output });
}

// rustc: compiler/rustc_codegen_llvm/src/back/write.rs:100 create_informational_target_machine
export function create_informational_target_machine(sess: Session): OwnedTargetMachine {
  const config: TargetMachineFactoryConfig = { split_dwarf_file: undefined, output_obj_file: undefined };
  return target_machine_factory(sess, "No")(sess.dcx(), config);
}

// rustc: compiler/rustc_codegen_llvm/src/back/write.rs:105 create_target_machine
export function create_target_machine(tcx: TyCtxt, mod_name: string): OwnedTargetMachine {
  let split_dwarf_file: PathBuf | undefined;
  if (tcx.sess.target_can_use_split_dwarf()) {
    split_dwarf_file = OutputFilenames_split_dwarf_path(
      tcx.output_filenames(null) as OutputFilenames,
      tcx.sess.split_debuginfo(),
      tcx.sess.opts.unstable_opts.split_dwarf_kind,
      mod_name,
    );
  } else {
    split_dwarf_file = undefined;
  }

  const output_obj_file: PathBuf | undefined = OutputFilenames_temp_path_for_cgu(tcx.output_filenames(null) as OutputFilenames, "Object", mod_name);
  const config: TargetMachineFactoryConfig = { split_dwarf_file, output_obj_file };

  return target_machine_factory(tcx.sess, tcx.backend_optimization_level(null))(tcx.dcx(), config);
}

/** `-> (llvm::CodeGenOptLevel, llvm::CodeGenOptSize)` */
// rustc: compiler/rustc_codegen_llvm/src/back/write.rs:123 to_llvm_opt_settings
function to_llvm_opt_settings(cfg: OptLevel): [llvm.CodeGenOptLevel, llvm.CodeGenOptSize] {
  // use self::config::OptLevel::*;
  switch (cfg) {
    case "No":
      return ["None", "CodeGenOptSizeNone"];
    case "Less":
      return ["Less", "CodeGenOptSizeNone"];
    case "More":
      return ["Default", "CodeGenOptSizeNone"];
    case "Aggressive":
      return ["Aggressive", "CodeGenOptSizeNone"];
    case "Size":
      return ["Default", "CodeGenOptSizeDefault"];
    case "SizeMin":
      return ["Default", "CodeGenOptSizeAggressive"];
  }
}

// rustc: compiler/rustc_codegen_llvm/src/back/write.rs:135 to_pass_builder_opt_level
function to_pass_builder_opt_level(cfg: OptLevel): llvm.PassBuilderOptLevel {
  // use config::OptLevel::*;
  switch (cfg) {
    case "No":
      return "O0";
    case "Less":
      return "O1";
    case "More":
      return "O2";
    case "Aggressive":
      return "O3";
    case "Size":
      return "Os";
    case "SizeMin":
      return "Oz";
  }
}

// rustc: compiler/rustc_codegen_llvm/src/back/write.rs:147 to_llvm_relocation_model
function to_llvm_relocation_model(relocation_model: RelocModel): llvm.RelocModel {
  switch (relocation_model) {
    case "Static":
      return "Static";
    // LLVM doesn't have a PIE relocation model, it represents PIE as PIC with an extra
    // attribute.
    case "Pic":
    case "Pie":
      return "PIC";
    case "DynamicNoPic":
      return "DynamicNoPic";
    case "Ropi":
      return "ROPI";
    case "Rwpi":
      return "RWPI";
    case "RopiRwpi":
      return "ROPI_RWPI";
  }
}

// rustc: compiler/rustc_codegen_llvm/src/back/write.rs:160 to_llvm_code_model
export function to_llvm_code_model(code_model: CodeModel | undefined): llvm.CodeModel {
  switch (code_model) {
    case "Tiny":
      return "Tiny";
    case "Small":
      return "Small";
    case "Kernel":
      return "Kernel";
    case "Medium":
      return "Medium";
    case "Large":
      return "Large";
    case undefined:
      return "None";
  }
}

// rustc: compiler/rustc_codegen_llvm/src/back/write.rs:171 to_llvm_float_abi
function to_llvm_float_abi(float_abi: FloatAbi | undefined): llvm.FloatAbi {
  switch (float_abi) {
    case undefined:
      return "Default";
    case "Soft":
      return "Soft";
    case "Hard":
      return "Hard";
  }
}

/** `-> TargetMachineFactoryFn<LlvmCodegenBackend>` (an `Arc<dyn Fn(..)>`: the closure). */
// rustc: compiler/rustc_codegen_llvm/src/back/write.rs:179 target_machine_factory
export function target_machine_factory(sess: Session, optlvl: OptLevel): TargetMachineFactoryFn<LlvmWriteTypes> {
  // Self-profile timer for creating a _factory_.
  const _prof_timer = sess.prof.generic_activity("target_machine_factory");

  const reloc_model = to_llvm_relocation_model(sess.relocation_model());

  const [opt_level] = to_llvm_opt_settings(optlvl);
  const float_abi = to_llvm_float_abi(sess.target.llvm_floatabi);

  const ffunction_sections = sess.opts.unstable_opts.function_sections ?? sess.target.function_sections;
  const fdata_sections = ffunction_sections;
  const funique_section_names = !sess.opts.unstable_opts.no_unique_section_names;

  const code_model = to_llvm_code_model(sess.code_model());

  const singlethread = sess.target.singlethread_(sess.internal_target_features);

  // PORT: the `SmallCStr`s below are the text; `SmallCStr::new`'s interior-NUL panic is dropped (llvm_util.ts `target_config`).
  // let triple = SmallCStr::new(&versioned_llvm_target(sess));
  const triple = versioned_llvm_target(sess.early_sess);
  // let cpu = SmallCStr::new(llvm_util::target_cpu(sess));
  const cpu = llvm_util.target_cpu(sess.early_sess);
  const features = cstring_new_unwrap(sess.global_backend_features.join(","));
  // let abi = SmallCStr::new(sess.target.llvm_abiname.desc());
  const abi = LlvmAbi.desc(sess.target.llvm_abiname);
  const trap_unreachable = sess.opts.unstable_opts.trap_unreachable ?? sess.target.trap_unreachable;
  const emit_stack_size_section = sess.opts.unstable_opts.emit_stack_sizes;

  const verbose_asm = sess.opts.unstable_opts.verbose_asm;
  const relax_x86_elf_relocations = sess.opts.unstable_opts.relax_elf_relocations ?? sess.target.relax_elf_relocations;

  const use_init_array = !(sess.opts.unstable_opts.use_ctors_section ?? sess.target.use_ctors_section);

  const path_mapping = sess.source_map().path_mapping();
  const working_dir = sess.source_map().working_dir();

  const use_emulated_tls = sess.tls_model() === "Emulated";

  let debuginfo_compression: llvm.CompressionKind;
  switch (sess.opts.unstable_opts.debuginfo_compression) {
    case "None":
      debuginfo_compression = "None";
      break;
    case "Zlib":
      if (llvm.LLVMRustLLVMHasZlibCompression()) {
        debuginfo_compression = "Zlib";
      } else {
        sess.dcx().emit_warn(UnsupportedCompression_diagnostic({ algorithm: "zlib" }));
        debuginfo_compression = "None";
      }
      break;
    case "Zstd":
      if (llvm.LLVMRustLLVMHasZstdCompression()) {
        debuginfo_compression = "Zstd";
      } else {
        sess.dcx().emit_warn(UnsupportedCompression_diagnostic({ algorithm: "zstd" }));
        debuginfo_compression = "None";
      }
      break;
  }

  const use_wasm_eh = wants_wasm_eh(sess.target);

  const large_data_threshold = sess.opts.unstable_opts.large_data_threshold ?? 0n;

  const prof = sess.prof; // SelfProfilerRef::clone(&sess.prof)
  // Arc::new(move |dcx: DiagCtxtHandle<'_>, config: TargetMachineFactoryConfig| { .. })
  return (dcx: DiagCtxtHandle, config: TargetMachineFactoryConfig): OwnedTargetMachine => {
    // Self-profile timer for invoking a factory to create a target machine.
    const _prof_timer = prof.generic_activity("target_machine_factory_inner");

    const path_to_cstring_helper = (path_: PathBuf | undefined): string => {
      const path = path_ ?? "";
      const path__ = path_mapping.to_real_filename(working_dir, path).path(RemapPathScopeComponents.DEBUGINFO);
      // .to_string_lossy().into_owned() (a PathBuf is UTF-8 text here, PORTING §5)
      return cstring_new_unwrap(path__);
    };

    const split_dwarf_file = path_to_cstring_helper(config.split_dwarf_file);
    const output_obj_file = path_to_cstring_helper(config.output_obj_file);

    const r = OwnedTargetMachine.new(
      triple,
      cpu,
      features,
      abi,
      code_model,
      reloc_model,
      opt_level,
      float_abi,
      ffunction_sections,
      fdata_sections,
      funique_section_names,
      trap_unreachable,
      singlethread,
      verbose_asm,
      emit_stack_size_section,
      relax_x86_elf_relocations,
      use_init_array,
      split_dwarf_file,
      output_obj_file,
      debuginfo_compression,
      use_emulated_tls,
      use_wasm_eh,
      large_data_threshold,
    );
    // .unwrap_or_else(|err| dcx.emit_fatal(ParseTargetMachineConfig(err)))
    return r.$ === "Ok" ? r._0 : dcx.emit_fatal(ParseTargetMachineConfig_diagnostic({ _0: r._0 }));
  };
}

// rustc: compiler/rustc_codegen_llvm/src/back/write.rs:291 save_temp_bitcode
export function save_temp_bitcode(cgcx: CodegenContext, module: ModuleCodegen<ModuleLlvm>, name: string): void {
  if (!cgcx_(cgcx).save_temps) {
    return;
  }
  const ext = `${name}.bc`;
  const path = OutputFilenames_temp_path_ext_for_cgu(cgcx_(cgcx).output_filenames, ext, module.name);
  write_bitcode_to_file(module.module_llvm, path);
}

// rustc: compiler/rustc_codegen_llvm/src/back/write.rs:304 write_bitcode_to_file
function write_bitcode_to_file(module: ModuleLlvm, path: PathBuf): void {
  // unsafe {
  const path_ = path_to_c_string(path);
  const llmod = module.llmod();
  llvm.LLVMWriteBitcodeToFile(llmod, path_);
  // }
}

/// In what context is a diagnostic handler being attached to a codegen unit?
export type CodegenDiagnosticsStage =
  /// Prelink optimization stage.
  | "Opt"
  /// LTO/ThinLTO postlink optimization stage.
  | "LTO"
  /// Code generation.
  | "Codegen";
export const CodegenDiagnosticsStage = { Opt: "Opt", LTO: "LTO", Codegen: "Codegen" } as const;

export class DiagnosticHandlers {
  constructor(
    /** `data: *mut (&'a CodegenContext, &'a SharedEmitter)` */
    public data: [CodegenContext, SharedEmitter] | undefined,
    public llcx: llvm.Context,
    public old_handler: llvm.DiagnosticHandler | undefined,
  ) {}

  // rustc: compiler/rustc_codegen_llvm/src/back/write.rs:329 new
  static new(cgcx: CodegenContext, shared_emitter: SharedEmitter, llcx: llvm.Context, module: ModuleCodegen<ModuleLlvm>, stage: CodegenDiagnosticsStage): DiagnosticHandlers {
    let remark_passes_all: boolean;
    let remark_passes: string[];
    const remark: Passes = cgcx_(cgcx).remark;
    switch (remark.$) {
      case "All": {
        remark_passes_all = true;
        remark_passes = [];
        break;
      }
      case "Some": {
        const passes = remark._0;
        remark_passes_all = false;
        remark_passes = passes.map((name) => cstring_new_unwrap(name));
        break;
      }
    }
    // let remark_passes: Vec<*const c_char> = remark_passes.iter().map(|name: &CString| name.as_ptr()).collect();
    const remark_dir = cgcx_(cgcx).remark_dir;
    let remark_file: string | undefined;
    if (remark_dir !== undefined) {
      // Use the .opt.yaml file suffix, which is supported by LLVM's opt-viewer.
      let stage_suffix: string;
      switch (stage) {
        case "Codegen":
          stage_suffix = "codegen";
          break;
        case "Opt":
          stage_suffix = "opt";
          break;
        case "LTO":
          stage_suffix = "lto";
          break;
      }
      const dir = path_join(remark_dir, `${module.name}.${stage_suffix}.opt.yaml`);
      // .and_then(|dir| dir.to_str().and_then(|p| CString::new(p).ok()))
      remark_file = utf8(dir).includes(0) ? undefined : dir;
    } else {
      remark_file = undefined;
    }

    const pgo_available = config_(cgcx_(cgcx).module_config).pgo_use !== undefined;
    const data: [CodegenContext, SharedEmitter] = [cgcx, shared_emitter]; // Box::into_raw(Box::new((cgcx, shared_emitter)))
    // unsafe {
    const old_handler = llvm.LLVMRustContextGetDiagnosticHandler(llcx);
    llvm.LLVMRustContextConfigureDiagnosticHandler(
      llcx,
      diagnostic_handler,
      data,
      remark_passes_all,
      remark_passes,
      remark_passes.length,
      // The `as_ref()` is important here, otherwise the `CString` will be dropped
      // too soon!
      remark_file,
      pgo_available,
    );
    return new DiagnosticHandlers(data, llcx, old_handler);
    // }
  }

  // impl<'a> Drop for DiagnosticHandlers<'a>
  // rustc: compiler/rustc_codegen_llvm/src/back/write.rs:387 drop
  drop(): void {
    // unsafe {
    llvm.LLVMRustContextSetDiagnosticHandler(this.llcx, this.old_handler);
    // drop(Box::from_raw(self.data));
    this.data = undefined;
    // }
  }
}

/** `cookie: u64` is a `bigint`. `source: Option<(String, Vec<InnerSpan>)>`. */
// rustc: compiler/rustc_codegen_llvm/src/back/write.rs:395 report_inline_asm
function report_inline_asm(cgcx: CodegenContext, msg: string, level: llvm.DiagnosticLevel, cookie: bigint, source: [string, InnerSpan[]] | undefined): InlineAsmError {
  // In LTO build we may get srcloc values from other crates which are invalid
  // since they use a different source map. To be safe we just suppress these
  // in LTO builds.
  let lo: BytePos;
  let hi: BytePos;
  const lto = cgcx_(cgcx).lto;
  if (cookie === 0n || lto === "Fat" || lto === "Thin") {
    [lo, hi] = [Span.lo(DUMMY_SP), Span.hi(DUMMY_SP)];
  } else {
    lo = BytePos.from_u32(Number(BigInt.asUintN(32, cookie)));
    hi = BytePos.from_u32(Number(BigInt.asUintN(32, cookie >> 32n)));
  }
  let level_: Level;
  switch (level) {
    case "Error":
      level_ = Level.Error;
      break;
    case "Warning":
      level_ = { $: "Warning", _0: undefined };
      break;
    case "Note":
    case "Remark":
      level_ = Level.Note;
      break;
  }
  // let msg = msg.trim_prefix("error: ").to_string();
  const msg_ = msg.startsWith("error: ") ? msg.slice("error: ".length) : msg;
  return { lo, hi, msg: msg_, level: level_, source };
}

/** `unsafe extern "C" fn diagnostic_handler(info: &DiagnosticInfo, user: *mut c_void)`: `user` is the `data` that
 * `DiagnosticHandlers::new` registered. */
// rustc: compiler/rustc_codegen_llvm/src/back/write.rs:421 diagnostic_handler
function diagnostic_handler(info: llvm.DiagnosticInfo, user: unknown): void {
  if (user === undefined || user === null) {
    return;
  }
  const [cgcx, shared_emitter] = user as [CodegenContext, SharedEmitter];

  const dcx_ = DiagCtxt.new(SharedEmitter_clone_box(shared_emitter));
  const dcx = dcx_.handle();

  const diag = Diagnostic_unpack(info);
  switch (diag.$) {
    case "InlineAsm": {
      const inline = diag._0;
      // FIXME use dcx
      SharedEmitter_inline_asm_error(shared_emitter, report_inline_asm(cgcx, inline.message, inline.level, inline.cookie, inline.source));
      break;
    }

    case "Optimization": {
      const opt = diag._0;
      let kind: string;
      switch (opt.kind) {
        case "OptimizationRemark":
          kind = "success";
          break;
        case "OptimizationMissed":
        case "OptimizationFailure":
          kind = "missed";
          break;
        case "OptimizationAnalysis":
        case "OptimizationAnalysisFPCommute":
        case "OptimizationAnalysisAliasing":
          kind = "analysis";
          break;
        case "OptimizationRemarkOther":
          kind = "other";
          break;
      }
      dcx.emit_note(
        FromLlvmOptimizationDiag_diagnostic({
          filename: opt.filename,
          line: opt.line,
          column: opt.column,
          pass_name: opt.pass_name,
          kind,
          message: opt.message,
        }),
      );
      break;
    }
    case "PGO":
    case "Linker": {
      const diagnostic_ref = diag._0;
      const r = llvm.build_string((s) => llvm.LLVMRustWriteDiagnosticInfoToString(diagnostic_ref, s));
      if (r.$ === "Err") panic("non-UTF8 diagnostic");
      const message = r._0;
      dcx.emit_warn(FromLlvmDiag_diagnostic({ message }));
      break;
    }
    case "Unsupported": {
      const diagnostic_ref = diag._0;
      const r = llvm.build_string((s) => llvm.LLVMRustWriteDiagnosticInfoToString(diagnostic_ref, s));
      if (r.$ === "Err") panic("non-UTF8 diagnostic");
      const message = r._0;
      dcx.emit_err(FromLlvmDiag_diagnostic({ message }));
      break;
    }
    case "UnknownDiagnostic":
      break;
  }
}

/** `-> Option<CString>` */
// rustc: compiler/rustc_codegen_llvm/src/back/write.rs:477 get_pgo_gen_path
function get_pgo_gen_path(config: ModuleConfig): string | undefined {
  const pgo_gen: SwitchWithOptPath = config_(config).pgo_gen;
  switch (pgo_gen.$) {
    case "Enabled": {
      const opt_dir_path = pgo_gen._0;
      let path: PathBuf;
      if (opt_dir_path !== undefined) {
        const dir_path = opt_dir_path;
        path = path_join(dir_path, "default_%m.profraw");
      } else {
        path = "default_%m.profraw";
      }

      return cstring_new_unwrap(path); // format!("{}", path.display())
    }
    case "Disabled":
      return undefined;
  }
}

// rustc: compiler/rustc_codegen_llvm/src/back/write.rs:492 get_pgo_use_path
function get_pgo_use_path(config: ModuleConfig): string | undefined {
  const p = config_(config).pgo_use;
  return p === undefined ? undefined : cstring_new_unwrap(p); // path_buf.to_string_lossy().as_bytes()
}

// rustc: compiler/rustc_codegen_llvm/src/back/write.rs:499 get_pgo_sample_use_path
function get_pgo_sample_use_path(config: ModuleConfig): string | undefined {
  const p = config_(config).pgo_sample_use;
  return p === undefined ? undefined : cstring_new_unwrap(p);
}

// rustc: compiler/rustc_codegen_llvm/src/back/write.rs:506 get_instr_profile_output_path
function get_instr_profile_output_path(config: ModuleConfig): string | undefined {
  return config_(config).instrument_coverage ? "default_%m_%p.profraw" : undefined;
}

// PreAD will run llvm opts but disable size increasing opts (vectorization, loop unrolling)
// DuringAD is the same as above, but also runs the enzyme opt and autodiff passes.
// PostAD will run all opts, including size increasing opts.
// #[derive(Debug, Eq, PartialEq)]
export type AutodiffStage = "PreAD" | "DuringAD" | "PostAD";
export const AutodiffStage = { PreAD: "PreAD", DuringAD: "DuringAD", PostAD: "PostAD" } as const;
export const debug_AutodiffStage = (v: AutodiffStage): string => v;

/** An `unsafe fn`. `thin_lto_buffer` / `thin_lto_summary_buffer`: `Option<&mut Option<Buffer>>`, a `{ value }` cell or `undefined`. */
// rustc: compiler/rustc_codegen_llvm/src/back/write.rs:520 llvm_optimize
export function llvm_optimize(
  cgcx: CodegenContext,
  prof: SelfProfilerRef,
  dcx: DiagCtxtHandle,
  module: ModuleCodegen<ModuleLlvm>,
  thin_lto_buffer: { value: Buffer | undefined } | undefined,
  thin_lto_summary_buffer: { value: Buffer | undefined } | undefined,
  config: ModuleConfig,
  opt_level: OptLevel,
  opt_stage: llvm.OptStage,
  autodiff_stage: AutodiffStage,
): void {
  // Enzyme:
  // The whole point of compiler based AD is to differentiate optimized IR instead of unoptimized
  // source code. However, benchmarks show that optimizations increasing the code size
  // tend to reduce AD performance. Therefore deactivate them before AD, then differentiate the code
  // and finally re-optimize the module, now with all optimizations available.
  // FIXME(ZuseZ4): In a future update we could figure out how to only optimize individual functions getting
  // differentiated.

  const c = config_(config);
  const cx_ = cgcx_(cgcx);
  const consider_ad = c.autodiff.some((a) => a.$ === "Enable");
  const run_enzyme = autodiff_stage === "DuringAD";
  const print_before_enzyme = c.autodiff.some((a) => a.$ === "PrintModBefore");
  const print_after_enzyme = c.autodiff.some((a) => a.$ === "PrintModAfter");
  const print_passes = c.autodiff.some((a) => a.$ === "PrintPasses");
  const passes_after_enzyme: string | undefined = autodiff_stage === "PostAD" ? c.autodiff_post_passes : undefined;

  let merge_functions: boolean;
  let unroll_loops: boolean;
  let vectorize_slp: boolean;
  let vectorize_loop: boolean;

  // When we build rustc with enzyme/autodiff support, we want to postpone size-increasing
  // optimizations until after differentiation. Our pipeline is thus: (opt + enzyme), (full opt).
  // We therefore have two calls to llvm_optimize, if autodiff is used.
  //
  // We also must disable merge_functions, since autodiff placeholder/dummy bodies tend to be
  // identical. We run opts before AD, so there is a chance that LLVM will merge our dummies.
  // In that case, we lack some dummy bodies and can't replace them with the real AD code anymore.
  // We then would need to abort compilation. This was especially common in test cases.
  if (consider_ad && autodiff_stage !== "PostAD") {
    merge_functions = false;
    unroll_loops = false;
    vectorize_slp = false;
    vectorize_loop = false;
  } else {
    unroll_loops = opt_level !== "Size" && opt_level !== "SizeMin";
    merge_functions = c.merge_functions;
    vectorize_slp = c.vectorize_slp;
    vectorize_loop = c.vectorize_loop;
  }
  // trace!(?unroll_loops, ?vectorize_slp, ?vectorize_loop, ?run_enzyme);
  void run_enzyme;
  if (thin_lto_buffer !== undefined) {
    assert(
      opt_stage === "PreLinkNoLTO" || opt_stage === "PreLinkFatLTO" || opt_stage === "PreLinkThinLTO",
      "the bitcode for LTO can only be obtained at the pre-link stage",
    );
  }
  const pgo_gen_path = get_pgo_gen_path(config);
  const pgo_use_path = get_pgo_use_path(config);
  const pgo_sample_use_path = get_pgo_sample_use_path(config);
  const is_lto = opt_stage === "ThinLTO" || opt_stage === "FatLTO";
  const is_final_stage = !(opt_stage === "PreLinkFatLTO" || opt_stage === "PreLinkThinLTO");
  const instr_profile_output_path = get_instr_profile_output_path(config);
  const sanitize_dataflow_abilist: string[] = c.sanitizer_dataflow_abilist.map((file) => cstring_new_unwrap(file));
  const sanitize_dataflow_abilist_ptrs: string[] = sanitize_dataflow_abilist;
  // Sanitizer instrumentation is only inserted during the pre-link optimization stage.
  let sanitizer_options: llvm.SanitizerOptions | undefined;
  if (!is_lto) {
    sanitizer_options = {
      sanitize_address: SanitizerSet.contains(c.sanitizer, SanitizerSet.ADDRESS),
      sanitize_address_recover: SanitizerSet.contains(c.sanitizer_recover, SanitizerSet.ADDRESS),
      sanitize_cfi: SanitizerSet.contains(c.sanitizer, SanitizerSet.CFI),
      sanitize_dataflow: SanitizerSet.contains(c.sanitizer, SanitizerSet.DATAFLOW),
      sanitize_dataflow_abilist: sanitize_dataflow_abilist_ptrs,
      sanitize_dataflow_abilist_len: sanitize_dataflow_abilist_ptrs.length,
      sanitize_kcfi: SanitizerSet.contains(c.sanitizer, SanitizerSet.KCFI),
      sanitize_memory: SanitizerSet.contains(c.sanitizer, SanitizerSet.MEMORY),
      sanitize_memory_recover: SanitizerSet.contains(c.sanitizer_recover, SanitizerSet.MEMORY),
      sanitize_memory_track_origins: c.sanitizer_memory_track_origins,
      sanitize_realtime: SanitizerSet.contains(c.sanitizer, SanitizerSet.REALTIME),
      sanitize_thread: SanitizerSet.contains(c.sanitizer, SanitizerSet.THREAD),
      sanitize_hwaddress: SanitizerSet.contains(c.sanitizer, SanitizerSet.HWADDRESS),
      sanitize_hwaddress_recover: SanitizerSet.contains(c.sanitizer_recover, SanitizerSet.HWADDRESS),
      sanitize_kernel_address: SanitizerSet.contains(c.sanitizer, SanitizerSet.KERNELADDRESS),
      sanitize_kernel_address_recover: SanitizerSet.contains(c.sanitizer_recover, SanitizerSet.KERNELADDRESS),
      sanitize_kernel_hwaddress: SanitizerSet.contains(c.sanitizer, SanitizerSet.KERNELHWADDRESS),
      sanitize_kernel_hwaddress_recover: SanitizerSet.contains(c.sanitizer_recover, SanitizerSet.KERNELHWADDRESS),
    };
  } else {
    sanitizer_options = undefined;
  }

  // (`fn handle_offload` is nested here upstream; it follows this function.)

  if (cx_.target_is_like_gpu && c.offload.some((o) => o.$ === "Device")) {
    const cx = context_mod().SimpleCx.new(module.module_llvm.llmod(), module.module_llvm.llcx, cx_.pointer_size);
    for (const func of cx.get_functions()) {
      const offload_kernel = "offload-kernel";
      if (attributes_mod().has_string_attr(func, offload_kernel)) {
        handle_offload(cx, func);
      }
      attributes_mod().remove_string_attr_from_llfn(func, offload_kernel);
    }
  }

  // let mut llvm_profiler = prof.llvm_recording_enabled().then(|| LlvmSelfProfiler::new(prof.get_self_profiler().unwrap()));
  const llvm_profiler: LlvmSelfProfiler | undefined = SelfProfilerRef_llvm_recording_enabled(prof)
    ? LlvmSelfProfiler.new(unported("rustc_data_structures: compiler/rustc_data_structures/src/profiling.rs SelfProfilerRef::get_self_profiler (-Z self-profile)"))
    : undefined;

  const llvm_selfprofiler: unknown = llvm_profiler; // .as_mut().map(|s| s as *mut _ as *mut c_void).unwrap_or(null_mut())

  const extra_passes = !is_lto ? c.passes.join(",") : "";

  const llvm_plugins = c.llvm_plugins.join(",");

  let enzyme_fn: unknown;
  if (consider_ad) {
    // let wrapper = llvm::EnzymeWrapper::get_instance();
    // wrapper.registerEnzymeAndPassPipeline
    enzyme_fn = unported("excluded (plan-m7 D18): compiler/rustc_codegen_llvm/src/llvm/enzyme_ffi.rs EnzymeWrapper::get_instance");
  } else {
    enzyme_fn = undefined;
  }

  const result = llvm.LLVMRustOptimize(
    module.module_llvm.llmod(),
    module.module_llvm.tm.raw(),
    to_pass_builder_opt_level(opt_level),
    opt_stage,
    cx_.use_linker_plugin_lto,
    c.no_prepopulate_passes,
    c.verify_llvm_ir,
    c.lint_llvm_ir,
    thin_lto_buffer,
    thin_lto_summary_buffer,
    merge_functions,
    unroll_loops,
    vectorize_slp,
    vectorize_loop,
    c.no_builtins,
    c.emit_lifetime_markers,
    enzyme_fn,
    print_before_enzyme,
    print_after_enzyme,
    print_passes,
    sanitizer_options,
    pgo_gen_path,
    pgo_use_path,
    c.instrument_coverage,
    instr_profile_output_path,
    pgo_sample_use_path,
    c.debug_info_for_profiling,
    llvm_selfprofiler,
    selfprofile_before_pass_callback,
    selfprofile_after_pass_callback,
    passes_after_enzyme,
    passes_after_enzyme === undefined ? 0 : utf8(passes_after_enzyme).length,
    extra_passes,
    utf8(extra_passes).length,
    llvm_plugins,
    utf8(llvm_plugins).length,
  );

  if (cx_.target_is_like_gpu && c.offload.some((o) => o.$ === "Device")) {
    const device_path = cx_.output_filenames.path("Object");
    const device_dir = unwrap_option(OutFileName.parent(device_path));
    const device_out = path_join(device_dir, "device.bin");
    const device_out_c = path_to_c_string(device_out);
    // 1) Bundle device module into offload image device.bin (device TM)
    void device_out_c;
    const ok: boolean = unported("excluded (plan-m7 D18): compiler/rustc_codegen_llvm/src/llvm/offload_ffi.rs RustOffloadWrapper::llvm_rust_bundle_images");
    if (!ok || !existsSync(device_out)) {
      dcx.emit_err(OffloadBundleImagesFailed_diagnostic({}));
    }
  }

  // This assumes that we previously compiled our kernels for a gpu target, which created a
  // `device.bin` artifact. The user is supposed to provide us with a path to this artifact, we
  // don't need any other artifacts from the previous run.
  if (!cx_.target_is_like_gpu && is_final_stage) {
    const host = c.offload.find((o): o is Extract<Offload, { $: "Host" }> => o.$ === "Host");
    if (host !== undefined) {
      const device_path = host._0;
      const device_pathbuf: PathBuf = device_path;
      if (!isAbsolute(device_pathbuf)) {
        dcx.emit_err(OffloadWithoutAbsPath_diagnostic({}));
      } else if (path_file_name(device_pathbuf) !== undefined && path_file_name(device_pathbuf) !== "device.bin") {
        dcx.emit_err(OffloadWrongFileName_diagnostic({}));
      } else if (!existsSync(device_pathbuf)) {
        dcx.emit_err(OffloadNonexistingPath_diagnostic({}));
      }
      const device_bin_c = path_to_c_string(device_pathbuf);
      void device_bin_c;
      const ok: boolean = unported("excluded (plan-m7 D18): compiler/rustc_codegen_llvm/src/llvm/offload_ffi.rs RustOffloadWrapper::llvm_rust_offload_wrap_images");
      if (!ok) {
        dcx.emit_err(OffloadWrapImagesFailed_diagnostic({}));
      }
    }
  }
  // result.into_result().unwrap_or_else(|()| llvm_err(dcx, LlvmError::RunLlvmPasses))
  if (llvm.LLVMRustResult_impl.into_result(result).$ === "Err") llvm_err(dcx, { $: "RunLlvmPasses" });
}

/** The nested `fn handle_offload<'ll>(cx: &'ll SimpleCx<'_>, old_fn: &llvm::Value)` of `llvm_optimize`. */
// rustc: compiler/rustc_codegen_llvm/src/back/write.rs:632 handle_offload
function handle_offload(cx: SimpleCx, old_fn: llvm.Value): void {
  const old_fn_ty = cx.get_type_of_global(old_fn);
  const old_param_types = cx.func_params_types(old_fn_ty);
  const old_param_count = old_param_types.length;
  if (old_param_count === 0) {
    return;
  }

  const first_param = llvm.get_param(old_fn, 0);
  const c_name = llvm.get_value_name(first_param);
  const first_arg_name = from_utf8_unwrap(c_name);
  // We might call llvm_optimize (and thus this code) multiple times on the same IR,
  // but we shouldn't add this helper ptr multiple times.
  // FIXME(offload): This could break if the user calls his first argument `dyn_ptr`.
  if (first_arg_name === "dyn_ptr") {
    return;
  }

  // Create the new parameter list, with ptr as the first argument
  const new_param_types: llvm.Type[] = [];
  new_param_types.push(cx.type_ptr());

  // This relies on undocumented LLVM knowledge that scalars must be passed as i64
  for (const old_ty of old_param_types) {
    let new_ty: llvm.Type;
    const k: TypeKind = cx.type_kind(old_ty);
    switch (k) {
      case "Half":
      case "Float":
      case "Double":
      case "Integer":
        new_ty = cx.type_i64();
        break;
      default:
        new_ty = old_ty;
    }
    new_param_types.push(new_ty);
  }

  // Create the new function type
  const ret_ty = llvm.LLVMGetReturnType(old_fn_ty);
  const new_fn_ty = cx.type_func(new_param_types, ret_ty);

  // Create the new function, with a temporary .offload name to avoid a name collision.
  const old_fn_name = from_utf8_unwrap(llvm.get_value_name(old_fn));
  const new_fn_name = `${old_fn_name}.offload`;
  const new_fn = cx.add_func(new_fn_name, new_fn_ty);
  const a0 = llvm.get_param(new_fn, 0);
  llvm.set_value_name(a0, utf8(cstring_new_unwrap("dyn_ptr")));

  const bb = builder_mod().SBuilder.append_block_inherent(cx, new_fn, "entry");
  const builder = builder_mod().SBuilder.build_inherent(cx, bb);

  const old_args_rebuilt: llvm.Value[] = [];

  for (let i = 0; i < old_param_types.length; i++) {
    const old_ty = old_param_types[i]!;
    const new_arg = llvm.get_param(new_fn, i + 1);

    let rebuilt: llvm.Value;
    const k: TypeKind = cx.type_kind(old_ty);
    switch (k) {
      case "Half":
      case "Float":
      case "Double":
      case "Integer": {
        const num_bits = scalar_width(cx, old_ty);

        const trunc = builder.trunc_inherent(new_arg, cx.type_ix(num_bits));
        rebuilt = builder.bitcast_inherent(trunc, old_ty);
        break;
      }
      default:
        rebuilt = new_arg;
    }

    old_args_rebuilt.push(rebuilt);
  }

  builder.ret_void_inherent();

  // Here we map the old arguments to the new arguments, with an offset of 1 to make sure
  // that we don't use the newly added `%dyn_ptr`.
  // unsafe { llvm::RustOffloadWrapper::get_instance().llvm_rust_offload_wrapper(old_fn, new_fn, old_args_rebuilt.as_slice()); }
  unported("excluded (plan-m7 D18): compiler/rustc_codegen_llvm/src/llvm/offload_ffi.rs RustOffloadWrapper::llvm_rust_offload_wrapper");

  llvm.set_linkage(new_fn, llvm.get_linkage(old_fn));
  llvm.set_visibility(new_fn, llvm.get_visibility(old_fn));

  // Replace all uses of old_fn with new_fn (RAUW)
  llvm.LLVMReplaceAllUsesWith(old_fn, new_fn);
  const name = llvm.get_value_name(old_fn);
  llvm.LLVMDeleteFunction(old_fn);
  // Now we can re-use the old name, without name collision.
  llvm.set_value_name(new_fn, name);
}

/** `module: &mut ModuleCodegen<ModuleLlvm>`. Unsafe due to LLVM calls. */
// Unsafe due to LLVM calls.
// rustc: compiler/rustc_codegen_llvm/src/back/write.rs:854 optimize
export function optimize(cgcx: CodegenContext, prof: SelfProfilerRef, shared_emitter: SharedEmitter, module: ModuleCodegen<ModuleLlvm>, config: ModuleConfig): void {
  const _timer = SelfProfilerRef_generic_activity_with_arg(prof, "LLVM_module_optimize", module.name);

  const dcx_ = DiagCtxt.new(SharedEmitter_clone_box(shared_emitter));
  const dcx = dcx_.handle();

  const llcx = module.module_llvm.llcx;
  const _handlers = DiagnosticHandlers.new(cgcx, shared_emitter, llcx, module, "Opt");

  if (module.kind === ModuleKind.Regular) {
    save_temp_bitcode(cgcx, module, "no-opt");
  }

  // FIXME(ZuseZ4): support SanitizeHWAddress and prevent illegal/unsupported opts

  const c = config_(config);
  const cx_ = cgcx_(cgcx);
  if (c.opt_level !== undefined) {
    const opt_level = c.opt_level;
    let opt_stage: llvm.OptStage;
    const lto: Lto = cx_.lto;
    if (lto === "Fat") {
      opt_stage = "PreLinkFatLTO";
    } else if (lto === "Thin" || lto === "ThinLocal") {
      opt_stage = "PreLinkThinLTO";
    } else if (cx_.use_linker_plugin_lto) {
      opt_stage = "PreLinkThinLTO";
    } else {
      opt_stage = "PreLinkNoLTO";
    }

    // If we know that we will later run AD, then we disable vectorization and loop unrolling.
    // Otherwise we pretend AD is already done and run the normal opt pipeline (=PostAD).
    const consider_ad = c.autodiff.some((a) => a.$ === "Enable");
    const autodiff_stage: AutodiffStage = consider_ad ? "PreAD" : "PostAD";
    // The embedded bitcode is used to run LTO/ThinLTO.
    // The bitcode obtained during the `codegen` phase is no longer suitable for performing LTO.
    // It may have undergone LTO due to ThinLocal, so we need to obtain the embedded bitcode at
    // this point.
    let thin_lto_buffer: { value: Buffer | undefined } | undefined;
    let thin_lto_summary_buffer: { value: Buffer | undefined } | undefined;
    if ((module.kind === ModuleKind.Regular && EmitObj_eq(c.emit_obj, { $: "ObjectCode", _0: "Full" })) || c.emit_thin_lto_summary) {
      [thin_lto_buffer, thin_lto_summary_buffer] = [{ value: undefined }, c.emit_thin_lto_summary ? { value: undefined } : undefined];
    } else {
      [thin_lto_buffer, thin_lto_summary_buffer] = [undefined, undefined];
    }
    // unsafe {
    llvm_optimize(cgcx, prof, dcx, module, thin_lto_buffer, thin_lto_summary_buffer, config, opt_level, opt_stage, autodiff_stage);
    // };
    if (thin_lto_buffer !== undefined) {
      const thin_lto_buffer_ = unwrap_option(thin_lto_buffer.value);
      module.thin_lto_buffer = Buffer_data(thin_lto_buffer_).slice();
      const bc_summary_out = OutputFilenames_temp_path_for_cgu(cx_.output_filenames, "ThinLinkBitcode", module.name);
      const thin_link_bitcode_filename = path_file_name(bc_summary_out);
      if (thin_lto_summary_buffer !== undefined && thin_link_bitcode_filename !== undefined) {
        const thin_lto_summary_buffer_ = unwrap_option(thin_lto_summary_buffer.value);
        const summary_data = Buffer_data(thin_lto_summary_buffer_);
        SelfProfilerRef_artifact_size(prof, "llvm_bitcode_summary", thin_link_bitcode_filename, BigInt(summary_data.length));
        const _timer = SelfProfilerRef_generic_activity_with_arg(prof, "LLVM_module_codegen_emit_bitcode_summary", module.name);
        const err = fs_write(bc_summary_out, summary_data);
        if (err.$ === "Err") {
          dcx.emit_err(WriteBytecode_diagnostic({ path: bc_summary_out, err: err._0 }));
        }
      }
    }
  }
  // `_handlers` drops at the end of the scope.
  _handlers.drop();
}

// rustc: compiler/rustc_codegen_llvm/src/back/write.rs:942 codegen
export function codegen(cgcx: CodegenContext, prof: SelfProfilerRef, shared_emitter: SharedEmitter, module: ModuleCodegen<ModuleLlvm>, config: ModuleConfig): CompiledModule {
  const _timer = SelfProfilerRef_generic_activity_with_arg(prof, "LLVM_module_codegen", module.name);

  const dcx_ = DiagCtxt.new(SharedEmitter_clone_box(shared_emitter));
  const dcx = dcx_.handle();

  const c = config_(config);
  const cx_ = cgcx_(cgcx);
  {
    const llmod = module.module_llvm.llmod();
    const llcx = module.module_llvm.llcx;
    const tm = module.module_llvm.tm;
    const _handlers = DiagnosticHandlers.new(cgcx, shared_emitter, llcx, module, "Codegen");

    if (cx_.msvc_imps_needed) {
      create_msvc_imps(cgcx, llcx, llmod);
    }

    // Note that if object files are just LLVM bitcode we write bitcode,
    // copy it to the .o file, and delete the bitcode if it wasn't
    // otherwise requested.

    const bc_out = OutputFilenames_temp_path_for_cgu(cx_.output_filenames, "Bitcode", module.name);
    const obj_out = OutputFilenames_temp_path_for_cgu(cx_.output_filenames, "Object", module.name);

    if (ModuleConfig_bitcode_needed(config)) {
      if (c.emit_bc || EmitObj_eq(c.emit_obj, EmitObj.Bitcode)) {
        let thin: ModuleBuffer;
        {
          const _timer = SelfProfilerRef_generic_activity_with_arg(prof, "LLVM_module_codegen_make_bitcode", module.name);
          thin = lto_mod().ModuleBuffer.new(llmod, cx_.lto !== "Fat");
        }
        const data = thin.data();
        const _timer = SelfProfilerRef_generic_activity_with_arg(prof, "LLVM_module_codegen_emit_bitcode", module.name);
        const bitcode_filename = path_file_name(bc_out);
        if (bitcode_filename !== undefined) {
          SelfProfilerRef_artifact_size(prof, "llvm_bitcode", bitcode_filename, BigInt(data.length));
        }
        const err = fs_write(bc_out, data);
        if (err.$ === "Err") {
          dcx.emit_err(WriteBytecode_diagnostic({ path: bc_out, err: err._0 }));
        }
      }

      if (ModuleConfig_embed_bitcode(config) && module.kind === ModuleKind.Regular) {
        const _timer = SelfProfilerRef_generic_activity_with_arg(prof, "LLVM_module_codegen_embed_bitcode", module.name);
        if (module.thin_lto_buffer === undefined) panic("cannot find embedded bitcode");
        const thin_bc = module.thin_lto_buffer;
        embed_bitcode(cgcx, llcx, llmod, thin_bc);
      }
    }

    if (c.emit_ir) {
      const _timer = SelfProfilerRef_generic_activity_with_arg(prof, "LLVM_module_codegen_emit_ir", module.name);
      const out = OutputFilenames_temp_path_for_cgu(cx_.output_filenames, "LlvmAssembly", module.name);
      const out_c = path_to_c_string(out);

      // (`extern "C" fn demangle_callback` is nested here upstream; it follows this function.)

      const result = llvm.LLVMRustPrintModule(llmod, out_c, demangle_callback);

      if (result === llvm.LLVMRustResult.Success) {
        record_artifact_size(prof, "llvm_ir", out);
      }

      // result.into_result().unwrap_or_else(|()| llvm_err(dcx, LlvmError::WriteIr { path: &out }));
      if (llvm.LLVMRustResult_impl.into_result(result).$ === "Err") llvm_err(dcx, { $: "WriteIr", path: out });
    }

    if (c.emit_asm) {
      const _timer = SelfProfilerRef_generic_activity_with_arg(prof, "LLVM_module_codegen_emit_asm", module.name);
      const path = OutputFilenames_temp_path_for_cgu(cx_.output_filenames, "Assembly", module.name);

      // We can't use the same module for asm and object code output,
      // because that triggers various errors like invalid IR or broken
      // binaries. So we must clone the module to produce the asm output
      // if we are also producing object code.
      const llmod_ = c.emit_obj.$ === "ObjectCode" ? llvm.LLVMCloneModule(llmod) : llmod;
      write_output_file(dcx, tm.raw(), c.no_builtins, llmod_, path, undefined, "AssemblyFile", prof, c.verify_llvm_ir);
    }

    switch (c.emit_obj.$) {
      case "ObjectCode": {
        const _timer = SelfProfilerRef_generic_activity_with_arg(prof, "LLVM_module_codegen_emit_obj", module.name);

        const dwo_out_ = OutputFilenames_temp_path_dwo_for_cgu(cx_.output_filenames, module.name);
        let dwo_out: PathBuf | undefined;
        const split_debuginfo: SplitDebuginfo = cx_.split_debuginfo;
        const split_dwarf_kind: SplitDwarfKind = cx_.split_dwarf_kind;
        if (split_debuginfo === "Off") {
          // Don't change how DWARF is emitted when disabled.
          dwo_out = undefined;
        } else if (!cx_.target_can_use_split_dwarf) {
          // Don't provide a DWARF object path if split debuginfo is enabled but this is
          // a platform that doesn't support Split DWARF.
          dwo_out = undefined;
        } else if (split_dwarf_kind === "Single") {
          // Don't provide a DWARF object path in single mode, sections will be written
          // into the object as normal but ignored by linker.
          dwo_out = undefined;
        } else {
          // Emit (a subset of the) DWARF into a separate dwarf object file in split
          // mode.
          dwo_out = dwo_out_;
        }

        write_output_file(dcx, tm.raw(), c.no_builtins, llmod, obj_out, dwo_out, "ObjectFile", prof, c.verify_llvm_ir);
        break;
      }

      case "Bitcode": {
        // debug!("copying bitcode {:?} to obj {:?}", bc_out, obj_out);
        const r = link_or_copy(bc_out, obj_out);
        if (r.$ === "Err") {
          dcx.emit_err(CopyBitcode_diagnostic({ err: r._0 }));
        }

        if (!c.emit_bc) {
          // debug!("removing_bitcode {:?}", bc_out);
          ensure_removed(dcx, bc_out);
        }
        break;
      }

      case "None":
        break;
    }

    record_llvm_cgu_instructions_stats(prof, module.name, llmod);
    // `_handlers` drops at the end of the block.
    _handlers.drop();
  }

  // `.dwo` files are only emitted if:
  //
  // - Object files are being emitted (i.e. bitcode only or metadata only compilations will not
  //   produce dwarf objects, even if otherwise enabled)
  // - Target supports Split DWARF
  // - Split debuginfo is enabled
  // - Split DWARF kind is `split` (i.e. debuginfo is split into `.dwo` files, not different
  //   sections in the `.o` files).
  const dwarf_object_emitted = c.emit_obj.$ === "ObjectCode" && cx_.target_can_use_split_dwarf && cx_.split_debuginfo !== "Off" && cx_.split_dwarf_kind === "Split";
  return module.into_compiled_module(c.emit_obj.$ !== "None", dwarf_object_emitted, c.emit_bc, c.emit_asm, c.emit_ir, cx_.output_filenames);
}

/** The nested `extern "C" fn demangle_callback(input_ptr: *const c_char, input_len: size_t, output_ptr: *mut c_char,
 * output_len: size_t) -> size_t` of `codegen`: `input` is the slice, `output` the buffer to fill; returns the bytes written. */
// rustc: compiler/rustc_codegen_llvm/src/back/write.rs:1017 demangle_callback
function demangle_callback(input_: Uint8Array, output: Uint8Array): number {
  // let input = unsafe { slice::from_raw_parts(input_ptr as *const u8, input_len as usize) };

  const input = from_utf8(input_);
  if (input === undefined) return 0;

  // let output = unsafe { slice::from_raw_parts_mut(output_ptr as *mut u8, output_len as usize) };
  // let mut cursor = io::Cursor::new(output);

  const demangled = try_demangle(input);
  if (demangled.$ === "Err") return 0;

  const bytes = utf8(display_Demangle(demangled._0, true)); // write!(cursor, "{demangled:#}")
  if (bytes.length > output.length) {
    // Possible only if provided buffer is not big enough
    return 0;
  }
  output.set(bytes, 0);

  return bytes.length; // cursor.position() as size_t
}

// rustc: compiler/rustc_codegen_llvm/src/back/write.rs:1155 create_section_with_flags_asm
function create_section_with_flags_asm(section_name: string, section_flags: string, data: Uint8Array): Uint8Array {
  const asm: number[] = Array.from(utf8(`.section ${section_name},"${section_flags}"\n`));
  asm.push(...utf8('.ascii "'));
  // asm.reserve(data.len());
  for (const byte of data) {
    if (byte === 0x5c /* b'\\' */ || byte === 0x22 /* b'"' */) {
      asm.push(0x5c);
      asm.push(byte);
    } else if (byte < 0x20 || byte >= 0x80) {
      // Avoid non UTF-8 inline assembly. Use octal escape sequence, because it is fixed
      // width, while hex escapes will consume following characters.
      asm.push(0x5c);
      asm.push(0x30 + ((byte >> 6) & 0x7));
      asm.push(0x30 + ((byte >> 3) & 0x7));
      asm.push(0x30 + ((byte >> 0) & 0x7));
    } else {
      asm.push(byte);
    }
  }
  asm.push(...utf8('"\n'));
  return Uint8Array.from(asm);
}

/** `-> &'static CStr` (its text) */
// rustc: compiler/rustc_codegen_llvm/src/back/write.rs:1178 bitcode_section_name
export function bitcode_section_name(cgcx: CodegenContext): string {
  if (cgcx_(cgcx).target_is_like_darwin) {
    return "__LLVM,__bitcode";
  } else if (cgcx_(cgcx).target_is_like_aix) {
    return ".ipa";
  } else {
    return ".llvmbc";
  }
}

/// Embed the bitcode of an LLVM module for LTO in the LLVM module itself.
// rustc: compiler/rustc_codegen_llvm/src/back/write.rs:1189 embed_bitcode
function embed_bitcode(cgcx: CodegenContext, llcx: llvm.Context, llmod: llvm.Module, bitcode: Uint8Array): void {
  // We're adding custom sections to the output object file, but we definitely
  // do not want these custom sections to make their way into the final linked
  // executable. The purpose of these custom sections is for tooling
  // surrounding object files to work with the LLVM IR, if necessary. For
  // example rustc's own LTO will look for LLVM IR inside of the object file
  // in these sections by default.
  //
  // To handle this is a bit different depending on the object file format
  // used by the backend, broken down into a few different categories:
  //
  // * Mach-O - this is for macOS. Inspecting the source code for the native
  //   linker here shows that the `.llvmbc` and `.llvmcmd` sections are
  //   automatically skipped by the linker. In that case there's nothing extra
  //   that we need to do here. We do need to make sure that the
  //   `__LLVM,__cmdline` section exists even though it is empty as otherwise
  //   ld64 rejects the object file.
  //
  // * Wasm - the native LLD linker is hard-coded to skip `.llvmbc` and
  //   `.llvmcmd` sections, so there's nothing extra we need to do.
  //
  // * COFF - if we don't do anything the linker will by default copy all
  //   these sections to the output artifact, not what we want! To subvert
  //   this we want to flag the sections we inserted here as
  //   `IMAGE_SCN_LNK_REMOVE`.
  //
  // * ELF - this is very similar to COFF above. One difference is that these
  //   sections are removed from the output linked artifact when
  //   `--gc-sections` is passed, which we pass by default. If that flag isn't
  //   passed though then these sections will show up in the final output.
  //   Additionally the flag that we need to set here is `SHF_EXCLUDE`.
  //
  // * XCOFF - AIX linker ignores content in .ipa and .info if no auxiliary
  //   symbol associated with these sections.
  //
  // Unfortunately, LLVM provides no way to set custom section flags. For ELF
  // and COFF we emit the sections using module level inline assembly for that
  // reason (see issue #90326 for historical background).

  const cx_ = cgcx_(cgcx);
  if (cx_.target_is_like_darwin || cx_.target_is_like_aix || cx_.target_arch === "wasm32" || cx_.target_arch === "wasm64") {
    // We don't need custom section flags, create LLVM globals.
    const llconst = common_mod().bytes_in_context(llcx, bitcode);
    const llglobal = llvm.add_global(llmod, common_mod().val_ty(llconst), "rustc.embedded.module");
    llvm.set_initializer(llglobal, llconst);

    llvm.set_section(llglobal, bitcode_section_name(cgcx));
    llvm.set_linkage(llglobal, "PrivateLinkage");
    llvm.LLVMSetGlobalConstant(llglobal, llvm.TRUE);

    const llconst_ = common_mod().bytes_in_context(llcx, new Uint8Array(0));
    const llglobal_ = llvm.add_global(llmod, common_mod().val_ty(llconst_), "rustc.embedded.cmdline");
    llvm.set_initializer(llglobal_, llconst_);
    let section: string;
    if (cx_.target_is_like_darwin) {
      section = "__LLVM,__cmdline";
    } else if (cx_.target_is_like_aix) {
      section = ".info";
    } else {
      section = ".llvmcmd";
    }
    llvm.set_section(llglobal_, section);
    llvm.set_linkage(llglobal_, "PrivateLinkage");
  } else {
    // We need custom section flags, so emit module-level inline assembly.
    const section_flags = cx_.is_pe_coff ? "n" : "e";
    const asm = create_section_with_flags_asm(".llvmbc", section_flags, bitcode);
    llvm.append_module_inline_asm(llmod, asm, "", "");
    const asm_ = create_section_with_flags_asm(".llvmcmd", section_flags, new Uint8Array(0));
    llvm.append_module_inline_asm(llmod, asm_, "", "");
  }
}

// Create a `__imp_<symbol> = &symbol` global for each externally visible
// static data symbol, including aliases to static data.
// This is required to satisfy `dllimport` references to static data in .rlibs
// when using MSVC linker. We do this only for data, as linker can fix up
// code references on its own.
// See #26591, #27438
// rustc: compiler/rustc_codegen_llvm/src/back/write.rs:1275 create_msvc_imps
function create_msvc_imps(cgcx: CodegenContext, llcx: llvm.Context, llmod: llvm.Module): void {
  if (!cgcx_(cgcx).msvc_imps_needed) {
    return;
  }
  // The x86 ABI seems to require that leading underscores are added to symbol
  // names, so we need an extra underscore on x86. There's also a leading
  // '\x01' here which disables LLVM's symbol mangling (e.g., no extra
  // underscores added in front).
  const prefix: Uint8Array = cgcx_(cgcx).target_arch === "x86" ? utf8("\x01__imp__") : utf8("\x01__imp_");

  const ptr_ty = type__mod().llvm_type_ptr(llcx);
  const symbols: [llvm.Value, llvm.Linkage][] = [
    ...base_mod().iter_globals(llmod),
    ...[...base_mod().iter_global_aliases(llmod)].filter((val) => llvm.LLVMGetTypeKind(llvm.LLVMGlobalGetValueType(val)).to_rust() !== "Function"),
  ]
    .map((val): [llvm.Value, llvm.Linkage] => [val, llvm.get_linkage(val)])
    .filter(([val, linkage]) => (linkage === "ExternalLinkage" || linkage === "WeakAnyLinkage") && !llvm.is_declaration(val));

  for (const [val, linkage] of symbols) {
    const name = llvm.get_value_name(val);
    // Exclude some symbols that we know are not Rust symbols.
    if (ignored(name)) {
      continue;
    }

    const imp_name_ = new Uint8Array(prefix.length + name.length);
    imp_name_.set(prefix, 0);
    imp_name_.set(name, prefix.length);
    // let imp_name = CString::new(imp_name).unwrap();
    const nul = imp_name_.indexOf(0);
    if (nul >= 0) panic(`called \`Result::unwrap()\` on an \`Err\` value: NulError(${nul}, [${Array.from(imp_name_).join(", ")}])`);
    // PORT: `llvm::add_global(llmod, ptr_ty, &imp_name)` takes the name as text here (`&CStr` upstream): the bytes as UTF-8
    // text. A symbol name that is not UTF-8 has no such text, so it stops instead of being re-encoded.
    const imp_name = from_utf8(imp_name_) ?? unported("rustc_codegen_llvm: create_msvc_imps of a symbol name that is not UTF-8 (add_global takes text)");

    const imp = llvm.add_global(llmod, ptr_ty, imp_name);

    llvm.set_initializer(imp, val);
    llvm.set_linkage(imp, linkage);
  }
}

/** The nested `fn ignored(symbol_name: &[u8]) -> bool` of `create_msvc_imps`. */
// Use this function to exclude certain symbols from `__imp` generation.
// rustc: compiler/rustc_codegen_llvm/src/back/write.rs:1318 ignored
function ignored(symbol_name: Uint8Array): boolean {
  // These are symbols generated by LLVM's profiling instrumentation
  const p = utf8("__llvm_profile_");
  if (symbol_name.length < p.length) return false;
  for (let i = 0; i < p.length; i++) if (symbol_name[i] !== p[i]) return false;
  return true;
}

/** `artifact_kind: &'static str`, `path: &Path` */
// rustc: compiler/rustc_codegen_llvm/src/back/write.rs:1324 record_artifact_size
function record_artifact_size(self_profiler_ref: SelfProfilerRef, artifact_kind: string, path: PathBuf): void {
  // Don't stat the file if we are not going to record its size.
  if (!SelfProfilerRef_enabled(self_profiler_ref)) {
    return;
  }

  const artifact_name = path_file_name(path);
  if (artifact_name !== undefined) {
    let file_size: bigint;
    try {
      file_size = BigInt(statSync(path).size);
    } catch {
      file_size = 0n;
    }
    SelfProfilerRef_artifact_size(self_profiler_ref, artifact_kind, artifact_name, file_size);
  }
}

// rustc: compiler/rustc_codegen_llvm/src/back/write.rs:1340 record_llvm_cgu_instructions_stats
function record_llvm_cgu_instructions_stats(prof: SelfProfilerRef, name: string, llmod: llvm.Module): void {
  if (!SelfProfilerRef_enabled(prof)) {
    return;
  }

  const total = llvm.LLVMRustModuleInstructionStats(llmod);
  SelfProfilerRef_artifact_size(prof, "cgu_instructions", name, total);
}

// ---- the cross-lane surface this file reads (not upstream fns) ----
//
// PORT: rustc_codegen_ssa back/write.rs is lane ssa-write's (running in parallel): `CodegenContext`, `ModuleConfig` and
// `SharedEmitter` are ssa-contract's opaque placeholders until it ports the structs. The interfaces below are the upstream
// fields this file reads (back/write.rs:72 `ModuleConfig`, :322 `CodegenContext`, :1948 `InlineAsmError`; `EmitObj` :48,
// `BitcodeSection` :62), under their upstream names and types, and `cgcx_` / `config_` view a placeholder as them (a type-level
// cast; no value changes). The methods and the emitter (`ModuleConfig::{bitcode_needed, embed_bitcode}`, `SharedEmitter` as an
// `Emitter`, `SharedEmitter::inline_asm_error`) and the `OutputFilenames` temp paths (rustc_session config.rs, also ssa-write's)
// are typed stubs naming their lane. Root: drop the views for ssa-write's structs and the stubs for its methods when it lands.

/// What kind of llvm bitcode section to embed in an object file.
type BitcodeSection = "None" | "Full";
/// What kind of object file to emit.
type EmitObj = { readonly $: "None" } | { readonly $: "Bitcode" } | { readonly $: "ObjectCode"; readonly _0: BitcodeSection };
const EmitObj = { None: Object.freeze({ $: "None" as const }), Bitcode: Object.freeze({ $: "Bitcode" as const }) };
/** `#[derive(PartialEq)]` */
function EmitObj_eq(a: EmitObj, b: EmitObj): boolean {
  return a.$ === b.$ && (a.$ !== "ObjectCode" || a._0 === (b as { _0: BitcodeSection })._0);
}

/** The fields of `ModuleConfig` (rustc_codegen_ssa back/write.rs:72) read here. */
interface ModuleConfigFields {
  passes: string[];
  opt_level: OptLevel | undefined;
  pgo_gen: SwitchWithOptPath;
  pgo_use: PathBuf | undefined;
  pgo_sample_use: PathBuf | undefined;
  debug_info_for_profiling: boolean;
  instrument_coverage: boolean;
  sanitizer: SanitizerSet;
  sanitizer_recover: SanitizerSet;
  sanitizer_dataflow_abilist: string[];
  sanitizer_memory_track_origins: number;
  emit_bc: boolean;
  emit_ir: boolean;
  emit_asm: boolean;
  emit_obj: EmitObj;
  emit_thin_lto_summary: boolean;
  verify_llvm_ir: boolean;
  lint_llvm_ir: boolean;
  no_prepopulate_passes: boolean;
  no_builtins: boolean;
  vectorize_loop: boolean;
  vectorize_slp: boolean;
  merge_functions: boolean;
  emit_lifetime_markers: boolean;
  llvm_plugins: string[];
  autodiff: AutoDiff[];
  autodiff_post_passes: string | undefined;
  offload: Offload[];
}

/** The fields of `CodegenContext` (rustc_codegen_ssa back/write.rs:322) read here. */
interface CodegenContextFields {
  lto: Lto;
  use_linker_plugin_lto: boolean;
  save_temps: boolean;
  output_filenames: OutputFilenames;
  module_config: ModuleConfig;
  msvc_imps_needed: boolean;
  is_pe_coff: boolean;
  target_can_use_split_dwarf: boolean;
  target_arch: string;
  target_is_like_darwin: boolean;
  target_is_like_aix: boolean;
  target_is_like_gpu: boolean;
  split_debuginfo: SplitDebuginfo;
  split_dwarf_kind: SplitDwarfKind;
  pointer_size: Size;
  remark: Passes;
  remark_dir: PathBuf | undefined;
}

/** `pub struct InlineAsmError` (rustc_codegen_ssa back/write.rs:1948). */
interface InlineAsmError {
  lo: BytePos;
  hi: BytePos;
  msg: string;
  level: Level;
  source: [string, InnerSpan[]] | undefined;
}

/** A `CodegenContext` placeholder viewed as its upstream fields (header). */
function cgcx_(cgcx: CodegenContext): CodegenContextFields {
  return cgcx as unknown as CodegenContextFields;
}
/** A `ModuleConfig` placeholder viewed as its upstream fields (header). */
function config_(config: ModuleConfig): ModuleConfigFields {
  return config as unknown as ModuleConfigFields;
}

/** `ModuleConfig::bitcode_needed` (rustc_codegen_ssa back/write.rs:269), lane ssa-write. */
export function ModuleConfig_bitcode_needed(_config: ModuleConfig): boolean {
  return unported("ssa-write: compiler/rustc_codegen_ssa/src/back/write.rs ModuleConfig::bitcode_needed");
}
/** `ModuleConfig::embed_bitcode` (rustc_codegen_ssa back/write.rs:276), lane ssa-write. */
export function ModuleConfig_embed_bitcode(_config: ModuleConfig): boolean {
  return unported("ssa-write: compiler/rustc_codegen_ssa/src/back/write.rs ModuleConfig::embed_bitcode");
}
/** `Box::new(shared_emitter.clone())` as the `Box<dyn Emitter>` `DiagCtxt::new` takes (`impl Emitter for SharedEmitter`), lane ssa-write. */
export function SharedEmitter_clone_box(_shared_emitter: SharedEmitter): Emitter {
  return unported("ssa-write: compiler/rustc_codegen_ssa/src/back/write.rs impl Emitter for SharedEmitter");
}
/** `SharedEmitter::inline_asm_error` (rustc_codegen_ssa back/write.rs:1976), lane ssa-write. */
export function SharedEmitter_inline_asm_error(_shared_emitter: SharedEmitter, _err: InlineAsmError): void {
  return unported("ssa-write: compiler/rustc_codegen_ssa/src/back/write.rs SharedEmitter::inline_asm_error");
}
/** `OutputFilenames::temp_path_for_cgu` (rustc_session config.rs:1315), lane ssa-write. */
export function OutputFilenames_temp_path_for_cgu(_self: OutputFilenames, _flavor: OutputType, _codegen_unit_name: string): PathBuf {
  return unported("ssa-write: compiler/rustc_session/src/config.rs OutputFilenames::temp_path_for_cgu");
}
/** `OutputFilenames::temp_path_dwo_for_cgu` (rustc_session config.rs:1321), lane ssa-write. */
export function OutputFilenames_temp_path_dwo_for_cgu(_self: OutputFilenames, _codegen_unit_name: string): PathBuf {
  return unported("ssa-write: compiler/rustc_session/src/config.rs OutputFilenames::temp_path_dwo_for_cgu");
}
/** `OutputFilenames::temp_path_ext_for_cgu` (rustc_session config.rs:1334), lane ssa-write. */
export function OutputFilenames_temp_path_ext_for_cgu(_self: OutputFilenames, _ext: string, _codegen_unit_name: string): PathBuf {
  return unported("ssa-write: compiler/rustc_session/src/config.rs OutputFilenames::temp_path_ext_for_cgu");
}
/** `OutputFilenames::split_dwarf_path` (rustc_session config.rs:1374), lane ssa-write. */
export function OutputFilenames_split_dwarf_path(_self: OutputFilenames, _split_debuginfo_kind: SplitDebuginfo, _split_dwarf_kind: SplitDwarfKind, _cgu_name: string): PathBuf | undefined {
  return unported("ssa-write: compiler/rustc_session/src/config.rs OutputFilenames::split_dwarf_path");
}

// PORT: the hand-written `Diagnostic` impls of diagnostics.rs (`ParseTargetMachineConfig`, `WithLlvmError`; tools/codegen
// generates only the derives) and llvm/diagnostic.rs are lane cg-lto-diag's (plan-m7 §2b "LTO, diagnostics", wave 43).

/** `impl Diagnostic for WithLlvmError<'_>` (diagnostics.rs), lane cg-lto-diag. */
function WithLlvmError_diagnostic(_self: WithLlvmError): never {
  return unported("cg-lto-diag: compiler/rustc_codegen_llvm/src/diagnostics.rs impl Diagnostic for WithLlvmError");
}
/** `impl Diagnostic for ParseTargetMachineConfig<'_>` (diagnostics.rs), lane cg-lto-diag. */
function ParseTargetMachineConfig_diagnostic(_self: ParseTargetMachineConfig): never {
  return unported("cg-lto-diag: compiler/rustc_codegen_llvm/src/diagnostics.rs impl Diagnostic for ParseTargetMachineConfig");
}

/** llvm/diagnostic.rs's `OptimizationDiagnosticKind` (lane cg-lto-diag): the variants this file matches on. */
type OptimizationDiagnosticKind =
  | "OptimizationRemark"
  | "OptimizationMissed"
  | "OptimizationAnalysis"
  | "OptimizationAnalysisFPCommute"
  | "OptimizationAnalysisAliasing"
  | "OptimizationFailure"
  | "OptimizationRemarkOther";
/** llvm/diagnostic.rs's `Diagnostic<'ll>` (lane cg-lto-diag): the variants and fields this file reads. */
type Diagnostic =
  | { readonly $: "Optimization"; readonly _0: { kind: OptimizationDiagnosticKind; pass_name: string; filename: string; line: number; column: number; message: string } }
  | { readonly $: "InlineAsm"; readonly _0: { level: llvm.DiagnosticLevel; cookie: bigint; message: string; source: [string, InnerSpan[]] | undefined } }
  | { readonly $: "PGO"; readonly _0: llvm.DiagnosticInfo }
  | { readonly $: "Linker"; readonly _0: llvm.DiagnosticInfo }
  | { readonly $: "Unsupported"; readonly _0: llvm.DiagnosticInfo }
  | { readonly $: "UnknownDiagnostic"; readonly _0: llvm.DiagnosticInfo };
/** `llvm::diagnostic::Diagnostic::unpack` (llvm/diagnostic.rs), lane cg-lto-diag. */
function Diagnostic_unpack(_di: llvm.DiagnosticInfo): Diagnostic {
  return unported("cg-lto-diag: compiler/rustc_codegen_llvm/src/llvm/diagnostic.rs Diagnostic::unpack");
}
/** `pub(crate) struct Buffer(&'static mut llvm::Buffer)` of back/lto.rs (lane cg-lto-diag; private there). */
type Buffer = { readonly __lto_Buffer: never };
/** `Buffer::data` (back/lto.rs), lane cg-lto-diag. */
function Buffer_data(_self: Buffer): Uint8Array {
  return unported("cg-lto-diag: compiler/rustc_codegen_llvm/src/back/lto.rs Buffer::data");
}

// PORT: `SelfProfilerRef` is rustc_session's stand-in, which never holds a profiler and has an empty event filter mask
// (rustc_session/stand_ins.ts). Upstream's methods this file calls are answered as upstream answers them in that state, and
// the stand-in lacks them (root: they belong on the stand-in): `enabled()` is `profiler.is_some()`; `llvm_recording_enabled()`
// tests the mask; `generic_activity_with_arg` and `artifact_size` go through `exec`, which returns `TimingGuard::none()` /
// does nothing for an event kind outside the mask.

/** profiling.rs `SelfProfilerRef::enabled`: `self.profiler.is_some()`. */
function SelfProfilerRef_enabled(prof: SelfProfilerRef): boolean {
  return prof.profiler !== undefined;
}
/** profiling.rs `SelfProfilerRef::llvm_recording_enabled`: `self.event_filter_mask.contains(EventFilter::LLVM)`; the mask is
 * empty without a profiler. */
function SelfProfilerRef_llvm_recording_enabled(prof: SelfProfilerRef): boolean {
  return SelfProfilerRef_enabled(prof) && unported("rustc_data_structures: compiler/rustc_data_structures/src/profiling.rs SelfProfilerRef::llvm_recording_enabled (-Z self-profile)");
}
/** profiling.rs `SelfProfilerRef::generic_activity_with_arg`: `TimingGuard::none()` outside the mask, as `generic_activity`. */
function SelfProfilerRef_generic_activity_with_arg(prof: SelfProfilerRef, event_label: string, _event_arg: string): VerboseTimingGuard {
  return prof.generic_activity(event_label);
}
/** profiling.rs `SelfProfilerRef::artifact_size`: `drop(self.exec(EventFilter::ARTIFACT_SIZES, ..))`, nothing outside the mask. */
function SelfProfilerRef_artifact_size(prof: SelfProfilerRef, _artifact_kind: string, _artifact_name: string, _size: bigint): void {
  if (SelfProfilerRef_enabled(prof)) unported("rustc_data_structures: compiler/rustc_data_structures/src/profiling.rs SelfProfilerRef::artifact_size (-Z self-profile)");
}

/** `crate::builder::gpu_offload::scalar_width` (excluded, plan-m7 D18; builder/gpu_offload.ts has no stub for it). */
function scalar_width(_cx: SimpleCx, _ty: llvm.Type): number {
  return unported("excluded (plan-m7 D18): compiler/rustc_codegen_llvm/src/builder/gpu_offload.rs scalar_width");
}

/** `rustc_fs_util::link_or_copy` (rustc_fs_util/src/lib.rs:62, not ported there). */
function link_or_copy(_p: PathBuf, _q: PathBuf): IoResult<"Link" | "Copy"> {
  return unported("rustc_fs_util: compiler/rustc_fs_util/src/lib.rs link_or_copy");
}

// ---- crate modules read lazily (init order: builder.ts's extension modules must load after builder.ts, as in context.ts) ----

/** `crate::attributes` (attributes.ts), read lazily. */
function attributes_mod(): typeof import("../attributes.ts") {
  return (attributes__m ??= require("../attributes.ts") as typeof import("../attributes.ts"));
}
var attributes__m: typeof import("../attributes.ts") | undefined;
/** `crate::base` (base.ts), read lazily. */
function base_mod(): typeof import("../base.ts") {
  return (base__m ??= require("../base.ts") as typeof import("../base.ts"));
}
var base__m: typeof import("../base.ts") | undefined;
/** `crate::builder` (builder.ts), read lazily. */
function builder_mod(): typeof import("../builder.ts") {
  return (builder__m ??= require("../builder.ts") as typeof import("../builder.ts"));
}
var builder__m: typeof import("../builder.ts") | undefined;
/** `crate::common` (common.ts), read lazily. */
function common_mod(): typeof import("../common.ts") {
  return (common__m ??= require("../common.ts") as typeof import("../common.ts"));
}
var common__m: typeof import("../common.ts") | undefined;
/** `crate::context` (context.ts), read lazily. */
function context_mod(): typeof import("../context.ts") {
  return (context__m ??= require("../context.ts") as typeof import("../context.ts"));
}
var context__m: typeof import("../context.ts") | undefined;
/** `crate::type_` (type_.ts), read lazily. */
function type__mod(): typeof import("../type_.ts") {
  return (type___m ??= require("../type_.ts") as typeof import("../type_.ts"));
}
var type___m: typeof import("../type_.ts") | undefined;
/** `crate::back::lto` (lto.ts), read lazily. */
function lto_mod(): typeof import("./lto.ts") {
  return (lto__m ??= require("./lto.ts") as typeof import("./lto.ts"));
}
var lto__m: typeof import("./lto.ts") | undefined;

// ---- helpers for std forms (not upstream fns) ----

/** `rustc_fs_util::path_to_c_string` (rustc_fs_util/src/lib.rs:88, Unix: `CString::new(p.as_os_str().as_bytes()).unwrap()`);
 * not ported in src/rustc_fs_util. */
function path_to_c_string(p: PathBuf): string {
  return cstring_new_unwrap(p);
}

/** `CString::new(s).unwrap()`: panics on an interior NUL byte. */
function cstring_new_unwrap(s: string): string {
  const bytes = utf8(s);
  const pos = bytes.indexOf(0);
  if (pos >= 0) panic(`called \`Result::unwrap()\` on an \`Err\` value: NulError(${pos}, [${Array.from(bytes).join(", ")}])`);
  return s;
}

/** `Path::join` (Unix): `b` absolute replaces `a`; otherwise one `/` between them. */
function path_join(a: PathBuf, b: string): PathBuf {
  if (b.startsWith("/")) return b;
  if (a === "" || a.endsWith("/")) return a + b;
  return `${a}/${b}`;
}

/** `Path::file_name`: the last normal component, `undefined` for a path ending in `..` or a root. */
function path_file_name(p: PathBuf): string | undefined {
  const trimmed = p.replace(/\/+$/, "");
  if (trimmed === "") return undefined;
  const name = basename(trimmed);
  if (name === ".." || name === "") return undefined;
  if (name === ".") return path_file_name(trimmed.slice(0, -1));
  return name;
}

/** `fs::write(path, data)` as an `io::Result<()>`. */
function fs_write(path: PathBuf, data: Uint8Array): IoResult<null> {
  try {
    writeFileSync(path, data);
    return Ok(null);
  } catch (e) {
    return Err(io_error_from_node(e) as IoError);
  }
}

/** `str::from_utf8(..)`: the text, or `undefined`. */
function from_utf8(b: Uint8Array): string | undefined {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(b);
  } catch {
    return undefined;
  }
}

/** `str::from_utf8(..).unwrap()` / `String::from_utf8(..).unwrap()`. */
function from_utf8_unwrap(b: Uint8Array): string {
  const s = from_utf8(b);
  if (s === undefined) panic("called `Result::unwrap()` on an `Err` value: Utf8Error");
  return s;
}

/** `Option::unwrap`. */
function unwrap_option<T>(v: T | undefined): T {
  if (v === undefined) panic("called `Option::unwrap()` on a `None` value");
  return v;
}

void display_IoError;
