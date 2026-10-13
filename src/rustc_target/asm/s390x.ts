// Stub of compiler/rustc_target/src/asm/s390x.rs.
// PORT: rust-ts has no built-in target with this architecture, so the module is not ported: its types
// are opaque and every fn calls `unported` (lane target-asm).
import { type DefRegs, type RegClassMap, type StubReg, type StubRegClass, stub_fn, stub_impls } from "./mod.ts";

/** `S390xInlineAsmRegClass` (`def_reg_class!`; not ported) */
export type S390xInlineAsmRegClass = string & { readonly __brand: "S390xInlineAsmRegClass" };
export const S390xInlineAsmRegClass = stub_impls<StubRegClass<S390xInlineAsmRegClass>>("s390x", "S390xInlineAsmRegClass");

/** `S390xInlineAsmReg` (`def_regs!`; not ported) */
export type S390xInlineAsmReg = string & { readonly __brand: "S390xInlineAsmReg" };
export const S390xInlineAsmReg = stub_impls<StubReg<S390xInlineAsmReg, S390xInlineAsmRegClass>>("s390x", "S390xInlineAsmReg");

/** `pub(super) fn regclass_map()` (`def_reg_class!`; not ported) */
export const regclass_map: () => RegClassMap = stub_fn("s390x", "regclass_map");

/** `pub(super) fn fill_reg_map(..)` (`def_regs!`; not ported) */
export const fill_reg_map: DefRegs<string, string>["fill_reg_map"] = stub_fn("s390x", "fill_reg_map");

