// Stub of compiler/rustc_target/src/asm/loongarch.rs.
// PORT: rust-ts has no built-in target with this architecture, so the module is not ported: its types
// are opaque and every fn calls `unported` (lane target-asm).
import { type DefRegs, type RegClassMap, type StubReg, type StubRegClass, stub_fn, stub_impls } from "./mod.ts";

/** `LoongArchInlineAsmRegClass` (`def_reg_class!`; not ported) */
export type LoongArchInlineAsmRegClass = string & { readonly __brand: "LoongArchInlineAsmRegClass" };
export const LoongArchInlineAsmRegClass = stub_impls<StubRegClass<LoongArchInlineAsmRegClass>>("loongarch", "LoongArchInlineAsmRegClass");

/** `LoongArchInlineAsmReg` (`def_regs!`; not ported) */
export type LoongArchInlineAsmReg = string & { readonly __brand: "LoongArchInlineAsmReg" };
export const LoongArchInlineAsmReg = stub_impls<StubReg<LoongArchInlineAsmReg, LoongArchInlineAsmRegClass>>("loongarch", "LoongArchInlineAsmReg");

/** `pub(super) fn regclass_map()` (`def_reg_class!`; not ported) */
export const regclass_map: () => RegClassMap = stub_fn("loongarch", "regclass_map");

/** `pub(super) fn fill_reg_map(..)` (`def_regs!`; not ported) */
export const fill_reg_map: DefRegs<string, string>["fill_reg_map"] = stub_fn("loongarch", "fill_reg_map");

