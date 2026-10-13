// Stub of compiler/rustc_target/src/asm/avr.rs.
// PORT: rust-ts has no built-in target with this architecture, so the module is not ported: its types
// are opaque and every fn calls `unported` (lane target-asm).
import { type DefRegs, type RegClassMap, type StubReg, type StubRegClass, stub_fn, stub_impls } from "./mod.ts";

/** `AvrInlineAsmRegClass` (`def_reg_class!`; not ported) */
export type AvrInlineAsmRegClass = string & { readonly __brand: "AvrInlineAsmRegClass" };
export const AvrInlineAsmRegClass = stub_impls<StubRegClass<AvrInlineAsmRegClass>>("avr", "AvrInlineAsmRegClass");

/** `AvrInlineAsmReg` (`def_regs!`; not ported) */
export type AvrInlineAsmReg = string & { readonly __brand: "AvrInlineAsmReg" };
export const AvrInlineAsmReg = stub_impls<StubReg<AvrInlineAsmReg, AvrInlineAsmRegClass>>("avr", "AvrInlineAsmReg");

/** `pub(super) fn regclass_map()` (`def_reg_class!`; not ported) */
export const regclass_map: () => RegClassMap = stub_fn("avr", "regclass_map");

/** `pub(super) fn fill_reg_map(..)` (`def_regs!`; not ported) */
export const fill_reg_map: DefRegs<string, string>["fill_reg_map"] = stub_fn("avr", "fill_reg_map");

