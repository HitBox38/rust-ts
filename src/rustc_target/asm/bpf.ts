// Stub of compiler/rustc_target/src/asm/bpf.rs.
// PORT: rust-ts has no built-in target with this architecture, so the module is not ported: its types
// are opaque and every fn calls `unported` (lane target-asm).
import { type DefRegs, type RegClassMap, type StubReg, type StubRegClass, stub_fn, stub_impls } from "./mod.ts";

/** `BpfInlineAsmRegClass` (`def_reg_class!`; not ported) */
export type BpfInlineAsmRegClass = string & { readonly __brand: "BpfInlineAsmRegClass" };
export const BpfInlineAsmRegClass = stub_impls<StubRegClass<BpfInlineAsmRegClass>>("bpf", "BpfInlineAsmRegClass");

/** `BpfInlineAsmReg` (`def_regs!`; not ported) */
export type BpfInlineAsmReg = string & { readonly __brand: "BpfInlineAsmReg" };
export const BpfInlineAsmReg = stub_impls<StubReg<BpfInlineAsmReg, BpfInlineAsmRegClass>>("bpf", "BpfInlineAsmReg");

/** `pub(super) fn regclass_map()` (`def_reg_class!`; not ported) */
export const regclass_map: () => RegClassMap = stub_fn("bpf", "regclass_map");

/** `pub(super) fn fill_reg_map(..)` (`def_regs!`; not ported) */
export const fill_reg_map: DefRegs<string, string>["fill_reg_map"] = stub_fn("bpf", "fill_reg_map");

