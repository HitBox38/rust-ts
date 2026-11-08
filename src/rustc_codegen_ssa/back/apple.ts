// Port of compiler/rustc_codegen_ssa/src/back/apple.rs (lane object-write-macho).
//
// PORT: `sdk_name`, `macho_platform` (the Mach-O wrapper files' `LC_BUILD_VERSION`), `add_version_to_llvm_target` and
// `stdout_to_path` are ported. The linker's half stops `unported`: `add_data_and_relocation` needs `object::write`
// relocations (not ported), and `get_sdk_root`, `xcrun_show_sdk_path`, `xcode_select_developer_dir` are reached only from
// `link_natively` (not ported). `debug!` tracing calls are kept as comments.
// Load order: `Os` and `Env` come through the crate root, not spec/mod.ts. spec/mod.ts, lib.ts and spec/json.ts form a
// cycle that only lib.ts enters safely (spec/json.ts reads `Os` at its top level), and test files reach this module
// first (lane unit-parallel; fixers-43 O1).
import { spec } from "../../rustc_target/lib.ts";
import type { Target } from "../../rustc_target/spec/mod.ts";
import type { OSVersion } from "../../rustc_target/spec/base/apple/mod.ts";
import { debug_str } from "../../std/fmt.ts";
import { assert, panic, unported, unreachable } from "../../std/panic.ts";
import * as macho from "../../vendor/object/macho.ts";

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
/// (See upstream for how the values were found.)
// rustc: compiler/rustc_codegen_ssa/src/back/apple.rs:81 add_data_and_relocation
export function add_data_and_relocation(_file: unknown, _section: unknown, _symbol: unknown, _target: Target, _kind: unknown): never {
  // PORT: needs `object::write::Object::add_relocation` (not ported) and is reached only from the linker's
  // `add_linked_symbol_object` (not ported).
  return unported("rustc_codegen_ssa::back::apple::add_data_and_relocation (object::write relocations)");
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
export function get_sdk_root(_sess: unknown): never {
  // PORT: reached only from `link_natively` (not ported).
  return unported("rustc_codegen_ssa::back::apple::get_sdk_root (linking for Apple targets)");
}

/// Invoke `xcrun --sdk $sdk_name --show-sdk-path` to get the SDK path.
///
/// (See upstream for how `xcrun` finds the developer directory.)
// rustc: compiler/rustc_codegen_ssa/src/back/apple.rs:224 xcrun_show_sdk_path
export function xcrun_show_sdk_path(_sdk_name: string, _verbose: boolean): never {
  // PORT: reached only from `get_sdk_root`.
  return unported("rustc_codegen_ssa::back::apple::xcrun_show_sdk_path (linking for Apple targets)");
}

/// Invoke `xcode-select --print-path`, and return the current developer directory.
///
/// NOTE: We don't do any error handling here, this is only used as a canary in diagnostics (`xcrun`
/// will have already emitted the relevant error information).
// rustc: compiler/rustc_codegen_ssa/src/back/apple.rs:284 xcode_select_developer_dir
export function xcode_select_developer_dir(): never {
  // PORT: reached only from `get_sdk_root`.
  return unported("rustc_codegen_ssa::back::apple::xcode_select_developer_dir (linking for Apple targets)");
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
