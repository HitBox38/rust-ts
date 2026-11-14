// Port of compiler/rustc_codegen_ssa/src/back/link.rs: up to `exec_linker` (:2105) lane ssa-link-a (wave 40q), from
// `exec_linker` to the end lane ssa-link-b (wave 40r; link/raw_dylib.rs is link/raw_dylib.ts). Earlier lanes ported `link_binary`/`link_rlib`
// (plan-m6 D4, miri-sysroot), the native library search (link-rlib-native), `ignored_for_lto`, `each_linked_rlib`,
// `preserve_objects_for_their_debuginfo`, `are_upstream_rust_objects_already_included` and `warn_if_linked_with_gold`.
//
// PORT:
// - Calls into other lanes' functions (link.rs :2105-end, back/linker.rs, back/command.rs, back/archive.rs) go through the
//   `xlane` table at the end of this file (mir/mod.ts convention): forwarders to back/linker.ts, back/command.ts,
//   back/archive.ts, back/apple.ts, vendor object's writer, and to this file's own `exec_linker`, `self_contained_components`,
//   `linker_with_args`, `relevant_lib` and raw_dylib's `create_raw_dylib_dll_import_libs`. `Command`, `dyn Linker`
//   (`DynLinker`), `ArchiveSymbols` and `process::Output` are imported; `jobserver::Acquired` is an interface stand-in.
// - `thorin` (split DWARF packaging), `find_msvc_tools` and the Windows API (`mod win`) are not vendored: their uses stop.
// - `LinkingFailed`, `ProcessingDymutilFailed` and `StrippingDebugInfoFailed` are not generated (their `ExitStatus` /
//   `Command` fields): emitting them stops.
import * as tracing from "../../rust_ts/tracing.ts";
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import type { DiagCtxtHandle } from "../../rustc_errors/lib.ts";
import { DuplicateEiiImpls_diagnostic } from "../../rustc_middle/diagnostics.gen.ts";
import { emit_lint_base, LevelSpec } from "../../rustc_middle/lint.ts";
import { LINKER_INFO, LINKER_MESSAGES } from "../../rustc_lint_defs/builtin.gen.ts";
import { copy_to_stdout, emit_wrapper_file, MaybeTempDir, METADATA_FILENAME, TempDirBuilder } from "../../rustc_metadata/fs.ts";
import type { LinkerFeaturesCli, OutputFilenames } from "../../rustc_session/config.ts";
import { LinkerPluginLto, OutFileName, OutputType, SwitchWithOptPath } from "../../rustc_session/config.ts";
import { make_target_lib_path } from "../../rustc_session/filesearch.ts";
import { check_file_is_writeable, invalid_output_for_target, out_filename } from "../../rustc_session/output.ts";
import type { Session } from "../../rustc_session/session.ts";
import "../../rustc_session/utils.ts"; // `Session::time` / `Session::timer`
import { type CrateNum, LOCAL_CRATE } from "../../rustc_span/def_id.ts";
import type { ErrorGuaranteed } from "../../rustc_span/lib.ts";
import { Symbol } from "../../rustc_span/symbol.ts";
import { bug } from "../../rustc_span/macros.ts";
import { TargetTuple } from "../../rustc_target/spec/tuple.ts";
import type { EncodedMetadata } from "../../rustc_metadata/lib.ts";
import { File as FsFile, Mmap } from "../../rustc_data_structures/memmap.ts";
import { assert, panic, unported, unwrap } from "../../std/panic.ts";
import { debug_list, debug_str, PLAIN } from "../../std/fmt.ts";
import { Err, Ok, type Result, unwrap_result } from "../../std/result.ts";
import type { MutRef } from "../../std/mut_ref.ts";
import { from_utf8, str_lines, string_trim, string_trim_end } from "../../std/str.ts";
import { split_paths, to_string_lossy, var_, var_os } from "../../std/env.ts";
import { debug_CrateType, type CrateType } from "../../rustc_structures/crate_type.ts";
import { debug_Linkage } from "../../rustc_middle/middle/dependency_format.ts";
import {
  AddNativeLibrary_diagnostic,
  AixStripNotUsed_diagnostic,
  BinaryOutputToTty_diagnostic,
  CheckInstalledVisualStudio_diagnostic,
  CopyPath_diagnostic,
  CreateTempDir_diagnostic,
  type ExtractBundledLibsError,
  ExtractBundledLibsError_diagnostic,
  FailedToWrite_diagnostic,
  InsufficientVSCodeProduct_diagnostic,
  LinkerFileStem_diagnostic,
  LinkerNotFound_diagnostic,
  LinkExeUnexpectedError_diagnostic,
  LinkRlibError,
  LinkRlibError_diagnostic,
  LinkScriptUnavailable_diagnostic,
  LinkScriptWriteFailure_diagnostic,
  MissingCppBuildToolComponent_diagnostic,
  MissingNativeLibrary_diagnostic,
  MsvcMissingLinker_diagnostic,
  ReadFileError_diagnostic,
  RepairVSBuildTools_diagnostic,
  RlibArchiveBuildFailure_diagnostic,
  SelectCppBuildToolWorkload_diagnostic,
  SelfContainedLinkerMissing_diagnostic,
  StaticlibHideInternalSymbolsUnsupported_diagnostic,
  StaticlibRenameInternalSymbolsUnsupported_diagnostic,
  StaticLibraryNativeArtifacts_diagnostic,
  StaticLibraryNativeArtifactsToFile_diagnostic,
  type ThorinErrorWrapper,
  UnableToExeLinker_diagnostic,
  UnableToRun_diagnostic,
  UnableToRunDsymutil_diagnostic,
  UnableToWriteDebuggerVisualizer_diagnostic,
  UnsupportedLinkSelfContained_diagnostic,
  VisualStudioNotInstalled_diagnostic,
} from "../diagnostics.gen.ts";
import { CopyPath, LinkExeStatusStackBufferOverrun_diagnostic, LinkingFailed_into_diag, MissingNativeLibrary, ThorinErrorWrapper_into_diag } from "../diagnostics.ts";
import { absolute, path_components, path_eq, path_extension, path_file_name, path_file_stem, path_is_absolute, path_join, path_parent, path_strip_prefix } from "../../std/path.ts";
import { debug_IoError, display_IoError, type ErrorKind, type IoError, io_error_from_node, IoError_kind, IoError_raw_os_error, type IoResult } from "../../std/io.ts";
import { ControlFlow } from "../../rustc_ast_ir/visit.ts";
// Load order: rustc_target through its crate root first. spec/mod.ts imports lib.ts, which evaluates spec/json.ts and
// target_features.ts, and both read spec/mod.ts's bindings at their top level: entered from spec/mod.ts, the cycle reads `Os`
// before it exists (lanes unit-parallel, fixers-48).
import "../../rustc_target/lib.ts";
import { debug_LinkerFlavor, Env, LinkerFeatures, LinkerFlavor, LinkOutputKind, LinkSelfContainedComponents, LinkSelfContainedDefault, Os, type Target } from "../../rustc_target/spec/mod.ts";
import type { CrtObjects } from "../../rustc_target/spec/crt_objects.ts";
import { SanitizerSet } from "../../rustc_target/stand_ins.ts";
import { type FileHeader, FileHeader32_impl, FileHeader64_impl, FileHeader_provided, type FileHeaderValue } from "../../vendor/object/read/elf/file.ts";
import { ArchiveFile } from "../../vendor/object/read/archive.ts";
import { File as ReadFile } from "../../vendor/object/read/any.ts";
import { display_Error as display_ReadError } from "../../vendor/object/read/mod.ts";
import { SectionKind } from "../../vendor/object/common.ts";
import { type Error as WriteError, type Object as WriteObject, type SectionId as WriteSectionId, Symbol as WriteSymbol, type SymbolId as WriteSymbolId } from "../../vendor/object/write/mod.ts";
import { eval_config_entry, EvalConfigResult } from "../../rustc_attr_parsing/attributes/cfg.ts";
import type { CrateSource } from "../../rustc_crate_store/cstore.gen.ts";
import * as jobserver from "../../rustc_data_structures/jobserver.ts";
import { try_canonicalize } from "../../rustc_fs_util/lib.ts";
import type { DebuggerVisualizerFile } from "../../rustc_middle/middle/debugger_visualizer.ts";
import type { SymbolExportKind } from "../../rustc_middle/middle/exported_symbols.ts";
import { str_cmp } from "../../rustc_session/options.ts";
import { NativeLibKind, NativeLibKind_eq } from "../../rustc_structures/native_lib_kind.ts";
import { needs_allocator_shim_for_linking } from "../base.ts";
import { add_data_and_relocation, get_sdk_root, sdk_name } from "./apple.ts";
import { versioned_llvm_target } from "./mod.ts";
import { get_rpath_linker_args, type RPathConfig } from "./rpath.ts";
import { coff_machine_for_arch, undecorate_coff_symbol } from "./symbol_export.ts";
import * as raw_dylib from "./link/raw_dylib.ts";
import { type ArchiveBuilder, type ArchiveBuilderBuilder, type ArchiveEntryKind, type ArchiveSymbols, ArchiveBuilderBuilder_provided } from "./archive.ts";
import { Command, debug_Command, type ExitStatus, type Output } from "./command.ts";
import { type DynLinker as Linker, disable_localization, get_linker, get_tools_search_paths } from "./linker.ts";
import { create_object_file, create_wrapper_file } from "./metadata.ts";
import * as rmeta_link from "./rmeta_link.ts";
import { RmetaLinkCache } from "./rmeta_link.ts";
import { LinkerOutput_diagnostic } from "./link.gen.ts";
import type { CodegenLintLevelSpecs, CompiledModule, CompiledModules, CrateInfo, NativeLib, SymbolExport } from "../lib.ts";

// rustc: compiler/rustc_codegen_ssa/src/back/link.rs:68 ensure_removed
export function ensure_removed(dcx: DiagCtxtHandle, path: string): void {
  try {
    rmSync(path);
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code !== "ENOENT") {
      // dcx.err(format!("failed to remove {}: {}", path.display(), e));
      // PORT: `{e}` is the io::Error's Display, which is not modelled for arbitrary errnos.
      void dcx;
      unported(`std::io::Error Display (ensure_removed: failed to remove ${path}: ${err.code})`);
    }
  }
}

// rustc: compiler/rustc_codegen_ssa/src/back/link.rs:76 eii_impl_crate_name
function eii_impl_crate_name(crate_info: CrateInfo, cnum: CrateNum): Symbol {
  if (cnum === LOCAL_CRATE) {
    return crate_info.local_crate_name;
  } else {
    return crate_info_crate_name(crate_info, cnum);
  }
}

// rustc: compiler/rustc_codegen_ssa/src/back/link.rs:80 check_externally_implementable_item_linkage
function check_externally_implementable_item_linkage(sess: Session, crate_info: CrateInfo): void {
  if (crate_info.eii_linkage.length === 0) {
    return;
  }

  // A crate can request multiple linked outputs with overlapping dependency
  // formats, so report each underlying conflict once.
  const emitted = new Set<number>();

  // This needs the dependency formats selected for the final artifact. The
  // earlier EII pass still handles missing impls and duplicate explicit impls.
  for (const dependency_formats of crate_info.dependency_formats.values()) {
    for (const [eii_index, eii] of crate_info.eii_linkage.entries()) {
      const explicit_impl = eii.impls[0];
      if (explicit_impl === undefined) {
        continue;
      }
      // If the explicit impl is already coming from a dylib, that dylib
      // has already resolved the default-vs-explicit choice.
      const explicit_linkage = dependency_formats[explicit_impl.impl_crate];
      if (explicit_linkage === "Dynamic" || explicit_linkage === "IncludedFromDylib") {
        continue;
      }

      const default_impl = eii.default_impl;
      if (default_impl === undefined) {
        continue;
      }
      const default_linkage = dependency_formats[default_impl.impl_crate];
      if (!(default_linkage === "Dynamic" || default_linkage === "IncludedFromDylib")) {
        continue;
      }

      if (emitted.has(eii_index)) {
        continue;
      }
      emitted.add(eii_index);

      sess.dcx().emit_err(
        DuplicateEiiImpls_diagnostic({
          name: eii.name,
          first_span: explicit_impl.span,
          first_crate: eii_impl_crate_name(crate_info, explicit_impl.impl_crate),
          second_span: default_impl.span,
          second_crate: eii_impl_crate_name(crate_info, default_impl.impl_crate),
          help: null,
          additional_crates: undefined,
          num_additional_crates: 0,
          additional_crate_names: "",
        }),
      );
    }
  }
}

/// The fallback directories are passed to linker, but not used when rustc does the search,
/// because in the latter case the set of fallback directories cannot always be determined
/// consistently at the moment.
interface NativeLibSearchFallback {
  self_contained_components: LinkSelfContainedComponents;
  apple_sdk_root: string | undefined;
}

/** `Path::exists`: `fs::metadata(path).is_ok()` (follows symlinks). */
function path_exists(path: string): boolean {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}

// rustc: compiler/rustc_codegen_ssa/src/back/link.rs:142 walk_native_lib_search_dirs
function walk_native_lib_search_dirs<R>(
  sess: Session,
  fallback: NativeLibSearchFallback | undefined,
  f: (dir: string, is_framework: boolean) => ControlFlow<R>,
): ControlFlow<R> {
  let r: ControlFlow<R>;
  // Library search paths explicitly supplied by user (`-L` on the command line).
  for (const search_path of sess.target_filesearch().cli_search_paths("Native")) {
    if ((r = f(search_path.dir, false)).$ === "Break") return r;
  }
  for (const search_path of sess.target_filesearch().cli_search_paths("Framework")) {
    // Frameworks are looked up strictly in framework-specific paths.
    if (search_path.kind !== "All") {
      if ((r = f(search_path.dir, true)).$ === "Break") return r;
    }
  }

  if (fallback === undefined) {
    return ControlFlow.Continue(null);
  }
  const { self_contained_components, apple_sdk_root } = fallback;

  // The toolchain ships some native library components and self-contained linking was enabled.
  // Add the self-contained library directory to search paths.
  if ((self_contained_components & (LinkSelfContainedComponents.LIBC | LinkSelfContainedComponents.UNWIND | LinkSelfContainedComponents.MINGW)) !== 0) {
    if ((r = f(path_join(sess.target_tlib_path.dir, "self-contained"), false)).$ === "Break") return r;
  }

  const has_shared_llvm_apple_darwin = sess.target.is_like_darwin && path_exists(path_join(sess.target_tlib_path.dir, "libLLVM.dylib"));

  // Toolchains for some targets may ship `libunwind.a`, but place it into the main sysroot
  // library directory instead of the self-contained directories.
  // Sanitizer libraries have the same issue and are also linked by name on Apple targets.
  // The targets here should be in sync with `copy_third_party_objects` in bootstrap.
  // On Apple targets, shared LLVM is linked by name, so when `libLLVM.dylib` is
  // present in the target libdir, add that directory to the linker search path.
  // FIXME: implement `-Clink-self-contained=+/-unwind,+/-sanitizers`, move the shipped libunwind
  // and sanitizers to self-contained directory, and stop adding this search path.
  // FIXME: On AIX this also has the side-effect of making the list of library search paths
  // non-empty, which is needed or the linker may decide to record the LIBPATH env, if
  // defined, as the search path instead of appending the default search paths.
  if (
    sess.target.cfg_abi.$ === "Fortanix" ||
    sess.target.os.$ === "Linux" ||
    sess.target.os.$ === "Fuchsia" ||
    sess.target.is_like_aix ||
    (sess.target.is_like_darwin && (sess.sanitizers() !== 0 || has_shared_llvm_apple_darwin)) ||
    (sess.target.os.$ === "Windows" && sess.target.env.$ === "Gnu" && sess.target.cfg_abi.$ === "Llvm")
  ) {
    if ((r = f(sess.target_tlib_path.dir, false)).$ === "Break") return r;
  }

  // Mac Catalyst uses the macOS SDK, but to link to iOS-specific frameworks
  // we must have the support library stubs in the library search path (#121430).
  if (apple_sdk_root !== undefined && sess.target.env.$ === "MacAbi") {
    if ((r = f(path_join(apple_sdk_root, "System/iOSSupport/usr/lib"), false)).$ === "Break") return r;
    if ((r = f(path_join(apple_sdk_root, "System/iOSSupport/System/Library/Frameworks"), true)).$ === "Break") return r;
  }

  return ControlFlow.Continue(null);
}

// rustc: compiler/rustc_codegen_ssa/src/back/link.rs:212 try_find_native_static_library
export function try_find_native_static_library(sess: Session, name: string, verbatim: boolean): string | undefined {
  const default_ = sess.staticlib_components(verbatim);
  let formats: [string, string][];
  if (verbatim) {
    formats = [default_];
  } else {
    // On Windows, static libraries sometimes show up as libfoo.a and other
    // times show up as foo.lib
    const unix: [string, string] = ["lib", ".a"];
    formats = default_[0] === unix[0] && default_[1] === unix[1] ? [default_] : [default_, unix];
  }

  const r = walk_native_lib_search_dirs<string>(sess, undefined, (dir, is_framework) => {
    if (!is_framework) {
      for (const [prefix, suffix] of formats) {
        const test = path_join(dir, `${prefix}${name}${suffix}`);
        if (path_exists(test)) {
          return ControlFlow.Break(test);
        }
      }
    }
    return ControlFlow.Continue(null);
  });
  return r.$ === "Break" ? r._0 : undefined;
}

// rustc: compiler/rustc_codegen_ssa/src/back/link.rs:241 try_find_native_dynamic_library
export function try_find_native_dynamic_library(sess: Session, name: string, verbatim: boolean): string | undefined {
  const default_ = sess.staticlib_components(verbatim);
  let formats: [string, string][];
  if (verbatim) {
    formats = [default_];
  } else {
    // While the official naming convention for MSVC import libraries
    // is foo.lib, Meson follows the libfoo.dll.a convention to
    // disambiguate .a for static libraries
    const meson: [string, string] = ["lib", ".dll.a"];
    // and MinGW uses .a altogether
    const mingw: [string, string] = ["lib", ".a"];
    formats = [default_, meson, mingw];
  }

  const r = walk_native_lib_search_dirs<string>(sess, undefined, (dir, is_framework) => {
    if (!is_framework) {
      for (const [prefix, suffix] of formats) {
        const test = path_join(dir, `${prefix}${name}${suffix}`);
        if (path_exists(test)) {
          return ControlFlow.Break(test);
        }
      }
    }
    return ControlFlow.Continue(null);
  });
  return r.$ === "Break" ? r._0 : undefined;
}

// rustc: compiler/rustc_codegen_ssa/src/back/link.rs:273 find_native_static_library
export function find_native_static_library(name: string, verbatim: boolean, sess: Session): string {
  const r = try_find_native_static_library(sess, name, verbatim);
  if (r !== undefined) return r;
  return sess.dcx().emit_fatal(MissingNativeLibrary_diagnostic(MissingNativeLibrary.new(name, verbatim)));
}

/// If `lib` is a static library that is bundled into the rlib as a packed archive, returns the
/// file name of that archive. Returns `None` for libraries that are instead unpacked into loose
/// object files, or not bundled at all.
// rustc: compiler/rustc_codegen_ssa/src/back/link.rs:282 find_bundled_library
function find_bundled_library(lib: NativeLib, sess: Session, crate_types: readonly CrateType[]): Symbol | undefined {
  if (
    lib.kind.$ === "Static" &&
    (lib.kind.bundle === true || lib.kind.bundle === undefined) &&
    crate_types.some((t) => t === "Rlib" || t === "StaticLib") &&
    (sess.opts.unstable_opts.packed_bundled_libs || lib.cfg !== undefined || lib.kind.whole_archive === true)
  ) {
    // `.file_name().and_then(|s| s.to_str()).map(Symbol::intern)`: paths are strings here.
    const file_name = path_file_name(find_native_static_library(Symbol.as_str(lib.name), lib.verbatim, sess));
    return file_name === undefined ? undefined : Symbol.intern(file_name);
  }
  return undefined;
}

/// Performs the linkage portion of the compilation phase. This will generate all
/// of the requested outputs for this compilation session.
// rustc: compiler/rustc_codegen_ssa/src/back/link.rs:303 link_binary
export function link_binary(
  sess: Session,
  archive_builder_builder: ArchiveBuilderBuilder,
  compiled_modules: CompiledModules,
  crate_info: CrateInfo,
  metadata: EncodedMetadata,
  outputs: OutputFilenames,
  codegen_backend: string,
): void {
  const _timer = sess.timer("link_binary");
  const output_metadata = sess.opts.output_types.contains_key("Metadata");
  const tempfiles_for_stdout_output: string[] = [];
  const rmeta_link_cache = new RmetaLinkCache();

  if (outputs.outputs.should_link()) {
    sess.time("check_externally_implementable_item_linkage", () => {
      check_externally_implementable_item_linkage(sess, crate_info);
    });
    sess.dcx().abort_if_errors();
  }

  for (const crate_type of crate_info.crate_types) {
    // Ignore executable crates if we have -Z no-codegen, as they will error.
    if ((sess.opts.unstable_opts.no_codegen || !sess.opts.output_types.should_codegen()) && !output_metadata && crate_type === "Executable") {
      continue;
    }

    if (invalid_output_for_target(sess, crate_type)) {
      bug(`invalid output type \`${crate_type}\` for target \`${TargetTuple.display(sess.opts.target_triple)}\``);
    }

    sess.time("link_binary_check_files_are_writeable", () => {
      for (const m of compiled_modules.modules) {
        if (m.object !== undefined) {
          check_file_is_writeable(m.object, sess);
        }
        if (m.global_asm_object !== undefined) {
          check_file_is_writeable(m.global_asm_object, sess);
        }
      }
    });

    if (outputs.outputs.should_link()) {
      const output = out_filename(sess, crate_type, outputs, crate_info.local_crate_name);
      const tmpdir = TempDirBuilder.new().prefix("rustc").tempdir_in(path_parent(OutFileName.as_path(output)) ?? ".");
      if (tmpdir.$ === "Err") {
        return sess.dcx().emit_fatal(CreateTempDir_diagnostic({ error: tmpdir._0 }));
      }
      const path = MaybeTempDir.new(tmpdir._0, sess.opts.cg.save_temps);
      // PORT: `path`'s drop at the end of this block, on an unwind too.
      try {
        const crate_name = Symbol.as_str(crate_info.local_crate_name);
        const out_filename_ = OutFileName.file_for_writing(output, outputs, "Exe", crate_name);
        switch (crate_type) {
          case "Rlib": {
            const _timer = sess.timer("link_rlib");
            // info!("preparing rlib to {:?}", out_filename);
            tracing.info_unconverted("rustc_codegen_ssa::back::link", "compiler/rustc_codegen_ssa/src/back/link.rs:363");
            xlane.ArchiveBuilder_build(link_rlib(sess, archive_builder_builder, compiled_modules, crate_info, metadata, "Normal", path), out_filename_, undefined);
            break;
          }
          case "StaticLib": {
            link_staticlib(sess, archive_builder_builder, rmeta_link_cache, compiled_modules, crate_info, metadata, out_filename_, path);
            break;
          }
          default: {
            link_natively(
              sess,
              archive_builder_builder,
              rmeta_link_cache,
              crate_type,
              out_filename_,
              compiled_modules,
              crate_info,
              metadata,
              path.as_ref(),
              codegen_backend,
            );
          }
        }
        if (sess.opts.json_artifact_notifications) {
          sess.dcx().emit_artifact_notification(out_filename_, "link");
        }

        // PORT: the `sess.prof.enabled()` block records the file size for `-Zself-profile`, not ported.

        if (sess.target.options.binary_format === "Elf") {
          const r = warn_if_linked_with_gold(sess, out_filename_);
          // if let Err(err) = ... { info!(?err, "Error while checking if gold was the linker"); }
          if (r.$ === "Err") tracing.info_unconverted("rustc_codegen_ssa::back::link", "compiler/rustc_codegen_ssa/src/back/link.rs:421");
        }

        if (OutFileName.is_stdout(output)) {
          if (OutFileName.is_tty(output)) {
            sess.dcx().emit_err(
              BinaryOutputToTty_diagnostic({
                shorthand: OutputType.shorthand("Exe"),
              }),
            );
          } else {
            const e = copy_to_stdout(out_filename_);
            if (e.$ === "Err") {
              sess.dcx().emit_err(CopyPath_diagnostic(CopyPath.new(out_filename_, OutFileName.as_path(output), e._0)));
            }
          }
          tempfiles_for_stdout_output.push(out_filename_);
        }
      } finally {
        path.drop();
      }
    }
  }

  // Remove the temporary object file and metadata if we aren't saving temps.
  sess.time("link_binary_remove_temps", () => {
    // If the user requests that temporaries are saved, don't delete any.
    if (sess.opts.cg.save_temps) {
      return;
    }

    const maybe_remove_temps_from_module = (preserve_objects: boolean, preserve_dwarf_objects: boolean, module: CompiledModule): void => {
      if (!preserve_objects && module.object !== undefined) {
        ensure_removed(sess.dcx(), module.object);
      }

      if (!preserve_objects && module.global_asm_object !== undefined) {
        ensure_removed(sess.dcx(), module.global_asm_object);
      }

      if (!preserve_dwarf_objects && module.dwarf_object !== undefined) {
        ensure_removed(sess.dcx(), module.dwarf_object);
      }
    };

    const remove_temps_from_module = (module: CompiledModule): void => maybe_remove_temps_from_module(false, false, module);

    // Otherwise, always remove the allocator module temporaries.
    if (compiled_modules.allocator_module !== undefined) {
      remove_temps_from_module(compiled_modules.allocator_module);
    }

    // Remove the temporary files if output goes to stdout
    for (const temp of tempfiles_for_stdout_output) {
      ensure_removed(sess.dcx(), temp);
    }

    // If no requested outputs require linking, then the object temporaries should
    // be kept.
    if (!sess.opts.output_types.should_link()) {
      return;
    }

    // Potentially keep objects for their debuginfo.
    const [preserve_objects, preserve_dwarf_objects] = preserve_objects_for_their_debuginfo(sess);
    // debug!(?preserve_objects, ?preserve_dwarf_objects);

    for (const module of compiled_modules.modules) {
      maybe_remove_temps_from_module(preserve_objects, preserve_dwarf_objects, module);
    }
  });
}

// Crate type is not passed when calculating the dylibs to include for LTO. In that case all
// crate types must use the same dependency formats.
// rustc: compiler/rustc_codegen_ssa/src/back/link.rs:495 each_linked_rlib
export function each_linked_rlib(info: CrateInfo, crate_type: CrateType | undefined, f: (cnum: CrateNum, path: string) => void): Result<null, LinkRlibError> {
  let fmts;
  if (crate_type !== undefined) {
    fmts = info.dependency_formats.get(crate_type);
    if (fmts === undefined) {
      return Err(LinkRlibError.MissingFormat);
    }
  } else {
    const dep_formats = [...info.dependency_formats];
    const first = dep_formats[0];
    if (first === undefined) return Err(LinkRlibError.MissingFormat);
    const [ty1, list1] = first;
    // PORT: `list1 != *list2` of `IndexVec<CrateNum, Linkage>`.
    const other = dep_formats.slice(1).find(([, list2]) => list1.length !== list2.length || list1.some((l, i) => l !== list2[i]));
    if (other !== undefined) {
      const [ty2, list2] = other;
      const debug_linkages = (list: typeof list1): string => debug_list(PLAIN, list.map((l) => debug_Linkage(l, PLAIN)));
      return Err({
        $: "IncompatibleDependencyFormats",
        ty1: debug_CrateType(ty1, PLAIN),
        ty2: debug_CrateType(ty2, PLAIN),
        list1: debug_linkages(list1),
        list2: debug_linkages(list2),
      });
    }
    fmts = list1;
  }

  const used_dep_crates = info.used_crates;
  for (const cnum of used_dep_crates) {
    const fmt = fmts[cnum];
    if (fmt === "NotLinked" || fmt === "Dynamic" || fmt === "IncludedFromDylib") continue;
    if (fmt === undefined) return Err(LinkRlibError.MissingFormat);
    const crate_name = crate_info_crate_name(info, cnum);
    const used_crate_source = crate_info_used_crate_source(info, cnum);
    if (used_crate_source.rlib !== undefined) {
      f(cnum, used_crate_source.rlib);
    } else if (used_crate_source.rmeta !== undefined) {
      return Err({ $: "OnlyRmetaFound", crate_name });
    } else {
      return Err({ $: "NotFound", crate_name });
    }
  }
  return Ok(null);
}

/// Create an 'rlib'.
///
/// An rlib in its current incarnation is essentially a renamed .a file (with "dummy" object files).
/// The rlib primarily contains the object file of the crate, but it also some of the object files
/// from native libraries.
// rustc: compiler/rustc_codegen_ssa/src/back/link.rs:545 link_rlib
export function link_rlib(
  sess: Session,
  archive_builder_builder: ArchiveBuilderBuilder,
  compiled_modules: CompiledModules,
  crate_info: CrateInfo,
  metadata: EncodedMetadata,
  flavor: RlibFlavor,
  tmpdir: MaybeTempDir,
): ArchiveBuilder {
  const ab = archive_builder_builder.new_archive_builder(sess);

  // Pre-compute the list of Rust object filenames and materialize the rmeta-link
  // wrapper file before any `add_file` calls. This lets the rmeta-link member be
  // placed immediately after metadata in the archive, so consumers can find
  // it without iterating every archive member.
  const rust_object_files: string[] = [];
  for (const m of compiled_modules.modules) {
    if (m.object !== undefined) rust_object_files.push(path_file_name(m.object)!);
  }
  for (const m of compiled_modules.modules) {
    if (m.global_asm_object !== undefined) rust_object_files.push(path_file_name(m.global_asm_object)!);
  }

  const native_lib_filenames: (Symbol | undefined)[] = crate_info.used_libraries.map((lib) => find_bundled_library(lib, sess, crate_info.crate_types));

  let metadata_link_file: string | undefined = undefined;
  if (flavor === "Normal") {
    const native_lib_filenames_: (string | undefined)[] = native_lib_filenames.map((f) => (f === undefined ? undefined : Symbol.as_str(f)));
    const metadata_link = new rmeta_link.RmetaLink(rust_object_files, native_lib_filenames_);
    const metadata_link_data = metadata_link.encode();
    const [wrapper] = create_wrapper_file(sess, rmeta_link.SECTION, metadata_link_data);
    metadata_link_file = emit_wrapper_file(sess, wrapper, tmpdir.as_ref(), rmeta_link.FILENAME);
  }

  let trailing_metadata: string | undefined;
  switch (flavor) {
    case "Normal": {
      const [metadata_, metadata_position] = create_wrapper_file(sess, ".rmeta", metadata.stub_or_full());
      const metadata_file = emit_wrapper_file(sess, metadata_, tmpdir.as_ref(), METADATA_FILENAME);
      switch (metadata_position) {
        case "First":
          // Most of the time metadata in rlib files is wrapped in a "dummy" object
          // file for the target platform so the rlib can be processed entirely by
          // normal linkers for the platform. Sometimes this is not possible however.
          // If it is possible however, placing the metadata object first improves
          // performance of getting metadata from rlibs.
          ab.add_file(metadata_file, "Other");
          // Place the rmeta-link member immediately after metadata so consumers
          // can find it without iterating the whole archive.
          if (metadata_link_file !== undefined) {
            ab.add_file(metadata_link_file, "Other");
          }
          trailing_metadata = undefined;
          break;
        case "Last":
          trailing_metadata = metadata_file;
          break;
      }
      break;
    }

    case "StaticlibBase":
      trailing_metadata = undefined;
      break;
  }

  for (const m of compiled_modules.modules) {
    if (m.object !== undefined) {
      ab.add_file(m.object, "RustObj");
    }

    if (m.global_asm_object !== undefined) {
      ab.add_file(m.global_asm_object, "RustObj");
    }

    if (m.dwarf_object !== undefined) {
      ab.add_file(m.dwarf_object, "Other");
    }
  }

  switch (flavor) {
    case "Normal":
      break;
    case "StaticlibBase":
      if (compiled_modules.allocator_module !== undefined) {
        const m = compiled_modules.allocator_module;
        if (m.object !== undefined) {
          ab.add_file(m.object, "RustObj");
        }
        if (m.global_asm_object !== undefined) {
          ab.add_file(m.global_asm_object, "RustObj");
        }
      }
      break;
  }

  // Used if packed_bundled_libs flag enabled.
  const packed_bundled_libs: string[] = [];

  // Note that in this loop we are ignoring the value of `lib.cfg`. That is,
  // we may not be configured to actually include a static library if we're
  // adding it here. That's because later when we consume this rlib we'll
  // decide whether we actually needed the static library or not.
  //
  // To do this "correctly" we'd need to keep track of which libraries added
  // which object files to the archive. We don't do that here, however. The
  // #[link(cfg(..))] feature is unstable, though, and only intended to get
  // liblibc working. In that sense the check below just indicates that if
  // there are any libraries we want to omit object files for at link time we
  // just exclude all custom object files.
  //
  // Eventually if we want to stabilize or flesh out the #[link(cfg(..))]
  // feature then we'll need to figure out how to record what objects were
  // loaded from the libraries found here and then encode that into the
  // metadata of the rlib we're generating somehow.
  for (let i = 0; i < crate_info.used_libraries.length; i++) {
    const lib = crate_info.used_libraries[i]!;
    if (!(lib.kind.$ === "Static" && (lib.kind.bundle === undefined || lib.kind.bundle === true))) {
      continue;
    }
    const filename = native_lib_filenames[i];
    if (flavor === "Normal" && filename !== undefined) {
      const path = find_native_static_library(Symbol.as_str(filename), true, sess);
      let src: Uint8Array;
      try {
        src = readFileSync(path);
      } catch (e) {
        src = sess.dcx().emit_fatal(ReadFileError_diagnostic({ message: io_error_from_node(e) }));
      }
      const [data] = create_wrapper_file(sess, ".bundled_lib", src);
      const wrapper_file = emit_wrapper_file(sess, data, tmpdir.as_ref(), Symbol.as_str(filename));
      packed_bundled_libs.push(wrapper_file);
    } else {
      const path = find_native_static_library(Symbol.as_str(lib.name), lib.verbatim, sess);
      const r = ab.add_archive(path, { $: "Other" });
      if (r.$ === "Err") {
        sess.dcx().emit_fatal(AddNativeLibrary_diagnostic({ library_path: path, error: r._0 }));
      }
    }
  }

  // On Windows, we add the raw-dylib import libraries to the rlibs already.
  // But on ELF, this is not possible, as a shared object cannot be a member of a static library.
  // Instead, we add all raw-dylibs to the final link on ELF.
  if (sess.target.options.is_like_windows) {
    for (const output_path of xlane.create_raw_dylib_dll_import_libs(sess, archive_builder_builder, crate_info.used_libraries, tmpdir.as_ref(), true)) {
      const r = ab.add_archive(output_path, { $: "Other" });
      if (r.$ === "Err") {
        sess.dcx().emit_fatal(AddNativeLibrary_diagnostic({ library_path: output_path, error: r._0 }));
      }
    }
  }

  if (trailing_metadata !== undefined) {
    // Note that it is important that we add all of our non-object "magical
    // files" *after* all of the object files in the archive. The reason for
    // this is as follows:
    //
    // * When performing LTO, this archive will be modified to remove
    //   objects from above. The reason for this is described below.
    //
    // * When the system linker looks at an archive, it will attempt to
    //   determine the architecture of the archive in order to see whether its
    //   linkable.
    //
    //   The algorithm for this detection is: iterate over the files in the
    //   archive. Skip magical SYMDEF names. Interpret the first file as an
    //   object file. Read architecture from the object file.
    //
    // * As one can probably see, if "metadata" and "foo.bc" were placed
    //   before all of the objects, then the architecture of this archive would
    //   not be correctly inferred once 'foo.o' is removed.
    //
    // * Most of the time metadata in rlib files is wrapped in a "dummy" object
    //   file for the target platform so the rlib can be processed entirely by
    //   normal linkers for the platform. Sometimes this is not possible however.
    //
    // Basically, all this means is that this code should not move above the
    // code above.
    ab.add_file(trailing_metadata, "Other");
    // Place the rmeta-link member immediately after metadata so consumers can
    // find it without iterating the whole archive.
    if (metadata_link_file !== undefined) {
      ab.add_file(metadata_link_file, "Other");
    }
  }

  // Add all bundled static native library dependencies.
  // Archives added to the end of .rlib archive, see comment above for the reason.
  for (const lib of packed_bundled_libs) {
    ab.add_file(lib, "Other");
  }

  return ab;
}

/// Create a static archive.
///
/// This is essentially the same thing as an rlib, but it also involves adding all of the upstream
/// crates' objects into the archive. This will slurp in all of the native libraries of upstream
/// dependencies as well.
///
/// Additionally, there's no way for us to link dynamic libraries, so we warn about all dynamic
/// library dependencies that they're not linked in.
///
/// There's no need to include metadata in a static archive, so ensure to not link in the metadata
/// object file (and also don't prepare the archive with a metadata file).
// rustc: compiler/rustc_codegen_ssa/src/back/link.rs:754 link_staticlib
export function link_staticlib(
  sess: Session,
  archive_builder_builder: ArchiveBuilderBuilder,
  rmeta_link_cache: RmetaLinkCache,
  compiled_modules: CompiledModules,
  crate_info: CrateInfo,
  metadata: EncodedMetadata,
  out_filename: string,
  tempdir: MaybeTempDir,
): void {
  tracing.info(TARGET, () => `preparing staticlib to ${debug_str(out_filename)}`);
  const ab = link_rlib(sess, archive_builder_builder, compiled_modules, crate_info, metadata, "StaticlibBase", tempdir);
  const all_native_libs: NativeLib[] = [];

  const res = each_linked_rlib(crate_info, "StaticLib", (cnum, path) => {
    const lto = are_upstream_rust_objects_already_included(sess) && !ignored_for_lto(sess, crate_info, cnum);

    const native_libs = crate_info_native_libraries(crate_info, cnum);
    const bundled_filenames = rmeta_link_cache.native_lib_filenames(sess.target, path, native_libs);
    // `FxIndexSet<Symbol>`: insertion-ordered.
    const relevant_libs = new Set<Symbol>();
    for (let i = 0; i < native_libs.length; i++) {
      if (!xlane.relevant_lib(sess, native_libs[i]!)) continue;
      const filename = bundled_filenames[i];
      if (filename !== undefined) relevant_libs.add(filename);
    }

    const bundled_libs = new Set<Symbol>();
    for (let i = 0; i < native_libs.length; i++) {
      const filename = bundled_filenames[i];
      if (filename !== undefined) bundled_libs.add(filename);
    }
    unwrap_result(
      ab.add_archive(path, {
        $: "Rlib",
        _0: rmeta_link_cache,
        _1: (fname: string, entry_kind: ArchiveEntryKind): boolean => {
          // Ignore metadata and rmeta-link files.
          if (fname === METADATA_FILENAME || fname === rmeta_link.FILENAME) {
            return true;
          }

          // Don't include Rust objects if LTO is enabled.
          if (lto && entry_kind === "RustObj") {
            return true;
          }

          // Skip objects for bundled libs.
          if (bundled_libs.has(Symbol.intern(fname))) {
            return true;
          }

          return false;
        },
      }),
      debug_IoError,
    );

    const r = xlane.extract_bundled_libs(archive_builder_builder, path, tempdir.as_ref(), relevant_libs);
    if (r.$ === "Err") sess.dcx().emit_fatal(ExtractBundledLibsError_diagnostic(r._0));

    for (const filename of relevant_libs) {
      const joined = path_join(tempdir.as_ref(), Symbol.as_str(filename));
      const path = joined;
      unwrap_result(ab.add_archive(path, { $: "Other" }), debug_IoError);
    }

    all_native_libs.push(...crate_info_native_libraries(crate_info, cnum));
  });
  if (res.$ === "Err") {
    sess.dcx().emit_fatal(LinkRlibError_diagnostic(res._0));
  }

  const hide = sess.opts.unstable_opts.staticlib_hide_internal_symbols;
  const rename = sess.opts.unstable_opts.staticlib_rename_internal_symbols;

  const hide_supported = sess.target.options.binary_format === "Elf" || sess.target.options.binary_format === "MachO";
  // Rename only rewrites symbol names, so it also works on COFF; hide
  // needs a visibility concept COFF lacks.
  const rename_supported =
    sess.target.options.binary_format === "Elf" || sess.target.options.binary_format === "MachO" || sess.target.options.binary_format === "Coff";

  let exported_symbols: Set<string> | undefined;
  if (hide || rename) {
    if (hide && !hide_supported) {
      sess.dcx().emit_warn(
        StaticlibHideInternalSymbolsUnsupported_diagnostic({
          binary_format: sess.target.options.archive_format,
        }),
      );
    }
    if (rename && !rename_supported) {
      sess.dcx().emit_warn(
        StaticlibRenameInternalSymbolsUnsupported_diagnostic({
          binary_format: sess.target.options.archive_format,
        }),
      );
    }
    if ((hide && hide_supported) || (rename && rename_supported)) {
      const symbols = crate_info.exported_symbols.get("StaticLib");
      exported_symbols = symbols === undefined ? undefined : new Set(symbols.map((symbol) => symbol.name));
    } else {
      exported_symbols = undefined;
    }
  } else {
    exported_symbols = undefined;
  }

  const symbols: ArchiveSymbols | undefined =
    exported_symbols === undefined
      ? undefined
      : {
          exported: exported_symbols,
          rename_suffix: rename && rename_supported ? crate_info.symbol_rename_suffix : undefined,
          // A warning was already emitted above if hiding was requested for an
          // unsupported format; don't also ask the backend to hide there.
          hide: hide && hide_supported,
        };

  xlane.ArchiveBuilder_build(ab, out_filename, symbols);

  const crates = crate_info.used_crates;

  const fmts = crate_info.dependency_formats.get("StaticLib");
  if (fmts === undefined) panic("no dependency formats for staticlib");

  const all_rust_dylibs: string[] = [];
  for (const cnum of crates) {
    if (fmts[cnum] !== "Dynamic") {
      continue;
    }
    const crate_name = crate_info_crate_name(crate_info, cnum);
    const used_crate_source = crate_info_used_crate_source(crate_info, cnum);
    if (used_crate_source.dylib !== undefined) {
      all_rust_dylibs.push(used_crate_source.dylib);
    } else if (used_crate_source.rmeta !== undefined) {
      sess.dcx().emit_fatal(LinkRlibError_diagnostic({ $: "OnlyRmetaFound", crate_name }));
    } else {
      sess.dcx().emit_fatal(LinkRlibError_diagnostic({ $: "NotFound", crate_name }));
    }
  }

  all_native_libs.push(...crate_info.used_libraries);

  for (const print of sess.opts.prints) {
    if (print.kind === "NativeStaticLibs") {
      print_native_static_libs(sess, print.out, all_native_libs, all_rust_dylibs);
    }
  }
}

/** `crate_info.native_libraries[&cnum]` (an `FxIndexMap` index: panics on a missing key). */
function crate_info_native_libraries(crate_info: CrateInfo, cnum: CrateNum): NativeLib[] {
  const libs = crate_info.native_libraries.get(cnum);
  if (libs === undefined) return panic("IndexMap: key not found");
  return libs;
}

/// Use `thorin` (rust implementation of a dwarf packaging utility) to link DWARF objects into a
/// DWARF package.
// rustc: compiler/rustc_codegen_ssa/src/back/link.rs:914 link_dwarf_object
function link_dwarf_object(sess: Session, compiled_modules: CompiledModules, crate_info: CrateInfo, executable_out_filename: string): void {
  const dwp_out_filename = executable_out_filename + ".dwp";
  // debug!(?dwp_out_filename, ?executable_out_filename);

  // #[derive(Default)]
  // PORT: the `TypedArena`s are arrays that keep the allocations alive for the session's lifetime.
  class ThorinSession<Relocations> {
    arena_data: Uint8Array[] = [];
    arena_mmap: Mmap[] = [];
    arena_relocations: Relocations[] = [];

    // rustc: compiler/rustc_codegen_ssa/src/back/link.rs:932 alloc_mmap
    alloc_mmap(data: Mmap): Mmap {
      this.arena_mmap.push(data);
      return data;
    }

    // impl<Relocations> thorin::Session<Relocations> for ThorinSession<Relocations>
    // rustc: compiler/rustc_codegen_ssa/src/back/link.rs:938 alloc_data
    alloc_data(data: Uint8Array): Uint8Array {
      this.arena_data.push(data);
      return data;
    }

    // rustc: compiler/rustc_codegen_ssa/src/back/link.rs:942 alloc_relocation
    alloc_relocation(data: Relocations): Relocations {
      this.arena_relocations.push(data);
      return data;
    }

    // rustc: compiler/rustc_codegen_ssa/src/back/link.rs:946 read_input
    read_input(path: string): IoResult<Uint8Array> {
      const file = FsFile.open(path);
      if (file.$ === "Err") return file;
      const mmap = Mmap.map(file._0);
      if (mmap.$ === "Err") return mmap;
      return Ok(this.alloc_mmap(mmap._0).deref());
    }
  }

  const r = sess.time("run_thorin", (): Result<null, ThorinError> => {
    const thorin_sess = new ThorinSession<unknown>();
    const package_ = thorin.DwarfPackage_new(thorin_sess);
    let q: Result<null, ThorinError>;

    // Input objs contain .o/.dwo files from the current crate.
    switch (sess.opts.unstable_opts.split_dwarf_kind) {
      case "Single":
        for (const m of compiled_modules.modules) {
          if (m.object !== undefined) {
            if ((q = package_.add_input_object(m.object)).$ === "Err") return q;
          }
          if (m.global_asm_object !== undefined) {
            if ((q = package_.add_input_object(m.global_asm_object)).$ === "Err") return q;
          }
        }
        break;
      case "Split":
        for (const m of compiled_modules.modules) {
          if (m.dwarf_object === undefined) continue;
          if ((q = package_.add_input_object(m.dwarf_object)).$ === "Err") return q;
        }
        break;
    }

    // Input rlibs contain .o/.dwo files from dependencies.
    const input_rlibs: string[] = [];
    for (const csource of crate_info.used_crate_source.values()) {
      if (csource.rlib !== undefined) input_rlibs.push(csource.rlib);
    }
    // `.into_sorted_stable_ord()`: `PathBuf`'s `Ord` compares the components.
    input_rlibs.sort(path_cmp);

    for (const input_rlib of input_rlibs) {
      // debug!(?input_rlib);
      if ((q = package_.add_input_object(input_rlib)).$ === "Err") return q;
    }

    // Failing to read the referenced objects is expected for dependencies where the path in the
    // executable will have been cleaned by Cargo, but the referenced objects will be contained
    // within rlibs provided as inputs.
    //
    // If paths have been remapped, then .o/.dwo files from the current crate also won't be
    // found, but are provided explicitly above.
    //
    // Adding an executable is primarily done to make `thorin` check that all the referenced
    // dwarf objects are found in the end.
    if ((q = package_.add_executable(executable_out_filename, "Skip")).$ === "Err") return q;

    return thorin.finish_and_emit(package_, dwp_out_filename);
  });
  if (r.$ === "Err") {
    const e: ThorinErrorWrapper = { _0: r._0 };
    sess.dcx().emit_fatal({ into_diag: (dcx, level) => ThorinErrorWrapper_into_diag(e, dcx, level) });
  }
}

// #[derive(Diagnostic)] #[diag("{$inner}")] struct LinkerOutput { inner: String } (link.gen.ts)
/// Translating this is kind of useless. We don't pass translation flags to the linker, so we'd just
/// end up with inconsistent languages within the same diagnostic.

// rustc: compiler/rustc_codegen_ssa/src/back/link.rs:1032 is_msvc_link_exe
function is_msvc_link_exe(sess: Session): boolean {
  const [linker_path, flavor] = linker_and_flavor(sess);
  return (
    sess.target.options.is_like_msvc &&
    flavor === LinkerFlavor.Msvc("No") &&
    // Match exactly "link.exe"
    linker_path === "link.exe"
  );
}

// rustc: compiler/rustc_codegen_ssa/src/back/link.rs:1040 is_macos_linker
function is_macos_linker(sess: Session): boolean {
  const [, flavor] = linker_and_flavor(sess);
  return sess.target.options.is_like_darwin && flavor.$ === "Darwin";
}

// rustc: compiler/rustc_codegen_ssa/src/back/link.rs:1045 is_windows_gnu_ld
function is_windows_gnu_ld(sess: Session): boolean {
  const [, flavor] = linker_and_flavor(sess);
  return (
    sess.target.options.is_like_windows &&
    !sess.target.options.is_like_msvc &&
    flavor.$ === "Gnu" &&
    flavor._1 === "No" &&
    sess.target.options.cfg_abi.$ !== "Llvm"
  );
}

// rustc: compiler/rustc_codegen_ssa/src/back/link.rs:1053 is_windows_gnu_clang
function is_windows_gnu_clang(sess: Session): boolean {
  const [, flavor] = linker_and_flavor(sess);
  return (
    sess.target.options.is_like_windows &&
    !sess.target.options.is_like_msvc &&
    flavor.$ === "Gnu" &&
    flavor._0 === "Yes" &&
    flavor._1 === "No" &&
    sess.target.options.cfg_abi.$ === "Llvm"
  );
}

// rustc: compiler/rustc_codegen_ssa/src/back/link.rs:1061 report_linker_output
export function report_linker_output(sess: Session, levels: CodegenLintLevelSpecs, stdout: Uint8Array, stderr: Uint8Array): void {
  let escaped_stderr = escape_string(stderr);
  let escaped_stdout = escape_string(stdout);
  let linker_info = "";

  tracing.info(TARGET, () => `linker stderr:\n${escaped_stderr}`);
  tracing.info(TARGET, () => `linker stdout:\n${escaped_stdout}`);

  // rustc: compiler/rustc_codegen_ssa/src/back/link.rs:1074 for_each
  function for_each(bytes: Uint8Array, f: (line: string, output: MutRef<string>) => void): string {
    const output: MutRef<string> = { value: "" };
    const s = from_utf8(bytes);
    if (s.$ === "Ok") {
      const str = s._0;
      tracing.info(TARGET, () => `line: ${str}`);
      output.value = "";
      for (const line of str_lines(str)) {
        f(string_trim(line), output);
      }
    }
    return escape_string(encoder.encode(string_trim(output.value)));
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/link.rs:1086 has_lnk_code
  function has_lnk_code(line: string): boolean {
    // link.exe diagnostics are structured as `LINK : warning LNK####:` or
    // `LINK : fatal error LNK####:`. The code is always followed by a `:`
    // that is the second colon in the line, so matching that structure
    // instead of scanning for `LNK####` anywhere avoids false positives on
    // file names.
    const bytes = encoder.encode(line);
    let colons = 0;
    let code_colon: number | undefined;
    for (let i = 0; i < bytes.length; i++) {
      if (bytes[i] === 0x3a && colons++ === 1) {
        code_colon = i;
        break;
      }
    }
    if (code_colon === undefined) {
      return false;
    }
    if (code_colon < 7) {
      return false;
    }
    const code_ = code_colon - 7;
    const code = bytes.subarray(code_, code_colon);
    return code[0] === 0x4c && code[1] === 0x4e && code[2] === 0x4b && code.subarray(3).every((b) => b >= 0x30 && b <= 0x39);
  }

  if (is_msvc_link_exe(sess)) {
    tracing.info(TARGET, () => "inferred MSVC link.exe");

    escaped_stdout = for_each(stdout, (line, output) => {
      // Hide progress messages from link.exe that we don't care about.
      // These include localized variants of the English messages (e.g.
      // "Creating library ..."), which rustc cannot recognize by text
      // without the English language pack.
      // See https://github.com/rust-lang/rust/issues/159133
      // When incremental linking is enabled and an .ilk exists, but its
      // associated .exe is missing, link.exe prints the path of the
      // missing .exe followed by:
      const ilk_but_no_exe = "not found or not built by the last incremental link; performing full link";
      // LNK6004 is the one code-bearing line that is still informational.
      if (has_lnk_code(line) && !line.endsWith(ilk_but_no_exe)) {
        output.value += line;
        output.value += "\r\n";
      } else {
        linker_info += line;
        linker_info += "\r\n";
      }
    });
  } else if (is_macos_linker(sess)) {
    tracing.info(TARGET, () => "inferred macOS linker");

    // FIXME: Tracked by https://github.com/rust-lang/rust/issues/136113
    const deployment_mismatch = (line: string): boolean =>
      // ld64 (object files + dylibs) and ld_prime (object files only):
      (line.startsWith("ld: ") && line.includes("was built for newer") && line.includes("than being linked")) ||
      // ld_prime (Xcode 15+, dylibs only):
      (line.startsWith("ld: ") && line.includes("building for") && line.includes("but linking with") && line.includes("which was built for newer version")) ||
      // lld (ld64.lld / rust-lld):
      line.includes("which is newer than target minimum of");
    // FIXME: This is a real warning we would like to show, but it hits too many crates
    // to want to turn it on immediately.
    const search_path = (line: string): boolean => line.startsWith("ld: warning: search path '") && line.endsWith("' not found");
    escaped_stderr = for_each(stderr, (line, output) => {
      // This duplicate library warning is just not helpful at all.
      if (line.startsWith("ld: warning: ignoring duplicate libraries: ") || deployment_mismatch(line) || search_path(line)) {
        linker_info += line;
        linker_info += "\n";
      } else {
        output.value += line;
        output.value += "\n";
      }
    });
  } else if (is_windows_gnu_ld(sess)) {
    tracing.info(TARGET, () => "inferred Windows GNU LD");

    let saw_exclude_symbol = false;
    // See https://github.com/rust-lang/rust/issues/112368.
    // FIXME: maybe check that binutils is older than 2.40 before downgrading this warning?
    const exclude_symbols = (line: string): boolean => line.startsWith("Warning: .drectve `-exclude-symbols:") && line.endsWith("' unrecognized");
    escaped_stderr = for_each(stderr, (line, output) => {
      if (exclude_symbols(line)) {
        saw_exclude_symbol = true;
        linker_info += line;
        linker_info += "\n";
      } else if (saw_exclude_symbol && line === "Warning: corrupt .drectve at end of def file") {
        linker_info += line;
        linker_info += "\n";
      } else {
        output.value += line;
        output.value += "\n";
      }
    });
  } else if (is_windows_gnu_clang(sess)) {
    tracing.info(TARGET, () => "inferred Windows Clang (GNU ABI)");
    escaped_stderr = for_each(stderr, (line, output) => {
      if (line.includes("argument unused during compilation: '-nolibc'")) {
        linker_info += line;
        linker_info += "\n";
      } else {
        output.value += line;
        output.value += "\n";
      }
    });
  }

  const lint_msg = (msg: string): void => {
    emit_lint_base(sess, LINKER_MESSAGES, LevelSpec.from_StableLevelSpec(levels.linker_messages), undefined, LinkerOutput_diagnostic({ inner: msg }));
  };
  const lint_info = (msg: string): void => {
    emit_lint_base(sess, LINKER_INFO, LevelSpec.from_StableLevelSpec(levels.linker_info), undefined, LinkerOutput_diagnostic({ inner: msg }));
  };

  if (escaped_stderr !== "") {
    // We already print `warning:` at the start of the diagnostic. Remove it from the linker output if present.
    escaped_stderr = escaped_stderr.startsWith("warning: ") ? escaped_stderr.slice("warning: ".length) : escaped_stderr;
    // Windows GNU LD prints uppercase Warning
    escaped_stderr = (escaped_stderr.startsWith("Warning: ") ? escaped_stderr.slice("Warning: ".length) : escaped_stderr).replaceAll(": warning: ", ": ");
    lint_msg(`linker stderr: ${string_trim_end(escaped_stderr)}`);
  }
  if (escaped_stdout !== "") {
    lint_msg(`linker stdout: ${string_trim_end(escaped_stdout)}`);
  }
  if (linker_info !== "") {
    lint_info(linker_info);
  }
}

/// Create a dynamic library or executable.
///
/// This will invoke the system linker/cc to create the resulting file. This links to all upstream
/// files as well.
// rustc: compiler/rustc_codegen_ssa/src/back/link.rs:1232 link_natively
export function link_natively(
  sess: Session,
  archive_builder_builder: ArchiveBuilderBuilder,
  rmeta_link_cache: RmetaLinkCache,
  crate_type: CrateType,
  out_filename: string,
  compiled_modules: CompiledModules,
  crate_info: CrateInfo,
  metadata: EncodedMetadata,
  tmpdir: string,
  codegen_backend: string,
): void {
  tracing.info(TARGET, () => `preparing ${debug_CrateType(crate_type, PLAIN)} to ${debug_str(out_filename)}`);
  const [linker_path, flavor] = linker_and_flavor(sess);
  const self_contained_components = xlane.self_contained_components(sess, crate_type, linker_path);

  // On AIX, we ship all libraries as .a big_af archive
  // the expected format is lib<name>.a(libname.so) for the actual
  // dynamic library. So we link to a temporary .so file to be archived
  // at the final out_filename location
  const should_archive = crate_type !== "Executable" && sess.target.options.is_like_aix;
  const archive_member = should_archive ? path_with_extension(path_join(tmpdir, unwrap(path_file_name(out_filename))), "so") : undefined;
  const temp_filename = archive_member ?? out_filename;

  const [cmd, jobserver_tokens] = xlane.linker_with_args(
    linker_path,
    flavor,
    sess,
    archive_builder_builder,
    rmeta_link_cache,
    crate_type,
    tmpdir,
    temp_filename,
    compiled_modules,
    crate_info,
    metadata,
    self_contained_components,
    codegen_backend,
  );

  xlane.disable_localization(cmd);

  for (const [k, v] of sess.target.options.link_env) {
    cmd.env(k, v);
  }
  for (const k of sess.target.options.link_env_remove) {
    cmd.env_remove(k);
  }

  for (const print of sess.opts.prints) {
    if (print.kind === "LinkArgs") {
      const content = `${xlane.debug_Command(cmd)}\n`;
      OutFileName.overwrite(print.out, content, sess);
    }
  }

  // May have not found libraries in the right formats.
  sess.dcx().abort_if_errors();

  // Invoke the system linker
  tracing.info(TARGET, () => xlane.debug_Command(cmd));
  // PORT: `Regex::new(..)` (the `regex` crate is not vendored): a JS RegExp of the same ASCII pattern; `is_match` finds a
  // match anywhere, as `RegExp.test` without flags does.
  const unknown_arg_regex = /(unknown|unrecognized) (command line )?(option|argument)/;
  let prog: IoResult<Output>;
  for (;;) {
    prog = sess.time("run_linker", () => xlane.exec_linker(sess, cmd, out_filename, flavor, tmpdir));
    if (prog.$ !== "Ok") {
      break;
    }
    const output = prog._0;
    if (output.status.success()) {
      break;
    }
    const out = from_utf8_lossy(concat_bytes(output.stderr, output.stdout));

    // Check to see if the link failed with an error message that indicates it
    // doesn't recognize the -no-pie option. If so, re-perform the link step
    // without it. This is safe because if the linker doesn't support -no-pie
    // then it should not default to linking executables as pie. Different
    // versions of gcc seem to use different quotes in the error message so
    // don't check for them.
    if (flavor.$ === "Gnu" && flavor._0 === "Yes" && unknown_arg_regex.test(out) && out.includes("-no-pie") && cmd.get_args().some((e) => e === "-no-pie")) {
      tracing.info(TARGET, () => `linker output: ${debug_str(out)}`);
      tracing.warn(TARGET, () => "Linker does not support -no-pie command line option. Retrying without.");
      for (const arg of cmd.take_args()) {
        if (arg !== "-no-pie") {
          cmd.arg(arg);
        }
      }
      tracing.info(TARGET, () => xlane.debug_Command(cmd));
      continue;
    }

    // Check if linking failed with an error message that indicates the driver didn't recognize
    // the `-fuse-ld=lld` option. If so, re-perform the link step without it. This avoids having
    // to spawn multiple instances on the happy path to do version checking, and ensures things
    // keep working on the tier 1 baseline of GLIBC 2.17+. That is generally understood as GCCs
    // circa RHEL/CentOS 7, 4.5 or so, whereas lld support was added in GCC 9.
    if (
      flavor.$ === "Gnu" &&
      flavor._0 === "Yes" &&
      flavor._1 === "Yes" &&
      unknown_arg_regex.test(out) &&
      out.includes("-fuse-ld=lld") &&
      cmd.get_args().some((e) => e === "-fuse-ld=lld")
    ) {
      tracing.info(TARGET, () => `linker output: ${debug_str(out)}`);
      tracing.info(TARGET, () => "The linker driver does not support `-fuse-ld=lld`. Retrying without it.");
      for (const arg of cmd.take_args()) {
        if (arg !== "-fuse-ld=lld") {
          cmd.arg(arg);
        }
      }
      tracing.info(TARGET, () => xlane.debug_Command(cmd));
      continue;
    }

    // Detect '-static-pie' used with an older version of gcc or clang not supporting it.
    // Fallback from '-static-pie' to '-static' in that case.
    if (
      flavor.$ === "Gnu" &&
      flavor._0 === "Yes" &&
      unknown_arg_regex.test(out) &&
      (out.includes("-static-pie") || out.includes("--no-dynamic-linker")) &&
      cmd.get_args().some((e) => e === "-static-pie")
    ) {
      tracing.info(TARGET, () => `linker output: ${debug_str(out)}`);
      tracing.warn(TARGET, () => "Linker does not support -static-pie command line option. Retrying with -static instead.");
      // Mirror `add_(pre,post)_link_objects` to replace CRT objects.
      const self_contained_crt_objects = LinkSelfContainedComponents.is_crt_objects_enabled(self_contained_components);
      const opts = sess.target.options;
      const pre_objects = self_contained_crt_objects ? opts.pre_link_objects_self_contained : opts.pre_link_objects;
      const post_objects = self_contained_crt_objects ? opts.post_link_objects_self_contained : opts.post_link_objects;
      const get_objects = (objects: CrtObjects, kind: LinkOutputKind): string[] =>
        (objects.get(kind) ?? []).map((obj) => get_object_file_path(sess, obj, self_contained_crt_objects));
      const pre_objects_static_pie = get_objects(pre_objects, "StaticPicExe");
      const post_objects_static_pie = get_objects(post_objects, "StaticPicExe");
      let pre_objects_static = get_objects(pre_objects, "StaticNoPicExe");
      let post_objects_static = get_objects(post_objects, "StaticNoPicExe");
      // Assume that we know insertion positions for the replacement arguments from replaced
      // arguments, which is true for all supported targets.
      assert(
        pre_objects_static.length === 0 || pre_objects_static_pie.length !== 0,
        "assertion failed: pre_objects_static.is_empty() || !pre_objects_static_pie.is_empty()",
      );
      assert(
        post_objects_static.length === 0 || post_objects_static_pie.length !== 0,
        "assertion failed: post_objects_static.is_empty() || !post_objects_static_pie.is_empty()",
      );
      for (const arg of cmd.take_args()) {
        if (arg === "-static-pie") {
          // Replace the output kind.
          cmd.arg("-static");
        } else if (pre_objects_static_pie.includes(arg)) {
          // Replace the pre-link objects (replace the first and remove the rest).
          cmd.args(pre_objects_static);
          pre_objects_static = [];
        } else if (post_objects_static_pie.includes(arg)) {
          // Replace the post-link objects (replace the first and remove the rest).
          cmd.args(post_objects_static);
          post_objects_static = [];
        } else {
          cmd.arg(arg);
        }
      }
      tracing.info(TARGET, () => xlane.debug_Command(cmd));
      continue;
    }

    break;
  }

  // Finished running linker, release the tokens.
  // drop(jobserver_tokens);
  for (const token of jobserver_tokens) token.drop();

  switch (prog.$) {
    case "Ok": {
      const prog_ = prog._0;
      if (!prog_.status.success()) {
        const output = concat_bytes(prog_.stderr, prog_.stdout);
        const escaped_output = escape_linker_output(output, flavor);
        const err: LinkingFailed = {
          linker_path: linker_path,
          exit_status: prog_.status,
          command: cmd,
          escaped_output,
          verbose: sess.opts.verbose,
          sysroot_dir: sess.opts.sysroot.path(),
        };
        sess.dcx().emit_err({ into_diag: (dcx, level) => LinkingFailed_into_diag(err, dcx, level) });
        // If MSVC's `link.exe` was expected but the return code
        // is not a Microsoft LNK error then suggest a way to fix or
        // install the Visual Studio build tools.
        const code = prog_.status.code();
        if (code !== undefined) {
          // All Microsoft `link.exe` linking ror codes are
          // four digit numbers in the range 1000 to 9999 inclusive
          if (is_msvc_link_exe(sess) && (code < 1000 || code > 9999)) {
            const is_vs_installed: boolean = unported("find_msvc_tools::find_vs_version (vendor crate not ported; MSVC link.exe)");
            const has_linker: boolean = unported("find_msvc_tools::find_tool (vendor crate not ported; MSVC link.exe)");

            sess.dcx().emit_note(LinkExeUnexpectedError_diagnostic({}));

            // STATUS_STACK_BUFFER_OVERRUN is also used for fast abnormal program termination, e.g. abort().
            // Emit a special diagnostic to let people know that this most likely doesn't indicate a stack buffer overrun.
            const STATUS_STACK_BUFFER_OVERRUN = 0xc0000409 | 0;
            if (code === STATUS_STACK_BUFFER_OVERRUN) {
              sess.dcx().emit_note(LinkExeStatusStackBufferOverrun_diagnostic({}));
            }

            if (is_vs_installed && has_linker) {
              // the linker is broken
              sess.dcx().emit_note(RepairVSBuildTools_diagnostic({}));
              sess.dcx().emit_note(MissingCppBuildToolComponent_diagnostic({}));
            } else if (is_vs_installed) {
              // the linker is not installed
              sess.dcx().emit_note(SelectCppBuildToolWorkload_diagnostic({}));
            } else {
              // visual studio is not installed
              sess.dcx().emit_note(VisualStudioNotInstalled_diagnostic({}));
            }
          }
        }

        sess.dcx().abort_if_errors();
      }

      tracing.info(TARGET, () => `reporting linker output: flavor=${debug_LinkerFlavor(flavor, PLAIN)}`);
      report_linker_output(sess, crate_info.lint_level_specs, prog_.stdout, prog_.stderr);
      break;
    }
    case "Err": {
      const e = prog._0;
      const linker_not_found = IoError_kind(e) === "NotFound";

      let err: ErrorGuaranteed;
      if (linker_not_found) {
        err = sess.dcx().emit_err(LinkerNotFound_diagnostic({ linker_path, error: e }));
      } else {
        err = sess.dcx().emit_err(
          UnableToExeLinker_diagnostic({
            linker_path,
            error: e,
            command_formatted: xlane.debug_Command(cmd),
          }),
        );
      }

      if (sess.target.options.is_like_msvc && linker_not_found) {
        sess.dcx().emit_note(MsvcMissingLinker_diagnostic({}));
        sess.dcx().emit_note(CheckInstalledVisualStudio_diagnostic({}));
        sess.dcx().emit_note(InsufficientVSCodeProduct_diagnostic({}));
      }
      err.raise_fatal();
    }
  }

  const split_debuginfo = sess.split_debuginfo();
  if (split_debuginfo === "Off" || split_debuginfo === "Unpacked") {
    // If split debug information is disabled or located in individual files
    // there's nothing to do here.
  } else if (split_debuginfo === "Packed" && sess.opts.debuginfo === "None") {
    // If packed split-debuginfo is requested, but the final compilation
    // doesn't actually have any debug information, then we skip this step.
  } else if (split_debuginfo === "Packed" && sess.target.options.is_like_darwin) {
    // On macOS the external `dsymutil` tool is used to create the packed
    // debug information. Note that this will read debug information from
    // the objects on the filesystem which we'll clean up later.
    const prog = xlane.Command_new("dsymutil").arg(out_filename).output();
    switch (prog.$) {
      case "Ok": {
        if (!prog._0.status.success()) {
          const output = concat_bytes(prog._0.stderr, prog._0.stdout);
          // sess.dcx().emit_warn(diagnostics::ProcessingDymutilFailed { status: prog.status, output: escape_string(&output) });
          // PORT: `ProcessingDymutilFailed` is skipped by the codegen set (its `ExitStatus` field).
          unported(`rustc_codegen_ssa::diagnostics::ProcessingDymutilFailed (dsymutil failed: ${escape_string(output)})`);
        }
        break;
      }
      case "Err":
        sess.dcx().emit_fatal(UnableToRunDsymutil_diagnostic({ error: prog._0 }));
    }
  } else if (split_debuginfo === "Packed" && sess.target.options.is_like_windows) {
    // On MSVC packed debug information is produced by the linker itself so
    // there's no need to do anything else here.
  } else {
    // ... and otherwise we're processing a `*.dwp` packed dwarf file.
    //
    // We cannot rely on the .o paths in the executable because they may have been
    // remapped by --remap-path-prefix and therefore invalid, so we need to provide
    // the .o/.dwo paths explicitly.
    link_dwarf_object(sess, compiled_modules, crate_info, out_filename);
  }

  const strip = sess.opts.cg.strip;

  if (sess.target.options.is_like_darwin) {
    const stripcmd = "rust-objcopy";
    if (strip === "Debuginfo") {
      strip_with_external_utility(sess, stripcmd, out_filename, ["--strip-debug"]);
    } else if (strip === "Symbols" && (crate_type === "Dylib" || crate_type === "Cdylib" || crate_type === "ProcMacro" || crate_type === "Sdylib")) {
      // Per the manpage, --discard-all is the maximum safe strip level for dynamic libraries. (#93988)
      strip_with_external_utility(sess, stripcmd, out_filename, ["--discard-all"]);
    } else if (strip === "Symbols") {
      strip_with_external_utility(sess, stripcmd, out_filename, ["--strip-all"]);
    } else {
      // (Strip::None, _) => {}
    }
  }

  if (sess.target.options.is_like_solaris) {
    // Many illumos systems will have both the native 'strip' utility and
    // the GNU one. Use the native version explicitly and do not rely on
    // what's in the path.
    //
    // If cross-compiling and there is not a native version, then use
    // `llvm-strip` and hope.
    const stripcmd = !sess.host.options.is_like_solaris ? "rust-objcopy" : "/usr/bin/strip";
    switch (strip) {
      // Always preserve the symbol table (-x).
      case "Debuginfo":
        strip_with_external_utility(sess, stripcmd, out_filename, ["-x"]);
        break;
      // Strip::Symbols is handled via the --strip-all linker option.
      case "Symbols":
        break;
      case "None":
        break;
    }
  }

  if (sess.target.options.is_like_aix) {
    // `llvm-strip` doesn't work for AIX - their strip must be used.
    if (!sess.host.options.is_like_aix) {
      sess.dcx().emit_warn(AixStripNotUsed_diagnostic({}));
    }
    const stripcmd = "/usr/bin/strip";
    switch (strip) {
      case "Debuginfo":
        // FIXME: AIX's strip utility only offers option to strip line number information.
        strip_with_external_utility(sess, stripcmd, temp_filename, ["-X32_64", "-l"]);
        break;
      case "Symbols":
        // Must be noted this option might remove symbol __aix_rust_metadata and thus removes .info section which contains metadata.
        strip_with_external_utility(sess, stripcmd, temp_filename, ["-X32_64", "-r"]);
        break;
      case "None":
        break;
    }
  }

  if (should_archive) {
    const ab = archive_builder_builder.new_archive_builder(sess);
    ab.add_file(temp_filename, "Other");
    xlane.ArchiveBuilder_build(ab, out_filename, undefined);
  }
}

// rustc: compiler/rustc_codegen_ssa/src/back/link.rs:1602 strip_with_external_utility
function strip_with_external_utility(sess: Session, util: string, out_filename: string, options: readonly string[]): void {
  const cmd = xlane.Command_new(util);
  cmd.args(options);

  const new_path = xlane.get_tools_search_paths(sess, false);
  const path = var_os("PATH");
  if (path !== undefined) {
    // PORT: the paths are UTF-8 strings here (`to_string_lossy`).
    new_path.push(...split_paths(path).map(to_string_lossy));
  }
  cmd.env("PATH", join_paths(new_path));

  const prog = cmd.arg(out_filename).output();
  switch (prog.$) {
    case "Ok": {
      if (!prog._0.status.success()) {
        const output = concat_bytes(prog._0.stderr, prog._0.stdout);
        // sess.dcx().emit_warn(diagnostics::StrippingDebugInfoFailed { util, status: prog.status, output: escape_string(&output) });
        // PORT: `StrippingDebugInfoFailed` is skipped by the codegen set (its `ExitStatus` field).
        unported(`rustc_codegen_ssa::diagnostics::StrippingDebugInfoFailed (${util} failed: ${escape_string(output)})`);
      }
      break;
    }
    case "Err":
      sess.dcx().emit_fatal(UnableToRun_diagnostic({ util, error: prog._0 }));
  }
}

// rustc: compiler/rustc_codegen_ssa/src/back/link.rs:1629 escape_string
export function escape_string(s: Uint8Array): string {
  const r = from_utf8(s);
  switch (r.$) {
    case "Ok":
      return r._0;
    case "Err":
      return `Non-UTF-8 output: ${escape_ascii(s)}`;
  }
}

// #[cfg(not(windows))]
// rustc: compiler/rustc_codegen_ssa/src/back/link.rs:1637 escape_linker_output
function escape_linker_output_not_windows(s: Uint8Array, _flavour: LinkerFlavor): string {
  return escape_string(s);
}

/// If the output of the msvc linker is not UTF-8 and the host is Windows,
/// then try to convert the string from the OEM encoding.
// #[cfg(windows)]
// rustc: compiler/rustc_codegen_ssa/src/back/link.rs:1644 escape_linker_output
function escape_linker_output_windows(s: Uint8Array, flavour: LinkerFlavor): string {
  // This only applies to the actual MSVC linker.
  if (flavour !== LinkerFlavor.Msvc("No")) {
    return escape_string(s);
  }
  const r = from_utf8(s);
  if (r.$ === "Ok") {
    return r._0;
  }
  const converted = win.locale_byte_str_to_string(s, win.oem_code_page());
  if (converted !== undefined) {
    return converted;
  }
  // The string is not UTF-8 and isn't valid for the OEM code page
  return `Non-UTF-8 output: ${escape_ascii(s)}`;
}

/** `escape_linker_output` as cfg'd for the host rustc runs on. */
const escape_linker_output = process.platform === "win32" ? escape_linker_output_windows : escape_linker_output_not_windows;

/// Wrappers around the Windows API.
// #[cfg(windows)] mod win
// PORT: the Windows API (`windows` crate) is not bound; Windows hosts are unchecked (AGENTS.md section 5).
const win = {
  /// Get the Windows system OEM code page. This is most notably the code page
  /// used for link.exe's output.
  // rustc: compiler/rustc_codegen_ssa/src/back/link.rs:1669 oem_code_page
  oem_code_page(): number {
    return unported("rustc_codegen_ssa::back::link::win::oem_code_page (GetLocaleInfoEx; Windows host)");
  },
  /// Try to convert a multi-byte string to a UTF-8 string using the given code page
  /// The string does not need to be null terminated.
  ///
  /// This is implemented as a wrapper around `MultiByteToWideChar`.
  /// See <https://learn.microsoft.com/en-us/windows/win32/api/stringapiset/nf-stringapiset-multibytetowidechar>
  ///
  /// It will fail if the multi-byte string is longer than `i32::MAX` or if it contains
  /// any invalid bytes for the expected encoding.
  // rustc: compiler/rustc_codegen_ssa/src/back/link.rs:1692 locale_byte_str_to_string
  locale_byte_str_to_string(_s: Uint8Array, _code_page: number): string | undefined {
    return unported("rustc_codegen_ssa::back::link::win::locale_byte_str_to_string (MultiByteToWideChar; Windows host)");
  },
};

// rustc: compiler/rustc_codegen_ssa/src/back/link.rs:1713 add_sanitizer_libraries
export function add_sanitizer_libraries(sess: Session, flavor: LinkerFlavor, crate_type: CrateType, linker: Linker): void {
  if (sess.target.options.is_like_android) {
    // Sanitizer runtime libraries are provided dynamically on Android
    // targets.
    return;
  }

  if (sess.opts.unstable_opts.external_clangrt) {
    // Linking against in-tree sanitizer runtimes is disabled via
    // `-Z external-clangrt`
    return;
  }

  if (crate_type === "Rlib" || crate_type === "StaticLib") {
    return;
  }

  // On macOS and Windows using MSVC the runtimes are distributed as dylibs
  // which should be linked to both executables and dynamic libraries.
  // Everywhere else the runtimes are currently distributed as static
  // libraries which should be linked to executables only.
  if (
    (crate_type === "Dylib" || crate_type === "Cdylib" || crate_type === "ProcMacro" || crate_type === "Sdylib") &&
    !(sess.target.options.is_like_darwin || sess.target.options.is_like_msvc)
  ) {
    return;
  }

  const sanitizer = sess.sanitizers();
  const contains = (flag: SanitizerSet): boolean => (sanitizer & flag) === flag;
  if (contains(SanitizerSet.ADDRESS)) {
    link_sanitizer_runtime(sess, flavor, linker, "asan");
  }
  if (contains(SanitizerSet.DATAFLOW)) {
    link_sanitizer_runtime(sess, flavor, linker, "dfsan");
  }
  if (contains(SanitizerSet.LEAK) && !contains(SanitizerSet.ADDRESS) && !contains(SanitizerSet.HWADDRESS)) {
    link_sanitizer_runtime(sess, flavor, linker, "lsan");
  }
  if (contains(SanitizerSet.MEMORY)) {
    link_sanitizer_runtime(sess, flavor, linker, "msan");
  }
  if (contains(SanitizerSet.THREAD)) {
    link_sanitizer_runtime(sess, flavor, linker, "tsan");
  }
  if (contains(SanitizerSet.HWADDRESS)) {
    link_sanitizer_runtime(sess, flavor, linker, "hwasan");
  }
  if (contains(SanitizerSet.SAFESTACK)) {
    link_sanitizer_runtime(sess, flavor, linker, "safestack");
  }
  if (contains(SanitizerSet.REALTIME)) {
    link_sanitizer_runtime(sess, flavor, linker, "rtsan");
  }
  if (contains(SanitizerSet.CFI) && ((sess.opts.unstable_opts.sanitizer_cfi_diag ?? false) || (sess.opts.unstable_opts.sanitizer_cfi_recover ?? false))) {
    if (sess.is_sanitizer_cfi_minimal_runtime_enabled()) {
      link_sanitizer_runtime(sess, flavor, linker, "ubsan_minimal");
    } else {
      link_sanitizer_runtime(sess, flavor, linker, "ubsan");
    }
  }
}

// rustc: compiler/rustc_codegen_ssa/src/back/link.rs:1787 link_sanitizer_runtime
function link_sanitizer_runtime(sess: Session, flavor: LinkerFlavor, linker: Linker, name: string): void {
  // rustc: compiler/rustc_codegen_ssa/src/back/link.rs:1793 find_sanitizer_runtime
  function find_sanitizer_runtime(sess: Session, filename: string): string {
    const path = path_join(sess.target_tlib_path.dir, filename);
    if (path_exists(path)) {
      return sess.target_tlib_path.dir;
    } else {
      return make_target_lib_path(sess.opts.sysroot.default_, TargetTuple.tuple(sess.opts.target_triple));
    }
  }

  const channel = CFG_RELEASE_CHANNEL !== undefined ? `-${CFG_RELEASE_CHANNEL}` : "";

  if (sess.target.options.is_like_darwin) {
    // On Apple platforms, the sanitizer is always built as a dylib, and
    // LLVM will link to `@rpath/*.dylib`, so we need to specify an
    // rpath to the library as well (the rpath should be absolute, see
    // PR #41352 for details).
    const filename = `rustc${channel}_rt.${name}`;
    const path = find_sanitizer_runtime(sess, filename);
    const rpath = path;
    xlane.Linker_link_args(linker, ["-rpath", rpath]);
    linker.link_dylib_by_name(filename, false, true);
  } else if (sess.target.options.is_like_msvc && flavor === LinkerFlavor.Msvc("No") && name === "asan") {
    // MSVC provides the `/INFERASANLIBS` argument to automatically find the
    // compatible ASAN library.
    xlane.Linker_link_arg(linker, "/INFERASANLIBS");
  } else {
    const filename = `librustc${channel}_rt.${name}.a`;
    const path = path_join(find_sanitizer_runtime(sess, filename), filename);
    linker.link_staticlib_by_path(path, true);
  }
}

/// Returns a boolean indicating whether the specified crate should be ignored
/// during LTO.
///
/// Crates ignored during LTO are not lumped together in the "massive object
/// file" that we create and are linked in their normal rlib states. See
/// comments below for what crates do not participate in LTO.
///
/// It's unusual for a crate to not participate in LTO. Typically only
/// compiler-specific and unstable crates have a reason to not participate in
/// LTO.
// rustc: compiler/rustc_codegen_ssa/src/back/link.rs:1839 ignored_for_lto
export function ignored_for_lto(sess: Session, info: CrateInfo, cnum: CrateNum): boolean {
  // If our target enables builtin function lowering in LLVM then the
  // crates providing these functions don't participate in LTO (e.g.
  // no_builtins or compiler builtins crates).
  return !sess.target.options.no_builtins && (info.compiler_builtins === cnum || info.is_no_builtins.has(cnum));
}

/// This functions tries to determine the appropriate linker (and corresponding LinkerFlavor) to use
// rustc: compiler/rustc_codegen_ssa/src/back/link.rs:1848 linker_and_flavor
export function linker_and_flavor(sess: Session): [string, LinkerFlavor] {
  // rustc: compiler/rustc_codegen_ssa/src/back/link.rs:1849 infer_from
  function infer_from(sess: Session, linker: string | undefined, flavor: LinkerFlavor | undefined, features: LinkerFeaturesCli): [string, LinkerFlavor] | undefined {
    const flavor_ = flavor === undefined ? undefined : adjust_flavor_to_features(flavor, features);
    if (linker !== undefined && flavor_ !== undefined) {
      return [linker, flavor_];
    } else if (linker === undefined && flavor_ !== undefined) {
      // only the linker flavor is known; use the default linker for the selected flavor
      const f = flavor_;
      let default_linker: string;
      if ((f.$ === "Gnu" && f._0 === "Yes") || (f.$ === "Darwin" && f._0 === "Yes") || (f.$ === "WasmLld" && f._0 === "Yes") || (f.$ === "Unix" && f._0 === "Yes")) {
        if (CFG_SOLARIS_OR_ILLUMOS) {
          // On historical Solaris systems, "cc" may have
          // been Sun Studio, which is not flag-compatible
          // with "gcc". This history casts a long shadow,
          // and many modern illumos distributions today
          // ship GCC as "gcc" without also making it
          // available as "cc".
          default_linker = "gcc";
        } else {
          default_linker = "cc";
        }
      } else if ((f.$ === "Gnu" && f._1 === "Yes") || (f.$ === "Darwin" && f._1 === "Yes") || f.$ === "WasmLld" || (f.$ === "Msvc" && f._0 === "Yes")) {
        default_linker = "lld";
      } else if (f.$ === "Gnu" || f.$ === "Darwin" || f.$ === "Unix") {
        default_linker = "ld";
      } else if (f.$ === "Msvc") {
        default_linker = "link.exe";
      } else if (f.$ === "EmCc") {
        if (CFG_WINDOWS) {
          default_linker = "emcc.bat";
        } else {
          default_linker = "emcc";
        }
      } else if (f.$ === "Bpf") {
        default_linker = "bpf-linker";
      } else {
        // LinkerFlavor::Llbc
        default_linker = "llvm-bitcode-linker";
      }
      return [default_linker, flavor_];
    } else if (linker !== undefined && flavor_ === undefined) {
      // `.file_stem().and_then(|stem| stem.to_str())`: paths are strings here.
      const stem = path_file_stem(linker);
      if (stem === undefined) {
        return sess.dcx().emit_fatal(LinkerFileStem_diagnostic({}));
      }
      let flavor = LinkerFlavor.with_linker_hints(sess.target.options.linker_flavor, stem);
      flavor = adjust_flavor_to_features(flavor, features);
      return [linker, flavor];
    } else {
      return undefined;
    }
  }

  // While linker flavors and linker features are isomorphic (and thus targets don't need to
  // define features separately), we use the flavor as the root piece of data and have the
  // linker-features CLI flag influence *that*, so that downstream code does not have to check for
  // both yet.
  // rustc: compiler/rustc_codegen_ssa/src/back/link.rs:1913 adjust_flavor_to_features
  function adjust_flavor_to_features(flavor: LinkerFlavor, features: LinkerFeaturesCli): LinkerFlavor {
    // Note: a linker feature cannot be both enabled and disabled on the CLI.
    if (LinkerFeatures.contains(features.enabled, LinkerFeatures.LLD)) {
      return LinkerFlavor.with_lld_enabled(flavor);
    } else if (LinkerFeatures.contains(features.disabled, LinkerFeatures.LLD)) {
      return LinkerFlavor.with_lld_disabled(flavor);
    } else {
      return flavor;
    }
  }

  const features = sess.opts.cg.linker_features;

  // linker and linker flavor specified via command line have precedence over what the target
  // specification specifies
  let linker_flavor: LinkerFlavor | undefined;
  const cli_flavor = sess.opts.cg.linker_flavor;
  if (cli_flavor !== undefined && cli_flavor.$ === "Llbc") {
    // The linker flavors that are non-target specific can be directly translated to LinkerFlavor
    linker_flavor = LinkerFlavor.Llbc;
  } else {
    // The linker flavors that corresponds to targets needs logic that keeps the base LinkerFlavor
    linker_flavor = cli_flavor === undefined ? undefined : LinkerFlavor.with_cli_hints(sess.target.options.linker_flavor, cli_flavor);
  }
  const ret = infer_from(sess, sess.opts.cg.linker, linker_flavor, features);
  if (ret !== undefined) {
    return ret;
  }

  const ret2 = infer_from(sess, sess.target.options.linker ?? undefined, sess.target.options.linker_flavor, features);
  if (ret2 !== undefined) {
    return ret2;
  }

  return bug("Not enough information provided to determine how to invoke the linker");
}

/// Returns a pair of boolean indicating whether we should preserve the object and
/// dwarf object files on the filesystem for their debug information. This is often
/// useful with split-dwarf like schemes.
// rustc: compiler/rustc_codegen_ssa/src/back/link.rs:1958 preserve_objects_for_their_debuginfo
export function preserve_objects_for_their_debuginfo(sess: Session): [boolean, boolean] {
  if (sess.opts.debuginfo === "None") {
    return [false, false];
  }

  const split_debuginfo = sess.split_debuginfo();
  // If there is no split debuginfo then do not preserve objects.
  if (split_debuginfo === "Off") return [false, false];
  // If there is packed split debuginfo, then the debuginfo in the objects
  // has been packaged and the objects can be deleted.
  if (split_debuginfo === "Packed") return [false, false];
  // If there is unpacked split debuginfo and the current target can not use
  // split dwarf, then keep objects.
  if (split_debuginfo === "Unpacked" && !sess.target_can_use_split_dwarf()) return [true, false];
  // If there is unpacked split debuginfo and the target can use split dwarf, then
  // keep the object containing that debuginfo (whether that is an object file or
  // dwarf object file depends on the split dwarf kind).
  if (sess.opts.unstable_opts.split_dwarf_kind === "Single") return [true, false];
  return [false, true];
}

// #[derive(PartialEq)]
export type RlibFlavor = "Normal" | "StaticlibBase";

// rustc: compiler/rustc_codegen_ssa/src/back/link.rs:1987 print_native_static_libs
export function print_native_static_libs(sess: Session, out: OutFileName, all_native_libs: readonly NativeLib[], all_rust_dylibs: readonly string[]): void {
  const lib_args: string[] = [];
  for (const lib of all_native_libs) {
    if (!xlane.relevant_lib(sess, lib)) continue;
    const name = Symbol.as_str(lib.name);
    let arg: string | undefined;
    const kind = lib.kind;
    if ((kind.$ === "Static" && kind.bundle === false) || kind.$ === "Dylib" || kind.$ === "Unspecified") {
      const verbatim = lib.verbatim;
      if (sess.target.options.is_like_msvc) {
        const [prefix, suffix] = sess.staticlib_components(verbatim);
        arg = `${prefix}${name}${suffix}`;
      } else if (LinkerFlavor.is_gnu(sess.target.options.linker_flavor)) {
        arg = `-l${verbatim ? ":" : ""}${name}`;
      } else {
        arg = `-l${name}`;
      }
    } else if (kind.$ === "Framework") {
      // ld-only syntax, since there are no frameworks in MSVC
      arg = `-framework ${name}`;
    } else {
      // These are included, no need to print them
      // NativeLibKind::Static { bundle: None | Some(true), .. } | LinkArg | WasmImportModule | RawDylib { .. }
      arg = undefined;
    }
    if (arg === undefined) continue;
    // deduplication of consecutive repeated libraries, see rust-lang/rust#113209
    if (lib_args.length > 0 && lib_args[lib_args.length - 1] === arg) continue;
    lib_args.push(arg);
  }
  for (const path of all_rust_dylibs) {
    // FIXME deduplicate with add_dynamic_crate

    // Just need to tell the linker about where the library lives and
    // what its name is
    const parent = path_parent(path);
    if (parent !== undefined) {
      const dir = fix_windows_verbatim_for_gcc(parent);
      if (sess.target.options.is_like_msvc) {
        let arg = "/LIBPATH:";
        arg += dir;
        lib_args.push(arg);
      } else {
        lib_args.push("-L");
        lib_args.push(dir);
      }
    }
    const stem = unwrap(path_file_stem(path));
    // Convert library file-stem into a cc -l argument.
    let lib: string;
    if (stem.startsWith("lib") && !sess.target.options.is_like_windows) {
      lib = stem.slice("lib".length);
    } else {
      lib = stem;
    }
    const path_ = parent ?? "";
    if (sess.target.options.is_like_msvc) {
      // When producing a dll, the MSVC linker may not actually emit a
      // `foo.lib` file if the dll doesn't actually export any symbols, so we
      // check to see if the file is there and just omit linking to it if it's
      // not present.
      const name = `${lib}.dll.lib`;
      if (path_exists(path_join(path_, name))) {
        lib_args.push(name);
      }
    } else {
      lib_args.push(`-l${lib}`);
    }
  }

  switch (out.$) {
    case "Real": {
      const path = out._0;
      OutFileName.overwrite(out, lib_args.join(" "), sess);
      sess.dcx().emit_note(StaticLibraryNativeArtifactsToFile_diagnostic({ path }));
      break;
    }
    case "Stdout": {
      sess.dcx().emit_note(StaticLibraryNativeArtifacts_diagnostic({}));
      // Prefix for greppability
      // Note: This must not be translated as tools are allowed to depend on this exact string.
      sess.dcx().note(`native-static-libs: ${lib_args.join(" ")}`);
      break;
    }
  }
}

// rustc: compiler/rustc_codegen_ssa/src/back/link.rs:2081 get_object_file_path
function get_object_file_path(sess: Session, name: string, self_contained: boolean): string {
  const file_path = path_join(sess.target_tlib_path.dir, name);
  if (path_exists(file_path)) {
    return file_path;
  }
  // Special directory with objects used only in self-contained linkage mode
  if (self_contained) {
    const file_path = path_join(path_join(sess.target_tlib_path.dir, "self-contained"), name);
    if (path_exists(file_path)) {
      return file_path;
    }
  }

  // Note: this is O(n^2), it could be expensive-ish if we lookup many object files for many
  // search paths
  for (const search_path of sess.target_filesearch().search_paths("Native")) {
    const file_path = path_join(search_path.dir, name);
    if (path_exists(file_path)) {
      return file_path;
    }
  }
  return name;
}

// rustc: compiler/rustc_codegen_ssa/src/back/link.rs:2105 exec_linker
export function exec_linker(sess: Session, cmd: Command, out_filename: string, flavor: LinkerFlavor, tmpdir: string): IoResult<Output> {
  // When attempting to spawn the linker we run a risk of blowing out the
  // size limits for spawning a new process with respect to the arguments
  // we pass on the command line.
  //
  // Here we attempt to handle errors from the OS saying "your list of
  // arguments is too big" by reinvoking the linker again with an `@`-file
  // that contains all the arguments (aka 'response' files).
  // The theory is that this is then accepted on all linkers and the linker
  // will read all its options out of there instead of looking at the command line.
  if (!cmd.very_likely_to_exceed_some_spawn_limit()) {
    // match cmd.command().stdout(Stdio::piped()).stderr(Stdio::piped()).spawn() { Ok(child) => child.wait_with_output() .. }
    // PORT: `spawn` + `wait_with_output` with piped stdout and stderr is `ProcessCommand::output` (`Bun.spawnSync`, plan-m7
    // D15): a spawn error is the same `io::Error`. The child's stdin is null there, where `spawn` would inherit rustc's; a
    // linker reads no stdin.
    const output = cmd.command().output();
    if (output.$ === "Ok") {
      const r = flush_linked_file(output, out_filename);
      if (r.$ === "Err") return r;
      return output;
    }
    const e = output._0;
    if (command_line_too_big(e)) {
      tracing.info(TARGET, () => `command line to linker was too big: ${display_IoError(e)}`);
    } else {
      return Err(e);
    }
  }

  tracing.info(TARGET, () => "falling back to passing arguments to linker via an @-file");
  const cmd2 = cmd.clone();
  let args = "";
  for (const arg of cmd2.take_args()) {
    args += new Escape(
      // arg: arg.to_str().unwrap(),
      arg,
      // Windows-style escaping for @-files is used by
      // - all linkers targeting MSVC-like targets, including LLD
      // - all LLD flavors running on Windows hosts
      // С/С++ compilers use Posix-style escaping (except clang-cl, which we do not use).
      sess.target.options.is_like_msvc || (CFG_WINDOWS && LinkerFlavor.uses_lld(flavor) && !LinkerFlavor.uses_cc(flavor)),
    ).fmt();
    args += "\n";
  }
  const file = path_join(tmpdir, "linker-arguments");
  let bytes: Uint8Array;
  if (sess.target.options.is_like_msvc) {
    const out: number[] = [];
    // start the stream with a UTF-16 BOM
    const units = [0xfeff];
    for (let i = 0; i < args.length; i++) units.push(args.charCodeAt(i)); // `args.encode_utf16()`
    for (const c of units) {
      // encode in little endian
      out.push(c & 0xff);
      out.push((c >> 8) & 0xff);
    }
    bytes = new Uint8Array(out);
  } else {
    bytes = encoder.encode(args);
  }
  const w = fs_write(file, bytes);
  if (w.$ === "Err") return w;
  cmd2.arg(`@${file}`);
  tracing.info(TARGET, () => `invoking linker ${xlane.debug_Command(cmd2)}`);
  const output = cmd2.output();
  const r = flush_linked_file(output, out_filename);
  if (r.$ === "Err") return r;
  return output;
}

// #[cfg(not(windows))]
// rustc: compiler/rustc_codegen_ssa/src/back/link.rs:2174 flush_linked_file
function flush_linked_file_not_windows(_: IoResult<Output>, __: string): IoResult<null> {
  return Ok(null);
}

// #[cfg(windows)]
// rustc: compiler/rustc_codegen_ssa/src/back/link.rs:2179 flush_linked_file
function flush_linked_file_windows(command_output: IoResult<Output>, out_filename: string): IoResult<null> {
  // On Windows, under high I/O load, output buffers are sometimes not flushed,
  // even long after process exit, causing nasty, non-reproducible output bugs.
  //
  // File::sync_all() calls FlushFileBuffers() down the line, which solves the problem.
  //
  // А full writeup of the original Chrome bug can be found at
  // randomascii.wordpress.com/2018/02/25/compiler-bug-linker-bug-windows-kernel-bug/amp

  if (command_output.$ === "Ok") {
    const out = command_output._0;
    if (out.status.success()) {
      // if let Ok(of) = fs::OpenOptions::new().write(true).open(out_filename) { of.sync_all()?; }
      void out_filename;
      return unported("std::fs::File::sync_all (exec_linker's flush_linked_file, Windows host)");
    }
  }

  return Ok(null);
}

/** PORT: the `flush_linked_file` of the host `cfg` (as `escape_linker_output`). */
function flush_linked_file(command_output: IoResult<Output>, out_filename: string): IoResult<null> {
  return CFG_WINDOWS ? flush_linked_file_windows(command_output, out_filename) : flush_linked_file_not_windows(command_output, out_filename);
}

// #[cfg(unix)]
// rustc: compiler/rustc_codegen_ssa/src/back/link.rs:2203 command_line_too_big
function command_line_too_big_unix(err: IoError): boolean {
  return IoError_raw_os_error(err) === LIBC_E2BIG;
}

// #[cfg(windows)]
// rustc: compiler/rustc_codegen_ssa/src/back/link.rs:2208 command_line_too_big
function command_line_too_big_windows(err: IoError): boolean {
  const ERROR_FILENAME_EXCED_RANGE = 206;
  return IoError_raw_os_error(err) === ERROR_FILENAME_EXCED_RANGE;
}

// #[cfg(not(any(unix, windows)))]
// rustc: compiler/rustc_codegen_ssa/src/back/link.rs:2214 command_line_too_big
function command_line_too_big_other(_: IoError): boolean {
  return false;
}

/** PORT: the `command_line_too_big` of the host `cfg` (every host the port runs on is unix or Windows). */
function command_line_too_big(err: IoError): boolean {
  void command_line_too_big_other;
  return CFG_WINDOWS ? command_line_too_big_windows(err) : command_line_too_big_unix(err);
}

/** `exec_linker`'s local `struct Escape<'a> { arg: &'a str, is_like_msvc: bool }`. */
class Escape {
  constructor(
    readonly arg: string,
    readonly is_like_msvc: boolean,
  ) {}

  /** `impl fmt::Display for Escape<'_>`. */
  // rustc: compiler/rustc_codegen_ssa/src/back/link.rs:2224 fmt
  fmt(): string {
    let f = "";
    if (this.is_like_msvc) {
      // This is "documented" at
      // https://docs.microsoft.com/en-us/cpp/build/reference/at-specify-a-linker-response-file
      //
      // Unfortunately there's not a great specification of the
      // syntax I could find online (at least) but some local
      // testing showed that this seemed sufficient-ish to catch
      // at least a few edge cases.
      f += '"';
      for (const c of this.arg) {
        switch (c) {
          case '"':
            f += `\\${c}`;
            break;
          default:
            f += c;
        }
      }
      f += '"';
    } else {
      // This is documented at https://linux.die.net/man/1/ld, namely:
      //
      // > Options in file are separated by whitespace. A whitespace
      // > character may be included in an option by surrounding the
      // > entire option in either single or double quotes. Any
      // > character (including a backslash) may be included by
      // > prefixing the character to be included with a backslash.
      //
      // We put an argument on each line, so all we need to do is
      // ensure the line is interpreted as one whole argument.
      for (const c of this.arg) {
        switch (c) {
          case "\\":
          case " ":
            f += `\\${c}`;
            break;
          default:
            f += c;
        }
      }
    }
    return f;
  }
}

// rustc: compiler/rustc_codegen_ssa/src/back/link.rs:2264 link_output_kind
export function link_output_kind(sess: Session, crate_type: CrateType): LinkOutputKind {
  const crt_static = sess.crt_static(crate_type);
  const reloc = sess.relocation_model();
  let kind: LinkOutputKind;
  if (crate_type === "Executable" && Session_is_wasi_reactor(sess)) {
    kind = "WasiReactorExe";
  } else if (crate_type === "Executable" && !crt_static && (reloc === "Pic" || reloc === "Pie")) {
    kind = "DynamicPicExe";
  } else if (crate_type === "Executable" && !crt_static) {
    kind = "DynamicNoPicExe";
  } else if (crate_type === "Executable" && crt_static && (reloc === "Pic" || reloc === "Pie")) {
    kind = "StaticPicExe";
  } else if (crate_type === "Executable" && crt_static) {
    kind = "StaticNoPicExe";
  } else if (crt_static) {
    kind = "StaticDylib";
  } else {
    kind = "DynamicDylib";
  }

  // Adjust the output kind to target capabilities.
  const opts = sess.target.options;
  const pic_exe_supported = opts.position_independent_executables;
  const static_pic_exe_supported = opts.static_position_independent_executables;
  const static_dylib_supported = opts.crt_static_allows_dylibs;
  if (kind === "DynamicPicExe" && !pic_exe_supported) return "DynamicNoPicExe";
  if (kind === "StaticPicExe" && !static_pic_exe_supported) return "StaticNoPicExe";
  if (kind === "StaticDylib" && !static_dylib_supported) return "DynamicDylib";
  return kind;
}

// Returns true if linker is located within sysroot
// rustc: compiler/rustc_codegen_ssa/src/back/link.rs:2293 detect_self_contained_mingw
function detect_self_contained_mingw(sess: Session, linker: string): boolean {
  const linker_with_extension = CFG_WINDOWS && path_extension(linker) === undefined ? path_with_extension(linker, "exe") : linker;
  // PORT: the paths are UTF-8 strings here (`to_string_lossy`).
  for (const dir of split_paths(var_os("PATH") ?? new Uint8Array(0)).map(to_string_lossy)) {
    const full_path = path_join(dir, linker_with_extension);
    // If linker comes from sysroot assume self-contained mode
    if (path_is_file(full_path) && path_strip_prefix(full_path, sess.opts.sysroot.path()) === undefined) {
      return false;
    }
  }
  return true;
}

/// Various toolchain components used during linking are used from rustc distribution
/// instead of being found somewhere on the host system.
/// We only provide such support for a very limited number of targets.
// rustc: compiler/rustc_codegen_ssa/src/back/link.rs:2312 self_contained_components
export function self_contained_components(sess: Session, crate_type: CrateType, linker: string): LinkSelfContainedComponents {
  // Turn the backwards compatible bool values for `self_contained` into fully inferred
  // `LinkSelfContainedComponents`.
  let self_contained: boolean;
  const explicitly_set = sess.opts.cg.link_self_contained.explicitly_set;
  if (explicitly_set !== undefined) {
    // Emit an error if the user requested self-contained mode on the CLI but the target
    // explicitly refuses it.
    if (LinkSelfContainedDefault.is_disabled(sess.target.options.link_self_contained)) {
      sess.dcx().emit_err(UnsupportedLinkSelfContained_diagnostic({}));
    }
    self_contained = explicitly_set;
  } else {
    const d = sess.target.options.link_self_contained;
    switch (d.$) {
      case "False":
        self_contained = false;
        break;
      case "True":
        self_contained = true;
        break;

      case "WithComponents":
        // For target specs with explicitly enabled components, we can return them
        // directly.
        return d._0;

      // FIXME: Find a better heuristic for "native musl toolchain is available",
      // based on host and linker path, for example.
      // (https://github.com/rust-lang/rust/pull/71769#issuecomment-626330237).
      case "InferredForMusl":
        self_contained = sess.crt_static(crate_type);
        break;
      case "InferredForMingw":
        self_contained = Target_eq(sess.host, sess.target) && sess.target.cfg_abi.$ !== "Uwp" && detect_self_contained_mingw(sess, linker);
        break;
    }
  }
  if (self_contained) {
    return LinkSelfContainedComponents.all();
  } else {
    return LinkSelfContainedComponents.empty();
  }
}

/// Add pre-link object files defined by the target spec.
// rustc: compiler/rustc_codegen_ssa/src/back/link.rs:2357 add_pre_link_objects
function add_pre_link_objects(cmd: Linker, sess: Session, flavor: LinkerFlavor, link_output_kind: LinkOutputKind, self_contained: boolean): void {
  // FIXME: we are currently missing some infra here (per-linker-flavor CRT objects),
  // so Fuchsia has to be special-cased.
  const opts = sess.target.options;
  const empty: CrtObjects = new Map();
  let objects: CrtObjects;
  if (self_contained) {
    objects = opts.pre_link_objects_self_contained;
  } else if (!(sess.target.os.$ === "Fuchsia" && flavor.$ === "Gnu" && flavor._0 === "Yes")) {
    objects = opts.pre_link_objects;
  } else {
    objects = empty;
  }
  for (const obj of objects.get(link_output_kind) ?? []) {
    cmd.add_object(get_object_file_path(sess, obj, self_contained));
  }
}

/// Add post-link object files defined by the target spec.
// rustc: compiler/rustc_codegen_ssa/src/back/link.rs:2381 add_post_link_objects
function add_post_link_objects(cmd: Linker, sess: Session, link_output_kind: LinkOutputKind, self_contained: boolean): void {
  const objects = self_contained ? sess.target.options.post_link_objects_self_contained : sess.target.options.post_link_objects;
  for (const obj of objects.get(link_output_kind) ?? []) {
    cmd.add_object(get_object_file_path(sess, obj, self_contained));
  }
}

/// Add arbitrary "pre-link" args defined by the target spec or from command line.
/// FIXME: Determine where exactly these args need to be inserted.
// rustc: compiler/rustc_codegen_ssa/src/back/link.rs:2399 add_pre_link_args
function add_pre_link_args(cmd: Linker, sess: Session, flavor: LinkerFlavor): void {
  const args = sess.target.options.pre_link_args.get(flavor);
  if (args !== undefined) {
    cmd.verbatim_args(args);
  }

  cmd.verbatim_args(sess.opts.unstable_opts.pre_link_args);
}

/// Add a link script embedded in the target, if applicable.
// rustc: compiler/rustc_codegen_ssa/src/back/link.rs:2408 add_link_script
function add_link_script(cmd: Linker, sess: Session, tmpdir: string, crate_type: CrateType): void {
  const script = sess.target.options.link_script;
  if ((crate_type === "Cdylib" || crate_type === "Executable") && script !== undefined) {
    if (!LinkerFlavor.is_gnu(sess.target.options.linker_flavor)) {
      sess.dcx().emit_fatal(LinkScriptUnavailable_diagnostic({}));
    }

    const file_name = ["rustc", sess.target.llvm_target, "linkfile.ld"].join("-");

    const path = path_join(tmpdir, file_name);
    const r = fs_write(path, encoder.encode(script));
    if (r.$ === "Err") {
      sess.dcx().emit_fatal(LinkScriptWriteFailure_diagnostic({ path, error: r._0 }));
    }

    cmd.link_arg("--script").link_arg(path);
  }
}

/// Add arbitrary "user defined" args defined from command line.
/// FIXME: Determine where exactly these args need to be inserted.
// rustc: compiler/rustc_codegen_ssa/src/back/link.rs:2430 add_user_defined_link_args
function add_user_defined_link_args(cmd: Linker, sess: Session): void {
  cmd.verbatim_args(sess.opts.cg.link_args);
}

/// Add arbitrary "late link" args defined by the target spec.
/// FIXME: Determine where exactly these args need to be inserted.
// rustc: compiler/rustc_codegen_ssa/src/back/link.rs:2436 add_late_link_args
function add_late_link_args(cmd: Linker, sess: Session, flavor: LinkerFlavor, crate_type: CrateType, crate_info: CrateInfo): void {
  const any_dynamic_crate =
    crate_type === "Dylib" ||
    crate_type === "Sdylib" ||
    [...crate_info.dependency_formats].some(([ty, list]) => ty === crate_type && list.some((linkage) => linkage === "Dynamic"));
  if (any_dynamic_crate) {
    const args = sess.target.options.late_link_args_dynamic.get(flavor);
    if (args !== undefined) {
      cmd.verbatim_args(args);
    }
  } else {
    const args = sess.target.options.late_link_args_static.get(flavor);
    if (args !== undefined) {
      cmd.verbatim_args(args);
    }
  }
  const args = sess.target.options.late_link_args.get(flavor);
  if (args !== undefined) {
    cmd.verbatim_args(args);
  }
}

/// Add arbitrary "post-link" args defined by the target spec.
/// FIXME: Determine where exactly these args need to be inserted.
// rustc: compiler/rustc_codegen_ssa/src/back/link.rs:2462 add_post_link_args
function add_post_link_args(cmd: Linker, sess: Session, flavor: LinkerFlavor): void {
  const args = sess.target.options.post_link_args.get(flavor);
  if (args !== undefined) {
    cmd.verbatim_args(args);
  }
}

/// Add a synthetic object file that contains reference to all symbols that we want to expose to
/// the linker.
///
/// Background: we implement rlibs as static library (archives). Linkers treat archives
/// differently from object files: all object files participate in linking, while archives will
/// only participate in linking if they can satisfy at least one undefined reference (version
/// scripts doesn't count). This causes `#[no_mangle]` or `#[used]` items to be ignored by the
/// linker, and since they never participate in the linking, using `KEEP` in the linker scripts
/// can't keep them either. This causes #47384.
///
/// To keep them around, we could use `--whole-archive`, `-force_load` and equivalents to force rlib
/// to participate in linking like object files, but this proves to be expensive (#93791). Therefore
/// we instead just introduce an undefined reference to them. This could be done by `-u` command
/// line option to the linker or `EXTERN(...)` in linker scripts, however they does not only
/// introduce an undefined reference, but also make them the GC roots, preventing `--gc-sections`
/// from removing them, and this is especially problematic for embedded programming where every
/// byte counts.
///
/// This method creates a synthetic object file, which contains undefined references to all symbols
/// that are necessary for the linking. They are only present in symbol table but not actually
/// used in any sections, so the linker will therefore pick relevant rlibs for linking, but
/// unused `#[no_mangle]` or `#[used(compiler)]` can still be discard by GC sections.
///
/// There's a few internal crates in the standard library (aka libcore and
/// libstd) which actually have a circular dependence upon one another. This
/// currently arises through "weak lang items" where libcore requires things
/// like `rust_begin_unwind` but libstd ends up defining it. To get this
/// circular dependence to work correctly we declare some of these things
/// in this synthetic object.
// rustc: compiler/rustc_codegen_ssa/src/back/link.rs:2497 add_linked_symbol_object
function add_linked_symbol_object(
  cmd: Linker,
  sess: Session,
  tmpdir: string,
  crate_type: CrateType,
  linked_symbols: readonly [string, SymbolExportKind][],
  exported_symbols: readonly SymbolExport[],
): void {
  const should_export_symbols =
    sess.target.options.is_like_msvc && exported_symbols.length !== 0 && (crate_type !== "Executable" || sess.opts.unstable_opts.export_executable_symbols);
  if (linked_symbols.length === 0 && !should_export_symbols) {
    return;
  }

  const file = create_object_file(sess);
  if (file === undefined) {
    return;
  }

  if (file.format() === "Coff") {
    // NOTE(nbdd0121): MSVC will hang if the input object file contains no sections,
    // so add an empty section.
    file.add_section(new Uint8Array(0), encoder.encode(".text"), SectionKind.Text);

    // We handle the name decoration of COFF targets in `symbol_export.rs`, so disable the
    // default mangler in `object` crate.
    file.set_mangling("None");
  }

  if (file.format() === "MachO") {
    // Divide up the sections into sub-sections via symbols for dead code stripping.
    // Without this flag, unused `#[no_mangle]` or `#[used(compiler)]` cannot be
    // discard on MachO targets.
    xlane.Object_set_subsections_via_symbols(file);
  }

  // ld64 requires a relocation to load undefined symbols, see below.
  // Not strictly needed if linking with lld, but might as well do it there too.
  const ld64_section_helper =
    file.format() === "MachO" ? file.add_section(file.segment_name("Data").slice(), encoder.encode("__data"), SectionKind.Data) : undefined;

  for (const [sym, kind] of linked_symbols) {
    const symbol = xlane.Object_add_symbol(
      file,
      new WriteSymbol(
        encoder.encode(sym),
        0,
        0,
        kind === "Text" ? "Text" : kind === "Data" ? "Data" : "Tls",
        "Unknown",
        false,
        { $: "Undefined" },
        { $: "None" },
      ),
    );

    // The linker shipped with Apple's Xcode, ld64, works a bit differently from other linkers.
    //
    // Code-wise, the relevant parts of ld64 are roughly:
    // 1. Find the `ArchiveLoadMode` based on commandline options, default to `parseObjects`.
    //    https://github.com/apple-oss-distributions/ld64/blob/ld64-954.16/src/ld/Options.cpp#L924-L932
    //    https://github.com/apple-oss-distributions/ld64/blob/ld64-954.16/src/ld/Options.h#L55
    //
    // 2. Read the archive table of contents (__.SYMDEF file).
    //    https://github.com/apple-oss-distributions/ld64/blob/ld64-954.16/src/ld/parsers/archive_file.cpp#L294-L325
    //
    // 3. Begin linking by loading "atoms" from input files.
    //    https://github.com/apple-oss-distributions/ld64/blob/ld64-954.16/doc/design/linker.html
    //    https://github.com/apple-oss-distributions/ld64/blob/ld64-954.16/src/ld/InputFiles.cpp#L1349
    //
    //   a. Directly specified object files (`.o`) are parsed immediately.
    //      https://github.com/apple-oss-distributions/ld64/blob/ld64-954.16/src/ld/parsers/macho_relocatable_file.cpp#L4611-L4627
    //
    //     - Undefined symbols are not atoms (`n_value > 0` denotes a common symbol).
    //       https://github.com/apple-oss-distributions/ld64/blob/ld64-954.16/src/ld/parsers/macho_relocatable_file.cpp#L2455-L2468
    //       https://maskray.me/blog/2022-02-06-all-about-common-symbols
    //
    //     - Relocations/fixups are atoms.
    //       https://github.com/apple-oss-distributions/ld64/blob/ce6341ae966b3451aa54eeb049f2be865afbd578/src/ld/parsers/macho_relocatable_file.cpp#L2088-L2114
    //
    //   b. Archives are not parsed yet.
    //      https://github.com/apple-oss-distributions/ld64/blob/ld64-954.16/src/ld/parsers/archive_file.cpp#L467-L577
    //
    // 4. When a symbol is needed by an atom, parse the object file that contains the symbol.
    //    https://github.com/apple-oss-distributions/ld64/blob/ld64-954.16/src/ld/InputFiles.cpp#L1417-L1491
    //    https://github.com/apple-oss-distributions/ld64/blob/ld64-954.16/src/ld/parsers/archive_file.cpp#L579-L597
    //
    // All of the steps above are fairly similar to other linkers, except that **it completely
    // ignores undefined symbols**.
    //
    // So to make this trick work on ld64, we need to do something else to load the relevant
    // object files. We do this by inserting a relocation (fixup) for each symbol.
    if (ld64_section_helper !== undefined) {
      const section = ld64_section_helper;
      const r = xlane.apple_add_data_and_relocation(file, section, symbol, sess.target, kind);
      if (r.$ === "Err") panic(`failed adding relocation: ${debug_WriteError(r._0)}`);
    }
  }

  if (should_export_symbols) {
    // Currently the compiler doesn't use `dllexport` (an LLVM attribute) to
    // export symbols from a dynamic library. When building a dynamic library,
    // however, we're going to want some symbols exported, so this adds a
    // `.drectve` section which lists all the symbols using /EXPORT arguments.
    //
    // The linker will read these arguments from the `.drectve` section and
    // export all the symbols from the dynamic library. Note that this is not
    // as simple as just exporting all the symbols in the current crate (as
    // specified by `codegen.reachable`) but rather we also need to possibly
    // export the symbols of upstream crates. Upstream rlibs may be linked
    // statically to this dynamic library, in which case they may continue to
    // transitively be used and hence need their symbols exported.
    // rustc: compiler/rustc_codegen_ssa/src/back/link.rs:2617 msvc_drectve_export
    const msvc_drectve_export = (symbol: SymbolExport): string => {
      const data = symbol.kind === "Data" ? ",DATA" : "";

      const link_name = symbol.link_name;
      if (link_name !== undefined) {
        // The first name is the decorated symbol used by the import library, while
        // EXPORTAS gives the public name written to the DLL export table.
        return ` /EXPORT:"${link_name}"${data},EXPORTAS,"${symbol.name}"`;
      } else {
        return ` /EXPORT:"${symbol.name}"${data}`;
      }
    };

    const drectve = exported_symbols.map(msvc_drectve_export).join("");

    const section = file.add_section(new Uint8Array(0), encoder.encode(".drectve"), SectionKind.Linker);
    file.append_section_data(section, encoder.encode(drectve), 1);
  }

  const path = path_join(tmpdir, "symbols.o");
  const written = file.write();
  if (written.$ === "Err") panic(`called \`Result::unwrap()\` on an \`Err\` value: ${debug_WriteError(written._0)}`);
  const result = fs_write(path, written._0);
  if (result.$ === "Err") {
    sess.dcx().emit_fatal(FailedToWrite_diagnostic({ path, error: result._0 }));
  }
  cmd.add_object(path);
}

/// Add object files containing code from the current crate.
// rustc: compiler/rustc_codegen_ssa/src/back/link.rs:2644 add_local_crate_regular_objects
function add_local_crate_regular_objects(cmd: Linker, compiled_modules: CompiledModules): void {
  for (const m of compiled_modules.modules) {
    if (m.object !== undefined) {
      cmd.add_object(m.object);
    }
    if (m.global_asm_object !== undefined) {
      cmd.add_object(m.global_asm_object);
    }
  }
}

/// Add object files for allocator code linked once for the whole crate tree.
// rustc: compiler/rustc_codegen_ssa/src/back/link.rs:2656 add_local_crate_allocator_objects
function add_local_crate_allocator_objects(cmd: Linker, compiled_modules: CompiledModules, crate_info: CrateInfo, crate_type: CrateType): void {
  const m = compiled_modules.allocator_module;
  if (needs_allocator_shim_for_linking(crate_info.dependency_formats, crate_type) && m !== undefined) {
    if (m.object !== undefined) {
      cmd.add_object(m.object);
    }
    if (m.global_asm_object !== undefined) {
      cmd.add_object(m.global_asm_object);
    }
  }
}

/// Add object files containing metadata for the current crate.
// rustc: compiler/rustc_codegen_ssa/src/back/link.rs:2675 add_local_crate_metadata_objects
function add_local_crate_metadata_objects(
  cmd: Linker,
  sess: Session,
  archive_builder_builder: ArchiveBuilderBuilder,
  crate_type: CrateType,
  tmpdir: string,
  crate_info: CrateInfo,
  metadata: EncodedMetadata,
): void {
  // When linking a dynamic library, we put the metadata into a section of the
  // executable. This metadata is in a separate object file from the main
  // object file, so we create and link it in here.
  if (crate_type === "Dylib" || crate_type === "ProcMacro") {
    const data = xlane.create_dylib_metadata_wrapper(archive_builder_builder, sess, metadata, crate_info.metadata_symbol);
    const obj = emit_wrapper_file(sess, data, tmpdir, "rmeta.o");

    cmd.add_object(obj);
  }
}

/// Add sysroot and other globally set directories to the directory search list.
// rustc: compiler/rustc_codegen_ssa/src/back/link.rs:2700 add_library_search_dirs
function add_library_search_dirs(
  cmd: Linker,
  sess: Session,
  self_contained_components: LinkSelfContainedComponents,
  apple_sdk_root: string | undefined,
): void {
  if (!sess.opts.unstable_opts.link_native_libraries) {
    return;
  }

  const fallback: NativeLibSearchFallback = { self_contained_components, apple_sdk_root };
  walk_native_lib_search_dirs<null>(sess, fallback, (dir, is_framework) => {
    if (is_framework) {
      cmd.framework_path(dir);
    } else {
      cmd.include_path(fix_windows_verbatim_for_gcc(dir));
    }
    return ControlFlow.Continue(null);
  });
}

/// Add options making relocation sections in the produced ELF files read-only
/// and suppressing lazy binding.
// rustc: compiler/rustc_codegen_ssa/src/back/link.rs:2723 add_relro_args
function add_relro_args(cmd: Linker, sess: Session): void {
  switch (sess.opts.cg.relro_level ?? sess.target.options.relro_level) {
    case "Full":
      cmd.full_relro();
      break;
    case "Partial":
      cmd.partial_relro();
      break;
    case "Off":
      cmd.no_relro();
      break;
    case "None":
      break;
  }
}

/// Add library search paths used at runtime by dynamic linkers.
// rustc: compiler/rustc_codegen_ssa/src/back/link.rs:2733 add_rpath_args
function add_rpath_args(cmd: Linker, sess: Session, crate_info: CrateInfo, out_filename: string): void {
  if (!sess.target.options.has_rpath) {
    return;
  }

  // FIXME (#2397): At some point we want to rpath our guesses as to
  // where extern libraries might live, based on the
  // add_lib_search_paths
  if (sess.opts.cg.rpath) {
    const libs: string[] = [];
    for (const cnum of crate_info.used_crates) {
      const dylib = crate_info_used_crate_source(crate_info, cnum).dylib;
      if (dylib !== undefined) libs.push(dylib);
    }
    const rpath_config: RPathConfig = {
      libs,
      out_filename,
      is_like_darwin: sess.target.options.is_like_darwin,
      linker_is_gnu: LinkerFlavor.is_gnu(sess.target.options.linker_flavor),
    };
    cmd.link_args(get_rpath_linker_args(rpath_config));
  }
}

// rustc: compiler/rustc_codegen_ssa/src/back/link.rs:2762 undecorate_c_symbol
function undecorate_c_symbol(name: string, sess: Session, kind: SymbolExportKind): string | undefined {
  switch (sess.target.options.binary_format) {
    case "MachO":
      // Mach-O: strip the leading underscore that all external symbols have.
      // The Darwin linker's export_symbols will add it back.
      return name.startsWith("_") ? name.slice(1) : undefined;
    case "Coff": {
      // COFF undecoration is shared with `symbol_edit`'s binary-level matching.
      const machine = coff_machine_for_arch(sess.target.arch);
      if (machine !== undefined) {
        return undecorate_coff_symbol(name, machine, kind);
      } else {
        return name;
      }
    }
    // ELF: no decoration
    default:
      return name;
  }
}

// rustc: compiler/rustc_codegen_ssa/src/back/link.rs:2785 add_c_staticlib_symbols
function add_c_staticlib_symbols(sess: Session, lib: NativeLib, out: SymbolExport[]): IoResult<null> {
  const file_path = find_native_static_library(Symbol.as_str(lib.name), lib.verbatim, sess);

  const opened = FsFile.open(file_path);
  if (opened.$ === "Err") return opened;
  const mapped = Mmap.map(opened._0);
  if (mapped.$ === "Err") return mapped;
  const archive_map = mapped._0._0;

  const parsed = ArchiveFile.parse(archive_map);
  if (parsed.$ === "Err") return Err(io_error_new("InvalidData", display_ReadError(parsed._0)));
  const archive = parsed._0;

  for (const member_ of archive.members()) {
    if (member_.$ === "Err") return Err(io_error_new("InvalidData", display_ReadError(member_._0)));
    const member = member_._0;

    const data_ = member.data(archive_map);
    if (data_.$ === "Err") return Err(io_error_new("InvalidData", display_ReadError(data_._0)));
    const data = data_._0;

    // clang LTO: raw LLVM bitcode
    if (data.length >= 4 && data[0] === 0x42 && data[1] === 0x43 && data[2] === 0xc0 && data[3] === 0xde) {
      return Err(io_error_new("InvalidData", "LLVM bitcode object in C static library (LTO not supported)"));
    }

    const object_ = ReadFile.parse(data);
    if (object_.$ === "Err") return Err(io_error_new("InvalidData", display_ReadError(object_._0)));
    const object = object_._0;

    // gcc / clang ELF / Mach-O LTO
    // if object.sections().any(|s| s.name().map(|n| n.starts_with(".gnu.lto_") || n == ".llvm.lto").unwrap_or(false)) { .. }
    void object;
    return unported("object::read::File::sections (vendor object: add_c_staticlib_symbols, a cdylib with `-l static:+export-symbols`)");
  }

  return Ok(null);
}

/// Produce the linker command line containing linker path and arguments.
///
/// When comments in the function say "order-(in)dependent" they mean order-dependence between
/// options and libraries/object files. For example `--whole-archive` (order-dependent) applies
/// to specific libraries passed after it, and `-o` (output file, order-independent) applies
/// to the linking process as a whole.
/// Order-independent options may still override each other in order-dependent fashion,
/// e.g `--foo=yes --foo=no` may be equivalent to `--foo=no`.
// rustc: compiler/rustc_codegen_ssa/src/back/link.rs:2870 linker_with_args
export function linker_with_args(
  path: string,
  flavor: LinkerFlavor,
  sess: Session,
  archive_builder_builder: ArchiveBuilderBuilder,
  rmeta_link_cache: RmetaLinkCache,
  crate_type: CrateType,
  tmpdir: string,
  out_filename: string,
  compiled_modules: CompiledModules,
  crate_info: CrateInfo,
  metadata: EncodedMetadata,
  self_contained_components: LinkSelfContainedComponents,
  codegen_backend: string,
): [Command, JobserverAcquired[]] {
  const self_contained_crt_objects = LinkSelfContainedComponents.is_crt_objects_enabled(self_contained_components);
  const cmd = get_linker(
    sess,
    path,
    flavor,
    LinkSelfContainedComponents.are_any_components_enabled(self_contained_components),
    crate_info.target_cpu,
    codegen_backend,
  );
  const link_output_kind_ = link_output_kind(sess, crate_type);

  const export_symbols = [...index_map_get(crate_info.exported_symbols, crate_type, "no entry found for key")];

  if (crate_type === "Cdylib") {
    // `FxHashSet<(Symbol, bool)>`
    const seen = new Set<string>();

    for (const lib of crate_info.used_libraries) {
      if (lib.kind.$ === "Static" && lib.kind.export_symbols === true) {
        const key = `${lib.name}:${lib.verbatim}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const err = add_c_staticlib_symbols(sess, lib, export_symbols);
        if (err.$ === "Err") {
          sess.dcx().fatal(`failed to process C static library \`${Symbol.as_str(lib.name)}\`: ${display_IoError(err._0)}`);
        }
      }
    }
  }

  // ------------ Early order-dependent options ------------

  // If we're building something like a dynamic library then some platforms
  // need to make sure that all symbols are exported correctly from the
  // dynamic library.
  // Must be passed before any libraries to prevent the symbols to export from being thrown away,
  // at least on some platforms (e.g. windows-gnu).
  cmd.export_symbols(tmpdir, crate_type, export_symbols);

  // Can be used for adding custom CRT objects or overriding order-dependent options above.
  // FIXME: In practice built-in target specs use this for arbitrary order-independent options,
  // introduce a target spec option for order-independent linker options and migrate built-in
  // specs to it.
  add_pre_link_args(cmd, sess, flavor);

  // ------------ Object code and libraries, order-dependent ------------

  // Pre-link CRT objects.
  add_pre_link_objects(cmd, sess, flavor, link_output_kind_, self_contained_crt_objects);

  add_linked_symbol_object(
    cmd,
    sess,
    tmpdir,
    crate_type,
    index_map_get(crate_info.linked_symbols, crate_type, "IndexMap: key not found"),
    export_symbols,
  );

  // Sanitizer libraries.
  add_sanitizer_libraries(sess, flavor, crate_type, cmd);

  // Object code from the current crate.
  // Take careful note of the ordering of the arguments we pass to the linker
  // here. Linkers will assume that things on the left depend on things to the
  // right. Things on the right cannot depend on things on the left. This is
  // all formally implemented in terms of resolving symbols (libs on the right
  // resolve unknown symbols of libs on the left, but not vice versa).
  //
  // For this reason, we have organized the arguments we pass to the linker as
  // such:
  //
  // 1. The local object that LLVM just generated
  // 2. Local native libraries
  // 3. Upstream rust libraries
  // 4. Upstream native libraries
  //
  // The rationale behind this ordering is that those items lower down in the
  // list can't depend on items higher up in the list. For example nothing can
  // depend on what we just generated (e.g., that'd be a circular dependency).
  // Upstream rust libraries are not supposed to depend on our local native
  // libraries as that would violate the structure of the DAG, in that
  // scenario they are required to link to them as well in a shared fashion.
  //
  // Note that upstream rust libraries may contain native dependencies as
  // well, but they also can't depend on what we just started to add to the
  // link line. And finally upstream native libraries can't depend on anything
  // in this DAG so far because they can only depend on other native libraries
  // and such dependencies are also required to be specified.
  add_local_crate_regular_objects(cmd, compiled_modules);
  add_local_crate_metadata_objects(cmd, sess, archive_builder_builder, crate_type, tmpdir, crate_info, metadata);
  add_local_crate_allocator_objects(cmd, compiled_modules, crate_info, crate_type);

  // Avoid linking to dynamic libraries unless they satisfy some undefined symbols
  // at the point at which they are specified on the command line.
  // Must be passed before any (dynamic) libraries to have effect on them.
  // On Solaris-like systems, `-z ignore` acts as both `--as-needed` and `--gc-sections`
  // so it will ignore unreferenced ELF sections from relocatable objects.
  // For that reason, we put this flag after metadata objects as they would otherwise be removed.
  // FIXME: Support more fine-grained dead code removal on Solaris/illumos
  // and move this option back to the top.
  cmd.add_as_needed();

  // Local native libraries of all kinds.
  add_local_native_libraries(cmd, sess, archive_builder_builder, rmeta_link_cache, crate_info, tmpdir, link_output_kind_);

  if (sess.opts.unstable_opts.offload.some((o) => o.$ === "Host")) {
    cmd.link_dylib_by_name("omptarget", false, true);
    cmd.link_dylib_by_name("omp", false, true);
    cmd.link_args(["-z", "nostart-stop-gc"]);
    cmd.link_arg("-rpath");
    cmd.link_arg(unwrap_result(absolute(sess.target_tlib_path.dir), debug_IoError));
  }

  // Upstream rust crates and their non-dynamic native libraries.
  add_upstream_rust_crates(cmd, sess, archive_builder_builder, rmeta_link_cache, crate_info, crate_type, tmpdir, link_output_kind_);

  // Dynamic native libraries from upstream crates.
  add_upstream_native_libraries(cmd, sess, archive_builder_builder, rmeta_link_cache, crate_info, tmpdir, link_output_kind_);

  // Raw-dylibs from all crates.
  const raw_dylib_dir = path_join(tmpdir, "raw-dylibs");
  if (sess.target.options.binary_format === "Elf") {
    // On ELF we can't pass the raw-dylibs stubs to the linker as a path,
    // instead we need to pass them via -l. To find the stub, we need to add
    // the directory of the stub to the linker search path.
    // We make an extra directory for this to avoid polluting the search path.
    const r = fs_create_dir(raw_dylib_dir);
    if (r.$ === "Err") {
      sess.dcx().emit_fatal(CreateTempDir_diagnostic({ error: r._0 }));
    }
    cmd.include_path(raw_dylib_dir);
  }

  // Link with the import library generated for any raw-dylib functions.
  if (sess.target.options.is_like_windows) {
    for (const output_path of xlane.create_raw_dylib_dll_import_libs(sess, archive_builder_builder, crate_info.used_libraries, tmpdir, true)) {
      cmd.add_object(output_path);
    }
  } else {
    for (const [link_path, as_needed] of raw_dylib.create_raw_dylib_elf_stub_shared_objects(sess, crate_info.used_libraries, raw_dylib_dir)) {
      // Always use verbatim linkage, see comments in create_raw_dylib_elf_stub_shared_objects.
      cmd.link_dylib_by_name(link_path, true, as_needed);
    }
  }
  // As with add_upstream_native_libraries, we need to add the upstream raw-dylib symbols in case
  // they are used within inlined functions or instantiated generic functions. We do this *after*
  // handling the raw-dylib symbols in the current crate to make sure that those are chosen first
  // by the linker.
  const dependency_linkage = crate_info.dependency_formats.get(crate_type);
  if (dependency_linkage === undefined) panic("failed to find crate type in dependency format list");

  // We sort the libraries below
  // #[allow(rustc::potential_query_instability)]
  const native_libraries_from_nonstatics: NativeLib[] = [];
  for (const [cnum, libraries] of crate_info.native_libraries) {
    if (sess.target.options.is_like_windows) {
      if (vec_index(dependency_linkage, cnum) !== "Static") native_libraries_from_nonstatics.push(...libraries);
    } else {
      native_libraries_from_nonstatics.push(...libraries);
    }
  }
  sort_native_libraries_by_name(native_libraries_from_nonstatics);

  if (sess.target.options.is_like_windows) {
    for (const output_path of xlane.create_raw_dylib_dll_import_libs(sess, archive_builder_builder, native_libraries_from_nonstatics, tmpdir, false)) {
      cmd.add_object(output_path);
    }
  } else {
    for (const [link_path, as_needed] of raw_dylib.create_raw_dylib_elf_stub_shared_objects(sess, native_libraries_from_nonstatics, raw_dylib_dir)) {
      // Always use verbatim linkage, see comments in create_raw_dylib_elf_stub_shared_objects.
      cmd.link_dylib_by_name(link_path, true, as_needed);
    }
  }

  // Library linking above uses some global state for things like `-Bstatic`/`-Bdynamic` to make
  // command line shorter, reset it to default here before adding more libraries.
  cmd.reset_per_library_state();

  // FIXME: Built-in target specs occasionally use this for linking system libraries,
  // eliminate all such uses by migrating them to `#[link]` attributes in `lib(std,c,unwind)`
  // and remove the option.
  add_late_link_args(cmd, sess, flavor, crate_type, crate_info);

  // ------------ Arbitrary order-independent options ------------

  // Add order-independent options determined by rustc from its compiler options,
  // target properties and source code.
  add_order_independent_options(cmd, sess, link_output_kind_, self_contained_components, flavor, crate_type, crate_info, out_filename, tmpdir);

  // Can be used for arbitrary order-independent options.
  // In practice may also be occasionally used for linking native libraries.
  // Passed after compiler-generated options to support manual overriding when necessary.
  add_user_defined_link_args(cmd, sess);

  // ------------ Builtin configurable linker scripts ------------
  // The user's link args should be able to overwrite symbols in the compiler's
  // linker script that were weakly defined (i.e. defined with `PROVIDE()`). For this
  // to work correctly, the user needs to be able to specify linker arguments like
  // `--defsym` and `--script` *before* any builtin linker scripts are evaluated.
  add_link_script(cmd, sess, tmpdir, crate_type);

  // ------------ Object code and libraries, order-dependent ------------

  // Post-link CRT objects.
  add_post_link_objects(cmd, sess, link_output_kind_, self_contained_crt_objects);

  // ------------ Late order-dependent options ------------

  // Doesn't really make sense.
  // FIXME: In practice built-in target specs use this for arbitrary order-independent options.
  // Introduce a target spec option for order-independent linker options, migrate built-in specs
  // to it and remove the option. Currently the last holdout is wasm32-unknown-emscripten.
  add_post_link_args(cmd, sess, flavor);

  // Only LLD supports controlling parallelism at the moment.
  const tokens: JobserverAcquired[] = [];
  const linker_jobs = sess.opts.jobs.linker;
  if (linker_jobs.$ === "Explicit" && LinkerFlavor.uses_lld(flavor)) {
    const limit = linker_jobs._0;
    // Try obtaining as many jobserver tokens as possible (within the limit) to run parallel
    // linking. One token is available implicitly since we are running on the main thread.
    const client = jobserver.client();

    let unsupported = false;
    for (let i = 0; i < limit - 1; i++) {
      const r: IoResult<JobserverAcquired | undefined> = (client as { try_acquire(): IoResult<JobserverAcquired | undefined> }).try_acquire();
      if (r.$ === "Ok") {
        if (r._0 !== undefined) tokens.push(r._0);
      } else if (IoError_kind(r._0) === "Unsupported") {
        assert(tokens.length === 0, "assertion failed: tokens.is_empty()");
        unsupported = true;
        break;
      } else {
        bug(`IO error when acquiring jobserver token: ${display_IoError(r._0)}`);
      }
    }

    const prefix = sess.target.options.is_like_windows ? "/threads:" : "--threads=";
    // Error on the side of oversubscription if non-blocking token acquiring is unsupported.
    // Linking is typically the last step in a multi-crate project build,
    // so the resources should usually be free.
    const threads = unsupported ? limit : 1 + tokens.length;
    cmd.link_arg(`${prefix}${threads}`);
  }

  return [cmd.take_cmd(), tokens];
}

// rustc: compiler/rustc_codegen_ssa/src/back/link.rs:3202 add_order_independent_options
function add_order_independent_options(
  cmd: Linker,
  sess: Session,
  link_output_kind: LinkOutputKind,
  self_contained_components: LinkSelfContainedComponents,
  flavor: LinkerFlavor,
  crate_type: CrateType,
  crate_info: CrateInfo,
  out_filename: string,
  tmpdir: string,
): void {
  // Take care of the flavors and CLI options requesting the `lld` linker.
  add_lld_args(cmd, sess, flavor, self_contained_components);

  add_apple_link_args(cmd, sess, flavor);

  const apple_sdk_root = add_apple_sdk(cmd, sess, flavor);

  if (sess.target.os.$ === "Fuchsia" && crate_type === "Executable" && !(flavor.$ === "Gnu" && flavor._0 === "Yes")) {
    const prefix = SanitizerSet.contains(sess.sanitizers(), SanitizerSet.ADDRESS) ? "asan/" : "";
    cmd.link_arg(`--dynamic-linker=${prefix}ld.so.1`);
  }

  if (sess.target.options.eh_frame_header) {
    cmd.add_eh_frame_header();
  }

  // Make the binary compatible with data execution prevention schemes.
  cmd.add_no_exec();

  if (LinkSelfContainedComponents.is_crt_objects_enabled(self_contained_components)) {
    cmd.no_crt_objects();
  }

  if (sess.target.os.$ === "Emscripten") {
    cmd.cc_arg("-fwasm-exceptions");
  }

  if (flavor === LinkerFlavor.Llbc) {
    cmd.link_args(["--target", versioned_llvm_target(sess.early_sess), "--target-cpu", crate_info.target_cpu]);
    if (crate_info.target_features.length > 0) {
      cmd.link_arg(`--target-feature=${crate_info.target_features.join(",")}`);
    }
  } else if (flavor === LinkerFlavor.Bpf) {
    cmd.link_args(["--cpu", crate_info.target_cpu]);
    const feat = [sess.opts.cg.target_feature, sess.target.options.features].find((feat) => feat !== "");
    if (feat !== undefined) {
      cmd.link_args(["--cpu-features", feat]);
    }
  }

  cmd.linker_plugin_lto();

  add_library_search_dirs(cmd, sess, self_contained_components, apple_sdk_root);

  cmd.output_filename(out_filename);

  const s = crate_info.windows_subsystem;
  if (crate_type === "Executable" && sess.target.options.is_like_windows && s !== undefined) {
    cmd.windows_subsystem(s);
  }

  // Try to strip as much out of the generated object by removing unused
  // sections if possible. See more comments in linker.rs
  if (!sess.link_dead_code()) {
    // If PGO is enabled sometimes gc_sections will remove the profile data section
    // as it appears to be unused. This can then cause the PGO profile file to lose
    // some functions. If we are generating a profile we shouldn't strip those metadata
    // sections to ensure we have all the data for PGO.
    const keep_metadata = crate_type === "Dylib" || SwitchWithOptPath.enabled(sess.opts.cg.profile_generate);
    cmd.gc_sections(keep_metadata);
  }

  cmd.set_output_kind(link_output_kind, crate_type, out_filename);

  add_relro_args(cmd, sess);

  // Pass optimization flags down to the linker.
  cmd.optimize();

  // Gather the set of NatVis files, if any, and write them out to a temp directory.
  const natvis_visualizers = collect_natvis_visualizers(tmpdir, sess, crate_info.local_crate_name, crate_info.natvis_debugger_visualizers);

  // Pass debuginfo, NatVis debugger visualizers and strip flags down to the linker.
  cmd.debuginfo(sess.opts.cg.strip, natvis_visualizers);

  // We want to prevent the compiler from accidentally leaking in any system libraries,
  // so by default we tell linkers not to link to any default libraries.
  if (!sess.opts.cg.default_linker_libraries && sess.target.options.no_default_libraries) {
    cmd.no_default_libraries();
  }

  if (SwitchWithOptPath.enabled(sess.opts.cg.profile_generate) || sess.instrument_coverage()) {
    cmd.pgo_gen();
  }

  if (sess.opts.unstable_opts.instrument_mcount.$ !== "Disabled") {
    cmd.enable_profiling();
  }

  if (sess.opts.cg.control_flow_guard !== "Disabled") {
    cmd.control_flow_guard();
  }

  // OBJECT-FILES-NO, AUDIT-ORDER
  if (sess.opts.unstable_opts.ehcont_guard) {
    cmd.ehcont_guard();
  }

  add_rpath_args(cmd, sess, crate_info, out_filename);
}

// Write the NatVis debugger visualizer files for each crate to the temp directory and gather the file paths.
// rustc: compiler/rustc_codegen_ssa/src/back/link.rs:3333 collect_natvis_visualizers
function collect_natvis_visualizers(
  tmpdir: string,
  sess: Session,
  crate_name: Symbol,
  natvis_debugger_visualizers: readonly DebuggerVisualizerFile[],
): string[] {
  const visualizer_paths: string[] = [];

  natvis_debugger_visualizers.forEach((visualizer, index) => {
    const visualizer_out_file = path_join(tmpdir, `${Symbol.as_str(crate_name)}-${index}.natvis`);

    const r = fs_write(visualizer_out_file, visualizer.src);
    if (r.$ === "Ok") {
      visualizer_paths.push(visualizer_out_file);
    } else {
      sess.dcx().emit_warn(UnableToWriteDebuggerVisualizer_diagnostic({ path: visualizer_out_file, error: r._0 }));
    }
  });
  return visualizer_paths;
}

// rustc: compiler/rustc_codegen_ssa/src/back/link.rs:3359 add_native_libs_from_crate
function add_native_libs_from_crate(
  cmd: Linker,
  sess: Session,
  archive_builder_builder: ArchiveBuilderBuilder,
  rmeta_link_cache: RmetaLinkCache,
  crate_info: CrateInfo,
  tmpdir: string,
  bundled_libs: ReadonlySet<Symbol>,
  cnum: CrateNum,
  link_static: boolean,
  link_dynamic: boolean,
  link_output_kind: LinkOutputKind,
): void {
  if (!sess.opts.unstable_opts.link_native_libraries) {
    // If `-Zlink-native-libraries=false` is set, then the assumption is that an
    // external build system already has the native dependencies defined, and it
    // will provide them to the linker itself.
    return;
  }

  if (link_static && cnum !== LOCAL_CRATE && bundled_libs.size !== 0) {
    // If rlib contains native libs as archives, unpack them to tmpdir.
    const rlib = unwrap(crate_info_used_crate_source(crate_info, cnum).rlib);
    const r = xlane.extract_bundled_libs(archive_builder_builder, rlib, tmpdir, bundled_libs);
    if (r.$ === "Err") sess.dcx().emit_fatal(ExtractBundledLibsError_diagnostic(r._0));
  }

  let native_libs: readonly NativeLib[];
  let bundled_filenames: readonly (Symbol | undefined)[];
  if (cnum === LOCAL_CRATE) {
    // Bundled libraries are only linked by path for upstream crates, so the local crate
    // never needs their filenames.
    native_libs = crate_info.used_libraries;
    bundled_filenames = [];
  } else {
    native_libs = crate_info_native_libraries(crate_info, cnum);
    const rlib_path = crate_info_used_crate_source(crate_info, cnum).rlib;
    bundled_filenames = rlib_path !== undefined ? rmeta_link_cache.native_lib_filenames(sess.target, rlib_path, native_libs) : [];
  }

  // `let mut last = (None, NativeLibKind::Unspecified, false);`
  let last: [Symbol | undefined, NativeLibKind, boolean] = [undefined, NativeLibKind.Unspecified, false];
  for (let i = 0; i < native_libs.length; i++) {
    const lib = native_libs[i]!;
    if (!relevant_lib(sess, lib)) {
      continue;
    }

    // Skip if this library is the same as the last.
    if (lib.name === last[0] && NativeLibKind_eq(lib.kind, last[1]) && lib.verbatim === last[2]) {
      continue;
    } else {
      last = [lib.name, lib.kind, lib.verbatim];
    }

    const name = Symbol.as_str(lib.name);
    const verbatim = lib.verbatim;
    const kind = lib.kind;
    switch (kind.$) {
      case "Static": {
        if (link_static) {
          const bundle = kind.bundle ?? true;
          const whole_archive = kind.whole_archive === true;
          if (bundle && cnum !== LOCAL_CRATE) {
            // `bundled_filenames.get(i).copied().flatten()`
            const filename = bundled_filenames[i];
            if (filename !== undefined) {
              // If rlib contains native libs as archives, they are unpacked to tmpdir.
              const path = path_join(tmpdir, Symbol.as_str(filename));
              cmd.link_staticlib_by_path(path, whole_archive);
            }
          } else {
            cmd.link_staticlib_by_name(name, verbatim, whole_archive);
          }
        }
        break;
      }
      case "Dylib": {
        if (link_dynamic) {
          cmd.link_dylib_by_name(name, verbatim, kind.as_needed ?? true);
        }
        break;
      }
      case "Unspecified": {
        // If we are generating a static binary, prefer static library when the
        // link kind is unspecified.
        if (!LinkOutputKind.can_link_dylib(link_output_kind) && !sess.target.options.crt_static_allows_dylibs) {
          if (link_static) {
            cmd.link_staticlib_by_name(name, verbatim, false);
          }
        } else if (link_dynamic) {
          cmd.link_dylib_by_name(name, verbatim, true);
        }
        break;
      }
      case "Framework": {
        if (link_dynamic) {
          cmd.link_framework_by_name(name, verbatim, kind.as_needed ?? true);
        }
        break;
      }
      case "RawDylib": {
        // Handled separately in `linker_with_args`.
        break;
      }
      case "WasmImportModule":
        break;
      case "LinkArg": {
        if (link_static) {
          if (verbatim) {
            cmd.verbatim_arg(name);
          } else {
            cmd.link_arg(name);
          }
        }
        break;
      }
    }
  }
}

// rustc: compiler/rustc_codegen_ssa/src/back/link.rs:3472 add_local_native_libraries
function add_local_native_libraries(
  cmd: Linker,
  sess: Session,
  archive_builder_builder: ArchiveBuilderBuilder,
  rmeta_link_cache: RmetaLinkCache,
  crate_info: CrateInfo,
  tmpdir: string,
  link_output_kind: LinkOutputKind,
): void {
  // All static and dynamic native library dependencies are linked to the local crate.
  const link_static = true;
  const link_dynamic = true;
  add_native_libs_from_crate(
    cmd,
    sess,
    archive_builder_builder,
    rmeta_link_cache,
    crate_info,
    tmpdir,
    new Set(),
    LOCAL_CRATE,
    link_static,
    link_dynamic,
    link_output_kind,
  );
}

// rustc: compiler/rustc_codegen_ssa/src/back/link.rs:3499 add_upstream_rust_crates
function add_upstream_rust_crates(
  cmd: Linker,
  sess: Session,
  archive_builder_builder: ArchiveBuilderBuilder,
  rmeta_link_cache: RmetaLinkCache,
  crate_info: CrateInfo,
  crate_type: CrateType,
  tmpdir: string,
  link_output_kind: LinkOutputKind,
): void {
  // All of the heavy lifting has previously been accomplished by the
  // dependency_format module of the compiler. This is just crawling the
  // output of that module, adding crates as necessary.
  //
  // Linking to a rlib involves just passing it to the linker (the linker
  // will slurp up the object files inside), and linking to a dynamic library
  // involves just passing the right -l flag.
  const data = crate_info.dependency_formats.get(crate_type);
  if (data === undefined) panic("failed to find crate type in dependency format list");

  if (sess.target.options.is_like_aix) {
    // Unlike ELF linkers, AIX doesn't feature `DT_SONAME` to override
    // the dependency name when outputting a shared library. Thus, `ld` will
    // use the full path to shared libraries as the dependency if passed it
    // by default unless `noipath` is passed.
    // https://www.ibm.com/docs/en/aix/7.3?topic=l-ld-command.
    cmd.link_or_cc_arg("-bnoipath");
  }

  for (const cnum of crate_info.used_crates) {
    // We may not pass all crates through to the linker. Some crates may appear statically in
    // an existing dylib, meaning we'll pick up all the symbols from the dylib.
    // We must always link crates `compiler_builtins` and `profiler_builtins` statically.
    // Even if they were already included into a dylib
    // (e.g. `libstd` when `-C prefer-dynamic` is used).
    // HACK: `dependency_formats` can report `profiler_builtins` as `NotLinked`.
    // See the comment in inject_profiler_runtime for why this is the case.
    const linkage = vec_index(data, cnum);
    const link_static_crate =
      linkage === "Static" ||
      ((linkage === "IncludedFromDylib" || linkage === "NotLinked") && (crate_info.compiler_builtins === cnum || crate_info.profiler_runtime === cnum));

    // `FxIndexSet<Symbol>`
    let bundled_libs = new Set<Symbol>();
    switch (linkage) {
      case "Static":
      case "IncludedFromDylib":
      case "NotLinked": {
        if (link_static_crate) {
          const rlib_path = crate_info_used_crate_source(crate_info, cnum).rlib;
          if (rlib_path !== undefined) {
            bundled_libs = new Set();
            for (const f of rmeta_link_cache.native_lib_filenames(sess.target, rlib_path, crate_info_native_libraries(crate_info, cnum))) {
              if (f !== undefined) bundled_libs.add(f);
            }
          }
          add_static_crate(cmd, sess, archive_builder_builder, rmeta_link_cache, crate_info, tmpdir, cnum, bundled_libs);
        }
        break;
      }
      case "Dynamic": {
        const src = crate_info_used_crate_source(crate_info, cnum);
        add_dynamic_crate(cmd, sess, unwrap(src.dylib));
        break;
      }
    }

    // Static libraries are linked for a subset of linked upstream crates.
    // 1. If the upstream crate is a directly linked rlib then we must link the native library
    // because the rlib is just an archive.
    // 2. If the upstream crate is a dylib or a rlib linked through dylib, then we do not link
    // the native library because it is already linked into the dylib, and even if
    // inline/const/generic functions from the dylib can refer to symbols from the native
    // library, those symbols should be exported and available from the dylib anyway.
    // 3. Libraries bundled into `(compiler,profiler)_builtins` are special, see above.
    const link_static = link_static_crate;
    // Dynamic libraries are not linked here, see the FIXME in `add_upstream_native_libraries`.
    const link_dynamic = false;
    add_native_libs_from_crate(
      cmd,
      sess,
      archive_builder_builder,
      rmeta_link_cache,
      crate_info,
      tmpdir,
      bundled_libs,
      cnum,
      link_static,
      link_dynamic,
      link_output_kind,
    );
  }
}

// rustc: compiler/rustc_codegen_ssa/src/back/link.rs:3604 add_upstream_native_libraries
function add_upstream_native_libraries(
  cmd: Linker,
  sess: Session,
  archive_builder_builder: ArchiveBuilderBuilder,
  rmeta_link_cache: RmetaLinkCache,
  crate_info: CrateInfo,
  tmpdir: string,
  link_output_kind: LinkOutputKind,
): void {
  for (const cnum of crate_info.used_crates) {
    // Static libraries are not linked here, they are linked in `add_upstream_rust_crates`.
    // FIXME: Merge this function to `add_upstream_rust_crates` so that all native libraries
    // are linked together with their respective upstream crates, and in their originally
    // specified order. This is slightly breaking due to our use of `--as-needed` (see crater
    // results in https://github.com/rust-lang/rust/pull/102832#issuecomment-1279772306).
    const link_static = false;
    // Dynamic libraries are linked for all linked upstream crates.
    // 1. If the upstream crate is a directly linked rlib then we must link the native library
    // because the rlib is just an archive.
    // 2. If the upstream crate is a dylib or a rlib linked through dylib, then we have to link
    // the native library too because inline/const/generic functions from the dylib can refer
    // to symbols from the native library, so the native library providing those symbols should
    // be available when linking our final binary.
    const link_dynamic = true;
    add_native_libs_from_crate(
      cmd,
      sess,
      archive_builder_builder,
      rmeta_link_cache,
      crate_info,
      tmpdir,
      new Set(),
      cnum,
      link_static,
      link_dynamic,
      link_output_kind,
    );
  }
}

// Rehome lib paths (which exclude the library file name) that point into the sysroot lib directory
// to be relative to the sysroot directory, which may be a relative path specified by the user.
//
// If the sysroot is a relative path, and the sysroot libs are specified as an absolute path, the
// linker command line can be non-deterministic due to the paths including the current working
// directory. The linker command line needs to be deterministic since it appears inside the PDB
// file generated by the MSVC linker. See https://github.com/rust-lang/rust/issues/112586.
//
// The returned path will always have `fix_windows_verbatim_for_gcc()` applied to it.
// rustc: compiler/rustc_codegen_ssa/src/back/link.rs:3653 rehome_sysroot_lib_dir
function rehome_sysroot_lib_dir(sess: Session, lib_dir: string): string {
  const sysroot_lib_path = sess.target_tlib_path.dir;
  const c1 = try_canonicalize(sysroot_lib_path);
  const canonical_sysroot_lib_path = c1.$ === "Ok" ? c1._0 : sysroot_lib_path;

  const c2 = try_canonicalize(lib_dir);
  const canonical_lib_dir = c2.$ === "Ok" ? c2._0 : lib_dir;
  if (path_eq(canonical_lib_dir, canonical_sysroot_lib_path)) {
    // This path already had `fix_windows_verbatim_for_gcc()` applied if needed.
    return sysroot_lib_path;
  } else {
    return fix_windows_verbatim_for_gcc(lib_dir);
  }
}

// rustc: compiler/rustc_codegen_ssa/src/back/link.rs:3667 rehome_lib_path
function rehome_lib_path(sess: Session, path: string): string {
  const dir = path_parent(path);
  if (dir !== undefined) {
    const file_name = path_file_name(path);
    if (file_name === undefined) return panic("library path has no file name component");
    return path_join(rehome_sysroot_lib_dir(sess, dir), file_name);
  } else {
    return fix_windows_verbatim_for_gcc(path);
  }
}

// Adds the static "rlib" versions of all crates to the command line.
// There's a bit of magic which happens here specifically related to LTO,
// namely that we remove upstream object files.
//
// When performing LTO, almost(*) all of the bytecode from the upstream
// libraries has already been included in our object file output. As a
// result we need to remove the object files in the upstream libraries so
// the linker doesn't try to include them twice (or whine about duplicate
// symbols). We must continue to include the rest of the rlib, however, as
// it may contain static native libraries which must be linked in.
//
// (*) Crates marked with `#![no_builtins]` don't participate in LTO and
// their bytecode wasn't included. The object files in those libraries must
// still be passed to the linker.
//
// Note, however, that if we're not doing LTO we can just pass the rlib
// blindly to the linker (fast) because it's fine if it's not actually
// included as we're at the end of the dependency chain.
// rustc: compiler/rustc_codegen_ssa/src/back/link.rs:3694 add_static_crate
function add_static_crate(
  cmd: Linker,
  sess: Session,
  archive_builder_builder: ArchiveBuilderBuilder,
  rmeta_link_cache: RmetaLinkCache,
  crate_info: CrateInfo,
  tmpdir: string,
  cnum: CrateNum,
  bundled_lib_file_names_: ReadonlySet<Symbol>,
): void {
  const src = crate_info_used_crate_source(crate_info, cnum);
  const cratepath = unwrap(src.rlib);

  const link_upstream = (path: string): void => {
    cmd.link_staticlib_by_path(rehome_lib_path(sess, path), false);
  };

  if (!are_upstream_rust_objects_already_included(sess) || ignored_for_lto(sess, crate_info, cnum)) {
    link_upstream(cratepath);
    return;
  }

  const dst = path_join(tmpdir, unwrap(path_file_name(cratepath)));
  const name_ = unwrap(path_file_name(cratepath));
  const name = name_.slice(3, name_.length - 5); // chop off lib/.rlib
  const bundled_lib_file_names = new Set(bundled_lib_file_names_);

  // sess.prof.generic_activity_with_arg("link_altering_rlib", name).run(|| { .. })
  // PORT: the self-profiler activity records nothing here (`-Zself-profile` is not ported); the closure runs as is.
  void name;
  {
    const upstream_rust_objects_already_included = are_upstream_rust_objects_already_included(sess);
    const is_builtins = sess.target.options.no_builtins || !crate_info.is_no_builtins.has(cnum);

    const archive = archive_builder_builder.new_archive_builder(sess);
    const r = archive.add_archive(cratepath, {
      $: "Rlib",
      _0: rmeta_link_cache,
      _1: (f: string, entry_kind: ArchiveEntryKind): boolean => {
        if (f === METADATA_FILENAME || f === rmeta_link.FILENAME) {
          return true;
        }

        // If we're performing LTO and this is a rust-generated object
        // file, then we don't need the object file as it's part of the
        // LTO module. Note that `#![no_builtins]` is excluded from LTO,
        // though, so we let that object file slide.
        if (upstream_rust_objects_already_included && entry_kind === "RustObj" && is_builtins) {
          return true;
        }

        // We skip native libraries because:
        // 1. This native libraries won't be used from the generated rlib,
        //    so we can throw them away to avoid the copying work.
        // 2. We can't allow it to be a single remaining entry in archive
        //    as some linkers may complain on that.
        if (bundled_lib_file_names.has(Symbol.intern(f))) {
          return true;
        }

        return false;
      },
    });
    if (r.$ === "Err") {
      sess.dcx().emit_fatal(RlibArchiveBuildFailure_diagnostic({ path: cratepath, error: r._0 }));
    }
    if (xlane.ArchiveBuilder_build(archive, dst, undefined)) {
      link_upstream(dst);
    }
  }
}

// Same thing as above, but for dynamic crates instead of static crates.
// rustc: compiler/rustc_codegen_ssa/src/back/link.rs:3769 add_dynamic_crate
function add_dynamic_crate(cmd: Linker, sess: Session, cratepath: string): void {
  cmd.link_dylib_by_path(rehome_lib_path(sess, cratepath), true);
}

// rustc: compiler/rustc_codegen_ssa/src/back/link.rs:3773 relevant_lib
export function relevant_lib(sess: Session, lib: NativeLib): boolean {
  const cfg = lib.cfg as Parameters<typeof eval_config_entry>[1] | undefined;
  if (cfg !== undefined) {
    return EvalConfigResult.as_bool(eval_config_entry(sess, cfg));
  } else {
    return true;
  }
}

// rustc: compiler/rustc_codegen_ssa/src/back/link.rs:3780 are_upstream_rust_objects_already_included
export function are_upstream_rust_objects_already_included(sess: Session): boolean {
  switch (sess.lto()) {
    case "Fat":
      return true;
    case "Thin":
      // If we defer LTO to the linker, we haven't run LTO ourselves, so
      // any upstream object files have not been copied yet.
      return !LinkerPluginLto.enabled(sess.opts.cg.linker_plugin_lto);
    case "No":
    case "ThinLocal":
      return false;
  }
}

/// We need to communicate five things to the linker on Apple/Darwin targets:
/// - The architecture.
/// - The operating system (and that it's an Apple platform).
/// - The environment.
/// - The deployment target.
/// - The SDK version.
// rustc: compiler/rustc_codegen_ssa/src/back/link.rs:3798 add_apple_link_args
function add_apple_link_args(cmd: Linker, sess: Session, flavor: LinkerFlavor): void {
  if (!sess.target.options.is_like_darwin) {
    return;
  }
  if (flavor.$ !== "Darwin") {
    return;
  }
  const cc = flavor._0;

  // `sess.target.arch` (`target_arch`) is not detailed enough.
  const dash = sess.target.llvm_target.indexOf("-");
  if (dash < 0) panic("LLVM target must have arch");
  const llvm_arch = sess.target.llvm_target.slice(0, dash);
  const target_os = sess.target.options.os;
  const target_env = sess.target.options.env;

  // The architecture name to forward to the linker.
  //
  // Supported architecture names can be found in the source:
  // https://github.com/apple-oss-distributions/ld64/blob/ld64-951.9/src/abstraction/MachOFileAbstraction.hpp#L578-L648
  //
  // Intentionally verbose to ensure that the list always matches correctly
  // with the list in the source above.
  let ld64_arch: string;
  switch (llvm_arch) {
    case "armv7k":
      ld64_arch = "armv7k";
      break;
    case "armv7s":
      ld64_arch = "armv7s";
      break;
    case "arm64":
      ld64_arch = "arm64";
      break;
    case "arm64e":
      ld64_arch = "arm64e";
      break;
    case "arm64_32":
      ld64_arch = "arm64_32";
      break;
    // ld64 doesn't understand i686, so fall back to i386 instead.
    //
    // Same story when linking with cc, since that ends up invoking ld64.
    case "i386":
    case "i686":
      ld64_arch = "i386";
      break;
    case "x86_64":
      ld64_arch = "x86_64";
      break;
    case "x86_64h":
      ld64_arch = "x86_64h";
      break;
    default:
      return bug(`unsupported architecture in Apple target: ${sess.target.llvm_target}`);
  }

  if (cc === "No") {
    // From the man page for ld64 (`man ld`):
    // > The linker accepts universal (multiple-architecture) input files,
    // > but always creates a "thin" (single-architecture), standard
    // > Mach-O output file. The architecture for the output file is
    // > specified using the -arch option.
    //
    // The linker has heuristics to determine the desired architecture,
    // but to be safe, and to avoid a warning, we set the architecture
    // explicitly.
    cmd.link_args(["-arch", ld64_arch]);

    // Man page says that ld64 supports the following platform names:
    // > - macos
    // > - ios
    // > - tvos
    // > - watchos
    // > - bridgeos
    // > - visionos
    // > - xros
    // > - mac-catalyst
    // > - ios-simulator
    // > - tvos-simulator
    // > - watchos-simulator
    // > - visionos-simulator
    // > - xros-simulator
    // > - driverkit
    let platform_name: string;
    if (target_env.$ === "Unspecified") {
      platform_name = Os.desc(target_os);
    } else if (target_os.$ === "IOs" && target_env.$ === "MacAbi") {
      platform_name = "mac-catalyst";
    } else if (target_os.$ === "IOs" && target_env.$ === "Sim") {
      platform_name = "ios-simulator";
    } else if (target_os.$ === "TvOs" && target_env.$ === "Sim") {
      platform_name = "tvos-simulator";
    } else if (target_os.$ === "WatchOs" && target_env.$ === "Sim") {
      platform_name = "watchos-simulator";
    } else if (target_os.$ === "VisionOs" && target_env.$ === "Sim") {
      platform_name = "visionos-simulator";
    } else {
      return bug(`invalid OS/env combination for Apple target: ${Os.desc(target_os)}, ${Env.desc(target_env)}`);
    }

    const min_version = sess.apple_deployment_target().fmt_full();

    // The SDK version is used at runtime when compiling with a newer SDK / version of Xcode:
    // - By dyld to give extra warnings and errors, see e.g.:
    //   <https://github.com/apple-oss-distributions/dyld/blob/dyld-1165.3/common/MachOFile.cpp#L3029>
    //   <https://github.com/apple-oss-distributions/dyld/blob/dyld-1165.3/common/MachOFile.cpp#L3738-L3857>
    // - By system frameworks to change certain behaviour. For example, the default value of
    //   `-[NSView wantsBestResolutionOpenGLSurface]` is `YES` when the SDK version is >= 10.15.
    //   <https://developer.apple.com/documentation/appkit/nsview/1414938-wantsbestresolutionopenglsurface?language=objc>
    //
    // We do not currently know the actual SDK version though, so we have a few options:
    // 1. Use the minimum version supported by rustc.
    // 2. Use the same as the deployment target.
    // 3. Use an arbitrary recent version.
    // 4. Omit the version.
    //
    // The first option is too low / too conservative, and means that users will not get the
    // same behaviour from a binary compiled with rustc as with one compiled by clang.
    //
    // The second option is similarly conservative, and also wrong since if the user specified a
    // higher deployment target than the SDK they're compiling/linking with, the runtime might
    // make invalid assumptions about the capabilities of the binary.
    //
    // The third option requires that `rustc` is periodically kept up to date with Apple's SDK
    // version, and is also wrong for similar reasons as above.
    //
    // The fourth option is bad because while `ld`, `otool`, `vtool` and such understand it to
    // mean "absent" or `n/a`, dyld doesn't actually understand it, and will end up interpreting
    // it as 0.0, which is again too low/conservative.
    //
    // Currently, we lie about the SDK version, and choose the second option.
    //
    // FIXME(madsmtm): Parse the SDK version from the SDK root instead.
    // <https://github.com/rust-lang/rust/issues/129432>
    const sdk_version = min_version;

    // From the man page for ld64 (`man ld`):
    // > This is set to indicate the platform, oldest supported version of
    // > that platform that output is to be used on, and the SDK that the
    // > output was built against.
    //
    // Like with `-arch`, the linker can figure out the platform versions
    // itself from the binaries being linked, but to be safe, we specify
    // the desired versions here explicitly.
    cmd.link_args(["-platform_version", platform_name, min_version, sdk_version]);
  } else {
    // cc == Cc::Yes
    //
    // We'd _like_ to use `-target` everywhere, since that can uniquely
    // communicate all the required details except for the SDK version
    // (which is read by Clang itself from the SDKROOT), but that doesn't
    // work on GCC, and since we don't know whether the `cc` compiler is
    // Clang, GCC, or something else, we fall back to other options that
    // also work on GCC when compiling for macOS.
    //
    // Targets other than macOS are ill-supported by GCC (it doesn't even
    // support e.g. `-miphoneos-version-min`), so in those cases we can
    // fairly safely use `-target`. See also the following, where it is
    // made explicit that the recommendation by LLVM developers is to use
    // `-target`: <https://github.com/llvm/llvm-project/issues/88271>
    if (target_os.$ === "MacOs") {
      // `-arch` communicates the architecture.
      //
      // CC forwards the `-arch` to the linker, so we use the same value
      // here intentionally.
      cmd.cc_args(["-arch", ld64_arch]);

      // The presence of `-mmacosx-version-min` makes CC default to
      // macOS, and it sets the deployment target.
      const version = sess.apple_deployment_target().fmt_full();
      // Intentionally pass this as a single argument, Clang doesn't
      // seem to like it otherwise.
      cmd.cc_arg(`-mmacosx-version-min=${version}`);

      // macOS has no environment, so with these two, we've told CC the
      // four desired parameters.
      //
      // We avoid `-m32`/`-m64`, as this is already encoded by `-arch`.
    } else {
      cmd.cc_args(["-target", versioned_llvm_target(sess.early_sess)]);
    }
  }
}

// rustc: compiler/rustc_codegen_ssa/src/back/link.rs:3954 add_apple_sdk
function add_apple_sdk(cmd: Linker, sess: Session, flavor: LinkerFlavor): string | undefined {
  if (!sess.target.options.is_like_darwin) {
    return undefined;
  }
  if (flavor.$ !== "Darwin") {
    return undefined;
  }
  const cc = flavor._0;

  // The default compiler driver on macOS is at `/usr/bin/cc`. This is a trampoline binary that
  // effectively invokes `xcrun cc` internally to look up both the compiler binary and the SDK
  // root from the current Xcode installation. When cross-compiling, when `rustc` is invoked
  // inside Xcode, or when invoking the linker directly, this default logic is unsuitable, so
  // instead we invoke `xcrun` manually.
  //
  // (Note that this doesn't mean we get a duplicate lookup here - passing `SDKROOT` below will
  // cause the trampoline binary to skip looking up the SDK itself).
  const sdkroot = sess.time("get_apple_sdk_root", () => get_apple_sdk_root(sess));
  if (sdkroot === undefined) return undefined;

  if (cc === "Yes") {
    // There are a few options to pass the SDK root when linking with a C/C++ compiler:
    // - The `--sysroot` flag.
    // - The `-isysroot` flag.
    // - The `SDKROOT` environment variable.
    //
    // `--sysroot` isn't actually enough to get Clang to treat it as a platform SDK, you need
    // to specify `-isysroot`. This is admittedly a bit strange, as on most targets `-isysroot`
    // only applies to include header files, but on Apple targets it also applies to libraries
    // and frameworks.
    //
    // This leaves the choice between `-isysroot` and `SDKROOT`. Both are supported by Clang and
    // GCC, though they may not be supported by all compiler drivers. We choose `SDKROOT`,
    // primarily because that is the same interface that is used when invoking the tool under
    // `xcrun -sdk macosx $tool`.
    //
    // In that sense, if a given compiler driver does not support `SDKROOT`, the blame is fairly
    // clearly in the tool in question, since they also don't support being run under `xcrun`.
    //
    // Additionally, `SDKROOT` is an environment variable and thus optional. It also has lower
    // precedence than `-isysroot`, so a custom compiler driver that does not support it and
    // instead figures out the SDK on their own can easily do so by using `-isysroot`.
    //
    // (This in particular affects Clang built with the `DEFAULT_SYSROOT` CMake flag, such as
    // the one provided by some versions of Homebrew's `llvm` package. Those will end up
    // ignoring the value we set here, and instead use their built-in sysroot).
    cmd.cmd().env("SDKROOT", sdkroot);
  } else {
    // When invoking the linker directly, we use the `-syslibroot` parameter. `SDKROOT` is not
    // read by the linker, so it's really the only option.
    //
    // This is also what Clang does.
    cmd.link_arg("-syslibroot");
    cmd.link_arg(sdkroot);
  }

  return sdkroot;
}

// rustc: compiler/rustc_codegen_ssa/src/back/link.rs:4011 get_apple_sdk_root
function get_apple_sdk_root(sess: Session): string | undefined {
  const sdkroot_ = var_("SDKROOT");
  if (sdkroot_.$ === "Ok") {
    const sdkroot = sdkroot_._0;
    const p = sdkroot;

    // Ignore invalid SDKs, similar to what clang does:
    // https://github.com/llvm/llvm-project/blob/llvmorg-19.1.6/clang/lib/Driver/ToolChains/Darwin.cpp#L2212-L2229
    //
    // NOTE: Things are complicated here by the fact that `rustc` can be run by Cargo to compile
    // build scripts and proc-macros for the host, and thus we need to ignore SDKROOT if it's
    // clearly set for the wrong platform.
    //
    // FIXME(madsmtm): Make this more robust (maybe read `SDKSettings.json` like Clang does?).
    const has = (s: string): boolean => sdkroot.includes(s);
    const name = xlane.apple_sdk_name(sess.target).toLowerCase();
    const ignored =
      (name === "appletvos" && (has("TVSimulator.platform") || has("MacOSX.platform"))) ||
      (name === "appletvsimulator" && (has("TVOS.platform") || has("MacOSX.platform"))) ||
      (name === "iphoneos" && (has("iPhoneSimulator.platform") || has("MacOSX.platform"))) ||
      (name === "iphonesimulator" && (has("iPhoneOS.platform") || has("MacOSX.platform"))) ||
      (name === "macosx" &&
        (has("iPhoneOS.platform") ||
          has("iPhoneSimulator.platform") ||
          has("AppleTVOS.platform") ||
          has("AppleTVSimulator.platform") ||
          has("WatchOS.platform") ||
          has("WatchSimulator.platform") ||
          has("XROS.platform") ||
          has("XRSimulator.platform"))) ||
      (name === "watchos" && (has("WatchSimulator.platform") || has("MacOSX.platform"))) ||
      (name === "watchsimulator" && (has("WatchOS.platform") || has("MacOSX.platform"))) ||
      (name === "xros" && (has("XRSimulator.platform") || has("MacOSX.platform"))) ||
      (name === "xrsimulator" && (has("XROS.platform") || has("MacOSX.platform"))) ||
      // Ignore `SDKROOT` if it's not a valid path.
      !path_is_absolute(p) ||
      path_eq(p, "/") ||
      !path_exists(p);
    if (!ignored) {
      return p;
    }
  }

  return xlane.apple_get_sdk_root(sess);
}

/// When using the linker flavors opting in to `lld`, add the necessary paths and arguments to
/// invoke it:
/// - when the self-contained linker flag is active: the build of `lld` distributed with rustc,
/// - or any `lld` available to `cc`.
// rustc: compiler/rustc_codegen_ssa/src/back/link.rs:4067 add_lld_args
function add_lld_args(cmd: Linker, sess: Session, flavor: LinkerFlavor, self_contained_components: LinkSelfContainedComponents): void {
  // debug!("add_lld_args requested, flavor: '{:?}', target self-contained components: {:?}", flavor, self_contained_components);

  // If the flavor doesn't use a C/C++ compiler to invoke the linker, or doesn't opt in to `lld`,
  // we don't need to do anything.
  if (!(LinkerFlavor.uses_cc(flavor) && LinkerFlavor.uses_lld(flavor))) {
    return;
  }

  // 1. Implement the "self-contained" part of this feature by adding rustc distribution
  // directories to the tool's search path, depending on a mix between what users can specify on
  // the CLI, and what the target spec enables (as it can't disable components):
  // - if the self-contained linker is enabled on the CLI or by the target spec,
  // - and if the self-contained linker is not disabled on the CLI.
  const self_contained_cli = sess.opts.cg.link_self_contained.is_linker_enabled();
  const self_contained_target = LinkSelfContainedComponents.is_linker_enabled(self_contained_components);

  const self_contained_linker = self_contained_cli || self_contained_target;
  if (self_contained_linker && !sess.opts.cg.link_self_contained.is_linker_disabled()) {
    let linker_path_exists = false;
    for (const path of xlane.get_tools_search_paths(sess, false)) {
      const linker_path = path_join(path, "gcc-ld");
      // `|=`: every path is checked, as upstream does (no short circuit).
      linker_path_exists = path_exists(linker_path) || linker_path_exists;
      cmd.cc_arg(`-B${linker_path}`);
    }
    if (!linker_path_exists) {
      // As a sanity check, we emit an error if none of these paths exist: we want
      // self-contained linking and have no linker.
      sess.dcx().emit_fatal(SelfContainedLinkerMissing_diagnostic({}));
    }
  }

  // 2. Implement the "linker flavor" part of this feature by asking `cc` to use some kind of
  // `lld` as the linker.
  //
  // Note that wasm targets skip this step since the only option there anyway
  // is to use LLD but component-producing targets rely on a wrapper around
  // this, `wasm-component-ld`, which is overridden if this option is passed.
  if (!sess.target.options.is_like_wasm) {
    cmd.cc_arg("-fuse-ld=lld");
  }

  if (!LinkerFlavor.is_gnu(flavor)) {
    // Tell clang to use a non-default LLD flavor.
    // Gcc doesn't understand the target option, but we currently assume
    // that gcc is not used for Apple and Wasm targets (#97402).
    //
    // Note that we don't want to do that by default on macOS: e.g. passing a
    // 10.7 target to LLVM works, but not to recent versions of clang/macOS, as
    // shown in issue #101653 and the discussion in PR #101792.
    //
    // It could be required in some cases of cross-compiling with
    // LLD, but this is generally unspecified, and we don't know
    // which specific versions of clang, macOS SDK, host and target OS
    // combinations impact us here.
    //
    // So we do a simple first-approximation until we know more of what the
    // Apple targets require (and which would be handled prior to hitting this
    // LLD codepath anyway), but the expectation is that until then
    // this should be manually passed if needed. We specify the target when
    // targeting a different linker flavor on macOS, and that's also always
    // the case when targeting WASM.
    if (sess.target.options.linker_flavor !== sess.host.options.linker_flavor) {
      cmd.cc_arg(`--target=${versioned_llvm_target(sess.early_sess)}`);
    }
  }
}

// gold has been deprecated with binutils 2.44
// and is known to behave incorrectly around Rust programs.
// There have been reports of being unable to bootstrap with gold:
// https://github.com/rust-lang/rust/issues/139425
// Additionally, gold miscompiles SHF_GNU_RETAIN sections, which are
// emitted with `#[used(linker)]`.
// rustc: compiler/rustc_codegen_ssa/src/back/link.rs:4153 warn_if_linked_with_gold
function warn_if_linked_with_gold(sess: Session, path: string): Result<null, unknown> {
  // rustc: compiler/rustc_codegen_ssa/src/back/link.rs:4158 elf_has_gold_version_note
  const elf_has_gold_version_note = (Self: FileHeader, elf: FileHeaderValue, data: Uint8Array): Result<boolean, unknown> => {
    const endian = FileHeader_provided.endian(Self, elf);
    if (endian.$ === "Err") return endian;

    const sections = FileHeader_provided.sections(Self, elf, endian._0, data);
    if (sections.$ === "Err") return sections;
    const section = sections._0.section_by_name(endian._0, encoder.encode(".note.gnu.gold-version"));
    if (section !== undefined) {
      // && let Some(mut notes) = section.notes(endian, data)? { return Ok(notes.any(|note| ..NT_GNU_GOLD_VERSION)); }
      return unported("object::read::elf::SectionHeader::notes (vendor object; warn_if_linked_with_gold, an ELF output with a .note.gnu.gold-version section)");
    }

    return Ok(false);
  };

  // let data = ReadCache::new(BufReader::new(File::open(path)?));
  // PORT: `ReadCache` reads ranges of the file on demand; the whole file is read here, and the same bytes are parsed.
  let data: Uint8Array;
  try {
    data = readFileSync(path);
  } catch (e) {
    return Err(e);
  }

  let was_linked_with_gold: boolean;
  if (sess.target.pointer_width === 64) {
    const elf = FileHeader_provided.parse(FileHeader64_impl, data);
    if (elf.$ === "Err") return elf;
    const r = elf_has_gold_version_note(FileHeader64_impl, elf._0, data);
    if (r.$ === "Err") return r;
    was_linked_with_gold = r._0;
  } else if (sess.target.pointer_width === 32) {
    const elf = FileHeader_provided.parse(FileHeader32_impl, data);
    if (elf.$ === "Err") return elf;
    const r = elf_has_gold_version_note(FileHeader32_impl, elf._0, data);
    if (r.$ === "Err") return r;
    was_linked_with_gold = r._0;
  } else {
    return Ok(null);
  }

  if (was_linked_with_gold) {
    const warn = sess.dcx().struct_warn("the gold linker is deprecated and has known bugs with Rust");
    warn.help("consider using LLD or ld from GNU binutils instead");
    warn.emit();
  }
  return Ok(null);
}

// ---- Helpers (not upstream) ------------------------------------------------------------------------------------------

const TARGET = "rustc_codegen_ssa::back::link";
const encoder = new TextEncoder();
const lossy_decoder = new TextDecoder("utf-8", { ignoreBOM: true });

/** PORT: `option_env!("CFG_RELEASE_CHANNEL")` of the oracle toolchain (as in rustc_driver_impl/lib.ts). */
const CFG_RELEASE_CHANNEL: string | undefined = "nightly";
/** `cfg!(windows)` for the host rustc runs on. */
const CFG_WINDOWS = process.platform === "win32";
/** `cfg!(any(target_os = "solaris", target_os = "illumos"))` for the host rustc runs on. */
const CFG_SOLARIS_OR_ILLUMOS = process.platform === "sunos";

/** `String::from_utf8_lossy` (WHATWG decoding replaces each maximal invalid subpart with U+FFFD, as std does). */
function from_utf8_lossy(bytes: Uint8Array): string {
  return lossy_decoder.decode(bytes);
}

/** `let mut v = a.clone(); v.extend(b)`. */
function concat_bytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/** `<[u8]>::escape_ascii()`'s Display: each byte through `core::ascii::escape_default`. */
function escape_ascii(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) {
    switch (b) {
      case 0x09:
        s += "\\t";
        break;
      case 0x0d:
        s += "\\r";
        break;
      case 0x0a:
        s += "\\n";
        break;
      case 0x5c:
      case 0x27:
      case 0x22:
        s += "\\" + String.fromCharCode(b);
        break;
      default:
        s += b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : `\\x${b.toString(16).padStart(2, "0")}`;
    }
  }
  return s;
}

/**
 * `<Path as Ord>::cmp`: `Iterator::cmp` of the components, by the derived `Ord` of `Component` (variant order `Prefix`,
 * `RootDir`, `CurDir`, `ParentDir`, `Normal`, then the `OsStr`s bytewise). PORT: a `Prefix` (Windows only) compares by its
 * raw text.
 */
function path_cmp(a: string, b: string): number {
  const ca = components_keys(a);
  const cb = components_keys(b);
  for (let i = 0; i < Math.min(ca.length, cb.length); i++) {
    const [vx, x] = ca[i]!;
    const [vy, y] = cb[i]!;
    if (vx !== vy) return vx - vy;
    if (x !== y) return x < y ? -1 : 1;
  }
  return ca.length - cb.length;
}
const COMPONENT_ORDER = ["Prefix", "RootDir", "CurDir", "ParentDir", "Normal"];
/** Each component as (variant index, its text as a string of its UTF-8 bytes, one char per byte, so `<` is bytewise). */
function components_keys(p: string): [number, string][] {
  const out: [number, string][] = [];
  const comps = path_components(p);
  for (let c = comps.next(); c !== undefined; c = comps.next()) {
    const text = c.$ === "Normal" ? c._0 : c.$ === "Prefix" ? c.raw : "";
    out.push([COMPONENT_ORDER.indexOf(c.$), String.fromCharCode(...encoder.encode(text))]);
  }
  return out;
}

/** `Path::with_extension`: the file name's extension replaced by (or extended with) `ext`. */
function path_with_extension(path: string, ext: string): string {
  const stem = path_file_stem(path);
  if (stem === undefined) return path;
  const parent = path_parent(path);
  const name = ext === "" ? stem : `${stem}.${ext}`;
  return parent === undefined || parent === "" ? name : path_join(parent, name);
}

/** `rustc_fs_util::fix_windows_verbatim_for_gcc`: the `#[cfg(not(windows))]` version is `p.to_path_buf()`. */
function fix_windows_verbatim_for_gcc(p: string): string {
  if (CFG_WINDOWS) return unported("rustc_fs_util::fix_windows_verbatim_for_gcc (Windows host)");
  return p;
}

/** `env::join_paths(paths).unwrap()` on unix: joined with `:`; a path holding the separator is an error. */
function join_paths(paths: readonly string[]): string {
  if (CFG_WINDOWS) return unported("std::env::join_paths (Windows host)");
  for (const p of paths) {
    if (p.includes(":")) return panic('called `Result::unwrap()` on an `Err` value: JoinPathsError { inner: JoinPathsError }');
  }
  return paths.join(":");
}

/** `crate_info.used_crate_source[&cnum]` (an `UnordMap` index: panics on a missing key, as `HashMap`'s does). */
function crate_info_used_crate_source(crate_info: CrateInfo, cnum: CrateNum): CrateSource {
  const src = crate_info.used_crate_source.get(cnum);
  if (src === undefined) return panic("no entry found for key");
  return src;
}

/** `crate_info.crate_name[&cnum]` (an `UnordMap` index: panics on a missing key, as `HashMap`'s does). */
function crate_info_crate_name(crate_info: CrateInfo, cnum: CrateNum): Symbol {
  const name = crate_info.crate_name.get(cnum);
  if (name === undefined) return panic("no entry found for key");
  return name;
}

/** `map[&key]` of an `UnordMap` (`"no entry found for key"`) or an `FxIndexMap` (`"IndexMap: key not found"`). */
function index_map_get<K, V>(map: ReadonlyMap<K, V>, key: K, message: string): V {
  const v = map.get(key);
  if (v === undefined) return panic(message);
  return v;
}

/** `slice[i]` / `IndexVec[i]`: panics out of bounds with core's message. */
function vec_index<T>(v: readonly T[], i: number): T {
  if (i >= v.length) return panic(`index out of bounds: the len is ${v.length} but the index is ${i}`);
  return v[i]!;
}

/** `fs::write(path, bytes)`. */
function fs_write(path: string, bytes: Uint8Array): IoResult<null> {
  try {
    writeFileSync(path, bytes);
    return Ok(null);
  } catch (e) {
    return Err(io_error_from_node(e));
  }
}

/** `fs::create_dir(path)` (not recursive). */
function fs_create_dir(path: string): IoResult<null> {
  try {
    mkdirSync(path);
    return Ok(null);
  } catch (e) {
    return Err(io_error_from_node(e));
  }
}

/** `Path::is_file`: `fs::metadata(path).map(|m| m.is_file()).unwrap_or(false)`. */
function path_is_file(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** `io::Error::new(kind, error)`: a boxed `StringError` of the error's `Display`. */
function io_error_new(kind: ErrorKind, error: string): IoError {
  return { $: "Custom", kind, error };
}

/** `libc::E2BIG` of the host (`#[cfg(unix)]` `command_line_too_big`). */
const LIBC_E2BIG: number = (require("node:os") as typeof import("node:os")).constants.errno.E2BIG;


/** `#[derive(Debug)] struct object::write::Error(String)`. */
function debug_WriteError(e: WriteError): string {
  return `Error(${debug_str(e._0)})`;
}

/**
 * `Session::is_wasi_reactor` (rustc_session/src/session.rs:799). PORT: not in session.ts yet (rustc_session is not this lane's);
 * a copy of its body, for the owner of session.ts to take.
 */
function Session_is_wasi_reactor(sess: Session): boolean {
  return sess.target.options.os.$ === "Wasi" && sess.opts.unstable_opts.wasi_exec_model === "Reactor";
}

/**
 * `sess.host == sess.target`: the derived `PartialEq` of `rustc_target::spec::Target`. PORT: not modelled (every field,
 * the options too); only `LinkSelfContainedDefault::InferredForMingw` (windows-gnu targets) asks, so it stops by name.
 */
function Target_eq(_a: Target, _b: Target): boolean {
  return unported("rustc_target::spec::Target PartialEq (self_contained_components: InferredForMingw, windows-gnu)");
}

/** `str::cmp` for `sort_unstable_by`, with the guard below. */
function sort_native_libraries_by_name(libs: NativeLib[]): void {
  // PORT: `sort_unstable_by` is core's ipnsort, which is insertion sort (stable) for up to 20 elements
  // (core/src/slice/sort/unstable/mod.rs:49). JS's sort is stable, so the two agree there. Past 20, equal names could end
  // in another order; that shows only through the raw-dylib collations below (they read only `RawDylib` libraries, keyed
  // by name), so that case stops.
  if (libs.length > 20) {
    const seen = new Set<Symbol>();
    for (const lib of libs) {
      if (lib.kind.$ !== "RawDylib") continue;
      if (seen.has(lib.name)) return unported("core::slice::sort_unstable_by (ipnsort past 20 elements, raw-dylib libraries of one name)");
      seen.add(lib.name);
    }
  }
  libs.sort((a, b) => str_cmp(Symbol.as_str(a.name), Symbol.as_str(b.name)));
}

// ---- Stand-ins for types of other lanes (PORT) -----------------------------------------------------------------------
// `Command`, `Output`, `ExitStatus` (back/command.ts), `dyn Linker` (back/linker.ts `DynLinker`) and `ArchiveSymbols`
// (back/archive.ts) are imported (root at integ-w57).

/**
 * `rustc_data_structures::jobserver::Acquired` (what `linker_with_args` gives out); dropping releases. PORT: the port's
 * jobserver (rustc_data_structures/jobserver.ts) is single-threaded and hands out no tokens: its `client()` stops by name, and
 * vendor/jobserver has no `Acquired`. So this stays a minimal stand-in: no token is ever made, and `linker_with_args` returns
 * an empty list unless `-Zlinker-jobs`-style explicit LLD parallelism reaches `client()`, which stops.
 */
export interface JobserverAcquired {
  drop(): void;
}

/** `diagnostics::LinkingFailed<'a>` (not generated: `ExitStatus` / `Command` fields; diagnostics.ts). */
interface LinkingFailed {
  linker_path: string;
  exit_status: ExitStatus;
  command: Command;
  escaped_output: string;
  verbose: boolean;
  sysroot_dir: string;
}

/** `thorin::Error` (the `thorin-dwp` crate is not vendored). */
type ThorinError = ThorinErrorWrapper["_0"];

/** `thorin::DwarfPackage` (not vendored). */
interface DwarfPackage {
  add_input_object(path: string): Result<null, ThorinError>;
  add_executable(path: string, missing: "Skip" | "Error"): Result<null, ThorinError>;
}

/** The `thorin` crate (not vendored): every entry stops. */
const thorin = {
  /** `thorin::DwarfPackage::new(&thorin_sess)`. */
  DwarfPackage_new(_sess: unknown): DwarfPackage {
    return unported("thorin::DwarfPackage::new (crate thorin-dwp not vendored; -Csplit-debuginfo=packed on ELF)");
  },
  /**
   * The tail of `run_thorin`: open `dwp_out_filename` (read, write, create, truncate) in a `BufWriter`, wrap it in
   * `thorin::object::write::StreamingBuffer`, `package.finish()?.emit(&mut output_stream)?`, `output_stream.result()?`,
   * `output_stream.into_inner().flush()?`.
   */
  finish_and_emit(_package: DwarfPackage, _dwp_out_filename: string): Result<null, ThorinError> {
    return unported("thorin::DwarfPackage::finish (crate thorin-dwp not vendored)");
  },
};

// ---- Cross-lane forwarders ------------------------------------------------------------------------------------------
// Each entry stands for one upstream fn this file calls in another file (or one it owns that other code calls), following
// the `xlane` convention of rustc_codegen_ssa/mir/mod.ts: they forward to the ports, and tests can replace them. Methods
// take the receiver first.
export const xlane = {
  // ssa-link-b (wave 40r): link.rs :2105 to the end and link/raw_dylib.rs, in this file and link/raw_dylib.ts. Forwarders, so
  // tests can replace them.
  /** `exec_linker(sess, &cmd, out_filename, flavor, tmpdir)` (link.rs:2105). */
  exec_linker(sess: Session, cmd: Command, out_filename: string, flavor: LinkerFlavor, tmpdir: string): IoResult<Output> {
    return exec_linker(sess, cmd, out_filename, flavor, tmpdir);
  },
  /** `self_contained_components(sess, crate_type, &linker_path)` (link.rs:2312). */
  self_contained_components(sess: Session, crate_type: CrateType, linker: string): LinkSelfContainedComponents {
    return self_contained_components(sess, crate_type, linker);
  },
  /** `linker_with_args(..)` (link.rs:2870), `(Command, Vec<jobserver::Acquired>)`. */
  linker_with_args(
    path: string,
    flavor: LinkerFlavor,
    sess: Session,
    archive_builder_builder: ArchiveBuilderBuilder,
    rmeta_link_cache: RmetaLinkCache,
    crate_type: CrateType,
    tmpdir: string,
    out_filename: string,
    compiled_modules: CompiledModules,
    crate_info: CrateInfo,
    metadata: EncodedMetadata,
    self_contained_components: LinkSelfContainedComponents,
    codegen_backend: string,
  ): [Command, JobserverAcquired[]] {
    return linker_with_args(
      path,
      flavor,
      sess,
      archive_builder_builder,
      rmeta_link_cache,
      crate_type,
      tmpdir,
      out_filename,
      compiled_modules,
      crate_info,
      metadata,
      self_contained_components,
      codegen_backend,
    );
  },
  /** `relevant_lib(sess, lib)` (link.rs:3773). */
  relevant_lib(sess: Session, lib: NativeLib): boolean {
    return relevant_lib(sess, lib);
  },
  /** `raw_dylib::create_raw_dylib_dll_import_libs(sess, archive_builder_builder, used_libraries, tmpdir, is_direct_dependency)` (link/raw_dylib.rs:63). */
  create_raw_dylib_dll_import_libs(
    sess: Session,
    archive_builder_builder: ArchiveBuilderBuilder,
    used_libraries: readonly NativeLib[],
    tmpdir: string,
    is_direct_dependency: boolean,
  ): string[] {
    return raw_dylib.create_raw_dylib_dll_import_libs(sess, archive_builder_builder, used_libraries, tmpdir, is_direct_dependency);
  },

  // Vendor `object` (write/mod.ts) and back/apple.ts: forwarders to the ports (lane vendor-object-write; root at integ-w58), kept
  // so tests can replace them (lane ssa-link-b's handoff).
  /** `file.add_symbol(symbol)` (object 0.39.1 write/mod.rs `Object::add_symbol`). */
  Object_add_symbol(file: WriteObject, symbol: WriteSymbol): WriteSymbolId {
    return file.add_symbol(symbol);
  },
  /** `file.set_subsections_via_symbols()` (object 0.39.1 write/mod.rs:307). */
  Object_set_subsections_via_symbols(file: WriteObject): void {
    file.set_subsections_via_symbols();
  },
  /** `apple::add_data_and_relocation(&mut file, section, symbol, &sess.target, kind)` (apple.rs:81). */
  apple_add_data_and_relocation(file: WriteObject, section: WriteSectionId, symbol: WriteSymbolId, target: Target, kind: SymbolExportKind): Result<null, WriteError> {
    return add_data_and_relocation(file, section, symbol, target, kind);
  },
  /** `apple::get_sdk_root(sess)` (apple.rs:160). */
  apple_get_sdk_root(sess: Session): string | undefined {
    return get_sdk_root(sess);
  },
  /** `apple::sdk_name(&sess.target)` (apple.rs:19). */
  apple_sdk_name(target: Target): string {
    return sdk_name(target);
  },

  // ssa-archive: back/archive.rs provided methods (receiver first).
  /** `archive_builder_builder.create_dylib_metadata_wrapper(sess, &metadata, &crate_info.metadata_symbol)` (archive.rs:69). */
  create_dylib_metadata_wrapper(archive_builder_builder: ArchiveBuilderBuilder, sess: Session, metadata: EncodedMetadata, symbol_name: string): Uint8Array {
    return ArchiveBuilderBuilder_provided.create_dylib_metadata_wrapper(archive_builder_builder, sess, metadata, symbol_name);
  },

  // ssa-linker: back/linker.rs and back/command.rs (forwarders; root at integ-w57).
  /** `linker::disable_localization(&mut cmd)` (linker.rs:39). */
  disable_localization(cmd: Command): void {
    disable_localization(cmd);
  },
  /** `Command::new(program)` (command.rs). */
  Command_new(program: string): Command {
    return Command.new(program);
  },
  /** `format!("{cmd:?}")`: `impl fmt::Debug for Command` (command.rs:209). */
  debug_Command(cmd: Command): string {
    return debug_Command(cmd);
  },
  /** `linker.link_args(args)` on `dyn Linker` (linker.rs `generate_arg_methods!` → `link_args`, :214). */
  Linker_link_args(linker: Linker, args: readonly string[]): Linker {
    return linker.link_args(args);
  },
  /** `linker.link_arg(arg)` on `dyn Linker` (linker.rs `generate_arg_methods!` → `link_args(self, iter::once(arg))`). */
  Linker_link_arg(linker: Linker, arg: string): Linker {
    return linker.link_arg(arg);
  },

  // ssa-archive: back/archive.rs (forwarders; root at integ-w57).
  /** `archive_builder_builder.extract_bundled_libs(rlib, outdir, bundled_lib_file_names)` (archive.rs:153). */
  extract_bundled_libs(
    archive_builder_builder: ArchiveBuilderBuilder,
    rlib: string,
    outdir: string,
    bundled_lib_file_names: ReadonlySet<Symbol>,
  ): Result<null, ExtractBundledLibsError> {
    return ArchiveBuilderBuilder_provided.extract_bundled_libs(archive_builder_builder, rlib, outdir, bundled_lib_file_names);
  },
  /** `ab.build(output, symbols)` (archive.rs:554). */
  ArchiveBuilder_build(ab: ArchiveBuilder, output: string, symbols: ArchiveSymbols | undefined): boolean {
    return ab.build(output, symbols);
  },

  // `Session::get_tools_search_paths` (rustc_session/src/session.rs:825) is in session.ts (lane default-sysroot); back/linker.ts
  // keeps a forwarder of that name, which this one calls.
  /** `sess.get_tools_search_paths(self_contained)` (rustc_session/src/session.rs:825). */
  get_tools_search_paths(sess: Session, self_contained: boolean): string[] {
    return get_tools_search_paths(sess, self_contained);
  },
};
