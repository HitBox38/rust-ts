// Stub of compiler/rustc_target/src/asm/mips.rs.
// PORT: rust-ts has no built-in target with this architecture, so the module is not ported: its types
// are opaque and every fn calls `unported` (lane target-asm).
import { type DefRegs, type RegClassMap, type StubReg, type StubRegClass, stub_fn, stub_impls } from "./mod.ts";

/** `MipsInlineAsmRegClass` (`def_reg_class!`; not ported) */
export type MipsInlineAsmRegClass = string & { readonly __brand: "MipsInlineAsmRegClass" };
export const MipsInlineAsmRegClass = stub_impls<StubRegClass<MipsInlineAsmRegClass>>("mips", "MipsInlineAsmRegClass");

/** `MipsInlineAsmReg` (`def_regs!`; not ported) */
export type MipsInlineAsmReg = string & { readonly __brand: "MipsInlineAsmReg" };
export const MipsInlineAsmReg = stub_impls<StubReg<MipsInlineAsmReg, MipsInlineAsmRegClass>>("mips", "MipsInlineAsmReg");

/** `pub(super) fn regclass_map()` (`def_reg_class!`; not ported) */
export const regclass_map: () => RegClassMap = stub_fn("mips", "regclass_map");

/** `pub(super) fn fill_reg_map(..)` (`def_regs!`; not ported) */
export const fill_reg_map: DefRegs<string, string>["fill_reg_map"] = stub_fn("mips", "fill_reg_map");

