// Partial port of compiler/rustc_codegen_ssa/src/back/link.rs: `link_binary` on the path that links nothing
// (`--emit=metadata` and other outputs without `should_link()`), with `ensure_removed` and the EII linkage check
// it calls, and `each_linked_rlib`, `ignored_for_lto`, `are_upstream_rust_objects_already_included` (for
// `CrateInfo::new`). Linking proper (rlibs,
// staticlibs, the native linker, temp dirs, sanitizer runtimes, linker args, ...) is M7: the `should_link()`
// branch of `link_binary` calls `unported` once it has checked the output file is writeable.
import { rmSync } from "node:fs";
import type { DiagCtxtHandle } from "../../rustc_errors/lib.ts";
import { DuplicateEiiImpls_diagnostic } from "../../rustc_middle/diagnostics.gen.ts";
import type { OutputFilenames } from "../../rustc_session/config.ts";
import { LinkerPluginLto } from "../../rustc_session/config.ts";
import { check_file_is_writeable, invalid_output_for_target, out_filename } from "../../rustc_session/output.ts";
import type { Session } from "../../rustc_session/session.ts";
import "../../rustc_session/utils.ts"; // `Session::time` / `Session::timer`
import { type CrateNum, LOCAL_CRATE } from "../../rustc_span/def_id.ts";
import type { Symbol } from "../../rustc_span/symbol.ts";
import { bug } from "../../rustc_span/macros.ts";
import { TargetTuple } from "../../rustc_target/spec/tuple.ts";
import type { EncodedMetadata } from "../../rustc_metadata/lib.ts";
import { unported } from "../../std/panic.ts";
import { debug_list, PLAIN } from "../../std/fmt.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
import { debug_CrateType, type CrateType } from "../../rustc_structures/crate_type.ts";
import { debug_Linkage } from "../../rustc_middle/middle/dependency_format.ts";
import { LinkRlibError } from "../diagnostics.gen.ts";
import type { CompiledModule, CompiledModules, CrateInfo } from "../lib.ts";

/**
 * PORT: `trait ArchiveBuilderBuilder` (back/archive.rs) is not ported; `link_binary` only hands it to the
 * linking steps, which are unported, so it is opaque here.
 */
export interface ArchiveBuilderBuilder {
  readonly __archive_builder_builder: string;
}

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
      void output;
      void archive_builder_builder;
      void metadata;
      void codegen_backend;
      // let tmpdir = TempDirBuilder::new().prefix("rustc").tempdir_in(..) ..; `link_rlib` / `link_staticlib` /
      // `link_natively`, artifact notifications, gold check, copying to stdout.
      unported(`rustc_codegen_ssa::back::link::link_binary (linking a ${crate_type}; M7)`);
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
    // let (preserve_objects, preserve_dwarf_objects) = preserve_objects_for_their_debuginfo(sess);
    // debug!(?preserve_objects, ?preserve_dwarf_objects);
    unported("rustc_codegen_ssa::back::link::preserve_objects_for_their_debuginfo (link_binary_remove_temps; M7)");
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
