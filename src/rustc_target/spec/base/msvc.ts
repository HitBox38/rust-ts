// compiler/rustc_target/src/spec/base/msvc.rs
import { LinkerFlavor, TargetOptions } from "../mod.ts";

// rustc: compiler/rustc_target/src/spec/base/msvc.rs:5 opts
export function opts(): TargetOptions {
  // Suppress the verbose logo and authorship debugging output, which would needlessly
  // clog any log files.
  const pre_link_args = TargetOptions.link_args(LinkerFlavor.Msvc("No"), ["/NOLOGO"]);

  return TargetOptions.update(TargetOptions.default(), {
    linker_flavor: LinkerFlavor.Msvc("No"),
    dll_tls_export: false,
    is_like_windows: true,
    is_like_msvc: true,
    binary_format: "Coff",
    pre_link_args,
    abi_return_struct_as_int: true,
    emit_debug_gdb_scripts: false,
    archive_format: "coff",

    // Currently this is the only supported method of debuginfo on MSVC
    // where `*.pdb` files show up next to the final artifact.
    split_debuginfo: "Packed",
    supported_split_debuginfo: ["Packed"],
    debuginfo_kind: "Pdb",
  });
}
