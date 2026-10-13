// Stub of compiler/rustc_target/src/asm/arm.rs.
// PORT: rust-ts has no built-in target with this architecture, so the module is not ported: its types
// are opaque and every fn calls `unported` (lane target-asm).
import { type DefRegs, type RegClassMap, type StubReg, type StubRegClass, stub_fn, stub_impls } from "./mod.ts";

/** `ArmInlineAsmRegClass` (`def_reg_class!`; not ported) */
export type ArmInlineAsmRegClass = string & { readonly __brand: "ArmInlineAsmRegClass" };
export const ArmInlineAsmRegClass = stub_impls<StubRegClass<ArmInlineAsmRegClass>>("arm", "ArmInlineAsmRegClass");

/** `ArmInlineAsmReg` (`def_regs!`; not ported) */
export type ArmInlineAsmReg = string & { readonly __brand: "ArmInlineAsmReg" };
export const ArmInlineAsmReg = stub_impls<StubReg<ArmInlineAsmReg, ArmInlineAsmRegClass>>("arm", "ArmInlineAsmReg");

/** `pub(super) fn regclass_map()` (`def_reg_class!`; not ported) */
export const regclass_map: () => RegClassMap = stub_fn("arm", "regclass_map");

/** `pub(super) fn fill_reg_map(..)` (`def_regs!`; not ported) */
export const fill_reg_map: DefRegs<string, string>["fill_reg_map"] = stub_fn("arm", "fill_reg_map");

