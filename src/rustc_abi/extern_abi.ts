// compiler/rustc_abi/src/extern_abi.rs
// PORT: ported by lane ast-passes (outside its assignment; rustc_ast_passes needs `ExternAbi`). `lib.ts` should
// `export * from "./extern_abi.ts"` (upstream `pub use extern_abi::{CVariadicStatus, ExternAbi, all_names}`) and drop
// its `CVariadicStatus` stand-in; until then this module re-exports that one.
import { into_diag_arg_using_display } from "../rustc_error_messages/diagnostic_impls.ts";
import { debug_Symbol } from "../rustc_span/symbol.ts";
import { debug_bool, debug_struct, type Debug } from "../std/fmt.ts";
import { assert, panic } from "../std/panic.ts";
import { Err, Ok, type Result } from "../std/result.ts";
import type { CVariadicStatus } from "./lib.ts";

export type { CVariadicStatus };

/**
 * `rustc_abi::AbiFromStrErr` (lib.rs:2486, `#[derive(Clone, Debug)]`).
 * PORT: defined here because rustc_abi/lib.ts does not have it yet; move it to lib.ts.
 */
export type AbiFromStrErr =
  /// not a known ABI
  | "Unknown"
  /// no "-unwind" variant can be used here
  | "NoExplicitUnwind";

// #[cfg(test)]
// mod tests;  (extern_abi.test.ts)

/// ABI we expect to see within `extern "{abi}"`
// #[derive(Clone, Copy, Debug)]
export type ExternAbi =
  /* universal */
  /// presumed C ABI for the platform
  | { readonly $: "C"; readonly unwind: boolean }
  /// ABI of the "system" interface, e.g. the Win32 API, always "aliasing"
  | { readonly $: "System"; readonly unwind: boolean }
  /// that's us!
  | { readonly $: "Rust" }
  /// the mostly-unused `unboxed_closures` ABI, effectively now an impl detail unless someone
  /// puts in the work to make it viable again... but would we need a special ABI?
  | { readonly $: "RustCall" }
  /// For things unlikely to be called, where reducing register pressure in
  /// `extern "Rust"` callers is worth paying extra cost in the callee.
  /// Stronger than just `#[cold]` because `fn` pointers might be incompatible.
  | { readonly $: "RustCold" }
  /// An always-invalid ABI that's used to test "this ABI is not supported by this platform"
  /// in a platform-agnostic way.
  | { readonly $: "RustInvalid" }
  /// Preserves no registers.
  ///
  /// Note, that this ABI is not stable in the registers it uses, is intended as an optimization
  /// and may fall-back to a more conservative calling convention if the backend does not support
  /// forcing callers to save all registers.
  | { readonly $: "RustPreserveNone" }
  /// Ensures that calls in tail position can always be optimized into a jump.
  ///
  /// This ABI is not stable, and relies on LLVM implementation details.
  | { readonly $: "RustTail" }
  /// Unstable ABI used to call LLVM intrinsics.
  | { readonly $: "LlvmIntrinsic" }
  /// An ABI that rustc does not know how to call or define. Functions with this ABI can
  /// only be created using `#[naked]` functions or `extern "custom"` blocks, and can only
  /// be called from inline assembly.
  | { readonly $: "Custom" }
  /// UEFI ABI, usually an alias of C, but sometimes an arch-specific alias
  /// and only valid on platforms that have a UEFI standard
  | { readonly $: "EfiApi" }
  /// Swift's calling convention, used to interoperate with Swift code without
  /// going through C as an intermediary.
  | { readonly $: "Swift" }
  /* arm */
  /// Arm Architecture Procedure Call Standard, sometimes `ExternAbi::C` is an alias for this
  | { readonly $: "Aapcs"; readonly unwind: boolean }
  /// extremely constrained barely-C ABI for TrustZone
  | { readonly $: "CmseNonSecureCall" }
  /// extremely constrained barely-C ABI for TrustZone
  | { readonly $: "CmseNonSecureEntry" }
  /* gpu */
  /// An entry-point function called by the GPU's host
  | { readonly $: "GpuKernel" }
  /// An entry-point function called by the GPU's host
  // FIXME: why do we have two of these?
  | { readonly $: "PtxKernel" }
  /* interrupt */
  | { readonly $: "AvrInterrupt" }
  | { readonly $: "AvrNonBlockingInterrupt" }
  | { readonly $: "Msp430Interrupt" }
  | { readonly $: "RiscvInterruptM" }
  | { readonly $: "RiscvInterruptS" }
  | { readonly $: "X86Interrupt" }
  /* x86 */
  /// `ExternAbi::C` but spelled funny because x86
  | { readonly $: "Cdecl"; readonly unwind: boolean }
  /// gnu-stdcall on "unix" and win-stdcall on "windows"
  | { readonly $: "Stdcall"; readonly unwind: boolean }
  /// gnu-fastcall on "unix" and win-fastcall on "windows"
  | { readonly $: "Fastcall"; readonly unwind: boolean }
  /// windows C++ ABI
  | { readonly $: "Thiscall"; readonly unwind: boolean }
  /// uses AVX and stuff
  | { readonly $: "Vectorcall"; readonly unwind: boolean }
  /* x86_64 */
  | { readonly $: "SysV64"; readonly unwind: boolean }
  | { readonly $: "Win64"; readonly unwind: boolean };

type UnwindVariant = Extract<ExternAbi, { readonly unwind: boolean }>["$"];
const v = <T extends ExternAbi>(x: T): T => Object.freeze(x);

/** Shared singletons of the unit variants (PORTING §5). */
const Unit = {
  Rust: v({ $: "Rust" }),
  RustCall: v({ $: "RustCall" }),
  RustCold: v({ $: "RustCold" }),
  RustInvalid: v({ $: "RustInvalid" }),
  RustPreserveNone: v({ $: "RustPreserveNone" }),
  RustTail: v({ $: "RustTail" }),
  LlvmIntrinsic: v({ $: "LlvmIntrinsic" }),
  Custom: v({ $: "Custom" }),
  EfiApi: v({ $: "EfiApi" }),
  Swift: v({ $: "Swift" }),
  CmseNonSecureCall: v({ $: "CmseNonSecureCall" }),
  CmseNonSecureEntry: v({ $: "CmseNonSecureEntry" }),
  GpuKernel: v({ $: "GpuKernel" }),
  PtxKernel: v({ $: "PtxKernel" }),
  AvrInterrupt: v({ $: "AvrInterrupt" }),
  AvrNonBlockingInterrupt: v({ $: "AvrNonBlockingInterrupt" }),
  Msp430Interrupt: v({ $: "Msp430Interrupt" }),
  RiscvInterruptM: v({ $: "RiscvInterruptM" }),
  RiscvInterruptS: v({ $: "RiscvInterruptS" }),
  X86Interrupt: v({ $: "X86Interrupt" }),
} as const;

const uw = (name: UnwindVariant, unwind: boolean): ExternAbi => v({ $: name, unwind } as ExternAbi);

// macro_rules! abi_impls { ... } expanded for `ExternAbi` (the `$tok` table in macro order).
const ABI_TABLE: readonly (readonly [ExternAbi, string])[] = [
  [uw("C", false), "C"],
  [uw("C", true), "C-unwind"],
  [Unit.Rust, "Rust"],
  [Unit.Swift, "Swift"],
  [uw("Aapcs", false), "aapcs"],
  [uw("Aapcs", true), "aapcs-unwind"],
  [Unit.AvrInterrupt, "avr-interrupt"],
  [Unit.AvrNonBlockingInterrupt, "avr-non-blocking-interrupt"],
  [uw("Cdecl", false), "cdecl"],
  [uw("Cdecl", true), "cdecl-unwind"],
  [Unit.CmseNonSecureCall, "cmse-nonsecure-call"],
  [Unit.CmseNonSecureEntry, "cmse-nonsecure-entry"],
  [Unit.Custom, "custom"],
  [Unit.EfiApi, "efiapi"],
  [uw("Fastcall", false), "fastcall"],
  [uw("Fastcall", true), "fastcall-unwind"],
  [Unit.GpuKernel, "gpu-kernel"],
  [Unit.LlvmIntrinsic, "llvm-intrinsic"],
  [Unit.Msp430Interrupt, "msp430-interrupt"],
  [Unit.PtxKernel, "ptx-kernel"],
  [Unit.RiscvInterruptM, "riscv-interrupt-m"],
  [Unit.RiscvInterruptS, "riscv-interrupt-s"],
  [Unit.RustCall, "rust-call"],
  [Unit.RustCold, "rust-cold"],
  [Unit.RustInvalid, "rust-invalid"],
  [Unit.RustPreserveNone, "rust-preserve-none"],
  [uw("Stdcall", false), "stdcall"],
  [uw("Stdcall", true), "stdcall-unwind"],
  [uw("System", false), "system"],
  [uw("System", true), "system-unwind"],
  [uw("SysV64", false), "sysv64"],
  [uw("SysV64", true), "sysv64-unwind"],
  [Unit.RustTail, "tail"],
  [uw("Thiscall", false), "thiscall"],
  [uw("Thiscall", true), "thiscall-unwind"],
  [uw("Vectorcall", false), "vectorcall"],
  [uw("Vectorcall", true), "vectorcall-unwind"],
  [uw("Win64", false), "win64"],
  [uw("Win64", true), "win64-unwind"],
  [Unit.X86Interrupt, "x86-interrupt"],
];

/** The macro's per-variant pattern `$e_name::$variant $({ unwind: $uw })?`. */
function same_pattern(a: ExternAbi, b: ExternAbi): boolean {
  return a.$ === b.$ && ("unwind" in a ? "unwind" in b && a.unwind === b.unwind : true);
}

export const ExternAbi = {
  ...Unit,
  C: (unwind: boolean): ExternAbi => uw("C", unwind),
  System: (unwind: boolean): ExternAbi => uw("System", unwind),
  Aapcs: (unwind: boolean): ExternAbi => uw("Aapcs", unwind),
  Cdecl: (unwind: boolean): ExternAbi => uw("Cdecl", unwind),
  Stdcall: (unwind: boolean): ExternAbi => uw("Stdcall", unwind),
  Fastcall: (unwind: boolean): ExternAbi => uw("Fastcall", unwind),
  Thiscall: (unwind: boolean): ExternAbi => uw("Thiscall", unwind),
  Vectorcall: (unwind: boolean): ExternAbi => uw("Vectorcall", unwind),
  SysV64: (unwind: boolean): ExternAbi => uw("SysV64", unwind),
  Win64: (unwind: boolean): ExternAbi => uw("Win64", unwind),

  ALL_VARIANTS: ABI_TABLE.map(([abi]) => abi) as readonly ExternAbi[],

  // rustc: compiler/rustc_abi/src/extern_abi.rs:137 as_str
  as_str(self: ExternAbi): string {
    for (const [abi, tok] of ABI_TABLE) {
      if (same_pattern(self, abi)) return tok;
    }
    return panic("unreachable: invalid ExternAbi variant");
  },

  // FIXME(FnSigKind): when PartialEq is stably const, use it instead
  // rustc: compiler/rustc_abi/src/extern_abi.rs:143 internal_const_eq
  internal_const_eq(self: ExternAbi, other: ExternAbi): boolean {
    for (const [abi] of ABI_TABLE) {
      if (same_pattern(self, abi) && same_pattern(other, abi)) return true;
    }
    return false;
  },

  // ALL_VARIANTS.iter().position(|v| v == self), but const
  // rustc: compiler/rustc_abi/src/extern_abi.rs:150 as_packed
  as_packed(self: ExternAbi): number {
    let index = 0;
    while (index < ExternAbi.ALL_VARIANTS.length) {
      if (ExternAbi.internal_const_eq(self, ExternAbi.ALL_VARIANTS[index]!)) {
        return index;
      }
      index += 1;
    }
    return panic("unreachable: invalid ExternAbi variant");
  },

  // rustc: compiler/rustc_abi/src/extern_abi.rs:160 from_packed
  from_packed(index: number): ExternAbi {
    assert(index < ExternAbi.ALL_VARIANTS.length, "invalid ExternAbi index");
    return ExternAbi.ALL_VARIANTS[index]!;
  },

  // impl ::core::str::FromStr for ExternAbi
  // rustc: compiler/rustc_abi/src/extern_abi.rs:169 from_str
  from_str(s: string): Result<ExternAbi, AbiFromStrErr> {
    for (const [abi, tok] of ABI_TABLE) {
      if (s === tok) return Ok(abi);
    }
    return Err("Unknown");
  },

  // impl Ord for ExternAbi
  // rustc: compiler/rustc_abi/src/extern_abi.rs:225 cmp
  cmp(self: ExternAbi, rhs: ExternAbi): -1 | 0 | 1 {
    // PORT: `str::cmp` is a byte-wise comparison; the ABI names are ASCII, so UTF-16 code unit order is the same.
    const a = ExternAbi.as_str(self);
    const b = ExternAbi.as_str(rhs);
    return a < b ? -1 : a > b ? 1 : 0;
  },

  // impl PartialOrd for ExternAbi
  // rustc: compiler/rustc_abi/src/extern_abi.rs:231 partial_cmp
  partial_cmp(self: ExternAbi, rhs: ExternAbi): -1 | 0 | 1 | undefined {
    return ExternAbi.cmp(self, rhs);
  },

  // impl PartialEq for ExternAbi
  // rustc: compiler/rustc_abi/src/extern_abi.rs:237 eq
  eq(self: ExternAbi, rhs: ExternAbi): boolean {
    return ExternAbi.cmp(self, rhs) === 0;
  },

  // impl Hash for ExternAbi, impl StableHash for ExternAbi
  // PORT: not ported (no marker; extern_abi.rs:245 hash, :255 stable_hash): nothing in the port hashes an `ExternAbi` yet.

  /// An ABI "like Rust"
  ///
  /// These ABIs are fully controlled by the Rust compiler, which means they
  /// - support unwinding with `-Cpanic=unwind`, unlike `extern "C"`
  /// - often diverge from the C ABI
  /// - are subject to change between compiler versions
  // rustc: compiler/rustc_abi/src/extern_abi.rs:286 is_rustic_abi
  is_rustic_abi(self: ExternAbi): boolean {
    return self.$ === "Rust" || self.$ === "RustCall" || self.$ === "RustCold" || self.$ === "RustPreserveNone" || self.$ === "RustTail";
  },

  /// Returns whether the ABI supports C variadics. This only controls whether we allow *imports*
  /// of such functions via `extern` blocks and definition via naked functions; there's a
  /// separate check during AST construction guarding *definitions* of variadic functions.
  // #[cfg(feature = "nightly")]
  // rustc: compiler/rustc_abi/src/extern_abi.rs:295 supports_c_variadic
  supports_c_variadic(self: ExternAbi): CVariadicStatus {
    // * C and Cdecl obviously support varargs.
    // * C can be based on Aapcs, SysV64 or Win64, so they must support varargs.
    // * EfiApi is based on Win64 or C, so it also supports it.
    // * System automatically falls back to C when used with variadics, therefore supports it.
    //
    // * Stdcall does not, because it would be impossible for the callee to clean
    //   up the arguments. (callee doesn't know how many arguments are there)
    // * Same for Fastcall, Vectorcall and Thiscall.
    // * Other calling conventions are related to hardware or the compiler itself.
    //
    // All of the supported ones must have a test in `tests/codegen/cffi/c-variadic-ffi.rs`.
    switch (self.$) {
      case "C":
      case "Cdecl":
      case "Aapcs":
      case "Win64":
      case "SysV64":
      case "EfiApi":
      case "System":
        return { $: "Stable" };
      default:
        return { $: "NotSupported" };
    }
  },

  /// Returns whether the ABI supports guaranteed tail calls.
  // #[cfg(feature = "nightly")]
  // rustc: compiler/rustc_abi/src/extern_abi.rs:321 supports_guaranteed_tail_call
  supports_guaranteed_tail_call(self: ExternAbi): boolean {
    switch (self.$) {
      case "CmseNonSecureCall":
      case "CmseNonSecureEntry":
        // See https://godbolt.org/z/9jhdeqErv. The CMSE calling conventions clear registers
        // before returning, and hence cannot guarantee a tail call.
        return false;
      case "AvrInterrupt":
      case "AvrNonBlockingInterrupt":
      case "Msp430Interrupt":
      case "RiscvInterruptM":
      case "RiscvInterruptS":
      case "X86Interrupt":
        // See https://godbolt.org/z/Edfjnxxcq. Interrupts cannot be called directly.
        return false;
      case "GpuKernel":
      case "PtxKernel":
        // See https://godbolt.org/z/jq5TE5jK1.
        return false;
      case "Custom":
        // This ABI does not support calls at all (except via assembly).
        return false;
      case "RustCall":
        // Argument untupling requires additional support for tail calls to be possible,
        // see <https://github.com/rust-lang/rust/pull/158248>. There is no real uses of
        // tail calling `extern "rust-call"` functions
        return false;

      case "C":
      case "System":
      case "Rust":
      case "RustCold":
      case "RustInvalid":
      case "LlvmIntrinsic":
      case "EfiApi":
      case "Aapcs":
      case "Cdecl":
      case "Stdcall":
      case "Fastcall":
      case "Thiscall":
      case "Vectorcall":
      case "SysV64":
      case "Win64":
      case "RustPreserveNone":
      case "RustTail":
      case "Swift":
        return true;
    }
  },

  /// Default ABI chosen for `extern fn` declarations without an explicit ABI.
  FALLBACK: uw("C", false),

  // rustc: compiler/rustc_abi/src/extern_abi.rs:382 name
  name(self: ExternAbi): string {
    return ExternAbi.as_str(self);
  },
};

// rustc: compiler/rustc_abi/src/extern_abi.rs:374 all_names
export function all_names(): string[] {
  return ExternAbi.ALL_VARIANTS.map((abi) => ExternAbi.as_str(abi));
}

// impl fmt::Display for ExternAbi
// rustc: compiler/rustc_abi/src/extern_abi.rs:388 fmt
export function display_ExternAbi(self: ExternAbi): string {
  return `"${ExternAbi.as_str(self)}"`;
}

// #[cfg(feature = "nightly")]
// rustc_error_messages::into_diag_arg_using_display!(ExternAbi);
export const ExternAbi_into_diag_arg = into_diag_arg_using_display(display_ExternAbi);

/** `#[derive(Debug)]` */
export const debug_ExternAbi: Debug<ExternAbi> = (self, f) =>
  "unwind" in self ? debug_struct(f, self.$, [["unwind", debug_bool(self.unwind, f)]]) : self.$;

/** `#[derive(Debug)]` of `CVariadicStatus` (extern_abi.rs:272). */
export const debug_CVariadicStatus: Debug<CVariadicStatus> = (self, f) =>
  self.$ === "Unstable" ? debug_struct(f, "Unstable", [["feature", debug_Symbol(self.feature, f)]]) : self.$;
