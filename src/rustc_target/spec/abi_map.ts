// compiler/rustc_target/src/spec/abi_map.rs
// PORT: ported by lane ast-passes (outside its assignment; `AstValidator::check_extern_fn_signature` needs it).
// spec/mod.ts should declare `mod abi_map; pub use abi_map::{AbiMap, AbiMapping};` by re-exporting this module.
import { type ArmCall, CanonAbi, type InterruptKind, type X86Call } from "../../rustc_abi/canon_abi.ts";
import { ExternAbi } from "../../rustc_abi/extern_abi.ts";
import { type Debug, debug_struct, debug_tuple } from "../../std/fmt.ts";
import { unwrap } from "../../std/panic.ts";
import type { Target } from "./mod.ts";

/// Mapping for ExternAbi to CanonAbi according to a Target
///
/// A maybe-transitional structure circa 2025 for hosting future experiments in
/// encapsulating arch-specific ABI lowering details to make them more testable.
// #[derive(Clone, Debug)]
export class AbiMap {
  constructor(
    public arch: ArchKind,
    public os: OsKind,
  ) {}

  /// create an AbiMap according to arbitrary fields on the [Target]
  // rustc: compiler/rustc_target/src/spec/abi_map.rs:48 from_target
  static from_target(target: Target): AbiMap {
    // the purpose of this little exercise is to force listing what affects these mappings
    let arch: ArchKind;
    switch (target.arch.$) {
      case "AArch64":
        arch = ArchKind.Aarch64;
        break;
      case "AmdGpu":
        arch = ArchKind.Amdgpu;
        break;
      case "Arm":
        arch = { $: "Arm", _0: target.llvm_target.startsWith("thumbv8m") ? "ThumbV8M" : "Other" };
        break;
      case "Avr":
        arch = ArchKind.Avr;
        break;
      case "LoongArch32":
      case "LoongArch64":
        arch = ArchKind.LoongArch;
        break;
      case "Msp430":
        arch = ArchKind.Msp430;
        break;
      case "Nvptx64":
        arch = ArchKind.Nvptx;
        break;
      case "RiscV32":
      case "RiscV64":
        arch = ArchKind.Riscv;
        break;
      case "SpirV":
        arch = ArchKind.Spirv;
        break;
      case "Wasm32":
      case "Wasm64":
        arch = ArchKind.Wasm;
        break;
      case "X86":
        arch = ArchKind.X86;
        break;
      case "X86_64":
        arch = ArchKind.X86_64;
        break;
      default:
        arch = ArchKind.Other;
        break;
    }

    let os: OsKind;
    if (target.is_like_darwin) {
      os = "Apple";
    } else if (target.is_like_windows) {
      os = "Windows";
    } else if (target.is_like_vexos) {
      os = "VEXos";
    } else {
      os = "Other";
    }

    return new AbiMap(arch, os);
  }

  /// lower an [ExternAbi] to a [CanonAbi] if this AbiMap allows
  // rustc: compiler/rustc_target/src/spec/abi_map.rs:84 canonize_abi
  canonize_abi(extern_abi: ExternAbi, has_c_varargs: boolean): AbiMapping {
    const { os, arch } = this;

    if (ExternAbi.eq(extern_abi, ExternAbi.Swift)) {
      // Per https://www.swift.org/blog/abi-stability-and-more/, Swift's ABI
      // is only stable on Apple platforms, so we reject it elsewhere.
      switch (os) {
        case "Apple":
          break;
        default:
          return AbiMapping.Invalid;
      }
    }

    const Interrupt = (k: InterruptKind): CanonAbi => ({ $: "Interrupt", _0: k });
    const X86 = (c: X86Call): CanonAbi => ({ $: "X86", _0: c });
    const Arm = (c: ArmCall): CanonAbi => ({ $: "Arm", _0: c });

    let canon_abi: CanonAbi;
    const e = extern_abi.$;
    const a = arch.$;
    // infallible lowerings
    if (e === "C") {
      canon_abi = CanonAbi.C;
    } else if (e === "Rust" || e === "RustCall") {
      canon_abi = CanonAbi.Rust;
    }
    // Dummy mapping to prevent reporting an error in the frontend
    else if (e === "LlvmIntrinsic") {
      canon_abi = CanonAbi.C;
    } else if (e === "RustCold" && this.os === "Windows") {
      canon_abi = CanonAbi.Rust;
    } else if (e === "RustCold") {
      canon_abi = CanonAbi.RustCold;
    } else if (e === "RustPreserveNone") {
      canon_abi = CanonAbi.RustPreserveNone;
    } else if (e === "RustTail") {
      canon_abi = CanonAbi.RustTail;
    } else if (e === "Swift") {
      canon_abi = CanonAbi.Swift;
    } else if (e === "System" && a === "X86" && os === "Windows" && !has_c_varargs) {
      canon_abi = X86("Stdcall");
    } else if (e === "System" && a === "Arm" && this.os === "VEXos") {
      // Calls to VEXos APIs do not use VFP registers.
      canon_abi = Arm("Aapcs");
    } else if (e === "System") {
      canon_abi = CanonAbi.C;
    }
    // fallible lowerings
    /* multi-platform */
    // always and forever
    else if (e === "RustInvalid") {
      return AbiMapping.Invalid;
    } else if (e === "Custom" && (a === "Wasm" || a === "Spirv")) {
      return AbiMapping.Invalid;
    } else if (e === "Custom") {
      canon_abi = CanonAbi.Custom;
    } else if (e === "EfiApi" && a === "Arm") {
      canon_abi = Arm("Aapcs");
    } else if (e === "EfiApi" && a === "X86_64") {
      canon_abi = X86("Win64");
    } else if (e === "EfiApi" && (a === "Aarch64" || a === "LoongArch" || a === "Riscv" || a === "X86")) {
      canon_abi = CanonAbi.C;
    } else if (e === "EfiApi") {
      return AbiMapping.Invalid;
    }
    /* arm */
    else if (e === "Aapcs" && a === "Arm") {
      canon_abi = Arm("Aapcs");
    } else if (e === "Aapcs") {
      return AbiMapping.Invalid;
    } else if (e === "CmseNonSecureCall" && arch.$ === "Arm" && arch._0 === "ThumbV8M") {
      canon_abi = Arm("CCmseNonSecureCall");
    } else if (e === "CmseNonSecureEntry" && arch.$ === "Arm" && arch._0 === "ThumbV8M") {
      canon_abi = Arm("CCmseNonSecureEntry");
    } else if (e === "CmseNonSecureCall" || e === "CmseNonSecureEntry") {
      return AbiMapping.Invalid;
    }
    /* gpu */
    else if (e === "PtxKernel" && a === "Nvptx") {
      canon_abi = CanonAbi.GpuKernel;
    } else if (e === "GpuKernel" && (a === "Amdgpu" || a === "Nvptx")) {
      canon_abi = CanonAbi.GpuKernel;
    } else if (e === "PtxKernel" || e === "GpuKernel") {
      return AbiMapping.Invalid;
    }
    /* x86 */
    else if (e === "Cdecl" && a === "X86") {
      canon_abi = CanonAbi.C;
    } else if (e === "Cdecl") {
      return AbiMapping.Deprecated(CanonAbi.C);
    } else if (e === "Fastcall" && a === "X86") {
      canon_abi = X86("Fastcall");
    } else if (e === "Fastcall" && os === "Windows") {
      return AbiMapping.Deprecated(CanonAbi.C);
    } else if (e === "Fastcall") {
      return AbiMapping.Invalid;
    } else if (e === "Stdcall" && a === "X86") {
      canon_abi = X86("Stdcall");
    } else if (e === "Stdcall" && os === "Windows") {
      return AbiMapping.Deprecated(CanonAbi.C);
    } else if (e === "Stdcall") {
      return AbiMapping.Invalid;
    } else if (e === "Thiscall" && a === "X86") {
      canon_abi = X86("Thiscall");
    } else if (e === "Thiscall") {
      return AbiMapping.Invalid;
    } else if (e === "Vectorcall" && (a === "X86" || a === "X86_64")) {
      canon_abi = X86("Vectorcall");
    } else if (e === "Vectorcall") {
      return AbiMapping.Invalid;
    } else if (e === "SysV64" && a === "X86_64") {
      canon_abi = X86("SysV64");
    } else if (e === "Win64" && a === "X86_64") {
      canon_abi = X86("Win64");
    } else if (e === "SysV64" || e === "Win64") {
      return AbiMapping.Invalid;
    }
    /* interrupts */
    else if (e === "AvrInterrupt" && a === "Avr") {
      canon_abi = Interrupt("Avr");
    } else if (e === "AvrNonBlockingInterrupt" && a === "Avr") {
      canon_abi = Interrupt("AvrNonBlocking");
    } else if (e === "Msp430Interrupt" && a === "Msp430") {
      canon_abi = Interrupt("Msp430");
    } else if (e === "RiscvInterruptM" && a === "Riscv") {
      canon_abi = Interrupt("RiscvMachine");
    } else if (e === "RiscvInterruptS" && a === "Riscv") {
      canon_abi = Interrupt("RiscvSupervisor");
    } else if (e === "X86Interrupt" && (a === "X86" || a === "X86_64")) {
      canon_abi = Interrupt("X86");
    } else {
      // ExternAbi::AvrInterrupt | AvrNonBlockingInterrupt | Msp430Interrupt | RiscvInterruptM
      // | RiscvInterruptS | X86Interrupt, _
      return AbiMapping.Invalid;
    }

    return AbiMapping.Direct(canon_abi);
  }
}

/// result from trying to map an ABI
// #[derive(Copy, Clone, Debug)]
export type AbiMapping =
  /// this ABI is exactly mapped for this platform
  | { readonly $: "Direct"; readonly _0: CanonAbi }
  /// we don't yet warn on this, but we will
  | { readonly $: "Deprecated"; readonly _0: CanonAbi }
  /// ABI we do not map for this platform: it must not reach codegen
  | { readonly $: "Invalid" };

export const AbiMapping = {
  Direct: (abi: CanonAbi): AbiMapping => ({ $: "Direct", _0: abi }),
  Deprecated: (abi: CanonAbi): AbiMapping => ({ $: "Deprecated", _0: abi }),
  Invalid: Object.freeze({ $: "Invalid" }) as AbiMapping,

  /// optionally get a [CanonAbi], even if Deprecated
  // rustc: compiler/rustc_target/src/spec/abi_map.rs:28 into_option
  into_option(self: AbiMapping): CanonAbi | undefined {
    switch (self.$) {
      case "Direct":
      case "Deprecated":
        return self._0;
      case "Invalid":
        return undefined;
    }
  },

  /// get a [CanonAbi] even if Deprecated, panicking if Invalid
  // #[track_caller]
  // rustc: compiler/rustc_target/src/spec/abi_map.rs:37 unwrap
  unwrap(self: AbiMapping): CanonAbi {
    return unwrap(AbiMapping.into_option(self));
  },

  // rustc: compiler/rustc_target/src/spec/abi_map.rs:41 is_mapped
  is_mapped(self: AbiMapping): boolean {
    return AbiMapping.into_option(self) !== undefined;
  },
};

// #[derive(Debug, PartialEq, Copy, Clone)]
type ArchKind =
  | { readonly $: "Aarch64" }
  | { readonly $: "Amdgpu" }
  | { readonly $: "Arm"; readonly _0: ArmVer }
  | { readonly $: "Avr" }
  | { readonly $: "LoongArch" }
  | { readonly $: "Msp430" }
  | { readonly $: "Nvptx" }
  | { readonly $: "Riscv" }
  | { readonly $: "X86" }
  | { readonly $: "X86_64" }
  | { readonly $: "Wasm" }
  | { readonly $: "Spirv" }
  /// Architectures which don't need other considerations for ABI lowering
  | { readonly $: "Other" };
const unit = <T extends ArchKind["$"]>($: T) => Object.freeze({ $ }) as ArchKind;
const ArchKind = {
  Aarch64: unit("Aarch64"),
  Amdgpu: unit("Amdgpu"),
  Avr: unit("Avr"),
  LoongArch: unit("LoongArch"),
  Msp430: unit("Msp430"),
  Nvptx: unit("Nvptx"),
  Riscv: unit("Riscv"),
  X86: unit("X86"),
  X86_64: unit("X86_64"),
  Wasm: unit("Wasm"),
  Spirv: unit("Spirv"),
  Other: unit("Other"),
} as const;

// #[derive(Debug, PartialEq, Copy, Clone)]
type OsKind = "Apple" | "Windows" | "VEXos" | "Other";

// #[derive(Debug, PartialEq, Copy, Clone)]
type ArmVer = "ThumbV8M" | "Other";

/** `#[derive(Debug)]` */
export const debug_AbiMap: Debug<AbiMap> = (v, f) =>
  debug_struct(f, "AbiMap", [
    ["arch", v.arch.$ === "Arm" ? debug_tuple(f, "Arm", [v.arch._0]) : v.arch.$],
    ["os", v.os],
  ]);
