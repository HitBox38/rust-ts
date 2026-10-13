// Stub of compiler/rustc_target/src/asm/msp430.rs.
// PORT: rust-ts has no built-in target with this architecture, so the module is not ported: its types
// are opaque and every fn calls `unported` (lane target-asm).
import { type DefRegs, type RegClassMap, type StubReg, type StubRegClass, stub_fn, stub_impls } from "./mod.ts";

/** `Msp430InlineAsmRegClass` (`def_reg_class!`; not ported) */
export type Msp430InlineAsmRegClass = string & { readonly __brand: "Msp430InlineAsmRegClass" };
export const Msp430InlineAsmRegClass = stub_impls<StubRegClass<Msp430InlineAsmRegClass>>("msp430", "Msp430InlineAsmRegClass");

/** `Msp430InlineAsmReg` (`def_regs!`; not ported) */
export type Msp430InlineAsmReg = string & { readonly __brand: "Msp430InlineAsmReg" };
export const Msp430InlineAsmReg = stub_impls<StubReg<Msp430InlineAsmReg, Msp430InlineAsmRegClass>>("msp430", "Msp430InlineAsmReg");

/** `pub(super) fn regclass_map()` (`def_reg_class!`; not ported) */
export const regclass_map: () => RegClassMap = stub_fn("msp430", "regclass_map");

/** `pub(super) fn fill_reg_map(..)` (`def_regs!`; not ported) */
export const fill_reg_map: DefRegs<string, string>["fill_reg_map"] = stub_fn("msp430", "fill_reg_map");

