// Port of compiler/rustc_codegen_ssa/src/back/apple.rs (lanes object-write-macho, vendor-object-write).
//
// PORT: `debug!` tracing calls are kept as comments. `Command::new("xcrun")` / `("xcode-select")` is `ProcessCommand`
// (back/command.ts, D15): a host tool call, like the linker's.
// Load order: `Os` and `Env` come through the crate root, not spec/mod.ts. spec/mod.ts, lib.ts and spec/json.ts form a
// cycle that only lib.ts enters safely (spec/json.ts reads `Os` at its top level), and test files reach this module
// first (lane unit-parallel; fixers-43 O1).
import { spec } from "../../rustc_target/lib.ts";
import type { Target } from "../../rustc_target/spec/mod.ts";
import type { OSVersion } from "../../rustc_target/spec/base/apple/mod.ts";
import type { SymbolExportKind } from "../../rustc_middle/middle/exported_symbols.ts";
import type { Session } from "../../rustc_session/session.ts";
import { PathBuf_into_diag_arg } from "../../rustc_error_messages/diagnostic_impls.ts";
import { IntoDiagArg } from "../../rustc_errors/lib.ts";
import { debug_str } from "../../std/fmt.ts";
import { assert, panic, unreachable } from "../../std/panic.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
import { str_lines, string_trim } from "../../std/str.ts";
import type { RelocationFlags } from "../../vendor/object/common.ts";
import * as macho from "../../vendor/object/macho.ts";
import type { Object as WriteObject, Result as WriteResult, SectionId, SymbolId } from "../../vendor/object/write/mod.ts";
import { ProcessCommand } from "./command.ts";
import { type XcrunError, XcrunError_diagnostic, XcrunSdkPathWarning_diagnostic } from "../diagnostics.gen.ts";

export type { OSVersion } from "../../rustc_target/spec/base/apple/mod.ts";

/// The canonical name of the desired SDK for a given target.
// rustc: compiler/rustc_codegen_ssa/src/back/apple.rs:19 sdk_name
export function sdk_name(target: Target): string {
  const os = target.os.$;
  const env = target.env.$;
  if (os === "MacOs" && env === "Unspecified") return "MacOSX";
  if (os === "IOs" && env === "Unspecified") return "iPhoneOS";
  if (os === "IOs" && env === "Sim") return "iPhoneSimulator";
  // Mac Catalyst uses the macOS SDK
  if (os === "IOs" && env === "MacAbi") return "MacOSX";
  if (os === "TvOs" && env === "Unspecified") return "AppleTVOS";
  if (os === "TvOs" && env === "Sim") return "AppleTVSimulator";
  if (os === "VisionOs" && env === "Unspecified") return "XROS";
  if (os === "VisionOs" && env === "Sim") return "XRSimulator";
  if (os === "WatchOs" && env === "Unspecified") return "WatchOS";
  if (os === "WatchOs" && env === "Sim") return "WatchSimulator";
  return unreachable(
    `internal error: entered unreachable code: invalid os '${spec.Os.desc(target.os)}' / abi '${spec.Env.desc(target.env)}' combination for Apple target`,
  );
}

// rustc: compiler/rustc_codegen_ssa/src/back/apple.rs:36 macho_platform
export function macho_platform(target: Target): number {
  const os = target.os.$;
  const env = target.env.$;
  if (os === "MacOs") return macho.PLATFORM_MACOS;
  if (os === "IOs" && env === "MacAbi") return macho.PLATFORM_MACCATALYST;
  if (os === "IOs" && env === "Sim") return macho.PLATFORM_IOSSIMULATOR;
  if (os === "IOs") return macho.PLATFORM_IOS;
  if (os === "WatchOs" && env === "Sim") return macho.PLATFORM_WATCHOSSIMULATOR;
  if (os === "WatchOs") return macho.PLATFORM_WATCHOS;
  if (os === "TvOs" && env === "Sim") return macho.PLATFORM_TVOSSIMULATOR;
  if (os === "TvOs") return macho.PLATFORM_TVOS;
  if (os === "VisionOs" && env === "Sim") return macho.PLATFORM_XROSSIMULATOR;
  if (os === "VisionOs") return macho.PLATFORM_XROS;
  return unreachable(
    `internal error: entered unreachable code: invalid os '${spec.Os.desc(target.os)}' / env '${spec.Env.desc(target.env)}' combination for Apple target`,
  );
}

/// Add relocation and section data needed for a symbol to be considered
/// undefined by ld64.
///
/// The relocation must be valid, and hence must point to a valid piece of
/// machine code, and hence this is unfortunately very architecture-specific.
///
///
/// # New architectures
///
/// The values here are basically the same as emitted by the following program:
///
/// ```c
/// // clang -c foo.c -target $CLANG_TARGET
/// void foo(void);
///
/// extern int bar;
///
/// void* foobar[2] = {
///     (void*)foo,
///     (void*)&bar,
///     // ...
/// };
/// ```
///
/// Can be inspected with:
/// ```console
/// objdump --macho --reloc foo.o
/// objdump --macho --full-contents foo.o
/// ```
// rustc: compiler/rustc_codegen_ssa/src/back/apple.rs:81 add_data_and_relocation
export function add_data_and_relocation(file: WriteObject, section: SectionId, symbol: SymbolId, target: Target, kind: SymbolExportKind): WriteResult<null> {
  const authenticated_pointer = kind === "Text" && target.llvm_target.startsWith("arm64e");

  let data: Uint8Array;
  if (authenticated_pointer) data = Uint8Array.of(0, 0, 0, 0, 0, 0, 0, 0x80);
  else if (target.pointer_width === 32) data = new Uint8Array(4);
  else if (target.pointer_width === 64) data = new Uint8Array(8);
  else {
    const pointer_width = target.pointer_width;
    return panic(`not implemented: unsupported Apple pointer width ${pointer_width}`);
  }

  if (target.arch.$ === "X86_64") {
    // Force alignment for the entire section to be 16 on x86_64.
    file.section_mut(section).append_data(new Uint8Array(0), 16);
  } else {
    // Elsewhere, the section alignment is the same as the pointer width.
    file.section_mut(section).append_data(new Uint8Array(0), target.pointer_width);
  }

  const offset = file.section_mut(section).append_data(data, data.length);

  let flags: RelocationFlags;
  if (authenticated_pointer) {
    flags = { $: "MachO", r_type: macho.ARM64_RELOC_AUTHENTICATED_POINTER, r_pcrel: false, r_length: 3 };
  } else if (target.arch.$ === "Arm") {
    // FIXME(madsmtm): Remove once `object` supports 32-bit ARM relocations:
    // https://github.com/gimli-rs/object/pull/757
    flags = { $: "MachO", r_type: macho.ARM_RELOC_VANILLA, r_pcrel: false, r_length: 2 };
  } else {
    flags = { $: "Generic", kind: "Absolute", encoding: "Generic", size: target.pointer_width & 0xff };
  }

  const r = file.add_relocation(section, { offset, addend: 0n, symbol, flags });
  if (r.$ === "Err") return r;

  return Ok(null);
}

// rustc: compiler/rustc_codegen_ssa/src/back/apple.rs:135 add_version_to_llvm_target
export function add_version_to_llvm_target(llvm_target: string, deployment_target: OSVersion): string {
  const components = llvm_target.split("-")[Symbol.iterator]();
  const next = (): string | undefined => {
    const n = components.next();
    return n.done === true ? undefined : n.value;
  };
  const arch = next() ?? panic("apple target should have arch");
  const vendor = next() ?? panic("apple target should have vendor");
  const os = next() ?? panic("apple target should have os");
  const environment = next();
  const extra = next();
  if (extra !== undefined) {
    // `assert_eq!(components.next(), None, "too many LLVM triple components")`
    panic(`assertion \`left == right\` failed: too many LLVM triple components\n  left: Some(${debug_str(extra)})\n right: None`);
  }

  assert(!/[0-9]/.test(os), "LLVM target must not already be versioned");

  const version = deployment_target.fmt_full();
  if (environment !== undefined) {
    const env = environment;
    // Insert version into OS, before environment
    return `${arch}-${vendor}-${os}${version}-${env}`;
  } else {
    return `${arch}-${vendor}-${os}${version}`;
  }
}

// rustc: compiler/rustc_codegen_ssa/src/back/apple.rs:160 get_sdk_root
export function get_sdk_root(sess: Session): string | undefined {
  const sdk_name_ = sdk_name(sess.target);

  // Attempt to invoke `xcrun` to find the SDK.
  //
  // Note that when cross-compiling from e.g. Linux, the `xcrun` binary may sometimes be provided
  // as a shim by a cross-compilation helper tool. It usually isn't, but we still try nonetheless.
  const r = xcrun_show_sdk_path(sdk_name_, false);
  if (r.$ === "Ok") {
    const [path, stderr] = r._0;
    // Emit extra stderr, such as if `-verbose` was passed, or if `xcrun` emitted a warning.
    if (stderr.length !== 0) {
      sess.dcx().emit_warn(XcrunSdkPathWarning_diagnostic({ sdk_name: sdk_name_, stderr }));
    }
    return path;
  } else {
    const err = r._0;
    // Failure to find the SDK is not a hard error, since the user might have specified it
    // in a manner unknown to us (moreso if cross-compiling):
    // - A compiler driver like `zig cc` which links using an internally bundled SDK.
    // - Extra linker arguments (`-Clink-arg=-syslibroot`).
    // - A custom linker or custom compiler driver.
    //
    // Though we still warn, since such cases are uncommon, and it is very hard to debug if
    // you do not know the details.
    //
    // FIXME(madsmtm): Make this a lint, to allow deny warnings to work.
    // (Or fix <https://github.com/rust-lang/rust/issues/21204>).
    const diag = sess.dcx().create_warn(XcrunError_diagnostic(err));
    diag.note({
      $: "Inline",
      _0: "the SDK is needed by the linker to know where to find symbols in system libraries and for embedding the SDK version in the final object file",
    });

    // Recognize common error cases, and give more Rust-specific error messages for those.
    const developer_dir = xcode_select_developer_dir();
    if (developer_dir !== undefined) {
      diag.arg("developer_dir", IntoDiagArg.of(developer_dir, PathBuf_into_diag_arg));
      diag.note({ $: "Inline", _0: 'found active developer directory at "{$developer_dir}"' });
      // PORT: `as_os_str().to_string_lossy()`: the path is already a string.
      if (developer_dir.includes("CommandLineTools")) {
        if (sdk_name_ !== "MacOSX") {
          diag.help({ $: "Inline", _0: "when compiling for iOS, tvOS, visionOS or watchOS, you need a full installation of Xcode" });
        }
      }
    } else {
      diag.help({
        $: "Inline",
        _0: "pass the path of an Xcode installation via the DEVELOPER_DIR environment variable, or an SDK with the SDKROOT environment variable",
      });
    }

    diag.emit();
    return undefined;
  }
}

/// Invoke `xcrun --sdk $sdk_name --show-sdk-path` to get the SDK path.
///
/// The exact logic that `xcrun` uses is unspecified (see `man xcrun` for a few details), and may
/// change between macOS and Xcode versions, but it roughly boils down to finding the active
/// developer directory, and then invoking `xcodebuild -sdk $sdk_name -version` to get the SDK
/// details.
///
/// Finding the developer directory is roughly done by looking at, in order:
/// - The `DEVELOPER_DIR` environment variable.
/// - The `/var/db/xcode_select_link` symlink (set by `xcode-select --switch`).
/// - `/Applications/Xcode.app` (hardcoded fallback path).
/// - `/Library/Developer/CommandLineTools` (hardcoded fallback path).
///
/// Note that `xcrun` caches its result, but with a cold cache this whole operation can be quite
/// slow, especially so the first time it's run after a reboot.
// rustc: compiler/rustc_codegen_ssa/src/back/apple.rs:224 xcrun_show_sdk_path
export function xcrun_show_sdk_path(sdk_name: string, verbose: boolean): Result<[string, string], XcrunError> {
  // Intentionally invoke the `xcrun` in PATH, since e.g. nixpkgs provide an `xcrun` shim, so we
  // don't want to require `/usr/bin/xcrun`.
  const cmd = ProcessCommand.new("xcrun");
  if (verbose) {
    cmd.arg("--verbose");
  }
  // The `--sdk` parameter is the same as in xcodebuild, namely either an absolute path to an SDK,
  // or the (lowercase) canonical name of an SDK.
  cmd.arg("--sdk");
  cmd.arg(sdk_name.toLowerCase());
  cmd.arg("--show-sdk-path");

  // We do not stream stdout/stderr lines directly to the user, since whether they are warnings or
  // errors depends on the status code at the end.
  const output_ = cmd.output();
  if (output_.$ === "Err") {
    return Err({ $: "FailedInvoking", sdk_name, command_formatted: cmd.debug(), error: output_._0 });
  }
  const output = output_._0;

  // It is fine to do lossy conversion here, non-UTF-8 paths are quite rare on macOS nowadays
  // (only possible with the HFS+ file system), and we only use it for error messages.
  // PORT: `ignoreBOM`, as `from_utf8_lossy_owned` keeps a leading U+FEFF (review vendor-object-write N1).
  let stderr = new TextDecoder("utf-8", { ignoreBOM: true }).decode(output.stderr);
  if (stderr.length !== 0) {
    // debug!(stderr, "original xcrun stderr");
  }

  // Some versions of `xcodebuild` output beefy errors when invoked via `xcrun`,
  // but these are usually red herrings.
  stderr = str_lines(stderr)
    .filter((line) => !line.includes("Writing error result bundle") && !line.includes("Requested but did not find extension point with identifier"))
    .join("\n");

  if (output.status.success()) {
    return Ok([stdout_to_path(output.stdout), stderr]);
  } else {
    // Output both stdout and stderr, since shims of `xcrun` (such as the one provided by
    // nixpkgs), do not always use stderr for errors.
    const stdout = string_trim(new TextDecoder("utf-8", { ignoreBOM: true }).decode(output.stdout));
    return Err({ $: "Unsuccessful", sdk_name, command_formatted: cmd.debug(), stdout, stderr });
  }
}

/// Invoke `xcode-select --print-path`, and return the current developer directory.
///
/// NOTE: We don't do any error handling here, this is only used as a canary in diagnostics (`xcrun`
/// will have already emitted the relevant error information).
// rustc: compiler/rustc_codegen_ssa/src/back/apple.rs:284 xcode_select_developer_dir
export function xcode_select_developer_dir(): string | undefined {
  const cmd = ProcessCommand.new("xcode-select");
  cmd.arg("--print-path");
  const output = cmd.output();
  if (output.$ === "Err") return undefined;
  if (!output._0.status.success()) {
    return undefined;
  }
  return stdout_to_path(output._0.stdout);
}

// rustc: compiler/rustc_codegen_ssa/src/back/apple.rs:294 stdout_to_path
export function stdout_to_path(stdout: Uint8Array): string {
  // Remove trailing newline.
  if (stdout.length > 0 && stdout[stdout.length - 1] === 0x0a) {
    stdout = stdout.subarray(0, stdout.length - 1);
  }
  // PORT: `OsString::from_vec` → `PathBuf`; paths are `string`s here, and the bytes are read as UTF-8 (lossy).
  return new TextDecoder().decode(stdout);
}
