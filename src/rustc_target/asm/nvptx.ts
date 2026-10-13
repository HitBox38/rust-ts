// Stub of compiler/rustc_target/src/asm/nvptx.rs.
// PORT: rust-ts has no built-in target with this architecture, so the module is not ported: its types
// are opaque and every fn calls `unported` (lane target-asm).
import { type DefRegs, type RegClassMap, type StubReg, type StubRegClass, stub_fn, stub_impls } from "./mod.ts";

/** `NvptxInlineAsmRegClass` (`def_reg_class!`; not ported) */
export type NvptxInlineAsmRegClass = string & { readonly __brand: "NvptxInlineAsmRegClass" };
export const NvptxInlineAsmRegClass = stub_impls<StubRegClass<NvptxInlineAsmRegClass>>("nvptx", "NvptxInlineAsmRegClass");

/** `NvptxInlineAsmReg` (`def_regs!`; not ported) */
export type NvptxInlineAsmReg = string & { readonly __brand: "NvptxInlineAsmReg" };
export const NvptxInlineAsmReg = stub_impls<StubReg<NvptxInlineAsmReg, NvptxInlineAsmRegClass>>("nvptx", "NvptxInlineAsmReg");

/** `pub(super) fn regclass_map()` (`def_reg_class!`; not ported) */
export const regclass_map: () => RegClassMap = stub_fn("nvptx", "regclass_map");

/** `pub(super) fn fill_reg_map(..)` (`def_regs!`; not ported) */
export const fill_reg_map: DefRegs<string, string>["fill_reg_map"] = stub_fn("nvptx", "fill_reg_map");

