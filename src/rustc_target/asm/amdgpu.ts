// Stub of compiler/rustc_target/src/asm/amdgpu.rs.
// PORT: rust-ts has no built-in target with this architecture, so the module is not ported: its types
// are opaque and every fn calls `unported` (lane target-asm).
import { type DefRegs, type RegClassMap, type StubReg, type StubRegClass, stub_fn, stub_impls } from "./mod.ts";

/** `AmdgpuInlineAsmRegClass` (`def_reg_class!`; not ported) */
export type AmdgpuInlineAsmRegClass = string & { readonly __brand: "AmdgpuInlineAsmRegClass" };
export const AmdgpuInlineAsmRegClass = stub_impls<StubRegClass<AmdgpuInlineAsmRegClass>>("amdgpu", "AmdgpuInlineAsmRegClass");

/** `AmdgpuInlineAsmReg` (`def_regs!`; not ported) */
export type AmdgpuInlineAsmReg = string & { readonly __brand: "AmdgpuInlineAsmReg" };
export const AmdgpuInlineAsmReg = stub_impls<StubReg<AmdgpuInlineAsmReg, AmdgpuInlineAsmRegClass>>("amdgpu", "AmdgpuInlineAsmReg");

/** `pub(super) fn regclass_map()` (`def_reg_class!`; not ported) */
export const regclass_map: () => RegClassMap = stub_fn("amdgpu", "regclass_map");

/** `pub(super) fn fill_reg_map(..)` (`def_regs!`; not ported) */
export const fill_reg_map: DefRegs<string, string>["fill_reg_map"] = stub_fn("amdgpu", "fill_reg_map");

