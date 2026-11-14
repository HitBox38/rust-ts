// Port of compiler/rustc_codegen_ssa/src/back/linker.rs (lanes crateinfo-symbols, ssa-linker).
//
// PORT:
// - `Box<dyn Linker>` is a `DynLinker`: the abstract class every impl extends. It carries the trait's provided methods (as calls
//   into `Linker_provided`, where their markers are), the methods `generate_arg_methods!` generates for every impl and for
//   `dyn Linker` (one copy, markers at the macro's lines), and `impl dyn Linker`'s `take_cmd`.
// - Each impl's field `cmd` shares its name with the trait method `cmd()`, which one TS class cannot hold: the field is `cmd_`.
// - `find_msvc_tools::find_tool` (an external crate, find-msvc-tools 0.1.11) is `find_msvc_tool` below: what the crate does on a
//   non-Windows host as far as it is decided without a search (no MSVC target arch, or no `VCINSTALLDIR`/`VSINSTALLDIR`: `None`);
//   the search itself and a Windows host stop.
// - `get_tools_search_paths` below forwards to `Session::get_tools_search_paths` (rustc_session/session.ts), for link.ts, which
//   imports it from here.
// - Files are written whole (`writeFileSync`) where upstream writes lines into a `File::create_buffered`: the same bytes, and the
//   same `io::Error` when the file cannot be created; only a failure part-way through could leave a different partial file.
// - `debug!` is compiled out (`tracing`'s static max level is INFO), so those lines stay as comments.
import { writeFileSync } from "node:fs";
// The crate root first: `rustc_target/spec/mod.ts` and `spec/json.ts` import each other (the order `rustc_target/lib.ts` sets up).
import "../../rustc_target/lib.ts";
import * as tracing from "../../rust_ts/tracing.ts";
import type { AllocatorKind } from "../../rustc_ast/expand/allocator.gen.ts";
import { WindowsSubsystemKind } from "../../rustc_attr_ir/data_structures.ts";
import type { Dependencies } from "../../rustc_middle/middle/dependency_format.ts";
import {
  type ExportedSymbol,
  type SymbolExportInfo,
  SymbolExportKind,
  SymbolExportLevel,
  metadata_symbol_name as exported_symbols_metadata_symbol_name,
} from "../../rustc_middle/middle/exported_symbols.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { SymbolName } from "../../rustc_middle/ty/mod.ts";
import type { Strip } from "../../rustc_session/config.ts";
import { generate_proc_macro_decls_symbol, type Session } from "../../rustc_session/session.ts";
import { bug } from "../../rustc_span/macros.ts";
import { type CrateNum, LOCAL_CRATE } from "../../rustc_span/def_id.ts";
import type { CrateType } from "../../rustc_structures/crate_type.ts";
import { Arch, type LinkerFlavor, LinkerFlavor as LinkerFlavorC, type LinkOutputKind } from "../../rustc_target/spec/mod.ts";
import { split_paths, var_os } from "../../std/env.ts";
import { display_IoError, io_error_from_node, type IoError } from "../../std/io.ts";
import { panic, unported, unreachable } from "../../std/panic.ts";
import { metadata as fs_metadata, read_dir } from "../../std/fs.ts";
import { path_extension, path_file_name, path_join, path_parent } from "../../std/path.ts";
import { from_utf8 } from "../../std/str.ts";
import { path_set_extension } from "../../rustc_session/config.ts";
import { needs_allocator_shim_for_linking } from "../base.ts";
import {
  BpfStaticlibNotSupported_diagnostic,
  Ld64UnimplementedModifier_diagnostic,
  LibDefWriteFailure_diagnostic,
  LinkerUnsupportedModifier_diagnostic,
  NoNatvisDirectory_diagnostic,
  SymbolFileWriteFailure_diagnostic,
  VersionScriptWriteFailure_diagnostic,
} from "../diagnostics.gen.ts";
import { SymbolExport } from "../lib.ts";
import { Command } from "./command.ts";
import { find_native_static_library, try_find_native_dynamic_library, try_find_native_static_library } from "./link.ts";
import * as symbol_export from "./symbol_export.ts";
import { allocator_shim_symbols } from "./symbol_export.ts";

export { Command } from "./command.ts";

/** `find_msvc_tools::Tool`: the found program and the environment it needs. */
interface MsvcTool {
  path(): string;
  env(): readonly [string, string][];
}

/**
 * `find_msvc_tools::find_tool(arch_or_target, tool)` (find-msvc-tools-0.1.11/src/find_tools.rs:148), as far as a non-Windows
 * host decides it without searching: `None` for an arch `TargetArch::new` does not know, for the `msbuild`/`devenv`/LLVM tools
 * (whose unix `impl_` functions return `None`), and when `VCINSTALLDIR` or `VSINSTALLDIR` is unset (`find_msvc_environment`'s
 * early returns; `find_msvc_15plus` and `find_msvc_14` are `None` on unix). Anything else stops.
 */
function find_msvc_tool(arch_or_target: string, tool: string): MsvcTool | undefined {
  if (process.platform === "win32") return unported("find_msvc_tools::find_tool (Windows host)");
  let full_arch: string;
  const dash = arch_or_target.indexOf("-");
  if (dash >= 0) {
    // The logic is all tailored for MSVC, if the target is not that then
    // bail out early.
    if (!arch_or_target.slice(dash + 1).includes("msvc")) {
      return undefined;
    }
    full_arch = arch_or_target.slice(0, dash);
  } else {
    full_arch = arch_or_target;
  }
  // `TargetArch::new(full_arch)?`
  if (!["x64", "x86_64", "arm64", "aarch64", "arm64ec", "x86", "i686", "i586", "arm", "thumbv7a"].includes(full_arch)) return undefined;
  if (tool.includes("msbuild") || tool.includes("devenv")) return undefined;
  if (["clang", "lldb", "llvm", "ld", "lld"].some((t) => tool.includes(t))) return undefined;
  // `find_msvc_environment`: `env_getter.get_env("VCINSTALLDIR")?; env_getter.get_env("VSINSTALLDIR")?;`
  if (var_os("VCINSTALLDIR") === undefined || var_os("VSINSTALLDIR") === undefined) return undefined;
  return unported("find_msvc_tools::find_tool (find_msvc_environment's search with VCINSTALLDIR and VSINSTALLDIR set)");
}

/**
 * `sess.get_tools_search_paths(self_contained)`: a forwarder to `Session::get_tools_search_paths` (rustc_session/session.ts,
 * session.rs:825), kept for link.ts, which imports it from here. PORT: not an upstream fn; the marker is on the session method.
 */
export function get_tools_search_paths(sess: Session, self_contained: boolean): string[] {
  return sess.get_tools_search_paths(self_contained);
}

/** `env::join_paths(paths).unwrap()` on unix (library/std/src/sys/paths/unix.rs `join_paths`): `:`-joined bytes; a path holding a
 *  `:` is a `JoinPathsError`, which `unwrap` panics on. */
function join_paths_unwrap(paths: readonly Uint8Array[]): Uint8Array {
  const sep = 0x3a;
  const joined: number[] = [];
  paths.forEach((path, i) => {
    if (i > 0) joined.push(sep);
    if (path.includes(sep)) panic("called `Result::unwrap()` on an `Err` value: JoinPathsError { inner: JoinPathsError }");
    for (const b of path) joined.push(b);
  });
  return new Uint8Array(joined);
}

/** `Path::with_file_name` (`set_file_name`: pop the file name if there is one, then push). */
function path_with_file_name(self_: string, file_name: string): string {
  if (path_file_name(self_) !== undefined) {
    return path_join(path_parent(self_)!, file_name);
  }
  return path_join(self_, file_name);
}

/** `File::create_buffered(path)` + the lines written to it, as one write (see the module notes). */
function write_file(path: string, contents: string): IoError | undefined {
  try {
    writeFileSync(path, contents);
    return undefined;
  } catch (e) {
    return io_error_from_node(e);
  }
}

/// Disables non-English messages from localized linkers.
/// Such messages may cause issues with text encoding on Windows (#35785)
/// and prevent inspection of linker output in case of errors, which we occasionally do.
/// This should be acceptable because other messages from rustc are in English anyway,
/// and may also be desirable to improve searchability of the linker diagnostics.
// rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:39 disable_localization
export function disable_localization(linker: Command): void {
  // No harm in setting both env vars simultaneously.
  // Unix-style linkers.
  linker.env("LC_ALL", "C");
  // MSVC's `link.exe`.
  linker.env("VSLANG", "1033");
}

/// The third parameter is for env vars, used on windows to set up the
/// path for MSVC to find its DLLs, and gcc to find its bundled
/// toolchain
// rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:50 get_linker
export function get_linker(
  sess: Session,
  linker: string,
  flavor: LinkerFlavor,
  self_contained: boolean,
  target_cpu: string,
  codegen_backend: string,
): DynLinker {
  const msvc_tool = find_msvc_tool(Arch.desc(sess.target.arch), "link.exe");

  // If our linker looks like a batch script on Windows then to execute this
  // we'll need to spawn `cmd` explicitly. This is primarily done to handle
  // emscripten where the linker is `emcc.bat` and needs to be spawned as
  // `cmd /c emcc.bat ...`.
  //
  // This worked historically but is needed manually since #42436 (regression
  // was tagged as #42791) and some more info can be found on #44443 for
  // emscripten itself.
  let cmd: Command;
  // PORT: `linker.to_str()` is always `Some` (paths are strings); `cfg!(windows)` is the host.
  if (process.platform === "win32" && linker.endsWith(".bat")) {
    cmd = Command.bat_script(linker);
  } else if (
    (flavor.$ === "Gnu" && flavor._0 === "No" && flavor._1 === "Yes") ||
    (flavor.$ === "Darwin" && flavor._0 === "No" && flavor._1 === "Yes") ||
    (flavor.$ === "WasmLld" && flavor._0 === "No") ||
    (flavor.$ === "Msvc" && flavor._0 === "Yes")
  ) {
    cmd = Command.lld(linker, LinkerFlavorC.lld_flavor(flavor));
  } else if (flavor.$ === "Msvc" && flavor._0 === "No" && sess.opts.cg.linker === undefined && sess.target.linker === undefined) {
    cmd = Command.new(msvc_tool === undefined ? linker : msvc_tool.path());
  } else {
    cmd = Command.new(linker);
  }

  // UWP apps have API restrictions enforced during Store submissions.
  // To comply with the Windows App Certification Kit,
  // MSVC needs to link with the Store versions of the runtime libraries (vcruntime, msvcrt, etc).
  const t = sess.target;
  if (flavor.$ === "Msvc" && t.cfg_abi.$ === "Uwp") {
    if (msvc_tool !== undefined) {
      // PORT: only a found `link.exe` reaches this, and finding one stops (find_msvc_tool).
      return unported("rustc_codegen_ssa::back::linker::get_linker (UWP /LIBPATH from a found link.exe)");
    } else {
      tracing.warn("rustc_codegen_ssa::back::linker", () => "link.exe not found");
    }
  }

  // The compiler's sysroot often has some bundled tools, so add it to the
  // PATH for the child.
  const new_path: Uint8Array[] = sess.get_tools_search_paths(self_contained).map((p) => new TextEncoder().encode(p));
  let msvc_changed_path = false;
  if (sess.target.is_like_msvc && msvc_tool !== undefined) {
    for (const [k, v] of msvc_tool.env()) {
      if (k === "PATH") {
        new_path.push(...split_paths(new TextEncoder().encode(v)));
        msvc_changed_path = true;
      } else {
        cmd.env(k, v);
      }
    }
  }

  let path: Uint8Array | undefined;
  if (!msvc_changed_path && (path = var_os("PATH")) !== undefined) {
    new_path.push(...split_paths(path));
  }
  const joined = from_utf8(join_paths_unwrap(new_path));
  // PORT: environment values are strings (command.ts); a `PATH` that is not UTF-8 stops.
  if (joined.$ === "Err") return unported("rustc_codegen_ssa::back::linker::get_linker (a PATH that is not UTF-8)");
  cmd.env("PATH", joined._0);

  // FIXME: Move `/LIBPATH` addition for uwp targets from the linker construction
  // to the linker args construction.
  if (!(cmd.get_args().length === 0 || sess.target.cfg_abi.$ === "Uwp")) {
    panic("assertion failed: cmd.get_args().is_empty() || sess.target.cfg_abi == CfgAbi::Uwp");
  }
  switch (flavor.$) {
    case "Unix":
      if (flavor._0 === "No" && sess.target.os.$ === "Aix") {
        return AixLinker.new(cmd, sess);
      }
      break;
    case "WasmLld":
      if (flavor._0 === "No") {
        return WasmLd.new(cmd, sess);
      }
      break;
  }
  switch (flavor.$) {
    case "Gnu":
    case "Darwin":
    case "WasmLld":
    case "Unix": {
      const cc = flavor._0;
      return new GccLinker(
        cmd,
        sess,
        target_cpu,
        undefined,
        cc === "No",
        LinkerFlavorC.is_gnu(flavor),
        LinkerFlavorC.uses_lld(flavor),
        codegen_backend,
      );
    }
    case "Msvc":
      return new MsvcLinker(cmd, sess);
    case "EmCc":
      return new EmLinker(cmd, sess);
    case "Bpf":
      return new BpfLinker(cmd, sess);
    case "Llbc":
      return new LlbcLinker(cmd, sess);
  }
}

// Note: Ideally neither these helper function, nor the macro-generated inherent methods below
// would exist, and these functions would live in `trait Linker`.
// Unfortunately, adding these functions to `trait Linker` make it `dyn`-incompatible.
// If the methods are added to the trait with `where Self: Sized` bounds, then even a separate
// implementation of them for `dyn Linker {}` wouldn't work due to a conflict with those
// uncallable methods in the trait.

/// Just pass the arguments to the linker as is.
/// It is assumed that they are correctly prepared in advance.
// rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:174 verbatim_args
function verbatim_args<L extends Linker>(l: L, args: Iterable<string>): L {
  for (const arg of args) {
    l.cmd().arg(arg);
  }
  return l;
}
/// Add underlying linker arguments to C compiler command, by wrapping them in
/// `-Wl` or `-Xlinker`.
// rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:185 convert_link_args_to_cc_args
export function convert_link_args_to_cc_args(cmd: Command, args: Iterable<string>): void {
  let combined_arg = "-Wl";
  for (const arg of args) {
    // If the argument itself contains a comma, we need to emit it
    // as `-Xlinker`, otherwise we can use `-Wl`.
    if (arg.includes(",")) {
      // Emit current `-Wl` argument, if any has been built.
      if (combined_arg !== "-Wl") {
        cmd.arg(combined_arg);
        // Begin next `-Wl` argument.
        combined_arg = "-Wl";
      }

      // Emit `-Xlinker` argument.
      cmd.arg("-Xlinker");
      cmd.arg(arg);
    } else {
      // Append to `-Wl` argument.
      combined_arg += ",";
      combined_arg += arg;
    }
  }
  // Emit final `-Wl` argument.
  if (combined_arg !== "-Wl") {
    cmd.arg(combined_arg);
  }
}
/// Arguments for the underlying linker.
/// Add options to pass them through cc wrapper if `Linker` is a cc wrapper.
// rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:214 link_args
function link_args<L extends Linker>(l: L, args: Iterable<string>): L {
  if (!l.is_cc()) {
    verbatim_args(l, args);
  } else {
    convert_link_args_to_cc_args(l.cmd(), args);
  }
  return l;
}
/// Arguments for the cc wrapper specifically.
/// Check that it's indeed a cc wrapper and pass verbatim.
// rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:224 cc_args
function cc_args<L extends Linker>(l: L, args: Iterable<string>): L {
  if (!l.is_cc()) panic("assertion failed: l.is_cc()");
  return verbatim_args(l, args);
}
/// Arguments supported by both underlying linker and cc wrapper, pass verbatim.
// rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:229 link_or_cc_args
function link_or_cc_args<L extends Linker>(l: L, args: Iterable<string>): L {
  return verbatim_args(l, args);
}

/// Linker abstraction used by `back::link` to build up the command to invoke a
/// linker.
///
/// This trait is the total list of requirements needed by `back::link` and
/// represents the meaning of each option being passed down. This trait is then
/// used to dispatch on whether a GNU-like linker (generally `ld.exe`) or an
/// MSVC linker (e.g., `link.exe`) is being used.
// rustc-trait: compiler/rustc_codegen_ssa/src/back/linker.rs:293 Linker
export interface Linker {
  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:294 cmd
  cmd(): Command;
  // (provided) back/linker.rs:295 is_cc -> Linker_provided.is_cc
  is_cc(): boolean;
  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:298 set_output_kind
  set_output_kind(output_kind: LinkOutputKind, crate_type: CrateType, out_filename: string): void;
  // (provided) back/linker.rs:304 link_dylib_by_name -> Linker_provided.link_dylib_by_name
  link_dylib_by_name(name: string, verbatim: boolean, as_needed: boolean): void;
  // (provided) back/linker.rs:307 link_dylib_by_path -> Linker_provided.link_dylib_by_path
  link_dylib_by_path(path: string, as_needed: boolean): void;
  // (provided) back/linker.rs:310 link_framework_by_name -> Linker_provided.link_framework_by_name
  link_framework_by_name(name: string, verbatim: boolean, as_needed: boolean): void;
  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:313 link_staticlib_by_name
  link_staticlib_by_name(name: string, verbatim: boolean, whole_archive: boolean): void;
  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:314 link_staticlib_by_path
  link_staticlib_by_path(path: string, whole_archive: boolean): void;
  // (provided) back/linker.rs:315 include_path -> Linker_provided.include_path
  include_path(path: string): void;
  // (provided) back/linker.rs:318 framework_path -> Linker_provided.framework_path
  framework_path(path: string): void;
  // (provided) back/linker.rs:321 output_filename -> Linker_provided.output_filename
  output_filename(path: string): void;
  // (provided) back/linker.rs:324 add_object -> Linker_provided.add_object
  add_object(path: string): void;
  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:327 gc_sections
  gc_sections(keep_metadata: boolean): void;
  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:328 full_relro
  full_relro(): void;
  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:329 partial_relro
  partial_relro(): void;
  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:330 no_relro
  no_relro(): void;
  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:331 optimize
  optimize(): void;
  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:332 pgo_gen
  pgo_gen(): void;
  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:333 control_flow_guard
  control_flow_guard(): void;
  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:334 ehcont_guard
  ehcont_guard(): void;
  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:335 debuginfo
  debuginfo(strip: Strip, natvis_debugger_visualizers: readonly string[]): void;
  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:336 no_crt_objects
  no_crt_objects(): void;
  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:337 no_default_libraries
  no_default_libraries(): void;
  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:338 export_symbols
  export_symbols(tmpdir: string, crate_type: CrateType, symbols: readonly SymbolExport[]): void;
  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:339 windows_subsystem
  windows_subsystem(subsystem: WindowsSubsystemKind): void;
  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:340 linker_plugin_lto
  linker_plugin_lto(): void;
  // (provided) back/linker.rs:341 add_eh_frame_header -> Linker_provided.add_eh_frame_header
  add_eh_frame_header(): void;
  // (provided) back/linker.rs:342 add_no_exec -> Linker_provided.add_no_exec
  add_no_exec(): void;
  // (provided) back/linker.rs:343 add_as_needed -> Linker_provided.add_as_needed
  add_as_needed(): void;
  // (provided) back/linker.rs:344 reset_per_library_state -> Linker_provided.reset_per_library_state
  reset_per_library_state(): void;
  // (provided) back/linker.rs:345 enable_profiling -> Linker_provided.enable_profiling
  enable_profiling(): void;
}

/** The provided methods of `trait Linker`. */
export const Linker_provided = {
  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:295 is_cc
  is_cc(_self: Linker): boolean {
    return false;
  },
  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:304 link_dylib_by_name
  link_dylib_by_name(_self: Linker, _name: string, _verbatim: boolean, _as_needed: boolean): void {
    bug("dylib linked with unsupported linker");
  },
  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:307 link_dylib_by_path
  link_dylib_by_path(_self: Linker, _path: string, _as_needed: boolean): void {
    bug("dylib linked with unsupported linker");
  },
  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:310 link_framework_by_name
  link_framework_by_name(_self: Linker, _name: string, _verbatim: boolean, _as_needed: boolean): void {
    bug("framework linked with unsupported linker");
  },
  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:315 include_path
  include_path(self: Linker, path: string): void {
    link_or_cc_args(link_or_cc_args(self, ["-L"]), [path]);
  },
  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:318 framework_path
  framework_path(_self: Linker, _path: string): void {
    bug("framework path set with unsupported linker");
  },
  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:321 output_filename
  output_filename(self: Linker, path: string): void {
    link_or_cc_args(link_or_cc_args(self, ["-o"]), [path]);
  },
  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:324 add_object
  add_object(self: Linker, path: string): void {
    link_or_cc_args(self, [path]);
  },
  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:341 add_eh_frame_header
  add_eh_frame_header(_self: Linker): void {},
  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:342 add_no_exec
  add_no_exec(_self: Linker): void {},
  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:343 add_as_needed
  add_as_needed(_self: Linker): void {},
  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:344 reset_per_library_state
  reset_per_library_state(_self: Linker): void {},
  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:345 enable_profiling
  enable_profiling(_self: Linker): void {},
};

/**
 * `Box<dyn Linker + '_>`: the base of every impl (see the module notes). The methods `generate_arg_methods!` generates (for
 * `GccLinker`, `MsvcLinker`, `EmLinker`, `WasmLd`, `AixLinker`, `LlbcLinker`, `BpfLinker` and `dyn Linker`, linker.rs:275) are
 * here once, and `impl dyn Linker` (linker.rs:348).
 */
export abstract class DynLinker implements Linker {
  abstract cmd(): Command;
  is_cc(): boolean {
    return Linker_provided.is_cc(this);
  }
  abstract set_output_kind(output_kind: LinkOutputKind, crate_type: CrateType, out_filename: string): void;
  link_dylib_by_name(name: string, verbatim: boolean, as_needed: boolean): void {
    Linker_provided.link_dylib_by_name(this, name, verbatim, as_needed);
  }
  link_dylib_by_path(path: string, as_needed: boolean): void {
    Linker_provided.link_dylib_by_path(this, path, as_needed);
  }
  link_framework_by_name(name: string, verbatim: boolean, as_needed: boolean): void {
    Linker_provided.link_framework_by_name(this, name, verbatim, as_needed);
  }
  abstract link_staticlib_by_name(name: string, verbatim: boolean, whole_archive: boolean): void;
  abstract link_staticlib_by_path(path: string, whole_archive: boolean): void;
  include_path(path: string): void {
    Linker_provided.include_path(this, path);
  }
  framework_path(path: string): void {
    Linker_provided.framework_path(this, path);
  }
  output_filename(path: string): void {
    Linker_provided.output_filename(this, path);
  }
  add_object(path: string): void {
    Linker_provided.add_object(this, path);
  }
  abstract gc_sections(keep_metadata: boolean): void;
  abstract full_relro(): void;
  abstract partial_relro(): void;
  abstract no_relro(): void;
  abstract optimize(): void;
  abstract pgo_gen(): void;
  abstract control_flow_guard(): void;
  abstract ehcont_guard(): void;
  abstract debuginfo(strip: Strip, natvis_debugger_visualizers: readonly string[]): void;
  abstract no_crt_objects(): void;
  abstract no_default_libraries(): void;
  abstract export_symbols(tmpdir: string, crate_type: CrateType, symbols: readonly SymbolExport[]): void;
  abstract windows_subsystem(subsystem: WindowsSubsystemKind): void;
  abstract linker_plugin_lto(): void;
  add_eh_frame_header(): void {
    Linker_provided.add_eh_frame_header(this);
  }
  add_no_exec(): void {
    Linker_provided.add_no_exec(this);
  }
  add_as_needed(): void {
    Linker_provided.add_as_needed(this);
  }
  reset_per_library_state(): void {
    Linker_provided.reset_per_library_state(this);
  }
  enable_profiling(): void {
    Linker_provided.enable_profiling(this);
  }

  // generate_arg_methods!
  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:240 verbatim_args
  verbatim_args(args: Iterable<string>): this {
    return verbatim_args(this, args);
  }
  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:244 verbatim_arg
  verbatim_arg(arg: string): this {
    return verbatim_args(this, [arg]);
  }
  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:248 link_args
  link_args(args: Iterable<string>): this {
    return link_args(this, args);
  }
  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:252 link_arg
  link_arg(arg: string): this {
    return link_args(this, [arg]);
  }
  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:256 cc_args
  cc_args(args: Iterable<string>): this {
    return cc_args(this, args);
  }
  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:260 cc_arg
  cc_arg(arg: string): this {
    return cc_args(this, [arg]);
  }
  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:264 link_or_cc_args
  link_or_cc_args(args: Iterable<string>): this {
    return link_or_cc_args(this, args);
  }
  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:268 link_or_cc_arg
  link_or_cc_arg(arg: string): this {
    return link_or_cc_args(this, [arg]);
  }

  // impl dyn Linker + '_
  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:349 take_cmd
  take_cmd(): Command {
    const cmd = this.cmd();
    const taken = new Command(cmd.program, cmd.f_args, cmd.f_env, cmd.f_env_remove, cmd.f_env_clear);
    // `mem::replace(self.cmd(), Command::new(""))`
    const empty = Command.new("");
    cmd.program = empty.program;
    cmd.f_args = empty.f_args;
    cmd.f_env = empty.f_env;
    cmd.f_env_remove = empty.f_env_remove;
    cmd.f_env_clear = empty.f_env_clear;
    return taken;
  }
}

class GccLinker extends DynLinker {
  constructor(
    public cmd_: Command,
    public sess: Session,
    public target_cpu: string,
    public hinted_static: boolean | undefined, // Keeps track of the current hinting mode.
    // Link as ld
    public is_ld: boolean,
    public is_gnu: boolean,
    public uses_lld: boolean,
    public codegen_backend: string,
  ) {
    super();
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:367 takes_hints
  takes_hints(): boolean {
    // Really this function only returns true if the underlying linker
    // configured for a compiler is binutils `ld.bfd` and `ld.gold`. We
    // don't really have a foolproof way to detect that, so rule out some
    // platforms where currently this is guaranteed to *not* be the case:
    //
    // * On OSX they have their own linker, not binutils'
    // * For WebAssembly the only functional linker is LLD, which doesn't
    //   support hint flags
    return !this.sess.target.is_like_darwin && !this.sess.target.is_like_wasm;
  }

  // Some platforms take hints about whether a library is static or dynamic.
  // For those that support this, we ensure we pass the option if the library
  // was flagged "static" (most defaults are dynamic) to ensure that if
  // libfoo.a and libfoo.so both exist that the right one is chosen.
  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:383 hint_static
  hint_static(): void {
    if (!this.takes_hints()) {
      return;
    }
    if (this.hinted_static !== true) {
      this.link_arg("-Bstatic");
      this.hinted_static = true;
    }
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:393 hint_dynamic
  hint_dynamic(): void {
    if (!this.takes_hints()) {
      return;
    }
    if (this.hinted_static !== false) {
      this.link_arg("-Bdynamic");
      this.hinted_static = false;
    }
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:403 push_linker_plugin_lto_args
  push_linker_plugin_lto_args(plugin_path: string | undefined): void {
    if (plugin_path !== undefined) {
      let arg = "-plugin=";
      arg += plugin_path;
      this.link_arg(arg);
    }

    let opt_level: string;
    switch (this.sess.opts.optimize) {
      case "No":
        opt_level = "O0";
        break;
      case "Less":
        opt_level = "O1";
        break;
      case "More":
      case "Size":
      case "SizeMin":
        opt_level = "O2";
        break;
      case "Aggressive":
        opt_level = "O3";
        break;
    }

    const path = this.sess.opts.cg.profile_sample_use;
    if (path !== undefined) {
      this.link_arg(`-plugin-opt=sample-profile=${path}`);
    }
    const prefix =
      this.codegen_backend === "gcc"
        ? // The GCC linker plugin requires a leading dash.
          "-"
        : "";
    this.link_args([`-plugin-opt=${prefix}${opt_level}`, `-plugin-opt=${prefix}mcpu=${this.target_cpu}`]);
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:432 build_dylib
  build_dylib(crate_type: CrateType, out_filename: string): void {
    // On mac we need to tell the linker to let this library be rpathed
    if (this.sess.target.is_like_darwin) {
      if (this.is_cc()) {
        // `-dynamiclib` makes `cc` pass `-dylib` to the linker.
        this.cc_arg("-dynamiclib");
      } else {
        this.link_arg("-dylib");
        // Clang also sets `-dynamic`, but that's implied by `-dylib`, so unnecessary.
      }

      // Note that the `osx_rpath_install_name` option here is a hack
      // purely to support bootstrap right now, we should get a more
      // principled solution at some point to force the compiler to pass
      // the right `-Wl,-install_name` with an `@rpath` in it.
      if (this.sess.opts.cg.rpath || this.sess.opts.unstable_opts.osx_rpath_install_name) {
        let rpath = "@rpath/";
        const file_name = path_file_name(out_filename);
        if (file_name === undefined) panic("called `Option::unwrap()` on a `None` value");
        rpath += file_name;
        this.link_arg("-install_name").link_arg(rpath);
      }
    } else {
      this.link_or_cc_arg("-shared");
      const name = path_file_name(out_filename);
      if (name !== undefined) {
        if (this.sess.target.is_like_windows) {
          // The output filename already contains `dll_suffix` so
          // the resulting import library will have a name in the
          // form of libfoo.dll.a
          const [prefix, suffix] = this.sess.staticlib_components(false);
          let implib_name = prefix;
          implib_name += name;
          implib_name += suffix;
          let out_implib = "--out-implib=";
          out_implib += path_with_file_name(out_filename, implib_name);
          this.link_arg(out_implib);
        } else if (crate_type === "Dylib") {
          // When dylibs are linked by a full path this value will get into `DT_NEEDED`
          // instead of the full path, so the library can be later found in some other
          // location than that specific path.
          let soname = "-soname=";
          soname += name;
          this.link_arg(soname);
        }
      }
    }
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:478 with_as_needed
  with_as_needed(as_needed: boolean, f: (this_: GccLinker) => void): void {
    if (!as_needed) {
      if (this.sess.target.is_like_darwin) {
        // FIXME(81490): ld64 doesn't support these flags but macOS 11
        // has -needed-l{} / -needed_library {}
        // but we have no way to detect that here.
        this.sess.dcx().emit_warn(Ld64UnimplementedModifier_diagnostic({}));
      } else if (this.is_gnu && !this.sess.target.is_like_windows) {
        this.link_arg("--no-as-needed");
      } else {
        this.sess.dcx().emit_warn(LinkerUnsupportedModifier_diagnostic({}));
      }
    }

    f(this);

    if (!as_needed) {
      if (this.sess.target.is_like_darwin) {
        // See above FIXME comment
      } else if (this.is_gnu && !this.sess.target.is_like_windows) {
        this.link_arg("--as-needed");
      }
    }
  }

  // impl<'a> Linker for GccLinker<'a>

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:505 cmd
  cmd(): Command {
    return this.cmd_;
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:509 is_cc
  override is_cc(): boolean {
    return !this.is_ld;
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:513 set_output_kind
  set_output_kind(output_kind: LinkOutputKind, crate_type: CrateType, out_filename: string): void {
    switch (output_kind) {
      case "DynamicNoPicExe":
        // noop on windows w/ gcc, warning w/ clang
        if (!this.is_ld && this.is_gnu && !this.sess.target.is_like_windows) {
          this.cc_arg("-no-pie");
        }
        break;
      case "DynamicPicExe":
        // noop on windows w/ gcc & ld, error w/ lld
        if (!this.sess.target.is_like_windows) {
          // `-pie` works for both gcc wrapper and ld.
          this.link_or_cc_arg("-pie");
        }
        break;
      case "StaticNoPicExe":
        // `-static` works for both gcc wrapper and ld.
        this.link_or_cc_arg("-static");
        // noop on windows w/ gcc, warning w/ clang
        if (!this.is_ld && this.is_gnu && !this.sess.target.is_like_windows) {
          this.cc_arg("-no-pie");
        }
        break;
      case "StaticPicExe":
        if (!this.is_ld) {
          // Note that combination `-static -pie` doesn't work as expected
          // for the gcc wrapper, `-static` in that case suppresses `-pie`.
          this.cc_arg("-static-pie");
        } else {
          // `--no-dynamic-linker` and `-z text` are not strictly necessary for producing
          // a static pie, but currently passed because gcc and clang pass them.
          // The former suppresses the `INTERP` ELF header specifying dynamic linker,
          // which is otherwise implicitly injected by ld (but not lld).
          // The latter doesn't change anything, only ensures that everything is pic.
          this.link_args(["-static", "-pie", "--no-dynamic-linker", "-z", "text"]);
        }
        break;
      case "DynamicDylib":
        this.build_dylib(crate_type, out_filename);
        break;
      case "StaticDylib":
        this.link_or_cc_arg("-static");
        this.build_dylib(crate_type, out_filename);
        break;
      case "WasiReactorExe":
        this.link_args(["--entry", "_initialize"]);
        break;
    }

    // VxWorks compiler driver introduced `--static-crt` flag specifically for rustc,
    // it switches linking for libc and similar system libraries to static without using
    // any `#[link]` attributes in the `libc` crate, see #72782 for details.
    // FIXME: Switch to using `#[link]` attributes in the `libc` crate
    // similarly to other targets.
    if (this.sess.target.os.$ === "VxWorks" && (output_kind === "StaticNoPicExe" || output_kind === "StaticPicExe" || output_kind === "StaticDylib")) {
      this.cc_arg("--static-crt");
    }

    // avr-none doesn't have default ISA, users must specify which specific
    // CPU (well, microcontroller) they are targetting using `-Ctarget-cpu`.
    //
    // Currently this makes sense only when using avr-gcc as a linker, since
    // it brings a couple of hand-written important intrinsics from libgcc.
    if (this.sess.target.arch.$ === "Avr" && !this.uses_lld) {
      this.verbatim_arg(`-mmcu=${this.target_cpu}`);
    }
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:591 link_dylib_by_name
  override link_dylib_by_name(name: string, verbatim: boolean, as_needed: boolean): void {
    if (this.sess.target.os.$ === "Illumos" && name === "c") {
      // libc will be added via late_link_args on illumos so that it will
      // appear last in the library search order.
      // FIXME: This should be replaced by a more complete and generic
      // mechanism for controlling the order of library arguments passed
      // to the linker.
      return;
    }
    this.hint_dynamic();
    this.with_as_needed(as_needed, (this_) => {
      const colon = verbatim && this_.is_gnu ? ":" : "";
      this_.link_or_cc_arg(`-l${colon}${name}`);
    });
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:607 link_dylib_by_path
  override link_dylib_by_path(path: string, as_needed: boolean): void {
    this.hint_dynamic();
    this.with_as_needed(as_needed, (this_) => {
      this_.link_or_cc_arg(path);
    });
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:614 link_framework_by_name
  override link_framework_by_name(name: string, _verbatim: boolean, as_needed: boolean): void {
    this.hint_dynamic();
    if (!as_needed) {
      // FIXME(81490): ld64 as of macOS 11 supports the -needed_framework
      // flag but we have no way to detect that here.
      // self.link_or_cc_arg("-needed_framework").link_or_cc_arg(name);
      this.sess.dcx().emit_warn(Ld64UnimplementedModifier_diagnostic({}));
    }
    this.link_or_cc_args(["-framework", name]);
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:625 link_staticlib_by_name
  link_staticlib_by_name(name: string, verbatim: boolean, whole_archive: boolean): void {
    this.hint_static();
    const colon = verbatim && this.is_gnu ? ":" : "";
    if (!whole_archive) {
      this.link_or_cc_arg(`-l${colon}${name}`);
    } else if (this.sess.target.is_like_darwin) {
      // -force_load is the macOS equivalent of --whole-archive, but it
      // involves passing the full path to the library to link.
      this.link_arg("-force_load");
      this.link_arg(find_native_static_library(name, verbatim, this.sess));
    } else {
      this.link_arg("--whole-archive").link_or_cc_arg(`-l${colon}${name}`).link_arg("--no-whole-archive");
    }
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:642 link_staticlib_by_path
  link_staticlib_by_path(path: string, whole_archive: boolean): void {
    this.hint_static();
    if (!whole_archive) {
      this.link_or_cc_arg(path);
    } else if (this.sess.target.is_like_darwin) {
      this.link_arg("-force_load").link_arg(path);
    } else {
      this.link_arg("--whole-archive").link_arg(path).link_arg("--no-whole-archive");
    }
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:653 framework_path
  override framework_path(path: string): void {
    this.link_or_cc_arg("-F").link_or_cc_arg(path);
  }
  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:656 full_relro
  full_relro(): void {
    this.link_args(["-z", "relro", "-z", "now"]);
  }
  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:659 partial_relro
  partial_relro(): void {
    this.link_args(["-z", "relro"]);
  }
  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:662 no_relro
  no_relro(): void {
    this.link_args(["-z", "norelro"]);
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:666 gc_sections
  gc_sections(keep_metadata: boolean): void {
    // The dead_strip option to the linker specifies that functions and data
    // unreachable by the entry point will be removed. This is quite useful
    // with Rust's compilation model of compiling libraries at a time into
    // one object file. For example, this brings hello world from 1.7MB to
    // 458K.
    //
    // Note that this is done for both executables and dynamic libraries. We
    // won't get much benefit from dylibs because LLVM will have already
    // stripped away as much as it could. This has not been seen to impact
    // link times negatively.
    //
    // -dead_strip can't be part of the pre_link_args because it's also used
    // for partial linking when using multiple codegen units (-r). So we
    // insert it here.
    if (this.sess.target.is_like_darwin) {
      this.link_arg("-dead_strip");

      // If we're building a dylib, we don't use --gc-sections because LLVM
      // has already done the best it can do, and we also don't want to
      // eliminate the metadata. If we're building an executable, however,
      // --gc-sections drops the size of hello world from 1.8MB to 597K, a 67%
      // reduction.
    } else if ((this.is_gnu || this.sess.target.is_like_wasm) && !keep_metadata) {
      this.link_arg("--gc-sections");
    }
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:694 optimize
  optimize(): void {
    if (!this.is_gnu && !this.sess.target.is_like_wasm) {
      return;
    }

    // GNU-style linkers support optimization with -O. GNU ld doesn't
    // need a numeric argument, but other linkers do.
    if (this.sess.opts.optimize === "More" || this.sess.opts.optimize === "Aggressive") {
      this.link_arg("-O1");
    }
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:708 pgo_gen
  pgo_gen(): void {
    if (!this.is_gnu) {
      return;
    }

    // If we're doing PGO generation stuff and on a GNU-like linker, use the
    // "-u" flag to properly pull in the profiler runtime bits.
    //
    // This is because LLVM otherwise won't add the needed initialization
    // for us on Linux (though the extra flag should be harmless if it
    // does).
    //
    // See https://reviews.llvm.org/D14033 and https://reviews.llvm.org/D14030.
    //
    // Though it may be worth to try to revert those changes upstream, since
    // the overhead of the initialization should be minor.
    this.link_or_cc_args(["-u", "__llvm_profile_runtime"]);
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:727 enable_profiling
  override enable_profiling(): void {
    // This flag is also used when linking to choose target specific
    // libraries needed to enable profiling.
    if (!this.is_ld) {
      this.cc_arg("-pg");
      // On windows-gnu targets, libgmon also needs to be linked, and this
      // requires readding libraries to satisfy its dependencies.
      if (this.sess.target.is_like_windows) {
        this.cc_arg("-lgmon");
        this.cc_arg("-lkernel32");
        this.cc_arg("-lmsvcrt");
      }
    }
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:742 control_flow_guard
  control_flow_guard(): void {}

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:744 ehcont_guard
  ehcont_guard(): void {}

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:746 debuginfo
  debuginfo(strip: Strip, _natvis: readonly string[]): void {
    // MacOS linker doesn't support stripping symbols directly anymore.
    if (this.sess.target.is_like_darwin) {
      return;
    }

    switch (strip) {
      case "None":
        break;
      case "Debuginfo":
        // The illumos linker does not support --strip-debug although
        // it does support --strip-all as a compatibility alias for -s.
        // The --strip-debug case is handled by running an external
        // `strip` utility as a separate step after linking.
        if (!this.sess.target.is_like_solaris) {
          this.link_arg("--strip-debug");
        }
        break;
      case "Symbols":
        this.link_arg("--strip-all");
        break;
    }
    switch (this.sess.opts.unstable_opts.debuginfo_compression) {
      case "None":
        break;
      case "Zlib":
        this.link_arg("--compress-debug-sections=zlib");
        break;
      case "Zstd":
        this.link_arg("--compress-debug-sections=zstd");
        break;
    }
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:778 no_crt_objects
  no_crt_objects(): void {
    if (!this.is_ld) {
      this.cc_arg("-nostartfiles");
    }
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:784 no_default_libraries
  no_default_libraries(): void {
    if (!this.is_ld) {
      this.cc_arg("-nodefaultlibs");
    }
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:790 export_symbols
  export_symbols(tmpdir: string, crate_type: CrateType, symbols: readonly SymbolExport[]): void {
    // Symbol visibility in object files typically takes care of this.
    if (crate_type === "Executable") {
      const should_export_executable_symbols = this.sess.opts.unstable_opts.export_executable_symbols;
      if (this.sess.target.override_export_symbols === undefined && !should_export_executable_symbols) {
        return;
      }
    }

    // We manually create a list of exported symbols to ensure we don't expose any more.
    // The object files have far more public symbols than we actually want to export,
    // so we hide them all here.

    if (!this.sess.target.limit_rdylib_exports) {
      return;
    }

    const path = path_join(tmpdir, this.sess.target.is_like_windows ? "list.def" : "list");
    // debug!("EXPORTED SYMBOLS:");

    if (this.sess.target.is_like_darwin) {
      // Write a plain, newline-separated list of symbols
      let f = "";
      for (const sym of symbols) {
        // debug!("  _{}", sym.name);
        f += `_${sym.name}\n`;
      }
      const error = write_file(path, f);
      if (error !== undefined) {
        this.sess.dcx().emit_fatal(LibDefWriteFailure_diagnostic({ error }));
      }
      this.link_arg("-exported_symbols_list").link_arg(path);
    } else if (this.sess.target.is_like_windows) {
      let f = "";

      // .def file similar to MSVC one but without LIBRARY section
      // because LD doesn't like when it's empty
      f += "EXPORTS\n";
      for (const symbol of symbols) {
        const kind_marker = symbol.kind === SymbolExportKind.Data ? " DATA" : "";
        // debug!("  _{}", symbol.name);
        // Quote the name in case it's reserved by linker in some way
        // (this accounts for names with dots in particular).
        f += `  "${symbol.name}"${kind_marker}\n`;
      }
      const error = write_file(path, f);
      if (error !== undefined) {
        this.sess.dcx().emit_fatal(LibDefWriteFailure_diagnostic({ error }));
      }
      this.link_arg(path);
    } else if (this.sess.target.is_like_wasm) {
      this.link_arg("--no-export-dynamic");
      for (const sym of symbols) {
        this.link_arg("--export").link_arg(sym.name);
      }
    } else if (crate_type === "Executable" && !this.sess.target.is_like_solaris) {
      let f = "";
      f += "{\n";
      for (const sym of symbols) {
        // debug!("{}", sym.name);
        f += `  ${sym.name};\n`;
      }
      f += "};\n";
      const error = write_file(path, f);
      if (error !== undefined) {
        this.sess.dcx().emit_fatal(VersionScriptWriteFailure_diagnostic({ error }));
      }
      this.link_arg("--dynamic-list").link_arg(path);
    } else {
      // Write an LD version script
      let f = "";
      f += "{\n";
      if (symbols.length !== 0) {
        f += "  global:\n";
        for (const sym of symbols) {
          // debug!("    {};", sym.name);
          f += `    ${sym.name};\n`;
        }
      }
      f += "\n  local:\n    *;\n};\n";
      const error = write_file(path, f);
      if (error !== undefined) {
        this.sess.dcx().emit_fatal(VersionScriptWriteFailure_diagnostic({ error }));
      }
      if (this.sess.target.is_like_solaris) {
        this.link_arg("-M").link_arg(path);
      } else {
        let arg = "--version-script=";
        arg += path;
        this.link_arg(arg).link_arg("--no-undefined-version");
      }
    }
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:892 windows_subsystem
  windows_subsystem(subsystem: WindowsSubsystemKind): void {
    this.link_args(["--subsystem", WindowsSubsystemKind.as_str(subsystem)]);
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:896 reset_per_library_state
  override reset_per_library_state(): void {
    this.hint_dynamic(); // Reset to default before returning the composed command line.
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:900 linker_plugin_lto
  linker_plugin_lto(): void {
    const lto = this.sess.opts.cg.linker_plugin_lto;
    switch (lto.$) {
      case "Disabled":
        // GCC, when used as a linker, will perform LTO even without -flto when it sees
        // object files with the GCC IR (which can happen when using rustc_codegen_gcc).
        // Since the std is compiled with -Cembed-bitcode=yes, any program using the std
        // will have the linker do LTO.
        // So, we disable this with -fno-lto when linker plugin LTO is not requested.
        if (this.is_cc() && this.codegen_backend === "gcc") {
          this.cc_arg("-fno-lto");
        }
        break;
      case "LinkerPluginAuto":
        this.push_linker_plugin_lto_args(undefined);
        break;
      case "LinkerPlugin":
        this.push_linker_plugin_lto_args(lto._0);
        break;
    }
  }

  // Add the `GNU_EH_FRAME` program header which is required to locate unwinding information.
  // Some versions of `gcc` add it implicitly, some (e.g. `musl-gcc`) don't,
  // so we just always add it.
  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:924 add_eh_frame_header
  override add_eh_frame_header(): void {
    this.link_arg("--eh-frame-hdr");
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:928 add_no_exec
  override add_no_exec(): void {
    if (this.sess.target.is_like_windows) {
      this.link_arg("--nxcompat");
    } else if (this.is_gnu) {
      this.link_args(["-z", "noexecstack"]);
    }
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:936 add_as_needed
  override add_as_needed(): void {
    if (this.is_gnu && !this.sess.target.is_like_windows) {
      this.link_arg("--as-needed");
    } else if (this.sess.target.is_like_solaris) {
      // -z ignore is the Solaris equivalent to the GNU ld --as-needed option
      this.link_args(["-z", "ignore"]);
    }
  }
}

class MsvcLinker extends DynLinker {
  constructor(
    public cmd_: Command,
    public sess: Session,
  ) {
    super();
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:952 cmd
  cmd(): Command {
    return this.cmd_;
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:956 set_output_kind
  set_output_kind(output_kind: LinkOutputKind, _crate_type: CrateType, out_filename: string): void {
    switch (output_kind) {
      case "DynamicNoPicExe":
      case "DynamicPicExe":
      case "StaticNoPicExe":
      case "StaticPicExe":
        break;
      case "DynamicDylib":
      case "StaticDylib": {
        this.link_arg("/DLL");
        let arg = "/IMPLIB:";
        arg += path_set_extension(out_filename, "dll.lib")[0];
        this.link_arg(arg);
        break;
      }
      case "WasiReactorExe":
        panic("can't link as reactor on non-wasi target");
    }
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:979 link_dylib_by_name
  override link_dylib_by_name(name: string, verbatim: boolean, _as_needed: boolean): void {
    // On MSVC-like targets rustc supports import libraries using alternative naming
    // scheme (`libfoo.a`) unsupported by linker, search for such libraries manually.
    const path = try_find_native_dynamic_library(this.sess, name, verbatim);
    if (path !== undefined) {
      this.link_arg(path);
    } else {
      this.link_arg(`${name}${verbatim ? "" : ".lib"}`);
    }
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:989 link_dylib_by_path
  override link_dylib_by_path(path: string, _as_needed: boolean): void {
    // When producing a dll, MSVC linker may not emit an implib file if the dll doesn't export
    // any symbols, so we skip linking if the implib file is not present.
    const implib_path = path_set_extension(path, "dll.lib")[0];
    if (fs_metadata(implib_path).$ === "Ok") {
      this.link_or_cc_arg(implib_path);
    }
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:998 link_staticlib_by_name
  link_staticlib_by_name(name: string, verbatim: boolean, whole_archive: boolean): void {
    // On MSVC-like targets rustc supports static libraries using alternative naming
    // scheme (`libfoo.a`) unsupported by linker, search for such libraries manually.
    const path = try_find_native_static_library(this.sess, name, verbatim);
    if (path !== undefined) {
      this.link_staticlib_by_path(path, whole_archive);
    } else {
      const opts = whole_archive ? "/WHOLEARCHIVE:" : "";
      const [prefix, suffix] = this.sess.staticlib_components(verbatim);
      this.link_arg(`${opts}${prefix}${name}${suffix}`);
    }
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1010 link_staticlib_by_path
  link_staticlib_by_path(path: string, whole_archive: boolean): void {
    if (!whole_archive) {
      this.link_arg(path);
    } else {
      let arg = "/WHOLEARCHIVE:";
      arg += path;
      this.link_arg(arg);
    }
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1020 gc_sections
  gc_sections(_keep_metadata: boolean): void {
    // MSVC's ICF (Identical COMDAT Folding) link optimization is
    // slow for Rust and thus we disable it by default when not in
    // optimization build.
    if (this.sess.opts.optimize !== "No") {
      this.link_arg("/OPT:REF,ICF");
    } else {
      // It is necessary to specify NOICF here, because /OPT:REF
      // implies ICF by default.
      this.link_arg("/OPT:REF,NOICF");
    }
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1033 full_relro
  full_relro(): void {
    // noop
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1037 partial_relro
  partial_relro(): void {
    // noop
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1041 no_relro
  no_relro(): void {
    // noop
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1045 no_crt_objects
  no_crt_objects(): void {
    // noop
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1049 no_default_libraries
  no_default_libraries(): void {
    this.link_arg("/NODEFAULTLIB");
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1053 include_path
  override include_path(path: string): void {
    let arg = "/LIBPATH:";
    arg += path;
    this.link_arg(arg);
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1059 output_filename
  override output_filename(path: string): void {
    let arg = "/OUT:";
    arg += path;
    this.link_arg(arg);
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1065 optimize
  optimize(): void {
    // Needs more investigation of `/OPT` arguments
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1069 pgo_gen
  pgo_gen(): void {
    // Nothing needed here.
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1073 control_flow_guard
  control_flow_guard(): void {
    this.link_arg("/guard:cf");
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1077 ehcont_guard
  ehcont_guard(): void {
    if (this.sess.target.pointer_width === 64) {
      this.link_arg("/guard:ehcont");
    }
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1083 debuginfo
  debuginfo(_strip: Strip, natvis_debugger_visualizers: readonly string[]): void {
    // This will cause the Microsoft linker to generate a PDB file
    // from the CodeView line tables in the object files.
    this.link_arg("/DEBUG");

    // Default to emitting only the file name of the PDB file into
    // the binary instead of the full path. Emitting the full path
    // may leak private information (such as user names).
    // See https://github.com/rust-lang/rust/issues/87825.
    //
    // This default behavior can be overridden by explicitly passing
    // `-Clink-arg=/PDBALTPATH:...` to rustc.
    this.link_arg("/PDBALTPATH:%_PDB%");

    // This will cause the Microsoft linker to embed .natvis info into the PDB file
    const natvis_dir_path = path_join(this.sess.opts.sysroot.path(), "lib\\rustlib\\etc");
    const natvis_dir = read_dir(natvis_dir_path);
    if (natvis_dir.$ === "Ok") {
      for (let entry = natvis_dir._0.next(); entry !== undefined; entry = natvis_dir._0.next()) {
        if (entry.$ === "Ok") {
          // PORT: `DirEntry::path` is the `read_dir` root joined with the entry's name. src/std's `DirEntry::file_name` is
          // lossy (U+FFFD for bytes that are not UTF-8) where upstream joins the raw `OsStr`, so a natvis file whose name is not
          // UTF-8 would print differently; unreachable in practice, as an MSVC target needs `link.exe`, and finding it stops.
          const path = path_join(natvis_dir_path, entry._0.file_name());
          if (path_extension(path) === "natvis") {
            let arg = "/NATVIS:";
            arg += path;
            this.link_arg(arg);
          }
        } else {
          this.sess.dcx().emit_warn(NoNatvisDirectory_diagnostic({ error: entry._0 }));
        }
      }
      natvis_dir._0.drop();
    }

    // This will cause the Microsoft linker to embed .natvis info for all crates into the PDB file
    for (const path of natvis_debugger_visualizers) {
      let arg = "/NATVIS:";
      arg += path;
      this.link_arg(arg);
    }
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1125 export_symbols
  export_symbols(tmpdir: string, crate_type: CrateType, _symbols: readonly SymbolExport[]): void {
    // We already add /EXPORT arguments to the .drectve section of symbols.o.
    // Keep passing an empty .def file: link.exe otherwise skips the import
    // library for DLLs with no exports.
    if (crate_type === "Executable") {
      const should_export_executable_symbols = this.sess.opts.unstable_opts.export_executable_symbols;
      if (!should_export_executable_symbols) {
        return;
      }
    }

    const path = path_join(tmpdir, "lib.def");
    const error = write_file(path, "LIBRARY\nEXPORTS\n");
    if (error !== undefined) {
      this.sess.dcx().emit_fatal(LibDefWriteFailure_diagnostic({ error }));
    }
    let arg = "/DEF:";
    arg += path;
    this.link_arg(arg);
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1151 windows_subsystem
  windows_subsystem(subsystem_: WindowsSubsystemKind): void {
    const subsystem = WindowsSubsystemKind.as_str(subsystem_);
    this.link_arg(`/SUBSYSTEM:${subsystem}`);

    // Windows has two subsystems we're interested in right now, the console
    // and windows subsystems. These both implicitly have different entry
    // points (starting symbols). The console entry point starts with
    // `mainCRTStartup` and the windows entry point starts with
    // `WinMainCRTStartup`. These entry points, defined in system libraries,
    // will then later probe for either `main` or `WinMain`, respectively to
    // start the application.
    //
    // In Rust we just always generate a `main` function so we want control
    // to always start there, so we force the entry point on the windows
    // subsystem to be `mainCRTStartup` to get everything booted up
    // correctly.
    //
    // For more information see RFC #1665
    if (subsystem === "windows") {
      this.link_arg("/ENTRY:mainCRTStartup");
    }
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1174 linker_plugin_lto
  linker_plugin_lto(): void {
    // Do nothing
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1178 add_no_exec
  override add_no_exec(): void {
    this.link_arg("/NXCOMPAT");
  }
}

class EmLinker extends DynLinker {
  constructor(
    public cmd_: Command,
    public sess: Session,
  ) {
    super();
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1189 cmd
  cmd(): Command {
    return this.cmd_;
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1193 is_cc
  override is_cc(): boolean {
    return true;
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1197 set_output_kind
  set_output_kind(output_kind: LinkOutputKind, _crate_type: CrateType, _out_filename: string): void {
    switch (output_kind) {
      case "DynamicNoPicExe":
      case "DynamicPicExe":
        this.cmd_.arg("-sMAIN_MODULE=2");
        break;
      case "DynamicDylib":
      case "StaticDylib":
        this.cmd_.arg("-sSIDE_MODULE=2");
        break;
      // -fno-pie is the default on Emscripten.
      case "StaticNoPicExe":
      case "StaticPicExe":
        break;
      case "WasiReactorExe":
        unreachable();
    }
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1218 link_dylib_by_name
  override link_dylib_by_name(name: string, _verbatim: boolean, _as_needed: boolean): void {
    // Emscripten always links statically
    this.link_or_cc_args(["-l", name]);
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1223 link_dylib_by_path
  override link_dylib_by_path(path: string, _as_needed: boolean): void {
    this.link_or_cc_arg(path);
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1227 link_staticlib_by_name
  link_staticlib_by_name(name: string, _verbatim: boolean, _whole_archive: boolean): void {
    this.link_or_cc_args(["-l", name]);
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1231 link_staticlib_by_path
  link_staticlib_by_path(path: string, _whole_archive: boolean): void {
    this.link_or_cc_arg(path);
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1235 full_relro
  full_relro(): void {
    // noop
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1239 partial_relro
  partial_relro(): void {
    // noop
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1243 no_relro
  no_relro(): void {
    // noop
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1247 gc_sections
  gc_sections(_keep_metadata: boolean): void {
    // noop
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1251 optimize
  optimize(): void {
    // Emscripten performs own optimizations
    let arg: string;
    switch (this.sess.opts.optimize) {
      case "No":
        arg = "-O0";
        break;
      case "Less":
        arg = "-O1";
        break;
      case "More":
        arg = "-O2";
        break;
      case "Aggressive":
        arg = "-O3";
        break;
      case "Size":
        arg = "-Os";
        break;
      case "SizeMin":
        arg = "-Oz";
        break;
    }
    this.cc_arg(arg);
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1263 pgo_gen
  pgo_gen(): void {
    // noop, but maybe we need something like the gnu linker?
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1267 control_flow_guard
  control_flow_guard(): void {}

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1269 ehcont_guard
  ehcont_guard(): void {}

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1271 debuginfo
  debuginfo(_strip: Strip, _natvis: readonly string[]): void {
    // Preserve names or generate source maps depending on debug info
    // For more information see https://emscripten.org/docs/tools_reference/emcc.html#emcc-g
    let arg: string;
    switch (this.sess.opts.debuginfo) {
      case "None":
        arg = "-g0";
        break;
      case "Limited":
      case "LineTablesOnly":
      case "LineDirectivesOnly":
        arg = "--profiling-funcs";
        break;
      case "Full":
        arg = "-g";
        break;
    }
    this.cc_arg(arg);
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1283 no_crt_objects
  no_crt_objects(): void {}

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1285 no_default_libraries
  no_default_libraries(): void {
    this.cc_arg("-nodefaultlibs");
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1289 export_symbols
  export_symbols(_tmpdir: string, _crate_type: CrateType, symbols: readonly SymbolExport[]): void {
    // debug!("EXPORTED SYMBOLS:");

    this.cc_arg("-s");

    // Emscripten exposes the program entry point under the JS name `_main`
    // regardless of the underlying wasm symbol (which is `__main_argc_argv`
    // per the wasm C ABI in the tool-conventions BasicCABI spec), bridging
    // the two internally. So the entry symbol must be requested as `_main`
    // here rather than as a `_`-prefixed form of its wasm name.
    const entry_name = this.sess.target.entry_name;
    let arg = "EXPORTED_FUNCTIONS=";
    // PORT: `serde_json::to_string` of a `Vec<String>` is `JSON.stringify` of the array: both escape `"`, `\` and the
    // control characters (`\b \f \n \r \t`, others as lowercase `\u00XX`) and nothing else.
    const encoded = JSON.stringify(
      symbols.map((sym) => {
        if (sym.name === entry_name) {
          return "_main";
        } else {
          return "_" + sym.name;
        }
      }),
    );
    // debug!("{encoded}");

    arg += encoded;

    this.cc_arg(arg);
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1321 windows_subsystem
  windows_subsystem(_subsystem: WindowsSubsystemKind): void {
    // noop
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1325 linker_plugin_lto
  linker_plugin_lto(): void {
    // Do nothing
  }
}

class WasmLd extends DynLinker {
  constructor(
    public cmd_: Command,
    public sess: Session,
  ) {
    super();
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1336 new
  static new(cmd: Command, sess: Session): WasmLd {
    return new WasmLd(cmd, sess);
  }

  // impl<'a> Linker for WasmLd<'a>

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1342 cmd
  cmd(): Command {
    return this.cmd_;
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1346 set_output_kind
  set_output_kind(output_kind: LinkOutputKind, _crate_type: CrateType, _out_filename: string): void {
    switch (output_kind) {
      case "DynamicNoPicExe":
      case "DynamicPicExe":
      case "StaticNoPicExe":
      case "StaticPicExe":
        break;
      case "DynamicDylib":
      case "StaticDylib":
        this.link_arg("--no-entry");
        break;
      case "WasiReactorExe":
        this.link_args(["--entry", "_initialize"]);
        break;
    }
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1366 link_dylib_by_name
  override link_dylib_by_name(name: string, _verbatim: boolean, _as_needed: boolean): void {
    this.link_or_cc_args(["-l", name]);
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1370 link_dylib_by_path
  override link_dylib_by_path(path: string, _as_needed: boolean): void {
    this.link_or_cc_arg(path);
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1374 link_staticlib_by_name
  link_staticlib_by_name(name: string, _verbatim: boolean, whole_archive: boolean): void {
    if (!whole_archive) {
      this.link_or_cc_args(["-l", name]);
    } else {
      this.link_arg("--whole-archive").link_or_cc_args(["-l", name]).link_arg("--no-whole-archive");
    }
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1384 link_staticlib_by_path
  link_staticlib_by_path(path: string, whole_archive: boolean): void {
    if (!whole_archive) {
      this.link_or_cc_arg(path);
    } else {
      this.link_arg("--whole-archive").link_or_cc_arg(path).link_arg("--no-whole-archive");
    }
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1392 full_relro
  full_relro(): void {}

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1394 partial_relro
  partial_relro(): void {}

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1396 no_relro
  no_relro(): void {}

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1398 gc_sections
  gc_sections(_keep_metadata: boolean): void {
    this.link_arg("--gc-sections");
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1402 optimize
  optimize(): void {
    // The -O flag is, as of late 2023, only used for merging of strings and debuginfo, and
    // only differentiates -O0 and -O1. It does not apply to LTO.
    let arg: string;
    switch (this.sess.opts.optimize) {
      case "No":
        arg = "-O0";
        break;
      case "Less":
        arg = "-O1";
        break;
      case "More":
        arg = "-O2";
        break;
      case "Aggressive":
        arg = "-O3";
        break;
      // Currently LLD doesn't support `Os` and `Oz`, so pass through `O2`
      // instead.
      case "Size":
        arg = "-O2";
        break;
      case "SizeMin":
        arg = "-O2";
        break;
    }
    this.link_arg(arg);
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1417 pgo_gen
  pgo_gen(): void {}

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1419 debuginfo
  debuginfo(strip: Strip, _natvis: readonly string[]): void {
    switch (strip) {
      case "None":
        break;
      case "Debuginfo":
        this.link_arg("--strip-debug");
        break;
      case "Symbols":
        this.link_arg("--strip-all");
        break;
    }
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1431 control_flow_guard
  control_flow_guard(): void {}

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1433 ehcont_guard
  ehcont_guard(): void {}

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1435 no_crt_objects
  no_crt_objects(): void {}

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1437 no_default_libraries
  no_default_libraries(): void {}

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1439 export_symbols
  export_symbols(_tmpdir: string, _crate_type: CrateType, symbols: readonly SymbolExport[]): void {
    for (const sym of symbols) {
      this.link_args(["--export", sym.name]);
    }
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1445 windows_subsystem
  windows_subsystem(_subsystem: WindowsSubsystemKind): void {}

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1447 linker_plugin_lto
  linker_plugin_lto(): void {
    switch (this.sess.opts.cg.linker_plugin_lto.$) {
      case "Disabled":
        // Nothing to do
        break;
      case "LinkerPluginAuto":
        this.push_linker_plugin_lto_args();
        break;
      case "LinkerPlugin":
        this.push_linker_plugin_lto_args();
        break;
    }
  }

  // impl<'a> WasmLd<'a>
  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1463 push_linker_plugin_lto_args
  push_linker_plugin_lto_args(): void {
    let opt_level: string;
    switch (this.sess.opts.optimize) {
      case "No":
        opt_level = "O0";
        break;
      case "Less":
        opt_level = "O1";
        break;
      case "More":
        opt_level = "O2";
        break;
      case "Aggressive":
        opt_level = "O3";
        break;
      // wasm-ld only handles integer LTO opt levels. Use O2
      case "Size":
      case "SizeMin":
        opt_level = "O2";
        break;
    }
    this.link_arg(`--lto-${opt_level}`);
  }
}

/// Linker for AIX.
class AixLinker extends DynLinker {
  constructor(
    public cmd_: Command,
    public sess: Session,
    public hinted_static: boolean | undefined,
  ) {
    super();
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1484 new
  static new(cmd: Command, sess: Session): AixLinker {
    return new AixLinker(cmd, sess, undefined);
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1488 hint_static
  hint_static(): void {
    if (this.hinted_static !== true) {
      this.link_arg("-bstatic");
      this.hinted_static = true;
    }
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1495 hint_dynamic
  hint_dynamic(): void {
    if (this.hinted_static !== false) {
      this.link_arg("-bdynamic");
      this.hinted_static = false;
    }
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1502 build_dylib
  build_dylib(_out_filename: string): void {
    this.link_args(["-bM:SRE", "-bnoentry"]);
    // FIXME: Use CreateExportList utility to create export list
    // and remove -bexpfull.
    this.link_arg("-bexpfull");
  }

  // impl<'a> Linker for AixLinker<'a>

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1511 cmd
  cmd(): Command {
    return this.cmd_;
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1515 set_output_kind
  set_output_kind(output_kind: LinkOutputKind, _crate_type: CrateType, out_filename: string): void {
    switch (output_kind) {
      case "DynamicDylib":
        this.hint_dynamic();
        this.build_dylib(out_filename);
        break;
      case "StaticDylib":
        this.hint_static();
        this.build_dylib(out_filename);
        break;
      default:
        break;
    }
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1534 link_dylib_by_name
  override link_dylib_by_name(name: string, verbatim: boolean, _as_needed: boolean): void {
    this.hint_dynamic();
    this.link_or_cc_arg(verbatim ? name : `-l${name}`);
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1539 link_dylib_by_path
  override link_dylib_by_path(path: string, _as_needed: boolean): void {
    this.hint_dynamic();
    this.link_or_cc_arg(path);
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1544 link_staticlib_by_name
  link_staticlib_by_name(name: string, verbatim: boolean, whole_archive: boolean): void {
    this.hint_static();
    if (!whole_archive) {
      this.link_or_cc_arg(verbatim ? name : `-l${name}`);
    } else {
      let arg = "-bkeepfile:";
      arg += find_native_static_library(name, verbatim, this.sess);
      this.link_or_cc_arg(arg);
    }
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1555 link_staticlib_by_path
  link_staticlib_by_path(path: string, whole_archive: boolean): void {
    this.hint_static();
    if (!whole_archive) {
      this.link_or_cc_arg(path);
    } else {
      let arg = "-bkeepfile:";
      arg += path;
      this.link_arg(arg);
    }
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1566 full_relro
  full_relro(): void {}

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1568 partial_relro
  partial_relro(): void {}

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1570 no_relro
  no_relro(): void {}

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1572 gc_sections
  gc_sections(_keep_metadata: boolean): void {
    this.link_arg("-bgc");
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1576 optimize
  optimize(): void {}

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1578 pgo_gen
  pgo_gen(): void {
    this.link_arg("-bdbg:namedsects:ss");
    this.link_arg("-u");
    this.link_arg("__llvm_profile_runtime");
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1584 control_flow_guard
  control_flow_guard(): void {}

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1586 ehcont_guard
  ehcont_guard(): void {}

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1588 debuginfo
  debuginfo(_strip: Strip, _natvis: readonly string[]): void {}

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1590 no_crt_objects
  no_crt_objects(): void {}

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1592 no_default_libraries
  no_default_libraries(): void {}

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1594 export_symbols
  export_symbols(tmpdir: string, _crate_type: CrateType, symbols: readonly SymbolExport[]): void {
    const path = path_join(tmpdir, "list.exp");
    let f = "";
    // FIXME: use llvm-nm to generate export list.
    for (const symbol of symbols) {
      // debug!("  _{}", symbol.name);
      f += `  ${symbol.name}\n`;
    }
    const e = write_file(path, f);
    if (e !== undefined) {
      this.sess.dcx().fatal(`failed to write export file: ${display_IoError(e)}`);
    }
    // PORT: upstream writes `path.to_str().unwrap()`, which panics on a non-UTF-8 path; the port's paths are strings, so the
    // `unwrap` cannot fail and is dropped.
    this.link_arg(`-bE:${path}`);
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1610 windows_subsystem
  windows_subsystem(_subsystem: WindowsSubsystemKind): void {}

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1612 reset_per_library_state
  override reset_per_library_state(): void {
    this.hint_dynamic();
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1616 linker_plugin_lto
  linker_plugin_lto(): void {}

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1618 add_eh_frame_header
  override add_eh_frame_header(): void {}

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1620 add_no_exec
  override add_no_exec(): void {}

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1622 add_as_needed
  override add_as_needed(): void {}
}

// rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1625 for_each_exported_symbols_include_dep
function for_each_exported_symbols_include_dep(
  tcx: TyCtxt,
  crate_type: CrateType,
  callback: (symbol: ExportedSymbol, info: SymbolExportInfo, cnum: CrateNum) => void,
): void {
  const formats = tcx.dependency_formats(null) as Dependencies;
  const deps = formats.get(crate_type);
  if (deps === undefined) return panic("IndexMap: key not found");

  for (let i = 0; i < deps.length; i++) {
    const cnum = i as CrateNum;
    const dep_format = deps[i];
    // For each dependency that we are linking to statically ...
    if (dep_format === "Static") {
      for (const [symbol, info] of tcx.exported_non_generic_symbols(cnum) as readonly [ExportedSymbol, SymbolExportInfo][]) {
        callback(symbol, info, cnum);
      }
      for (const [symbol, info] of tcx.exported_generic_symbols(cnum) as readonly [ExportedSymbol, SymbolExportInfo][]) {
        callback(symbol, info, cnum);
      }
    }
  }
}

// rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1646 symbol_export_from_exported_symbol
function symbol_export_from_exported_symbol(tcx: TyCtxt, symbol: ExportedSymbol, kind: SymbolExportKind, cnum: CrateNum): SymbolExport {
  const name = symbol_export.exporting_symbol_name_for_instance_in_crate(tcx, symbol, cnum);
  const link_name = symbol_export.linking_symbol_name_for_instance_in_crate(tcx, symbol, kind, cnum);
  return SymbolExport.with_link_name(name, kind, link_name);
}

// rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1658 symbol_export_from_raw_name
function symbol_export_from_raw_name(tcx: TyCtxt, name: string, kind: SymbolExportKind): SymbolExport {
  const symbol: ExportedSymbol = { $: "NoDefId", _0: SymbolName.new(tcx, name) };
  const link_name = symbol_export.linking_symbol_name_for_instance_in_crate(tcx, symbol, kind, LOCAL_CRATE);
  return SymbolExport.with_link_name(name, kind, link_name);
}

// rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1669 exported_symbols
export function exported_symbols(tcx: TyCtxt, crate_type: CrateType): SymbolExport[] {
  const exports = tcx.sess.target.override_export_symbols;
  if (exports !== undefined) {
    return exports.map((name) =>
      symbol_export_from_raw_name(
        tcx,
        name,
        // FIXME use the correct export kind for this symbol. override_export_symbols
        // can't directly specify the SymbolExportKind as it is defined in rustc_middle
        // which rustc_target can't depend on.
        SymbolExportKind.Text,
      ),
    );
  }

  const symbols = crate_type === "ProcMacro" ? exported_symbols_for_proc_macro_crate(tcx) : exported_symbols_for_non_proc_macro(tcx, crate_type);

  // Preserve the metadata symbol to ensure the metadata section doesn't get removed by the
  // linker. On wasm however the metadata is put in a custom section, to which symbols can't
  // refer, so there is no metadata symbol there. Luckily custom sections are always preserved by
  // the linker.
  if ((crate_type === "Dylib" || crate_type === "ProcMacro") && !tcx.sess.target.is_like_wasm) {
    const metadata_symbol_name = exported_symbols_metadata_symbol_name(tcx);
    symbols.push(symbol_export_from_raw_name(tcx, metadata_symbol_name, SymbolExportKind.Data));
  }

  return symbols;
}

// rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1710 exported_symbols_for_non_proc_macro
function exported_symbols_for_non_proc_macro(tcx: TyCtxt, crate_type: CrateType): SymbolExport[] {
  const symbols: SymbolExport[] = [];
  const export_threshold = symbol_export.crates_export_threshold([crate_type]);
  for_each_exported_symbols_include_dep(tcx, crate_type, (symbol, info, cnum) => {
    // Do not export mangled symbols from cdylibs and don't attempt to export compiler-builtins
    // from any dylib. The latter doesn't work anyway as we use hidden visibility for
    // compiler-builtins. Most linkers silently ignore it, but ld64 gives a warning.
    if (SymbolExportLevel.is_below_threshold(info.level, export_threshold) && !tcx.is_compiler_builtins(cnum)) {
      symbols.push(symbol_export_from_exported_symbol(tcx, symbol, info.kind, cnum));
      symbol_export.extend_exported_symbols(symbols, tcx, symbol, cnum);
    }
  });

  // Mark allocator shim symbols as exported only if they were generated.
  let kind: AllocatorKind | undefined;
  if (
    export_threshold === "Rust" &&
    needs_allocator_shim_for_linking(tcx.dependency_formats(null) as Dependencies, crate_type) &&
    (kind = tcx.allocator_kind(null) as AllocatorKind | undefined) !== undefined
  ) {
    for (const [name, kind_] of allocator_shim_symbols(tcx, kind)) {
      symbols.push(symbol_export_from_raw_name(tcx, name, kind_));
    }
  }

  return symbols;
}

// rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1740 exported_symbols_for_proc_macro_crate
function exported_symbols_for_proc_macro_crate(tcx: TyCtxt): SymbolExport[] {
  // `exported_symbols` will be empty when !should_codegen.
  if (!tcx.sess.opts.output_types.should_codegen()) {
    return [];
  }

  const stable_crate_id = tcx.stable_crate_id(LOCAL_CRATE);
  const proc_macro_decls_name = generate_proc_macro_decls_symbol(stable_crate_id);

  return [symbol_export_from_raw_name(tcx, proc_macro_decls_name, SymbolExportKind.Data)];
}

// rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1752 linked_symbols
export function linked_symbols(tcx: TyCtxt, crate_type: CrateType): [string, SymbolExportKind][] {
  switch (crate_type) {
    case "Executable":
    case "ProcMacro":
    case "Cdylib":
    case "Dylib":
    case "Sdylib":
      break;
    case "StaticLib":
    case "Rlib":
      // These are not linked, so no need to generate symbols.o for them.
      return [];
  }

  switch (tcx.sess.lto()) {
    case "No":
    case "ThinLocal":
      break;
    case "Thin":
    case "Fat":
      // We really only need symbols from upstream rlibs to end up in the linked symbols list.
      // The rest are in separate object files which the linker will always link in and
      // doesn't have rules around the order in which they need to appear.
      // When doing LTO, some of the symbols in the linked symbols list happen to be
      // internalized by LTO, which then prevents referencing them from symbols.o. When doing
      // LTO, all object files that get linked in will be local object files rather than
      // pulled in from rlibs, so an empty linked symbols list works fine to avoid referencing
      // all those internalized symbols from symbols.o.
      return [];
  }

  const symbols: [string, SymbolExportKind][] = [];

  const export_threshold = symbol_export.crates_export_threshold([crate_type]);
  for_each_exported_symbols_include_dep(tcx, crate_type, (symbol, info, cnum) => {
    if ((SymbolExportLevel.is_below_threshold(info.level, export_threshold) && !tcx.is_compiler_builtins(cnum)) || info.used || info.rustc_std_internal_symbol) {
      symbols.push([symbol_export.linking_symbol_name_for_instance_in_crate(tcx, symbol, info.kind, cnum), info.kind]);
    }
  });

  return symbols;
}

/// The `self-contained` LLVM bitcode linker
class LlbcLinker extends DynLinker {
  constructor(
    public cmd_: Command,
    public sess: Session,
  ) {
    super();
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1810 cmd
  cmd(): Command {
    return this.cmd_;
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1814 set_output_kind
  set_output_kind(_output_kind: LinkOutputKind, _crate_type: CrateType, _out_filename: string): void {}

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1822 link_staticlib_by_name
  link_staticlib_by_name(_name: string, _verbatim: boolean, _whole_archive: boolean): void {
    panic("staticlibs not supported");
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1826 link_staticlib_by_path
  link_staticlib_by_path(path: string, _whole_archive: boolean): void {
    this.link_or_cc_arg(path);
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1830 debuginfo
  debuginfo(strip: Strip, _natvis: readonly string[]): void {
    switch (strip) {
      case "None":
        this.link_arg("--debug");
        break;
      case "Debuginfo":
      case "Symbols":
        break;
    }
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1839 optimize
  optimize(): void {
    let arg: string;
    switch (this.sess.opts.optimize) {
      case "No":
        arg = "-O0";
        break;
      case "Less":
        arg = "-O1";
        break;
      case "More":
        arg = "-O2";
        break;
      case "Aggressive":
        arg = "-O3";
        break;
      case "Size":
        arg = "-Os";
        break;
      case "SizeMin":
        arg = "-Oz";
        break;
    }
    this.link_arg(arg);
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1850 full_relro
  full_relro(): void {}

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1852 partial_relro
  partial_relro(): void {}

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1854 no_relro
  no_relro(): void {}

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1856 gc_sections
  gc_sections(_keep_metadata: boolean): void {}

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1858 pgo_gen
  pgo_gen(): void {}

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1860 no_crt_objects
  no_crt_objects(): void {}

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1862 no_default_libraries
  no_default_libraries(): void {}

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1864 control_flow_guard
  control_flow_guard(): void {}

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1866 ehcont_guard
  ehcont_guard(): void {}

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1868 export_symbols
  export_symbols(_tmpdir: string, _crate_type: CrateType, symbols: readonly SymbolExport[]): void {
    switch (_crate_type) {
      case "Cdylib":
        for (const sym of symbols) {
          this.link_args(["--export-symbol", sym.name]);
        }
        break;
      default:
        break;
    }
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1879 windows_subsystem
  windows_subsystem(_subsystem: WindowsSubsystemKind): void {}

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1881 linker_plugin_lto
  linker_plugin_lto(): void {}
}

class BpfLinker extends DynLinker {
  constructor(
    public cmd_: Command,
    public sess: Session,
  ) {
    super();
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1890 cmd
  cmd(): Command {
    return this.cmd_;
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1894 set_output_kind
  set_output_kind(_output_kind: LinkOutputKind, _crate_type: CrateType, _out_filename: string): void {}

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1902 link_staticlib_by_name
  link_staticlib_by_name(_name: string, _verbatim: boolean, _whole_archive: boolean): void {
    this.sess.dcx().emit_fatal(BpfStaticlibNotSupported_diagnostic({}));
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1906 link_staticlib_by_path
  link_staticlib_by_path(path: string, _whole_archive: boolean): void {
    this.link_or_cc_arg(path);
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1910 debuginfo
  debuginfo(_strip: Strip, _natvis: readonly string[]): void {
    this.link_arg("--debug");
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1914 optimize
  optimize(): void {
    let arg: string;
    switch (this.sess.opts.optimize) {
      case "No":
        arg = "-O0";
        break;
      case "Less":
        arg = "-O1";
        break;
      case "More":
        arg = "-O2";
        break;
      case "Aggressive":
        arg = "-O3";
        break;
      case "Size":
        arg = "-Os";
        break;
      case "SizeMin":
        arg = "-Oz";
        break;
    }
    this.link_arg(arg);
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1925 full_relro
  full_relro(): void {}

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1927 partial_relro
  partial_relro(): void {}

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1929 no_relro
  no_relro(): void {}

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1931 gc_sections
  gc_sections(_keep_metadata: boolean): void {}

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1933 pgo_gen
  pgo_gen(): void {}

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1935 no_crt_objects
  no_crt_objects(): void {}

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1937 no_default_libraries
  no_default_libraries(): void {}

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1939 control_flow_guard
  control_flow_guard(): void {}

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1941 ehcont_guard
  ehcont_guard(): void {}

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1943 export_symbols
  export_symbols(tmpdir: string, _crate_type: CrateType, symbols: readonly SymbolExport[]): void {
    const path = path_join(tmpdir, "symbols");
    let f = "";
    for (const sym of symbols) {
      f += `${sym.name}\n`;
    }
    const error = write_file(path, f);
    if (error !== undefined) {
      this.sess.dcx().emit_fatal(SymbolFileWriteFailure_diagnostic({ error }));
    } else {
      this.link_arg("--export-symbols").link_arg(path);
    }
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1958 windows_subsystem
  windows_subsystem(_subsystem: WindowsSubsystemKind): void {}

  // rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1960 linker_plugin_lto
  linker_plugin_lto(): void {}
}
