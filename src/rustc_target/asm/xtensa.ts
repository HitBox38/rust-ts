// Stub of compiler/rustc_target/src/asm/xtensa.rs.
// PORT: rust-ts has no built-in target with this architecture, so the module is not ported: its types
// are opaque and every fn calls `unported` (lane target-asm).
import { type DefRegs, type RegClassMap, type StubReg, type StubRegClass, stub_fn, stub_impls } from "./mod.ts";

/** `XtensaInlineAsmRegClass` (`def_reg_class!`; not ported) */
export type XtensaInlineAsmRegClass = string & { readonly __brand: "XtensaInlineAsmRegClass" };
export const XtensaInlineAsmRegClass = stub_impls<StubRegClass<XtensaInlineAsmRegClass>>("xtensa", "XtensaInlineAsmRegClass");

/** `XtensaInlineAsmReg` (`def_regs!`; not ported) */
export type XtensaInlineAsmReg = string & { readonly __brand: "XtensaInlineAsmReg" };
export const XtensaInlineAsmReg = stub_impls<StubReg<XtensaInlineAsmReg, XtensaInlineAsmRegClass>>("xtensa", "XtensaInlineAsmReg");

/** `pub(super) fn regclass_map()` (`def_reg_class!`; not ported) */
export const regclass_map: () => RegClassMap = stub_fn("xtensa", "regclass_map");

/** `pub(super) fn fill_reg_map(..)` (`def_regs!`; not ported) */
export const fill_reg_map: DefRegs<string, string>["fill_reg_map"] = stub_fn("xtensa", "fill_reg_map");

