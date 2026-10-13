// Stub of compiler/rustc_target/src/asm/powerpc.rs.
// PORT: rust-ts has no built-in target with this architecture, so the module is not ported: its types
// are opaque and every fn calls `unported` (lane target-asm).
import type { Target } from "../spec/mod.ts";
import { type DefRegs, type RegClassMap, type StubReg, type StubRegClass, stub_fn, stub_impls } from "./mod.ts";

/** `PowerPCInlineAsmRegClass` (`def_reg_class!`; not ported) */
export type PowerPCInlineAsmRegClass = string & { readonly __brand: "PowerPCInlineAsmRegClass" };
export const PowerPCInlineAsmRegClass = stub_impls<StubRegClass<PowerPCInlineAsmRegClass>>("powerpc", "PowerPCInlineAsmRegClass");

/** `PowerPCInlineAsmReg` (`def_regs!`; not ported) */
export type PowerPCInlineAsmReg = string & { readonly __brand: "PowerPCInlineAsmReg" };
export const PowerPCInlineAsmReg = stub_impls<StubReg<PowerPCInlineAsmReg, PowerPCInlineAsmRegClass>>("powerpc", "PowerPCInlineAsmReg");

/** `pub(super) fn regclass_map()` (`def_reg_class!`; not ported) */
export const regclass_map: () => RegClassMap = stub_fn("powerpc", "regclass_map");

/** `pub(super) fn fill_reg_map(..)` (`def_regs!`; not ported) */
export const fill_reg_map: DefRegs<string, string>["fill_reg_map"] = stub_fn("powerpc", "fill_reg_map");

/** `pub(crate) fn is_spe(target: &Target) -> bool` (not ported) */
export const is_spe: (target: Target) => boolean = stub_fn("powerpc", "is_spe");

