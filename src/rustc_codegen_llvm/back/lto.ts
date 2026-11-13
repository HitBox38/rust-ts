// Port of compiler/rustc_codegen_llvm/src/back/lto.rs (lane cg-lto-diag, plan-m7 §2b "LTO, diagnostics", D8). Ported whole, in
// upstream order.
//
// LLVM work goes to the IR model (src/rust_ts/llvm/ffi.ts) under its ffi.rs names; what the model lacks stays its stop
// (`llir: <name>`). Plan-m7 D8 decides what happens to each LTO flavour here:
// - **`ThinLocal`** (the default at `-O` with several CGUs) is a no-op: `thin_lto` builds no combined index
//   (`LLVMRustCreateThinLTOData`) and `optimize_and_codegen_thin_module` skips the four index-driven steps
//   (`LLVMRustPrepareThinLTO{Rename,ResolveWeak,Internalize,Import}`); everything else runs as upstream, including the
//   `-Csave-temps` files and the ThinLTO post-link pipeline (`run_pass_manager(thin = true)`). PORT comments at both
//   points say why the result is the same apart from cross-CGU inlining.
// - **`-Clto=thin`** stops at `unported` where the combined index would be built.
// - **Fat LTO** (`-Clto=fat`) is ported as is: bitcode from rlibs (`prepare_lto`), then `LLVMRustLinkerNew/Add/Free` and
//   `LLVMRustRunRestrictionPass`. In the IR model those become `llvm-link` and `opt` over llir-tools' pinned-tool helper
//   (src/rust_ts/llvm/tools.ts); until an IR-model lane implements them they are its stops (docs/handoff/cg-lto-diag.md).
//
// PORT:
// - `CString` / `&CStr` is `string` (its bytes without the NUL); `CString::new(..).unwrap()` keeps its interior-NUL panic.
// - `Buffer` (`#[repr(transparent)]` over `&'static mut llvm::Buffer`) is the model's handle itself, so the FFI's
//   `&mut Option<Buffer>` out-parameters (`LLVMRustOptimize`'s `ThinLTOBuffer`) hold it; its methods are `Buffer_data` /
//   `Buffer_drop`.
// - `debug!` sites are comments (rustc ships with `max_level_info`); `info!` sites go to rust_ts/tracing.ts.
// - `SelfProfilerRef` is rustc_session's stand-in (no profiler, empty event mask): `generic_activity_with_arg` and
//   `generic_activity_with_arg_recorder` are local helpers answering as upstream does in that state (as back/write.ts does).
// - `crate::back::write` is imported statically; `crate::ModuleLlvm` (back/llvm_backend.ts, which imports this file) is read
//   lazily.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import * as tracing from "../../rust_ts/tracing.ts";
import { type SerializedModule, SerializedModule as SerializedModuleC, ThinModule, type ThinShared } from "../../rustc_codegen_ssa/back/lto.ts";
import * as rmeta_link from "../../rustc_codegen_ssa/back/rmeta_link.ts";
import type { CodegenContext, FatLtoInput, SharedEmitter, TargetMachineFactoryFn, ThinLtoInput } from "../../rustc_codegen_ssa/back/write.ts";
import { type CompiledModule, ModuleCodegen, ModuleKind } from "../../rustc_codegen_ssa/lib.ts";
import type { ModuleBufferMethods, WorkProduct } from "../../rustc_codegen_ssa/traits/write.ts";
import { File as FsFile, Mmap } from "../../rustc_data_structures/memmap.ts";
import type { PathBuf } from "../../rustc_error_messages/lib.ts";
import { DiagCtxt, type DiagCtxtHandle } from "../../rustc_errors/lib.ts";
import type { AutoDiff, OptLevel } from "../../rustc_session/config.ts";
import type { SelfProfilerRef, VerboseTimingGuard } from "../../rustc_session/stand_ins.ts";
import { SanitizerSet } from "../../rustc_target/spec/mod.ts";
import { debug_map, debug_option, debug_str, debug_struct, type Fmt, format_debug, PRETTY } from "../../std/fmt.ts";
import { debug_IoError, INVALID_UTF8, io_error_from_node, type IoResult } from "../../std/io.ts";
import { assert, panic, unported, unwrap } from "../../std/panic.ts";
import { Err, Ok, type Result, expect_result } from "../../std/result.ts";
import { from_utf8, string_trim, utf8 } from "../../std/str.ts";
import { File as ObjectFile } from "../../vendor/object/read/any.ts";
import { ArchiveFile, type ArchiveMember } from "../../vendor/object/read/archive.ts";
import { debug_Error as debug_ObjectError, display_Error as display_ObjectError } from "../../vendor/object/read/mod.ts";
import { LlvmError, type LtoBitcodeFromRlib, LtoBitcodeFromRlib_diagnostic } from "../diagnostics.ts";
import * as llvm from "../llvm/mod.ts";
import { build_string } from "../llvm/mod.ts";
import type { LlvmWriteTypes, ModuleLlvm } from "./llvm_backend.ts";
import * as write from "./write.ts";
import { bitcode_section_name, codegen, DiagnosticHandlers, save_temp_bitcode } from "./write.ts";

const TARGET = "rustc_codegen_llvm::back::lto";

/// We keep track of the computed LTO cache keys from the previous
/// session to determine which CGUs we can reuse.
const THIN_LTO_KEYS_INCR_COMP_FILE_NAME = "thin-lto-past-keys.bin";

// rustc: compiler/rustc_codegen_llvm/src/back/lto.rs:39 prepare_lto
function prepare_lto(
  cgcx: CodegenContext,
  exported_symbols_for_lto: readonly string[],
  each_linked_rlib_for_lto: readonly PathBuf[],
  dcx: DiagCtxtHandle,
): [string[], [SerializedModule<ModuleBuffer>, string][]] {
  const symbols_below_threshold = exported_symbols_for_lto.map((symbol) => cstring_new_unwrap(symbol));

  if (cgcx.module_config.instrument_coverage || cgcx.module_config.pgo_gen.$ === "Enabled") {
    // These are weak symbols that point to the profile version and the
    // profile name, which need to be treated as exported so LTO doesn't nix
    // them.
    const PROFILER_WEAK_SYMBOLS: readonly [string, string] = ["__llvm_profile_raw_version", "__llvm_profile_filename"];

    symbols_below_threshold.push(...PROFILER_WEAK_SYMBOLS);
  }

  if (SanitizerSet.contains(cgcx.module_config.sanitizer, SanitizerSet.MEMORY)) {
    const msan_weak_symbols: string[] = [];

    // Similar to profiling, preserve weak msan symbol during LTO.
    if (SanitizerSet.contains(cgcx.module_config.sanitizer_recover, SanitizerSet.MEMORY)) {
      msan_weak_symbols.push("__msan_keep_going");
    }

    if (cgcx.module_config.sanitizer_memory_track_origins !== 0) {
      msan_weak_symbols.push("__msan_track_origins");
    }

    symbols_below_threshold.push(...msan_weak_symbols);
  }

  // Preserve LLVM-injected, ASAN-related symbols.
  // See also https://github.com/rust-lang/rust/issues/113404.
  symbols_below_threshold.push("___asan_globals_registered");

  // __llvm_profile_counter_bias is pulled in at link time by an undefined reference to
  // __llvm_profile_runtime, therefore we won't know until link time if this symbol
  // should have default visibility.
  symbols_below_threshold.push("__llvm_profile_counter_bias");

  // LTO seems to discard this otherwise under certain circumstances.
  symbols_below_threshold.push("rust_eh_personality");

  // If we're performing LTO for the entire crate graph, then for each of our
  // upstream dependencies, find the corresponding rlib and load the bitcode
  // from the archive.
  //
  // We save off all the bytecode and LLVM module ids for later processing
  // with either fat or thin LTO
  const upstream_modules: [SerializedModule<ModuleBuffer>, string][] = [];
  for (const path of each_linked_rlib_for_lto) {
    // unsafe {
    const archive_data = expect_result(Mmap.map(expect_result(FsFile.open(path), "couldn't open rlib", debug_IoError)), "couldn't map rlib", debug_IoError).deref();
    // }
    const archive = expect_result(ArchiveFile.parse(archive_data), "wanted an rlib", debug_ObjectError);
    const metadata_link = unwrap(rmeta_link.read(archive, archive_data, path));
    const obj_files: [string, ArchiveMember][] = [];
    for (const child of archive.members()) {
      // .filter_map(|child| child.ok().and_then(|c| str::from_utf8(c.name()).ok().map(|name| (name.trim(), c))))
      if (child.$ === "Err") continue;
      const c = child._0;
      const name = from_utf8(c.name());
      if (name.$ === "Err") continue;
      const entry: [string, ArchiveMember] = [string_trim(name._0), c];
      // .filter(|&(name, _)| metadata_link.rust_object_files.iter().any(|f| f == name))
      if (metadata_link.rust_object_files.some((f) => f === entry[0])) obj_files.push(entry);
    }
    for (const [name, child] of obj_files) {
      tracing.info(TARGET, () => `adding bitcode from ${name}`);
      const r = get_bitcode_slice_from_object_data(expect_result(child.data(archive_data), "corrupt rlib", debug_ObjectError), cgcx);
      switch (r.$) {
        case "Ok": {
          const data = r._0;
          const module: SerializedModule<ModuleBuffer> = { $: "FromRlib", _0: data.slice() };
          upstream_modules.push([module, cstring_new_unwrap(name)]);
          break;
        }
        case "Err":
          dcx.emit_fatal(LtoBitcodeFromRlib_diagnostic(r._0));
      }
    }
  }

  return [symbols_below_threshold, upstream_modules];
}

// rustc: compiler/rustc_codegen_llvm/src/back/lto.rs:127 get_bitcode_slice_from_object_data
function get_bitcode_slice_from_object_data(obj: Uint8Array, cgcx: CodegenContext): Result<Uint8Array, LtoBitcodeFromRlib> {
  // We're about to assume the data here is an object file with sections, but if it's raw LLVM IR
  // that won't work. Fortunately, if that's what we have we can just return the object directly,
  // so we sniff the relevant magic strings here and return.
  if (starts_with(obj, [0xde, 0xc0, 0x17, 0x0b]) || starts_with(obj, [0x42, 0x43, 0xc0, 0xde])) {
    return Ok(obj);
  }
  // We drop the "__LLVM," prefix here because on Apple platforms there's a notion of "segment
  // name" which in the public API for sections gets treated as part of the section name, but
  // internally in MachOObjectFile.cpp gets treated separately.
  // PORT: `bitcode_section_name` hands a JS string, so `CStr::to_str().unwrap()` cannot fail.
  let section_name = bitcode_section_name(cgcx);
  // `str::trim_start_matches` strips the prefix repeatedly.
  while (section_name.startsWith("__LLVM,")) section_name = section_name.slice("__LLVM,".length);

  const obj_ = ObjectFile.parse(obj);
  if (obj_.$ === "Err") return Err({ err: display_ObjectError(obj_._0) });

  // PORT: `Object::section_by_name` is the provided `self.section_by_name_bytes(section_name.as_bytes())` (object
  // read/traits.rs), which the vendor port does not carry.
  const section = obj_._0.section_by_name_bytes(utf8(section_name));
  if (section === undefined) return Err({ err: `Can't find section ${section_name}` });

  const data = section.data();
  return data.$ === "Ok" ? data : Err({ err: display_ObjectError(data._0) });
}

/// Performs fat LTO by merging all modules into a single one and returning it
/// for further optimization.
// rustc: compiler/rustc_codegen_llvm/src/back/lto.rs:154 run_fat
export function run_fat(
  cgcx: CodegenContext,
  prof: SelfProfilerRef,
  shared_emitter: SharedEmitter,
  tm_factory: TargetMachineFactoryFn<LlvmWriteTypes>,
  exported_symbols_for_lto: readonly string[],
  each_linked_rlib_for_lto: readonly PathBuf[],
  modules: FatLtoInput<LlvmWriteTypes>[],
): ModuleCodegen<ModuleLlvm> {
  const dcx_ = DiagCtxt.new(shared_emitter.clone());
  const dcx = dcx_.handle();
  const [symbols_below_threshold_, upstream_modules] = prepare_lto(cgcx, exported_symbols_for_lto, each_linked_rlib_for_lto, dcx);
  // `.iter().map(|c| c.as_ptr()).collect()`
  const symbols_below_threshold = symbols_below_threshold_.slice();
  return fat_lto(cgcx, prof, dcx, shared_emitter, tm_factory, modules, upstream_modules, symbols_below_threshold);
}

/// Performs thin LTO by performing necessary global analysis and returning two
/// lists, one of the modules that need optimization and another for modules that
/// can simply be copied over from the incr. comp. cache.
// rustc: compiler/rustc_codegen_llvm/src/back/lto.rs:184 run_thin
export function run_thin(
  cgcx: CodegenContext,
  prof: SelfProfilerRef,
  dcx: DiagCtxtHandle,
  exported_symbols_for_lto: readonly string[],
  each_linked_rlib_for_lto: readonly PathBuf[],
  modules: ThinLtoInput<LlvmWriteTypes>[],
): [ThinModule<LlvmWriteTypes>[], WorkProduct[]] {
  const [symbols_below_threshold_, upstream_modules] = prepare_lto(cgcx, exported_symbols_for_lto, each_linked_rlib_for_lto, dcx);
  const symbols_below_threshold = symbols_below_threshold_.slice();
  if (cgcx.use_linker_plugin_lto) {
    panic("internal error: entered unreachable code: We should never reach this case if the LTO step is deferred to the linker");
  }
  return thin_lto(cgcx, prof, dcx, modules, upstream_modules, symbols_below_threshold);
}

// rustc: compiler/rustc_codegen_llvm/src/back/lto.rs:205 fat_lto
function fat_lto(
  cgcx: CodegenContext,
  prof: SelfProfilerRef,
  dcx: DiagCtxtHandle,
  shared_emitter: SharedEmitter,
  tm_factory: TargetMachineFactoryFn<LlvmWriteTypes>,
  modules: FatLtoInput<LlvmWriteTypes>[],
  serialized_modules: [SerializedModule<ModuleBuffer>, string][],
  symbols_below_threshold: readonly string[],
): ModuleCodegen<ModuleLlvm> {
  const _timer = prof.generic_activity("LLVM_fat_lto_build_monolithic_module");
  tracing.info(TARGET, () => "going for a fat lto");

  // Sort out all our lists of incoming modules into two lists.
  //
  // * `serialized_modules` (also and argument to this function) contains all
  //   modules that are serialized in-memory.
  // * `in_memory` contains modules which are already parsed and in-memory,
  //   such as from multi-CGU builds.
  const in_memory: ModuleCodegen<ModuleLlvm>[] = [];
  for (const module of modules) {
    switch (module.$) {
      case "InMemory":
        in_memory.push(module._0);
        break;
      case "Serialized": {
        const { name, bitcode_path } = module;
        tracing.info(TARGET, () => `pushing serialized module ${debug_str(name)}`);
        serialized_modules.push([SerializedModuleC.from_file<ModuleBuffer>(bitcode_path), cstring_new_unwrap(name)]);
        break;
      }
    }
  }

  // Find the "costliest" module and merge everything into that codegen unit.
  // All the other modules will be serialized and reparsed into the new
  // context, so this hopefully avoids serializing and parsing the largest
  // codegen unit.
  //
  // Additionally use a regular module as the base here to ensure that various
  // file copy operations in the backend work correctly. The only other kind
  // of module here should be an allocator one, and if your crate is smaller
  // than the allocator module then the size doesn't really matter anyway.
  // `Iterator::max` over `(cost, i)`: the last of equal maxima, so ties go to the later index.
  let costliest_module: [bigint, number] | undefined = undefined;
  in_memory.forEach((module, i) => {
    if (module.kind !== ModuleKind.Regular) return;
    const cost = llvm.LLVMRustModuleCost(module.module_llvm.llmod());
    if (costliest_module === undefined || cost > costliest_module[0] || (cost === costliest_module[0] && i >= costliest_module[1])) {
      costliest_module = [cost, i];
    }
  });

  // If we found a costliest module, we're good to go. Otherwise all our
  // inputs were serialized which could happen in the case, for example, that
  // all our inputs were incrementally reread from the cache and we're just
  // re-executing the LTO passes. If that's the case deserialize the first
  // module and create a linker with it.
  let module: ModuleCodegen<ModuleLlvm>;
  const costliest = costliest_module as [bigint, number] | undefined;
  if (costliest !== undefined) {
    const [_cost, i] = costliest;
    module = in_memory.splice(i, 1)[0]!;
  } else {
    assert(serialized_modules.length !== 0, "must have at least one serialized module");
    const [buffer, name] = serialized_modules.splice(0, 1)[0]!;
    tracing.info(TARGET, () => `no in-memory regular modules to choose from, parsing ${debug_CStr(name)}`);
    const llvm_module = llvm_backend().ModuleLlvm.parse(cgcx, tm_factory, name, SerializedModuleC.data(buffer), dcx);
    module = ModuleCodegen.new_regular(name, llvm_module);
  }
  {
    const llvm_ = module.module_llvm;
    const [llcx, llmod] = [llvm_.llcx, llvm_.llmod()];
    tracing.info(TARGET, () => `using ${debug_str(module.name)} as a base module`);

    // The linking steps below may produce errors and diagnostics within LLVM
    // which we'd like to handle and print, so set up our diagnostic handlers
    // (which get unregistered when they go out of scope below).
    const _handler = DiagnosticHandlers.new(cgcx, shared_emitter, llcx, module, "LTO");

    // For all other modules we codegened we'll need to link them into our own
    // bitcode. All modules were codegened in their own LLVM context, however,
    // and we want to move everything to the same LLVM context. Currently the
    // way we know of to do that is to serialize them to a string and them parse
    // them later. Not great but hey, that's why it's "fat" LTO, right?
    for (const module_ of in_memory) {
      const buffer = ModuleBuffer.new(module_.module_llvm.llmod(), false);
      const llmod_id = cstring_new_unwrap(module_.name);
      serialized_modules.push([{ $: "Local", _0: buffer }, llmod_id]);
    }
    // Sort the modules to ensure we produce deterministic results.
    serialized_modules.sort((module1, module2) => cmp_cstr(module1[1], module2[1]));

    // For all serialized bitcode files we parse them and link them in as we did
    // above, this is all mostly handled in C++.
    const linker = llvm.LLVMRustLinkerNew(llmod);
    for (const [bc_decoded, name] of serialized_modules) {
      const _timer = generic_activity_with_arg_recorder(prof, "LLVM_fat_lto_link_module", () => debug_CStr(name));
      tracing.info(TARGET, () => `linking ${debug_CStr(name)}`);
      const data = SerializedModuleC.data(bc_decoded);

      // unsafe {
      if (!llvm.LLVMRustLinkerAdd(linker, data, data.length)) {
        llvm.LLVMRustLinkerFree(linker);
        write.llvm_err(dcx, { $: "LoadBitcode", name: utf8(name) });
      }
      // }
      // `bc_decoded` drops here: a `Local` module frees its buffer (`Drop for Buffer`).
      if (bc_decoded.$ === "Local") Buffer_drop(bc_decoded._0.data_);
    }
    llvm.LLVMRustLinkerFree(linker);
    save_temp_bitcode(cgcx, module, "lto.input");

    // Internalize everything below threshold to help strip out more modules and such.
    // unsafe {
    llvm.LLVMRustRunRestrictionPass(llmod, symbols_below_threshold, symbols_below_threshold.length);
    // }
    save_temp_bitcode(cgcx, module, "lto.after-restriction");
    // `_handler` drops at the end of the scope (normal path only, as back/write.ts's `DiagnosticHandlers`).
    _handler.drop();
  }

  return module;
}

/// Prepare "thin" LTO to get run on these modules.
///
/// The general structure of ThinLTO is quite different from the structure of
/// "fat" LTO above. With "fat" LTO all LLVM modules in question are merged into
/// one giant LLVM module, and then we run more optimization passes over this
/// big module after internalizing most symbols. Thin LTO, on the other hand,
/// avoid this large bottleneck through more targeted optimization.
///
/// At a high level Thin LTO looks like:
///
///    1. Prepare a "summary" of each LLVM module in question which describes
///       the values inside, cost of the values, etc.
///    2. Merge the summaries of all modules in question into one "index"
///    3. Perform some global analysis on this index
///    4. For each module, use the index and analysis calculated previously to
///       perform local transformations on the module, for example inlining
///       small functions from other modules.
///    5. Run thin-specific optimization passes over each module, and then code
///       generate everything at the end.
///
/// The summary for each module is intended to be quite cheap, and the global
/// index is relatively quite cheap to create as well. As a result, the goal of
/// ThinLTO is to reduce the bottleneck on LTO and enable LTO to be used in more
/// situations. For example one cheap optimization is that we can parallelize
/// all codegen modules, easily making use of all the cores on a machine.
///
/// With all that in mind, the function here is designed at specifically just
/// calculating the *index* for ThinLTO. This index will then be shared amongst
/// all of the `LtoModuleCodegen` units returned below and destroyed once
/// they all go out of scope.
// rustc: compiler/rustc_codegen_llvm/src/back/lto.rs:368 thin_lto
function thin_lto(
  cgcx: CodegenContext,
  prof: SelfProfilerRef,
  dcx: DiagCtxtHandle,
  modules: ThinLtoInput<LlvmWriteTypes>[],
  serialized_modules: [SerializedModule<ModuleBuffer>, string][],
  symbols_below_threshold: readonly string[],
): [ThinModule<LlvmWriteTypes>[], WorkProduct[]] {
  const _timer = prof.generic_activity("LLVM_thin_lto_global_analysis");
  // unsafe {
  tracing.info(TARGET, () => "going for that thin, thin LTO");

  const green_modules = new Map<string, WorkProduct>();
  for (const module of modules) {
    if (module.$ === "Green") {
      // PORT: `WorkProduct` is never constructed (-C incremental, plan-m7 D11), so no `Green` input exists.
      unported("rustc_codegen_llvm::back::lto::thin_lto (ThinLtoInput::Green: rustc_middle WorkProduct; -C incremental, plan-m7 D11)");
    }
  }

  const full_scope_len = modules.length;
  const thin_buffers: SerializedModule<ModuleBuffer>[] = [];
  const module_names: string[] = [];
  const thin_modules: llvm.ThinLTOModule[] = [];
  void full_scope_len;

  modules.forEach((module, i) => {
    let name: string;
    let buffer: SerializedModule<ModuleBuffer>;
    switch (module.$) {
      case "Red":
        [name, buffer] = [module.name, module.buffer];
        break;
      case "Green":
        // `(wp.cgu_name, SerializedModule::from_file(&bitcode_path))`: unreachable, see above.
        return unported("rustc_codegen_llvm::back::lto::thin_lto (ThinLtoInput::Green: rustc_middle WorkProduct; -C incremental, plan-m7 D11)");
    }
    tracing.info(TARGET, () => `local module: ${i} - ${name}`);
    const cname = cstring_new_unwrap(name);
    thin_modules.push({
      identifier: cname,
      data: SerializedModuleC.data(buffer),
      len: SerializedModuleC.data(buffer).length,
    });
    thin_buffers.push(buffer);
    module_names.push(cname);
  });

  // FIXME: All upstream crates are deserialized internally in the
  //        function below to extract their summary and modules. Note that
  //        unlike the loop above we *must* decode and/or read something
  //        here as these are all just serialized files on disk. An
  //        improvement, however, to make here would be to store the
  //        module summary separately from the actual module itself. Right
  //        now this is store in one large bitcode file, and the entire
  //        file is deflate-compressed. We could try to bypass some of the
  //        decompression by storing the index uncompressed and only
  //        lazily decompressing the bytecode if necessary.
  //
  //        Note that truly taking advantage of this optimization will
  //        likely be further down the road. We'd have to implement
  //        incremental ThinLTO first where we could actually avoid
  //        looking at upstream modules entirely sometimes (the contents,
  //        we must always unconditionally look at the index).

  for (const [module, name] of serialized_modules) {
    tracing.info(TARGET, () => `upstream module ${debug_CStr(name)}`);
    thin_modules.push({
      identifier: name,
      data: SerializedModuleC.data(module),
      len: SerializedModuleC.data(module).length,
    });
    thin_buffers.push(module);
    module_names.push(name);
  }

  // Sanity check
  if (thin_modules.length !== module_names.length) {
    panic(`assertion \`left == right\` failed\n  left: ${thin_modules.length}\n right: ${module_names.length}`);
  }

  // Delegate to the C++ bindings to create some data here. Once this is a
  // tried-and-true interface we may wish to try to upstream some of this
  // to LLVM itself, right now we reimplement a lot of what they do
  // upstream...
  let data: ThinData;
  if (cgcx.lto === "ThinLocal") {
    // PORT (plan-m7 D8, the ThinLocal no-op): no pinned tool builds ThinLTO's combined index (`llvm-lto` is not shipped),
    // so `LLVMRustCreateThinLTOData` is not called and `ThinData` holds no index. With `Lto::ThinLocal` the index covers
    // only this crate's CGUs (`each_linked_rlib_for_lto` is empty), and it feeds exactly the four per-module steps that
    // `optimize_and_codegen_thin_module` skips for the same reason (see there). Every module still gets its ThinLTO
    // post-link pipeline. `symbols_below_threshold` only matters to the index (preserved GUIDs).
    void symbols_below_threshold;
    data = new ThinData(undefined);
  } else {
    // `-Clto=thin` (plan-m7 D8): the same index over the whole crate graph, with cross-crate importing.
    // Upstream: `ThinData(llvm::LLVMRustCreateThinLTOData(thin_modules.as_ptr(), thin_modules.len(),
    // symbols_below_threshold.as_ptr(), symbols_below_threshold.len()).unwrap_or_else(|| write::llvm_err(dcx,
    // LlvmError::PrepareThinLtoContext)))`.
    void LlvmError.PrepareThinLtoContext;
    return unported("rustc_codegen_llvm::back::lto::thin_lto (-Clto=thin: LLVMRustCreateThinLTOData, no pinned tool builds a ThinLTO combined index; plan-m7 D8)");
  }

  tracing.info(TARGET, () => "thin LTO data created");

  const new_key_map_path = cgcx.new_incr_comp_session_dir !== undefined ? path_join(cgcx.new_incr_comp_session_dir, THIN_LTO_KEYS_INCR_COMP_FILE_NAME) : undefined;

  let prev_key_map: ThinLTOKeysMap | undefined;
  if (cgcx.old_incr_comp_session_dir !== undefined) {
    const old_incr_comp_session_dir = cgcx.old_incr_comp_session_dir;
    const old_path = path_join(old_incr_comp_session_dir, THIN_LTO_KEYS_INCR_COMP_FILE_NAME);

    // If the previous file was deleted, or we get an IO error
    // reading the file, then we'll just use `None` as the
    // prev_key_map, which will force the code to be recompiled.
    if (existsSync(old_path)) {
      const r = ThinLTOKeysMap.load_from_file(old_path);
      prev_key_map = r.$ === "Ok" ? r._0 : undefined;
    } else {
      prev_key_map = undefined;
    }
  } else {
    assert(green_modules.size === 0, "assertion failed: green_modules.is_empty()");
    prev_key_map = undefined;
  }
  let curr_key_map: ThinLTOKeysMap;
  if (cgcx.new_incr_comp_session_dir !== undefined) {
    curr_key_map = ThinLTOKeysMap.from_thin_lto_modules(data, thin_modules, module_names);
  } else {
    assert(green_modules.size === 0, "assertion failed: green_modules.is_empty()");
    curr_key_map = ThinLTOKeysMap.default_();
  }
  tracing.info(TARGET, () => "thin LTO cache key map loaded");
  tracing.info(TARGET, () => `prev_key_map: ${format_debug(prev_key_map, (v, f) => debug_option(v, f, debug_ThinLTOKeysMap), PRETTY)}`);
  tracing.info(TARGET, () => `curr_key_map: ${format_debug(curr_key_map, debug_ThinLTOKeysMap, PRETTY)}`);

  // Throw our data in an `Arc` as we'll be sharing it across threads. We
  // also put all memory referenced by the C++ data (buffers, ids, etc)
  // into the arc as well. After this we'll create a thin module
  // codegen per module in this data.
  const shared: ThinShared<LlvmWriteTypes> = { data, modules: thin_buffers, module_names };

  const copy_jobs: WorkProduct[] = [];
  const opt_jobs: ThinModule<LlvmWriteTypes>[] = [];

  tracing.info(TARGET, () => "checking which modules can be-reused and which have to be re-optimized.");
  for (const [module_index, module_name_] of shared.module_names.entries()) {
    const module_name = module_name_to_str(module_name_);
    if (prev_key_map !== undefined && green_modules.has(module_name)) {
      assert(cgcx.old_incr_comp_session_dir !== undefined, "assertion failed: cgcx.old_incr_comp_session_dir.is_some()");
      assert(cgcx.new_incr_comp_session_dir !== undefined, "assertion failed: cgcx.new_incr_comp_session_dir.is_some()");

      // If a module exists in both the current and the previous session,
      // and has the same LTO cache key in both sessions, then we can re-use it
      if (prev_key_map.keys.get(module_name) === curr_key_map.keys.get(module_name)) {
        const work_product = green_modules.get(module_name)!;
        copy_jobs.push(work_product);
        tracing.info(TARGET, () => ` - ${module_name}: re-used`);
        continue;
      }
    }

    tracing.info(TARGET, () => ` - ${module_name}: re-compiled`);
    opt_jobs.push(new ThinModule(shared, module_index));
  }

  // Save the current ThinLTO import information for the next compilation
  // session.
  if (new_key_map_path !== undefined) {
    const err = curr_key_map.save_to_file(new_key_map_path);
    if (err.$ === "Err") {
      write.llvm_err(dcx, { $: "WriteThinLtoKey", err: err._0 });
    }
  }

  return [opt_jobs, copy_jobs];
  // }
}

/** The subset of `llvm::EnzymeWrapper` (llvm/enzyme_ffi.rs, excluded by plan-m7 D18) that `enable_autodiff_settings` calls. */
interface EnzymeWrapper {
  set_print_perf(b: boolean): void;
  set_print_activity(b: boolean): void;
  set_print_type(b: boolean): void;
  set_print_type_fun(fun: string): void;
  set_inline(b: boolean): void;
  set_loose_types(b: boolean): void;
  set_print(b: boolean): void;
  set_strict_aliasing(b: boolean): void;
  set_rust_rules(b: boolean): void;
}

// rustc: compiler/rustc_codegen_llvm/src/back/lto.rs:533 enable_autodiff_settings
export function enable_autodiff_settings(ad: readonly AutoDiff[]): void {
  const enzyme: EnzymeWrapper = unported("excluded (plan-m7 D18): compiler/rustc_codegen_llvm/src/llvm/enzyme_ffi.rs EnzymeWrapper::get_instance");

  for (const val of ad) {
    // We intentionally don't use a wildcard, to not forget handling anything new.
    switch (val.$) {
      case "PrintPerf": {
        enzyme.set_print_perf(true);
        break;
      }
      case "PrintAA": {
        enzyme.set_print_activity(true);
        break;
      }
      case "PrintTA": {
        enzyme.set_print_type(true);
        break;
      }
      case "PrintTAFn": {
        const fun = val._0;
        enzyme.set_print_type(true); // Enable general type printing
        enzyme.set_print_type_fun(fun); // Set specific function to analyze
        break;
      }
      case "Inline": {
        enzyme.set_inline(true);
        break;
      }
      case "LooseTypes": {
        enzyme.set_loose_types(true);
        break;
      }
      case "PrintSteps": {
        enzyme.set_print(true);
        break;
      }
      // We handle this in the PassWrapper.cpp
      case "PrintPasses":
        break;
      // We handle this in the PassWrapper.cpp
      case "PrintModBefore":
        break;
      // We handle this in the PassWrapper.cpp
      case "PrintModAfter":
        break;
      // We handle this in the PassWrapper.cpp
      case "PrintModFinal":
        break;
      // This is required and already checked
      case "Enable":
        break;
      // We handle this below
      case "NoPostopt":
        break;
      // Disables TypeTree generation
      case "NoTT":
        break;
    }
  }
  // This helps with handling enums for now.
  enzyme.set_strict_aliasing(false);
  // FIXME(ZuseZ4): Test this, since it was added a long time ago.
  enzyme.set_rust_rules(true);
}

// rustc: compiler/rustc_codegen_llvm/src/back/lto.rs:583 run_pass_manager
export function run_pass_manager(cgcx: CodegenContext, prof: SelfProfilerRef, dcx: DiagCtxtHandle, module: ModuleCodegen<ModuleLlvm>, thin: boolean): void {
  const _timer = generic_activity_with_arg(prof, "LLVM_lto_optimize", module.name);
  const config = cgcx.module_config;

  // Now we have one massive module inside of llmod. Time to run the
  // LTO-specific optimization passes that LLVM provides.
  //
  // This code is based off the code found in llvm's LTO code generator:
  //      llvm/lib/LTO/LTOCodeGenerator.cpp
  // debug!("running the pass manager");
  const opt_stage: llvm.OptStage = thin ? "ThinLTO" : "FatLTO";
  const opt_level: OptLevel = config.opt_level ?? "No";

  // The PostAD behavior is the same that we would have if no autodiff was used.
  // It will run the default optimization pipeline. If AD is enabled we select
  // the DuringAD stage, which will disable vectorization and loop unrolling, and
  // schedule two autodiff optimization + differentiation passes.
  // We then run the llvm_optimize function a second time, to optimize the code which we generated
  // in the enzyme differentiation pass.
  const enable_ad = config.autodiff.some((a) => a.$ === "Enable");
  let stage: write.AutodiffStage;
  if (thin) {
    stage = "PreAD";
  } else {
    stage = enable_ad ? "DuringAD" : "PostAD";
  }

  // unsafe {
  write.llvm_optimize(cgcx, prof, dcx, module, undefined, undefined, config, opt_level, opt_stage, stage);
  // }

  if (enable_ad && !thin) {
    const opt_stage: llvm.OptStage = "FatLTO";
    const stage: write.AutodiffStage = "PostAD";
    if (!config.autodiff.some((a) => a.$ === "NoPostopt") && config.autodiff_post_passes !== "") {
      // unsafe {
      write.llvm_optimize(cgcx, prof, dcx, module, undefined, undefined, config, opt_level, opt_stage, stage);
      // }
    }

    // This is the final IR, so people should be able to inspect the optimized autodiff output,
    // for manual inspection.
    if (config.autodiff.some((a) => a.$ === "PrintModFinal")) {
      // unsafe { llvm::LLVMDumpModule(module.module_llvm.llmod()) };
      unported("excluded (plan-m7 D18): compiler/rustc_codegen_llvm/src/llvm/enzyme_ffi.rs LLVMDumpModule");
    }
  }

  // debug!("lto done");
}

/** `pub(crate) struct Buffer(&'static mut llvm::Buffer);` (`#[repr(transparent)]`): the model's handle (header PORT). */
export type Buffer = llvm.Buffer;

// unsafe impl Send for Buffer {}
// unsafe impl Sync for Buffer {}

// impl Buffer
// rustc: compiler/rustc_codegen_llvm/src/back/lto.rs:651 data
export function Buffer_data(self: Buffer): Uint8Array {
  // unsafe {
  const ptr = llvm.LLVMRustBufferPtr(self);
  const len = llvm.LLVMRustBufferLen(self);
  // `slice::from_raw_parts(ptr, len)`: a null `ptr` is undefined behaviour there.
  return unwrap(ptr).subarray(0, len);
  // }
}

// impl Drop for Buffer
// rustc: compiler/rustc_codegen_llvm/src/back/lto.rs:661 drop
export function Buffer_drop(self: Buffer): void {
  // unsafe {
  llvm.LLVMRustBufferFree(self);
  // }
}

/** `pub struct ThinData(&'static mut llvm::ThinLTOData);` PORT: `_0` is `undefined` under the ThinLocal no-op (`thin_lto`). */
export class ThinData {
  constructor(public _0: llvm.ThinLTOData | undefined) {}

  // unsafe impl Send for ThinData {}
  // unsafe impl Sync for ThinData {}

  // impl Drop for ThinData
  // rustc: compiler/rustc_codegen_llvm/src/back/lto.rs:674 drop
  drop(): void {
    // PORT: the ThinLocal no-op built no index, so there is nothing to free.
    if (this._0 === undefined) return;
    // unsafe {
    llvm.LLVMRustFreeThinLTOData(this._0);
    // }
  }
}

export class ModuleBuffer implements ModuleBufferMethods {
  constructor(
    /** private */
    public data_: Buffer,
  ) {}

  // PORT (cg-contract): the field `data` is `data_`: `ModuleBufferMethods::data()` is a method of the same name.

  // impl ModuleBuffer
  // rustc: compiler/rustc_codegen_llvm/src/back/lto.rs:686 new
  static new(m: llvm.Module, is_thin: boolean): ModuleBuffer {
    // unsafe {
    const buffer = llvm.LLVMRustModuleSerialize(m, is_thin);
    return new ModuleBuffer(/* data */ buffer);
    // }
  }

  // impl ModuleBufferMethods for ModuleBuffer
  // rustc: compiler/rustc_codegen_llvm/src/back/lto.rs:695 data
  data(): Uint8Array {
    return Buffer_data(this.data_);
  }
}

// rustc: compiler/rustc_codegen_llvm/src/back/lto.rs:700 optimize_and_codegen_thin_module
export function optimize_and_codegen_thin_module(
  cgcx: CodegenContext,
  prof: SelfProfilerRef,
  shared_emitter: SharedEmitter,
  tm_factory: TargetMachineFactoryFn<LlvmWriteTypes>,
  thin_module: ThinModule<LlvmWriteTypes>,
): CompiledModule {
  const dcx_ = DiagCtxt.new(shared_emitter.clone());
  const dcx = dcx_.handle();

  const module_name = thin_module.shared.module_names[thin_module.idx]!;

  // Right now the implementation we've got only works over serialized
  // modules, so we create a fresh new LLVM context and parse the module
  // into that context. One day, however, we may do this for upstream
  // crates but for locally codegened modules we may be able to reuse
  // that LLVM Context and Module.
  const module_llvm = llvm_backend().ModuleLlvm.parse(cgcx, tm_factory, module_name, thin_module.data(), dcx);
  const module = ModuleCodegen.new_regular(thin_module.name(), module_llvm);
  // Given that the newly created module lacks a thinlto buffer for embedding, we need to re-add it here.
  if (cgcx.module_config.embed_bitcode()) {
    module.thin_lto_buffer = thin_module.data().slice();
  }
  {
    const target = module.module_llvm.tm;
    const llmod = module.module_llvm.llmod();
    save_temp_bitcode(cgcx, module, "thin-lto-input");

    // PORT (plan-m7 D8, the ThinLocal no-op): `thin_lto` built no combined index, so the four steps below that read it
    // are skipped. Each `-Csave-temps` file is still written (of the unchanged module), and the timers still run. With
    // only this crate's CGUs in the index (`Lto::ThinLocal`) the steps would do this (PassWrapper.cpp:1313-1500 at the pin):
    // - rename (`renameModuleForThinLTO`): promotes the locals that another CGU imports (`.llvm.<hash>` names). Nothing is
    //   imported, so nothing needs promoting. It also clears `dso_local` on declarations for ELF PIC modules with the
    //   default PIE level, and sets it where the index proves a local definition: both only choose between direct and
    //   GOT access to a symbol that resolves the same way;
    // - resolve-weak (`thinLTOFinalizeInModule`): picks one prevailing copy of each linkonce/weak symbol defined in several
    //   CGUs (`weak_odr`) and drops the others (`available_externally`), and propagates function attributes from the
    //   index. Without it every CGU keeps its `linkonce_odr` copy and the linker keeps one, as in a multi-CGU build
    //   without LTO;
    // - internalize (`thinLTOInternalizeModule`): makes symbols that are dead from the preserved roots internal (the index
    //   marks only those; "everything that's already external linkage will stay as external"). Without it they stay
    //   external: emitted and visible to the linker, but unreachable;
    // - import: copies small functions from other CGUs for inlining. Skipping it is the D8 difference: less cross-CGU
    //   inlining.
    // `-Clto=thin` never gets here: `thin_lto` stops first.
    const thin_local_no_op = cgcx.lto === "ThinLocal";
    {
      const _timer = generic_activity_with_arg(prof, "LLVM_thin_lto_rename", thin_module.name());
      if (!thin_local_no_op) {
        // unsafe {
        llvm.LLVMRustPrepareThinLTORename(unwrap(thin_module.shared.data._0), llmod, target.raw());
        // };
      }
      save_temp_bitcode(cgcx, module, "thin-lto-after-rename");
    }

    {
      const _timer = generic_activity_with_arg(prof, "LLVM_thin_lto_resolve_weak", thin_module.name());
      if (!thin_local_no_op && !llvm.LLVMRustPrepareThinLTOResolveWeak(unwrap(thin_module.shared.data._0), llmod)) {
        write.llvm_err(dcx, LlvmError.PrepareThinLtoModule);
      }
      save_temp_bitcode(cgcx, module, "thin-lto-after-resolve");
    }

    {
      const _timer = generic_activity_with_arg(prof, "LLVM_thin_lto_internalize", thin_module.name());
      if (!thin_local_no_op && !llvm.LLVMRustPrepareThinLTOInternalize(unwrap(thin_module.shared.data._0), llmod)) {
        write.llvm_err(dcx, LlvmError.PrepareThinLtoModule);
      }
      save_temp_bitcode(cgcx, module, "thin-lto-after-internalize");
    }

    {
      const _timer = generic_activity_with_arg(prof, "LLVM_thin_lto_import", thin_module.name());
      if (!thin_local_no_op && !llvm.LLVMRustPrepareThinLTOImport(unwrap(thin_module.shared.data._0), llmod, target.raw())) {
        write.llvm_err(dcx, LlvmError.PrepareThinLtoModule);
      }
      save_temp_bitcode(cgcx, module, "thin-lto-after-import");
    }

    // Alright now that we've done everything related to the ThinLTO
    // analysis it's time to run some optimizations! Here we use the same
    // `run_pass_manager` as the "fat" LTO above except that we tell it to
    // populate a thin-specific pass manager, which presumably LLVM treats a
    // little differently.
    {
      tracing.info(TARGET, () => `running thin lto passes over ${module.name}`);
      run_pass_manager(cgcx, prof, dcx, module, true);
      save_temp_bitcode(cgcx, module, "thin-lto-after-pm");
    }
  }
  return codegen(cgcx, prof, shared_emitter, module, cgcx.module_config);
}

/// Maps LLVM module identifiers to their corresponding LLVM LTO cache keys
// #[derive(Debug, Default)]
class ThinLTOKeysMap {
  constructor(
    // key = llvm name of importing module, value = LLVM cache key
    /** `BTreeMap<String, String>`: iterate it through `sorted_entries` */
    public keys: Map<string, string>,
  ) {}

  /** `#[derive(Default)]` */
  static default_(): ThinLTOKeysMap {
    return new ThinLTOKeysMap(new Map());
  }

  /** `BTreeMap`'s iteration order: keys by their bytes. */
  sorted_entries(): [string, string][] {
    return [...this.keys].sort(([a], [b]) => cmp_cstr(a, b));
  }

  // impl ThinLTOKeysMap
  // rustc: compiler/rustc_codegen_llvm/src/back/lto.rs:796 save_to_file
  save_to_file(path: string): IoResult<null> {
    // use std::io::Write;
    // PORT: `File::create_buffered` + one `writeln!` per entry is one write of the whole text (the buffer flushes on drop).
    let text = "";
    // The entries are loaded back into a hash map in `load_from_file()`, so
    // the order in which we write them to file here does not matter.
    for (const [module, key] of this.sorted_entries()) {
      text += `${module} ${key}\n`;
    }
    try {
      writeFileSync(path, text);
    } catch (e) {
      return Err(io_error_from_node(e));
    }
    return Ok(null);
  }

  // rustc: compiler/rustc_codegen_llvm/src/back/lto.rs:807 load_from_file
  static load_from_file(path: string): IoResult<ThinLTOKeysMap> {
    // use std::io::BufRead;
    const keys = new Map<string, string>();
    let bytes: Uint8Array;
    try {
      bytes = readFileSync(path);
    } catch (e) {
      return Err(io_error_from_node(e));
    }
    // `BufRead::lines`: split at `\n`, drop a trailing `\r`, no empty last line; a line that is not UTF-8 is an
    // `InvalidData` error.
    const text = from_utf8(bytes);
    if (text.$ === "Err") return Err(INVALID_UTF8);
    const lines = text._0.split("\n");
    if (lines[lines.length - 1] === "") lines.pop();
    for (let line of lines) {
      if (line.endsWith("\r")) line = line.slice(0, -1);
      const split = line.split(" ");
      const module = unwrap(split[0]);
      const key = unwrap(split[1]);
      if (split.length > 2) {
        panic(`assertion \`left == right\` failed: Expected two space-separated values, found ${debug_str(line)}\n  left: Some(${debug_str(split[2]!)})\n right: None`);
      }
      keys.set(module, key);
    }
    return Ok(new ThinLTOKeysMap(keys));
  }

  // rustc: compiler/rustc_codegen_llvm/src/back/lto.rs:822 from_thin_lto_modules
  static from_thin_lto_modules(data: ThinData, modules: readonly llvm.ThinLTOModule[], names: readonly string[]): ThinLTOKeysMap {
    if (data._0 === undefined) {
      // PORT (plan-m7 D8, D11): the ThinLocal no-op built no index to compute cache keys from; -C incremental is out of M7.
      return unported("rustc_codegen_llvm::back::lto::ThinLTOKeysMap::from_thin_lto_modules (LLVMRustComputeLTOCacheKey without a ThinLTO index: the ThinLocal no-op under -C incremental; plan-m7 D8, D11)");
    }
    const data_ = data._0;
    const keys = new Map<string, string>();
    // iter::zip(modules, names)
    for (let i = 0; i < Math.min(modules.length, names.length); i++) {
      const [module, name] = [modules[i]!, names[i]!];
      const key = expect_result(
        build_string((rust_str) => {
          // unsafe {
          llvm.LLVMRustComputeLTOCacheKey(rust_str, module.identifier, data_);
          // }
        }),
        "Invalid ThinLTO module key",
        llvm.debug_FromUtf8Error,
      );
      keys.set(module_name_to_str(name), key);
    }
    return new ThinLTOKeysMap(keys);
  }
}
/** `#[derive(Debug)]` on `ThinLTOKeysMap`. */
const debug_ThinLTOKeysMap = (v: ThinLTOKeysMap, f: Fmt): string =>
  debug_struct(f, "ThinLTOKeysMap", [["keys", debug_map(f, v.sorted_entries().map(([k, x]) => [debug_str(k), debug_str(x)]))]]);

// rustc: compiler/rustc_codegen_llvm/src/back/lto.rs:840 module_name_to_str
function module_name_to_str(c_str: string): string {
  // PORT: a `CStr` here is a JS string, so `to_str()` cannot fail and the non-UTF-8 `bug!` arm is unreachable.
  return c_str;
}

/** `name: &CStr` (its bytes without the NUL, as a string). */
// rustc: compiler/rustc_codegen_llvm/src/back/lto.rs:846 parse_module
export function parse_module(cx: llvm.Context, name: string, data: Uint8Array, dcx: DiagCtxtHandle): llvm.Module {
  // unsafe {
  return llvm.LLVMRustParseBitcodeForLTO(cx, data, data.length, name) ?? write.llvm_err(dcx, LlvmError.ParseBitcode);
  // }
}

// ---- helpers for std forms (not upstream fns) ----

/** `CString::new(s).unwrap()`: panics on an interior NUL byte (as back/write.ts's copy). */
function cstring_new_unwrap(s: string): string {
  const bytes = utf8(s);
  const pos = bytes.indexOf(0);
  if (pos >= 0) panic(`called \`Result::unwrap()\` on an \`Err\` value: NulError(${pos}, [${Array.from(bytes).join(", ")}])`);
  return s;
}

/** `Ord for CStr` (and `String`): byte order. */
function cmp_cstr(a: string, b: string): number {
  return Buffer.compare(utf8(a), utf8(b));
}

/** `<CStr as Debug>`: `"` + the bytes' `escape_ascii()` + `"`. */
function debug_CStr(s: string): string {
  let out = '"';
  for (const b of utf8(s)) {
    if (b === 0x09) out += "\\t";
    else if (b === 0x0d) out += "\\r";
    else if (b === 0x0a) out += "\\n";
    else if (b === 0x5c) out += "\\\\";
    else if (b === 0x27) out += "\\'";
    else if (b === 0x22) out += '\\"';
    else if (b >= 0x20 && b < 0x7f) out += String.fromCharCode(b);
    else out += `\\x${b.toString(16).padStart(2, "0")}`;
  }
  return `${out}"`;
}

/** `<[u8]>::starts_with` */
function starts_with(a: Uint8Array, prefix: readonly number[]): boolean {
  return a.length >= prefix.length && prefix.every((b, i) => a[i] === b);
}

/** `Path::join` (Unix): `b` absolute replaces `a`; otherwise one `/` between them. */
function path_join(a: PathBuf, b: string): PathBuf {
  if (b.startsWith("/")) return b;
  if (a === "" || a.endsWith("/")) return a + b;
  return `${a}/${b}`;
}

/** profiling.rs `SelfProfilerRef::generic_activity_with_arg`: `TimingGuard::none()` outside the (empty) event mask. */
function generic_activity_with_arg(prof: SelfProfilerRef, event_label: string, _event_arg: string): VerboseTimingGuard {
  return prof.generic_activity(event_label);
}

/** profiling.rs `SelfProfilerRef::generic_activity_with_arg_recorder`: outside the (empty) event mask the recorder is not
 * called and the guard is `TimingGuard::none()`. */
function generic_activity_with_arg_recorder(prof: SelfProfilerRef, event_label: string, _f: () => string): VerboseTimingGuard {
  return prof.generic_activity(event_label);
}

/** `crate::back::llvm_backend` (`ModuleLlvm`), read lazily: llvm_backend.ts imports this file. */
function llvm_backend(): typeof import("./llvm_backend.ts") {
  return (llvm_backend__m ??= require("./llvm_backend.ts") as typeof import("./llvm_backend.ts"));
}
var llvm_backend__m: typeof import("./llvm_backend.ts") | undefined;
