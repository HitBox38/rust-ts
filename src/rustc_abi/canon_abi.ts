// compiler/rustc_abi/src/canon_abi.rs (types; `Display` needs `ExternAbi`, which is not ported).
import { unported } from "../std/panic.ts";

/// Calling convention to determine codegen
///
/// CanonAbi erases certain distinctions ExternAbi preserves, but remains target-dependent.
/// There are still both target-specific variants and aliasing variants, though much fewer.
/// The reason for this step is the frontend may wish to show an ExternAbi but implement that ABI
/// using a different ABI than the string per se, or describe irrelevant differences, e.g.
/// - extern "system"
/// - extern "cdecl"
/// - extern "C-unwind"
/// In that sense, this erases mere syntactic distinctions to create a canonical *directive*,
/// rather than picking the "actual" ABI.
// #[derive(Copy, Clone, Debug)]
// #[derive(PartialOrd, Ord, PartialEq, Eq, Hash)]
export type CanonAbi =
  // NOTE: the use of nested variants for some ABIs is for many targets they don't matter,
  // and this pushes the complexity of their reasoning to target-specific code,
  // allowing a `match` to easily exhaustively ignore these subcategories of variants.
  // Otherwise it is very tempting to avoid matching exhaustively!
  | { readonly $: "C" }
  | { readonly $: "Rust" }
  | { readonly $: "RustCold" }
  | { readonly $: "RustPreserveNone" }
  | { readonly $: "RustTail" }
  /// An ABI that rustc does not know how to call or define.
  | { readonly $: "Custom" }
  /// Swift calling convention, exposed via LLVM's `swiftcc`. Cross-platform
  /// and not tied to a specific target architecture.
  | { readonly $: "Swift" }
  /// ABIs relevant to 32-bit Arm targets
  | { readonly $: "Arm"; readonly _0: ArmCall }
  /// ABI relevant to GPUs: the entry point for a GPU kernel
  | { readonly $: "GpuKernel" }
  /// ABIs relevant to bare-metal interrupt targets
  // FIXME(workingjubilee): a particular reason for this nesting is we might not need these?
  // interrupt ABIs should have the same properties:
  // - uncallable by Rust calls, as LLVM rejects it in most cases
  // - uses a preserve-all-registers *callee* convention
  // - should always return `-> !` (effectively... it can't use normal `ret`)
  // what differs between targets is
  // - allowed arguments: x86 differs slightly, having 2-3 arguments which are handled magically
  // - may need special prologues/epilogues for some interrupts, without affecting "call ABI"
  | { readonly $: "Interrupt"; readonly _0: InterruptKind }
  /// ABIs relevant to Windows or x86 targets
  | { readonly $: "X86"; readonly _0: X86Call };
export const CanonAbi = {
  C: { $: "C" } as CanonAbi,
  Rust: { $: "Rust" } as CanonAbi,
  RustCold: { $: "RustCold" } as CanonAbi,
  RustPreserveNone: { $: "RustPreserveNone" } as CanonAbi,
  RustTail: { $: "RustTail" } as CanonAbi,
  Custom: { $: "Custom" } as CanonAbi,
  Swift: { $: "Swift" } as CanonAbi,
  GpuKernel: { $: "GpuKernel" } as CanonAbi,

  // rustc: compiler/rustc_abi/src/canon_abi.rs:61 is_rustic_abi
  is_rustic_abi(self: CanonAbi): boolean {
    switch (self.$) {
      case "Rust":
      case "RustCold":
      case "RustPreserveNone":
      case "RustTail":
        return true;
      case "C":
      case "Custom":
      case "Swift":
      case "Arm":
      case "GpuKernel":
      case "Interrupt":
      case "X86":
        return false;
    }
  },
} as const;

// impl fmt::Display for CanonAbi
// PORT: not ported (no marker; canon_abi.rs:79 fmt): it prints through `ExternAbi::as_str` (extern_abi.rs, not ported).
export function display_CanonAbi(_self: CanonAbi): string {
  return unported("rustc_abi::CanonAbi Display (ExternAbi::as_str)");
}

/// Callee codegen for interrupts
///
/// This is named differently from the "Call" enums because it is different:
/// these "ABI" differences are not relevant to callers, since there is "no caller".
/// These only affect callee codegen. making their categorization as distinct ABIs a bit peculiar.
// #[derive(Copy, Clone, Debug)]
// #[derive(PartialOrd, Ord, PartialEq, Eq, Hash)]
export type InterruptKind = "Avr" | "AvrNonBlocking" | "Msp430" | "RiscvMachine" | "RiscvSupervisor" | "X86";

/// ABIs defined for x86-{32,64}
///
/// One of SysV64 or Win64 may alias the C ABI, and arguably Win64 is cross-platform now?
// #[derive(Clone, Copy, Debug)]
// #[derive(PartialOrd, Ord, PartialEq, Eq, Hash)]
export type X86Call =
  /// "fastcall" has both GNU and Windows variants
  | "Fastcall"
  /// "stdcall" has both GNU and Windows variants
  | "Stdcall"
  | "SysV64"
  | "Thiscall"
  | "Vectorcall"
  | "Win64";

/// ABIs defined for 32-bit Arm
// #[derive(Copy, Clone, Debug)]
// #[derive(PartialOrd, Ord, PartialEq, Eq, Hash)]
export type ArmCall = "Aapcs" | "CCmseNonSecureCall" | "CCmseNonSecureEntry";
