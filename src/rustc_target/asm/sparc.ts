// Stub of compiler/rustc_target/src/asm/sparc.rs.
// PORT: rust-ts has no built-in target with this architecture, so the module is not ported: its types
// are opaque and every fn calls `unported` (lane target-asm).
import { type DefRegs, type RegClassMap, type StubReg, type StubRegClass, stub_fn, stub_impls } from "./mod.ts";

/** `SparcInlineAsmRegClass` (`def_reg_class!`; not ported) */
export type SparcInlineAsmRegClass = string & { readonly __brand: "SparcInlineAsmRegClass" };
export const SparcInlineAsmRegClass = stub_impls<StubRegClass<SparcInlineAsmRegClass>>("sparc", "SparcInlineAsmRegClass");

/** `SparcInlineAsmReg` (`def_regs!`; not ported) */
export type SparcInlineAsmReg = string & { readonly __brand: "SparcInlineAsmReg" };
export const SparcInlineAsmReg = stub_impls<StubReg<SparcInlineAsmReg, SparcInlineAsmRegClass>>("sparc", "SparcInlineAsmReg");

/** `pub(super) fn regclass_map()` (`def_reg_class!`; not ported) */
export const regclass_map: () => RegClassMap = stub_fn("sparc", "regclass_map");

/** `pub(super) fn fill_reg_map(..)` (`def_regs!`; not ported) */
export const fill_reg_map: DefRegs<string, string>["fill_reg_map"] = stub_fn("sparc", "fill_reg_map");

