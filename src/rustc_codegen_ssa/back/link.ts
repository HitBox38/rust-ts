// Partial port of compiler/rustc_codegen_ssa/src/back/link.rs: `link_binary` and `link_rlib` (plan-m6 D4, lane miri-sysroot),
// with `ensure_removed` and the EII linkage check they call, and `each_linked_rlib`, `ignored_for_lto`,
// `are_upstream_rust_objects_already_included` (for `CrateInfo::new`). Linking proper (staticlibs, the native linker,
// sanitizer runtimes, linker args, ...) is M7: those crate types in the `should_link()` branch call `unported`.
// PORT: a bundled static native library stops `unported` in `link_rlib` (`find_native_static_library`, `add_archive`).
import * as tracing from "../../rust_ts/tracing.ts";
import { readFileSync, rmSync } from "node:fs";
import type { DiagCtxtHandle } from "../../rustc_errors/lib.ts";
import { DuplicateEiiImpls_diagnostic } from "../../rustc_middle/diagnostics.gen.ts";
import { emit_wrapper_file, MaybeTempDir, METADATA_FILENAME, TempDirBuilder } from "../../rustc_metadata/fs.ts";
import type { OutputFilenames } from "../../rustc_session/config.ts";
import { LinkerPluginLto, OutFileName } from "../../rustc_session/config.ts";
import { check_file_is_writeable, invalid_output_for_target, out_filename } from "../../rustc_session/output.ts";
import type { Session } from "../../rustc_session/session.ts";
import "../../rustc_session/utils.ts"; // `Session::time` / `Session::timer`
import { type CrateNum, LOCAL_CRATE } from "../../rustc_span/def_id.ts";
import { Symbol } from "../../rustc_span/symbol.ts";
import { bug } from "../../rustc_span/macros.ts";
import { TargetTuple } from "../../rustc_target/spec/tuple.ts";
import type { EncodedMetadata } from "../../rustc_metadata/lib.ts";
import { unported } from "../../std/panic.ts";
import { debug_list, PLAIN } from "../../std/fmt.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
import { debug_CrateType, type CrateType } from "../../rustc_structures/crate_type.ts";
import { debug_Linkage } from "../../rustc_middle/middle/dependency_format.ts";
import { CreateTempDir_diagnostic, LinkRlibError } from "../diagnostics.gen.ts";
import { path_file_name, path_parent } from "../../std/path.ts";
import { FileHeader32_impl, FileHeader64_impl, FileHeader_provided } from "../../vendor/object/read/elf/file.ts";
import type { ArchiveBuilder, ArchiveBuilderBuilder } from "./archive.ts";
import { create_wrapper_file } from "./metadata.ts";
import * as rmeta_link from "./rmeta_link.ts";
import type { CompiledModule, CompiledModules, CrateInfo, NativeLib } from "../lib.ts";

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

// rustc: compiler/rustc_codegen_ssa/src/back/link.rs:282 find_bundled_library
function find_bundled_library(lib: NativeLib, sess: Session, crate_types: readonly CrateType[]): Symbol | undefined {
  if (
    lib.kind.$ === "Static" &&
    (lib.kind.bundle === true || lib.kind.bundle === undefined) &&
    crate_types.some((t) => t === "Rlib" || t === "StaticLib") &&
    (sess.opts.unstable_opts.packed_bundled_libs || lib.cfg !== undefined || lib.kind.whole_archive === true)
  ) {
    return unported(`rustc_codegen_ssa::back::link::find_native_static_library (${Symbol.as_str(lib.name)})`);
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
  // let mut rmeta_link_cache = RmetaLinkCache::default();

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
            link_rlib(sess, archive_builder_builder, compiled_modules, crate_info, metadata, "Normal", path).build(out_filename_);
            break;
          }
          case "StaticLib":
            unported(`rustc_codegen_ssa::back::link::link_staticlib (linking a ${crate_type}; M7)`);
            break;
          default:
            void codegen_backend;
            unported(`rustc_codegen_ssa::back::link::link_natively (linking a ${crate_type}; M7)`);
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
          unported(`rustc_codegen_ssa::back::link::link_binary (copying a ${crate_type} to stdout; M7)`);
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
function link_rlib(
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
  for (const lib of crate_info.used_libraries) {
    if (!(lib.kind.$ === "Static" && (lib.kind.bundle === undefined || lib.kind.bundle === true))) {
      continue;
    }
    // PORT: `read(find_native_static_library(..))` + `.bundled_lib` wrapper, or `add_archive`: a bundled native library (M7).
    unported(`rustc_codegen_ssa::back::link::link_rlib (bundled native library ${Symbol.as_str(lib.name)})`);
  }

  // On Windows, we add the raw-dylib import libraries to the rlibs already.
  // But on ELF, this is not possible, as a shared object cannot be a member of a static library.
  // Instead, we add all raw-dylibs to the final link on ELF.
  if (sess.target.options.is_like_windows) {
    unported("rustc_codegen_ssa::back::link::raw_dylib::create_raw_dylib_dll_import_libs (Windows rlibs)");
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

/// Returns a pair of boolean indicating whether we should preserve the object and
/// dwarf object files on the filesystem for their debug information. This is often
/// useful with split-dwarf like schemes.
// rustc: compiler/rustc_codegen_ssa/src/back/link.rs:1958 preserve_objects_for_their_debuginfo
function preserve_objects_for_their_debuginfo(sess: Session): [boolean, boolean] {
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
type RlibFlavor = "Normal" | "StaticlibBase";

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
