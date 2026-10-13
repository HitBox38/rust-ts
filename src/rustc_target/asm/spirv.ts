// Stub of compiler/rustc_target/src/asm/spirv.rs.
// PORT: rust-ts has no built-in target with this architecture, so the module is not ported: its types
// are opaque and every fn calls `unported` (lane target-asm).
import { type DefRegs, type RegClassMap, type StubReg, type StubRegClass, stub_fn, stub_impls } from "./mod.ts";

/** `SpirVInlineAsmRegClass` (`def_reg_class!`; not ported) */
export type SpirVInlineAsmRegClass = string & { readonly __brand: "SpirVInlineAsmRegClass" };
export const SpirVInlineAsmRegClass = stub_impls<StubRegClass<SpirVInlineAsmRegClass>>("spirv", "SpirVInlineAsmRegClass");

/** `SpirVInlineAsmReg` (`def_regs!`; not ported) */
export type SpirVInlineAsmReg = string & { readonly __brand: "SpirVInlineAsmReg" };
export const SpirVInlineAsmReg = stub_impls<StubReg<SpirVInlineAsmReg, SpirVInlineAsmRegClass>>("spirv", "SpirVInlineAsmReg");

/** `pub(super) fn regclass_map()` (`def_reg_class!`; not ported) */
export const regclass_map: () => RegClassMap = stub_fn("spirv", "regclass_map");

/** `pub(super) fn fill_reg_map(..)` (`def_regs!`; not ported) */
export const fill_reg_map: DefRegs<string, string>["fill_reg_map"] = stub_fn("spirv", "fill_reg_map");

