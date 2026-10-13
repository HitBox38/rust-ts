// compiler/rustc_target/src/spec/base/apple/mod.rs
import type { ParseIntError } from "../../../../rustc_abi/lib.ts";
import { type Debug, debug_struct } from "../../../../std/fmt.ts";
import { unreachable } from "../../../../std/panic.ts";
import { Err, Ok, type Result } from "../../../../std/result.ts";
import { debug_target_spec_other as debug_target_spec_other_value } from "../../../lib.ts";
import {
  type Arch as SpecArch,
  Arch as SpecArchImpl,
  CfgAbi,
  Env,
  LinkerFlavor,
  Os,
  StackProbeType,
  type Target,
  TargetOptions,
} from "../../mod.ts";

// #[cfg(test)]
// mod tests;

// #[allow(non_camel_case_types)]
// #[derive(Copy, Clone, PartialEq)]
export type Arch = "Armv7k" | "Armv7s" | "Arm64" | "Arm64e" | "Arm64_32" | "I386" | "I686" | "X86_64" | "X86_64h";
export const Arch = {
  Armv7k: "Armv7k",
  Armv7s: "Armv7s",
  Arm64: "Arm64",
  Arm64e: "Arm64e",
  Arm64_32: "Arm64_32",
  I386: "I386",
  I686: "I686",
  X86_64: "X86_64",
  X86_64h: "X86_64h",

  // rustc: compiler/rustc_target/src/spec/base/apple/mod.rs:29 target_name
  target_name(self: Arch): string {
    switch (self) {
      case "Armv7k":
        return "armv7k";
      case "Armv7s":
        return "armv7s";
      case "Arm64":
        return "arm64";
      case "Arm64e":
        return "arm64e";
      case "Arm64_32":
        return "arm64_32";
      case "I386":
        return "i386";
      case "I686":
        return "i686";
      case "X86_64":
        return "x86_64";
      case "X86_64h":
        return "x86_64h";
    }
  },

  // rustc: compiler/rustc_target/src/spec/base/apple/mod.rs:43 target_arch
  target_arch(self: Arch): SpecArch {
    switch (self) {
      case "Armv7k":
      case "Armv7s":
        return SpecArchImpl.Arm;
      case "Arm64":
      case "Arm64e":
      case "Arm64_32":
        return SpecArchImpl.AArch64;
      case "I386":
      case "I686":
        return SpecArchImpl.X86;
      case "X86_64":
      case "X86_64h":
        return SpecArchImpl.X86_64;
    }
  },

  // rustc: compiler/rustc_target/src/spec/base/apple/mod.rs:52 target_cpu
  target_cpu(self: Arch, env: TargetEnv): string {
    switch (self) {
      case "Armv7k":
        return "cortex-a8";
      case "Armv7s":
        return "swift"; // iOS 10 is only supported on iPhone 5 or higher.
      case "Arm64":
        switch (env) {
          case "Normal":
            return "apple-a7";
          case "Simulator":
            return "apple-a12";
          case "MacCatalyst":
            return "apple-a12";
        }
      // falls through (unreachable: the inner match is exhaustive)
      case "Arm64e":
        return "apple-a12";
      case "Arm64_32":
        return "apple-s4";
      // Only macOS 10.12+ is supported, which means
      // all x86_64/x86 CPUs must be running at least penryn
      // https://github.com/llvm/llvm-project/blob/01f924d0e37a5deae51df0d77e10a15b63aa0c0f/clang/lib/Driver/ToolChains/Arch/X86.cpp#L79-L82
      case "I386":
      case "I686":
        return "penryn";
      case "X86_64":
        return "penryn";
      // Note: `core-avx2` is slightly more advanced than `x86_64h`, see
      // comments (and disabled features) in `x86_64h_apple_darwin` for
      // details. It is a higher baseline then `penryn` however.
      case "X86_64h":
        return "core-avx2";
    }
  },

  // rustc: compiler/rustc_target/src/spec/base/apple/mod.rs:75 stack_probes
  stack_probes(self: Arch): StackProbeType {
    switch (self) {
      case "Armv7k":
      case "Armv7s":
        return StackProbeType.None;
      case "Arm64":
      case "Arm64e":
      case "Arm64_32":
      case "I386":
      case "I686":
      case "X86_64":
      case "X86_64h":
        return StackProbeType.Inline;
    }
  },
} as const;

// #[derive(Copy, Clone, PartialEq)]
export type TargetEnv = "Normal" | "Simulator" | "MacCatalyst";
export const TargetEnv = {
  Normal: "Normal",
  Simulator: "Simulator",
  MacCatalyst: "MacCatalyst",

  // rustc: compiler/rustc_target/src/spec/base/apple/mod.rs:97 target_env
  target_env(self: TargetEnv): Env {
    switch (self) {
      case "Normal":
        return Env.Unspecified;
      case "MacCatalyst":
        return Env.MacAbi;
      case "Simulator":
        return Env.Sim;
    }
  },

  // NOTE: We originally set `cfg(target_abi = "macabi")` / `cfg(target_abi = "sim")`,
  // before it was discovered that those are actually environments:
  // https://github.com/rust-lang/rust/issues/133331
  //
  // But let's continue setting them for backwards compatibility.
  // FIXME(madsmtm): Warn about using these in the future.
  // rustc: compiler/rustc_target/src/spec/base/apple/mod.rs:111 target_abi
  target_abi(self: TargetEnv): CfgAbi {
    switch (self) {
      case "Normal":
        return CfgAbi.Unspecified;
      case "MacCatalyst":
        return CfgAbi.MacAbi;
      case "Simulator":
        return CfgAbi.Sim;
    }
  },
} as const;

/// Get the base target options, unversioned LLVM target and `target_arch` from the three
/// things that uniquely identify Rust's Apple targets: The OS, the architecture, and the ABI.
// rustc: compiler/rustc_target/src/spec/base/apple/mod.rs:122 base
export function base(os: Os, arch: Arch, env: TargetEnv): [TargetOptions, string, SpecArch] {
  const link_env_remove_ = link_env_remove(os);
  const unversioned_llvm_target_ = unversioned_llvm_target(os, arch, env);
  const opts = TargetOptions.update(TargetOptions.default(), {
    llvm_floatabi:
      Arch.target_arch(arch).$ === "Arm"
        ? "Hard"
        : // `llvm_floatabi` makes no sense on x86 and aarch64.
          undefined,
    os,
    env: TargetEnv.target_env(env),
    cfg_abi: TargetEnv.target_abi(env),
    cpu: Arch.target_cpu(arch, env),
    link_env_remove: link_env_remove_,
    vendor: "apple",
    linker_flavor: LinkerFlavor.Darwin("Yes", "No"),
    // macOS has -dead_strip, which doesn't rely on function_sections
    function_sections: false,
    dynamic_linking: true,
    families: ["unix"],
    is_like_darwin: true,
    binary_format: "MachO",
    // LLVM notes that macOS 10.11+ and iOS 9+ default
    // to v4, so we do the same.
    // https://github.com/llvm/llvm-project/blob/378778a0d10c2f8d5df8ceff81f95b6002984a4b/clang/lib/Driver/ToolChains/Darwin.cpp#L1203
    default_dwarf_version: 4,
    frame_pointer: ((): "Always" | "NonLeaf" => {
      switch (arch) {
        // clang ignores `-fomit-frame-pointer` for Armv7, it only accepts `-momit-leaf-frame-pointer`
        case "Armv7k":
        case "Armv7s":
          return "Always";
        // clang supports omitting frame pointers for the rest, but... don't?
        case "Arm64":
        case "Arm64e":
        case "Arm64_32":
          return "NonLeaf";
        case "I386":
        case "I686":
        case "X86_64":
        case "X86_64h":
          return "Always";
      }
    })(),
    has_rpath: true,
    dll_suffix: ".dylib",
    archive_format: "darwin",
    // Thread locals became available with iOS 8 and macOS 10.7,
    // and both are far below our minimum.
    has_thread_local: true,
    abi_return_struct_as_int: true,
    emit_debug_gdb_scripts: false,
    eh_frame_header: false,
    stack_probes: Arch.stack_probes(arch),

    debuginfo_kind: "DwarfDsym",
    // The historical default for macOS targets is to run `dsymutil` which
    // generates a packed version of debuginfo split from the main file.
    split_debuginfo: "Packed",
    supported_split_debuginfo: ["Packed", "Unpacked", "Off"],

    // Tell the linker that we would like it to avoid irreproducible binaries.
    //
    // This environment variable is pretty magical but is intended for
    // producing deterministic builds. This was first discovered to be used
    // by the `ar` tool as a way to control whether or not mtime entries in
    // the archive headers were set to zero or not.
    //
    // In `ld64-351.8`, shipped with Xcode 9.3, the linker was updated to
    // read this flag too. Linker versions that don't support this flag
    // may embed modification timestamps in binaries (especially in debug
    // information).
    //
    // A cleaner alternative would be to pass the `-reproducible` flag,
    // though that is only supported since `ld64-819.6` shipped with Xcode
    // 14, which is too new for our minimum supported version:
    // https://doc.rust-lang.org/rustc/platform-support/apple-darwin.html#host-tooling
    //
    // For some more info see the commentary on #47086
    link_env: [["ZERO_AR_DATE", "1"]],
  });
  if (arch === "I386" || arch === "I686") {
    // All Apple x86-32 targets have SSE2.
    opts.rustc_abi = "X86Sse2";
  }
  return [opts, unversioned_llvm_target_, Arch.target_arch(arch)];
}

/// Generate part of the LLVM target triple.
///
/// See `rustc_codegen_ssa::back::versioned_llvm_target` for the full triple passed to LLVM and
/// Clang.
// rustc: compiler/rustc_target/src/spec/base/apple/mod.rs:214 unversioned_llvm_target
function unversioned_llvm_target(os: Os, arch: Arch, env: TargetEnv): string {
  const arch_ = Arch.target_name(arch);
  // Convert to the "canonical" OS name used by LLVM:
  // https://github.com/llvm/llvm-project/blob/llvmorg-18.1.8/llvm/lib/TargetParser/Triple.cpp#L236-L282
  let os_: string;
  switch (os.$) {
    case "MacOs":
      os_ = "macosx";
      break;
    case "IOs":
      os_ = "ios";
      break;
    case "WatchOs":
      os_ = "watchos";
      break;
    case "TvOs":
      os_ = "tvos";
      break;
    case "VisionOs":
      os_ = "xros";
      break;
    default:
      return unreachable("internal error: entered unreachable code: tried to get LLVM target OS for non-Apple platform");
  }
  let environment: string;
  switch (env) {
    case "Normal":
      environment = "";
      break;
    case "MacCatalyst":
      environment = "-macabi";
      break;
    case "Simulator":
      environment = "-simulator";
      break;
  }
  return `${arch_}-apple-${os_}${environment}`;
}

// rustc: compiler/rustc_target/src/spec/base/apple/mod.rs:234 link_env_remove
function link_env_remove(os: Os): readonly string[] {
  // Apple platforms only officially support macOS as a host for any compilation.
  //
  // If building for macOS, we go ahead and remove any erroneous environment state
  // that's only applicable to cross-OS compilation. Always leave anything for the
  // host OS alone though.
  if (os.$ === "MacOs") {
    // `IPHONEOS_DEPLOYMENT_TARGET` must not be set when using the Xcode linker at
    // "/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/ld",
    // although this is apparently ignored when using the linker at "/usr/bin/ld".
    return ["IPHONEOS_DEPLOYMENT_TARGET", "TVOS_DEPLOYMENT_TARGET", "XROS_DEPLOYMENT_TARGET"];
  } else {
    // Otherwise if cross-compiling for a different OS/SDK (including Mac Catalyst), remove any part
    // of the linking environment that's wrong and reversed.
    return ["MACOSX_DEPLOYMENT_TARGET"];
  }
}

/// Deployment target or SDK version.
///
/// The size of the numbers in here are limited by Mach-O's `LC_BUILD_VERSION`.
// #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
export class OSVersion {
  constructor(
    readonly major: number,
    readonly minor: number,
    readonly patch: number,
  ) {}

  /// Parse an OS version triple (SDK version or deployment target).
  // impl FromStr for OSVersion
  // rustc: compiler/rustc_target/src/spec/base/apple/mod.rs:266 from_str
  static from_str(version: string): Result<OSVersion, ParseIntError> {
    const i = version.indexOf(".");
    if (i !== -1) {
      const major_s = version.slice(0, i);
      const minor_s = version.slice(i + 1);
      const major = parse_uint(major_s, 0xffff);
      if (major.$ === "Err") return major;
      const j = minor_s.indexOf(".");
      if (j !== -1) {
        const minor = parse_uint(minor_s.slice(0, j), 0xff);
        if (minor.$ === "Err") return minor;
        const patch = parse_uint(minor_s.slice(j + 1), 0xff);
        if (patch.$ === "Err") return patch;
        return Ok(new OSVersion(major._0, minor._0, patch._0));
      } else {
        const minor = parse_uint(minor_s, 0xff);
        if (minor.$ === "Err") return minor;
        return Ok(new OSVersion(major._0, minor._0, 0));
      }
    } else {
      const major = parse_uint(version, 0xffff);
      if (major.$ === "Err") return major;
      return Ok(new OSVersion(major._0, 0, 0));
    }
  }

  // rustc: compiler/rustc_target/src/spec/base/apple/mod.rs:281 new
  static new(major: number, minor: number, patch: number): OSVersion {
    return new OSVersion(major, minor, patch);
  }

  // rustc: compiler/rustc_target/src/spec/base/apple/mod.rs:285 fmt_pretty
  fmt_pretty(): string {
    const { major, minor, patch } = this;
    let s = `${major}.${minor}`;
    if (patch !== 0) {
      s += `.${patch}`;
    }
    return s;
  }

  // rustc: compiler/rustc_target/src/spec/base/apple/mod.rs:296 fmt_full
  fmt_full(): string {
    const { major, minor, patch } = this;
    return `${major}.${minor}.${patch}`;
  }

  /// Minimum operating system versions currently supported by `rustc`.
  // rustc: compiler/rustc_target/src/spec/base/apple/mod.rs:302 os_minimum_deployment_target
  static os_minimum_deployment_target(os: Os): OSVersion {
    // When bumping a version in here, remember to update the platform-support docs too.
    //
    // NOTE: The defaults may change in future `rustc` versions, so if you are looking for the
    // default deployment target, prefer:
    // ```
    // $ rustc --print deployment-target
    // ```
    let v: [number, number, number];
    switch (os.$) {
      case "MacOs":
        v = [10, 12, 0];
        break;
      case "IOs":
        v = [10, 0, 0];
        break;
      case "TvOs":
        v = [10, 0, 0];
        break;
      case "WatchOs":
        v = [5, 0, 0];
        break;
      case "VisionOs":
        v = [1, 0, 0];
        break;
      default:
        return unreachable(
          `internal error: entered unreachable code: tried to get deployment target for non-Apple platform: ${debug_target_spec_other_value(os)}`,
        );
    }
    const [major, minor, patch] = v;
    return new OSVersion(major, minor, patch);
  }

  /// The deployment target for the given target.
  ///
  /// This is similar to `os_minimum_deployment_target`, except that on certain targets it makes sense
  /// to raise the minimum OS version.
  ///
  /// This matches what LLVM does, see in part:
  /// <https://github.com/llvm/llvm-project/blob/llvmorg-21.1.3/llvm/lib/TargetParser/Triple.cpp#L2140-L2175>
  // rustc: compiler/rustc_target/src/spec/base/apple/mod.rs:330 minimum_deployment_target
  static minimum_deployment_target(target: Target): OSVersion {
    const os = target.os.$;
    const arch = target.arch.$;
    const env = target.env.$;
    let v: [number, number, number];
    if (os === "MacOs" && arch === "AArch64") {
      v = [11, 0, 0];
    } else if (os === "IOs" && arch === "AArch64" && env === "MacAbi") {
      v = [14, 0, 0];
    } else if (os === "IOs" && arch === "AArch64" && env === "Sim") {
      v = [14, 0, 0];
    } else if (os === "IOs" && target.llvm_target.startsWith("arm64e")) {
      v = [14, 0, 0];
    } else if (os === "IOs" && env === "MacAbi") {
      // Mac Catalyst defaults to 13.1 in Clang.
      v = [13, 1, 0];
    } else if (os === "TvOs" && arch === "AArch64" && env === "Sim") {
      v = [14, 0, 0];
    } else if (os === "WatchOs" && arch === "AArch64" && env === "Sim") {
      v = [7, 0, 0];
    } else if (os === "WatchOs" && arch === "AArch64" && env === "Unspecified" && !target.llvm_target.startsWith("arm64_32")) {
      // True Aarch64 on watchOS (instead of their Aarch64 Ilp32 called `arm64_32`) has been
      // available since Xcode 14, but it's only actually used more recently in watchOS 26.
      v = [26, 0, 0];
    } else {
      return OSVersion.os_minimum_deployment_target(target.os);
    }
    const [major, minor, patch] = v;
    return new OSVersion(major, minor, patch);
  }
}
export const debug_OSVersion: Debug<OSVersion> = (v, f) =>
  debug_struct(f, "OSVersion", [
    ["major", String(v.major)],
    ["minor", String(v.minor)],
    ["patch", String(v.patch)],
  ]);

/** PORT: `u16::from_str`/`u8::from_str` (radix 10, optional leading `+`). */
function parse_uint(s: string, max: number): Result<number, ParseIntError> {
  let digits = s;
  if (digits.startsWith("+") && digits.length > 1) digits = digits.slice(1);
  if (digits.length === 0) return Err("Empty");
  let v = 0;
  for (const c of digits) {
    if (c < "0" || c > "9") return Err("InvalidDigit");
    v = v * 10 + (c.charCodeAt(0) - 48);
    if (v > max) return Err("PosOverflow");
  }
  return Ok(v);
}

/// Name of the environment variable used to fetch the deployment target on the given OS.
// rustc: compiler/rustc_target/src/spec/base/apple/mod.rs:354 deployment_target_env_var
export function deployment_target_env_var(os: Os): string {
  switch (os.$) {
    case "MacOs":
      return "MACOSX_DEPLOYMENT_TARGET";
    case "IOs":
      return "IPHONEOS_DEPLOYMENT_TARGET";
    case "WatchOs":
      return "WATCHOS_DEPLOYMENT_TARGET";
    case "TvOs":
      return "TVOS_DEPLOYMENT_TARGET";
    case "VisionOs":
      return "XROS_DEPLOYMENT_TARGET";
    default:
      return unreachable("internal error: entered unreachable code: tried to get deployment target env var for non-Apple platform");
  }
}
