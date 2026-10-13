// Stub of compiler/rustc_target/src/asm/m68k.rs.
// PORT: rust-ts has no built-in target with this architecture, so the module is not ported: its types
// are opaque and every fn calls `unported` (lane target-asm).
import { type DefRegs, type RegClassMap, type StubReg, type StubRegClass, stub_fn, stub_impls } from "./mod.ts";

/** `M68kInlineAsmRegClass` (`def_reg_class!`; not ported) */
export type M68kInlineAsmRegClass = string & { readonly __brand: "M68kInlineAsmRegClass" };
export const M68kInlineAsmRegClass = stub_impls<StubRegClass<M68kInlineAsmRegClass>>("m68k", "M68kInlineAsmRegClass");

/** `M68kInlineAsmReg` (`def_regs!`; not ported) */
export type M68kInlineAsmReg = string & { readonly __brand: "M68kInlineAsmReg" };
export const M68kInlineAsmReg = stub_impls<StubReg<M68kInlineAsmReg, M68kInlineAsmRegClass>>("m68k", "M68kInlineAsmReg");

/** `pub(super) fn regclass_map()` (`def_reg_class!`; not ported) */
export const regclass_map: () => RegClassMap = stub_fn("m68k", "regclass_map");

/** `pub(super) fn fill_reg_map(..)` (`def_regs!`; not ported) */
export const fill_reg_map: DefRegs<string, string>["fill_reg_map"] = stub_fn("m68k", "fill_reg_map");

