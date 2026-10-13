// Stub of compiler/rustc_target/src/asm/csky.rs.
// PORT: rust-ts has no built-in target with this architecture, so the module is not ported: its types
// are opaque and every fn calls `unported` (lane target-asm).
import { type DefRegs, type RegClassMap, type StubReg, type StubRegClass, stub_fn, stub_impls } from "./mod.ts";

/** `CSKYInlineAsmRegClass` (`def_reg_class!`; not ported) */
export type CSKYInlineAsmRegClass = string & { readonly __brand: "CSKYInlineAsmRegClass" };
export const CSKYInlineAsmRegClass = stub_impls<StubRegClass<CSKYInlineAsmRegClass>>("csky", "CSKYInlineAsmRegClass");

/** `CSKYInlineAsmReg` (`def_regs!`; not ported) */
export type CSKYInlineAsmReg = string & { readonly __brand: "CSKYInlineAsmReg" };
export const CSKYInlineAsmReg = stub_impls<StubReg<CSKYInlineAsmReg, CSKYInlineAsmRegClass>>("csky", "CSKYInlineAsmReg");

/** `pub(super) fn regclass_map()` (`def_reg_class!`; not ported) */
export const regclass_map: () => RegClassMap = stub_fn("csky", "regclass_map");

/** `pub(super) fn fill_reg_map(..)` (`def_regs!`; not ported) */
export const fill_reg_map: DefRegs<string, string>["fill_reg_map"] = stub_fn("csky", "fill_reg_map");

