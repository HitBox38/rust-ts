// Port of compiler/rustc_codegen_ssa/src/back/link.rs up to `exec_linker` (:2105, lane ssa-link-a, wave 40q); the rest of the
// file (`exec_linker` onwards, with link/raw_dylib.rs) is lane ssa-link-b's. Earlier lanes ported `link_binary`/`link_rlib`
// (plan-m6 D4, miri-sysroot), the native library search (link-rlib-native), `ignored_for_lto`, `each_linked_rlib`,
// `preserve_objects_for_their_debuginfo`, `are_upstream_rust_objects_already_included` and `warn_if_linked_with_gold`.
//
// PORT:
// - Calls into other lanes' functions (link.rs :2105-end, back/linker.rs, back/command.rs, back/archive.rs) go through the
//   `xlane` stub table at the end of this file, which root points at the ports as they land (mir/mod.ts convention). The
//   types those lanes own (`Command`, `dyn Linker`, `ArchiveSymbols`, `jobserver::Acquired`, `process::Output`) are
//   interface stand-ins next to it.
// - `thorin` (split DWARF packaging), `find_msvc_tools` and the Windows API (`mod win`) are not vendored: their uses stop.
// - `LinkingFailed`, `ProcessingDymutilFailed` and `StrippingDebugInfoFailed` are not generated (their `ExitStatus` /
//   `Command` fields): emitting them stops.
import * as tracing from "../../rust_ts/tracing.ts";
import { readFileSync, rmSync, statSync } from "node:fs";
import type { DiagCtxtHandle } from "../../rustc_errors/lib.ts";
import { DuplicateEiiImpls_diagnostic } from "../../rustc_middle/diagnostics.gen.ts";
import { emit_lint_base, LevelSpec } from "../../rustc_middle/lint.ts";
import { LINKER_INFO, LINKER_MESSAGES } from "../../rustc_lint_defs/builtin.gen.ts";
import { copy_to_stdout, emit_wrapper_file, MaybeTempDir, METADATA_FILENAME, TempDirBuilder } from "../../rustc_metadata/fs.ts";
import type { LinkerFeaturesCli, OutputFilenames } from "../../rustc_session/config.ts";
import { LinkerPluginLto, OutFileName, OutputType } from "../../rustc_session/config.ts";
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
import { split_paths, to_string_lossy, var_os } from "../../std/env.ts";
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
  InsufficientVSCodeProduct_diagnostic,
  LinkerFileStem_diagnostic,
  LinkerNotFound_diagnostic,
  LinkExeUnexpectedError_diagnostic,
  LinkRlibError,
  LinkRlibError_diagnostic,
  MissingCppBuildToolComponent_diagnostic,
  MissingNativeLibrary_diagnostic,
  MsvcMissingLinker_diagnostic,
  ReadFileError_diagnostic,
  RepairVSBuildTools_diagnostic,
  SelectCppBuildToolWorkload_diagnostic,
  StaticlibHideInternalSymbolsUnsupported_diagnostic,
  StaticlibRenameInternalSymbolsUnsupported_diagnostic,
  StaticLibraryNativeArtifacts_diagnostic,
  StaticLibraryNativeArtifactsToFile_diagnostic,
  type ThorinErrorWrapper,
  UnableToExeLinker_diagnostic,
  UnableToRun_diagnostic,
  UnableToRunDsymutil_diagnostic,
  VisualStudioNotInstalled_diagnostic,
} from "../diagnostics.gen.ts";
import { CopyPath, LinkExeStatusStackBufferOverrun_diagnostic, LinkingFailed_into_diag, MissingNativeLibrary, ThorinErrorWrapper_into_diag } from "../diagnostics.ts";
import { path_components, path_file_name, path_file_stem, path_join, path_parent } from "../../std/path.ts";
import { debug_IoError, io_error_from_node, IoError_kind, type IoResult } from "../../std/io.ts";
import { ControlFlow } from "../../rustc_ast_ir/visit.ts";
// Load order: rustc_target through its crate root first. spec/mod.ts imports lib.ts, which evaluates spec/json.ts and
// target_features.ts, and both read spec/mod.ts's bindings at their top level: entered from spec/mod.ts, the cycle reads `Os`
// before it exists (lanes unit-parallel, fixers-48).
import "../../rustc_target/lib.ts";
import { debug_LinkerFlavor, LinkerFeatures, LinkerFlavor, type LinkOutputKind, LinkSelfContainedComponents } from "../../rustc_target/spec/mod.ts";
import type { CrtObjects } from "../../rustc_target/spec/crt_objects.ts";
import { SanitizerSet } from "../../rustc_target/stand_ins.ts";
import { FileHeader32_impl, FileHeader64_impl, FileHeader_provided } from "../../vendor/object/read/elf/file.ts";
import type { ArchiveBuilder, ArchiveBuilderBuilder, ArchiveEntryKind } from "./archive.ts";
import { create_wrapper_file } from "./metadata.ts";
import * as rmeta_link from "./rmeta_link.ts";
import { RmetaLinkCache } from "./rmeta_link.ts";
import { LinkerOutput_diagnostic } from "./link.gen.ts";
import type { CodegenLintLevelSpecs, CompiledModule, CompiledModules, CrateInfo, NativeLib } from "../lib.ts";

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
    const name = crate_info.crate_name.get(cnum);
    if (name === undefined) return bug("CrateInfo::crate_name: no entry for the crate");
    return name;
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
    const crate_name = info.crate_name.get(cnum)!;
    const used_crate_source = info.used_crate_source.get(cnum)!;
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
function link_staticlib(
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
    const crate_name = crate_info.crate_name.get(cnum)!;
    const used_crate_source = crate_info.used_crate_source.get(cnum)!;
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
function link_natively(
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

// rustc: compiler/rustc_codegen_ssa/src/back/link.rs:4153 warn_if_linked_with_gold
function warn_if_linked_with_gold(sess: Session, path: string): Result<null, unknown> {
  // PORT: `elf_has_gold_version_note` and the warning are reached only by a real ELF output (a native link, M7): an rlib fails
  // the file header's parse, and the caller only logs that.
  // let data = ReadCache::new(BufReader::new(File::open(path)?));
  let data: Uint8Array;
  try {
    data = readFileSync(path);
  } catch (e) {
    return Err(e);
  }
  if (sess.target.pointer_width === 64) {
    const elf = FileHeader_provided.parse(FileHeader64_impl, data);
    if (elf.$ === "Err") return elf;
  } else if (sess.target.pointer_width === 32) {
    const elf = FileHeader_provided.parse(FileHeader32_impl, data);
    if (elf.$ === "Err") return elf;
  } else {
    return Ok(null);
  }
  return unported("rustc_codegen_ssa::back::link::warn_if_linked_with_gold (a native ELF output; M7)");
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

// ---- Stand-ins for types of other lanes (PORT) -----------------------------------------------------------------------
// The lanes that own them land in parallel (wave 40q); root replaces these with their exports at integration.

/** `std::process::ExitStatus`: what link.rs calls on it. */
export interface ExitStatus {
  success(): boolean;
  code(): number | undefined;
}

/** `std::process::Output`. */
export interface Output {
  status: ExitStatus;
  stdout: Uint8Array;
  stderr: Uint8Array;
}

/** `back::command::Command` (lane ssa-linker): the methods link.rs calls. Arguments are UTF-8 strings (`OsString`). */
export interface Command {
  arg(arg: string): Command;
  args(args: readonly string[]): Command;
  env(key: string, value: string): Command;
  env_remove(key: string): Command;
  get_args(): readonly string[];
  take_args(): string[];
  output(): IoResult<Output>;
}

/** `dyn back::linker::Linker` (lane ssa-linker): the trait methods link.rs :1-2104 calls. */
export interface Linker {
  link_dylib_by_name(name: string, verbatim: boolean, as_needed: boolean): void;
  link_staticlib_by_path(path: string, whole_archive: boolean): void;
}

/** `rustc_data_structures::jobserver::Acquired` (lane ssa-link-b gives them out of `linker_with_args`); dropping releases. */
export interface JobserverAcquired {
  drop(): void;
}

/** `back::archive::ArchiveSymbols` (lane ssa-archive). */
export interface ArchiveSymbols {
  exported: Set<string>;
  rename_suffix: string | undefined;
  hide: boolean;
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

// ---- Cross-lane stubs ------------------------------------------------------------------------------------------------
// Each entry stands for one upstream fn of another fill lane of wave 40q (or the next), following the `xlane` convention
// of rustc_codegen_ssa/mir/mod.ts: root points the entries at the ports when they land, and tests can replace them.
// Methods take the receiver first.
export const xlane = {
  // ssa-link-b: link.rs :2105 to the end, and link/raw_dylib.rs (next wave).
  /** `exec_linker(sess, &cmd, out_filename, flavor, tmpdir)` (link.rs:2105). */
  exec_linker(_sess: Session, _cmd: Command, _out_filename: string, _flavor: LinkerFlavor, _tmpdir: string): IoResult<Output> {
    return unported("ssa-link-b: exec_linker");
  },
  /** `self_contained_components(sess, crate_type, &linker_path)` (link.rs:2312). */
  self_contained_components(_sess: Session, _crate_type: CrateType, _linker: string): LinkSelfContainedComponents {
    return unported("ssa-link-b: self_contained_components");
  },
  /** `linker_with_args(..)` (link.rs:2870), `(Command, Vec<jobserver::Acquired>)`. */
  linker_with_args(
    _path: string,
    _flavor: LinkerFlavor,
    _sess: Session,
    _archive_builder_builder: ArchiveBuilderBuilder,
    _rmeta_link_cache: RmetaLinkCache,
    _crate_type: CrateType,
    _tmpdir: string,
    _out_filename: string,
    _compiled_modules: CompiledModules,
    _crate_info: CrateInfo,
    _metadata: EncodedMetadata,
    _self_contained_components: LinkSelfContainedComponents,
    _codegen_backend: string,
  ): [Command, JobserverAcquired[]] {
    return unported("ssa-link-b: linker_with_args");
  },
  /** `relevant_lib(sess, lib)` (link.rs:3773). */
  relevant_lib(_sess: Session, _lib: NativeLib): boolean {
    return unported("ssa-link-b: relevant_lib");
  },
  /** `raw_dylib::create_raw_dylib_dll_import_libs(sess, archive_builder_builder, used_libraries, tmpdir, is_direct_dependency)` (link/raw_dylib.rs:63). */
  create_raw_dylib_dll_import_libs(
    _sess: Session,
    _archive_builder_builder: ArchiveBuilderBuilder,
    _used_libraries: readonly NativeLib[],
    _tmpdir: string,
    _is_direct_dependency: boolean,
  ): string[] {
    return unported("ssa-link-b: create_raw_dylib_dll_import_libs");
  },

  // ssa-linker: back/linker.rs and back/command.rs.
  /** `linker::disable_localization(&mut cmd)` (linker.rs:39). */
  disable_localization(_cmd: Command): void {
    unported("ssa-linker: disable_localization");
  },
  /** `Command::new(program)` (command.rs). */
  Command_new(_program: string): Command {
    return unported("ssa-linker: Command::new");
  },
  /** `format!("{cmd:?}")`: `impl fmt::Debug for Command` (command.rs:209). */
  debug_Command(_cmd: Command): string {
    return unported("ssa-linker: <Command as Debug>::fmt");
  },
  /** `linker.link_args(args)` on `dyn Linker` (linker.rs `generate_arg_methods!` → `link_args`, :214). */
  Linker_link_args(_linker: Linker, _args: readonly string[]): Linker {
    return unported("ssa-linker: link_args");
  },
  /** `linker.link_arg(arg)` on `dyn Linker` (linker.rs `generate_arg_methods!` → `link_args(self, iter::once(arg))`). */
  Linker_link_arg(_linker: Linker, _arg: string): Linker {
    return unported("ssa-linker: link_arg");
  },

  // ssa-archive: back/archive.rs.
  /** `archive_builder_builder.extract_bundled_libs(rlib, outdir, bundled_lib_file_names)` (archive.rs:153). */
  extract_bundled_libs(
    _archive_builder_builder: ArchiveBuilderBuilder,
    _rlib: string,
    _outdir: string,
    _bundled_lib_file_names: ReadonlySet<Symbol>,
  ): Result<null, ExtractBundledLibsError> {
    return unported("ssa-archive: extract_bundled_libs");
  },
  /**
   * `ab.build(output, symbols)` (archive.rs:554). The archive builder in tree takes no `symbols` (it is always `None` there),
   * so `None` forwards to it and `Some` stops until ssa-archive's `build` lands.
   */
  ArchiveBuilder_build(ab: ArchiveBuilder, output: string, symbols: ArchiveSymbols | undefined): boolean {
    if (symbols !== undefined) return unported("ssa-archive: ArchiveBuilder::build with ArchiveSymbols (symbol_edit.rs)");
    return ab.build(output);
  },

  // rustc_session (no lane this wave): `Session::get_tools_search_paths` (session.rs:825) is not ported.
  /** `sess.get_tools_search_paths(self_contained)` (rustc_session/src/session.rs:825). */
  get_tools_search_paths(_sess: Session, _self_contained: boolean): string[] {
    return unported("rustc_session::Session::get_tools_search_paths");
  },
};
