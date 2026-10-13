// Stub of compiler/rustc_target/src/asm/riscv.rs.
// PORT: rust-ts has no built-in target with this architecture, so the module is not ported: its types
// are opaque and every fn calls `unported` (lane target-asm).
import type { Symbol } from "../../rustc_span/symbol.ts";
import { type DefRegs, type RegClassMap, type StubReg, type StubRegClass, stub_fn, stub_impls } from "./mod.ts";

/** `RiscVInlineAsmRegClass` (`def_reg_class!`; not ported) */
export type RiscVInlineAsmRegClass = string & { readonly __brand: "RiscVInlineAsmRegClass" };
export const RiscVInlineAsmRegClass = stub_impls<StubRegClass<RiscVInlineAsmRegClass>>("riscv", "RiscVInlineAsmRegClass");

/** `RiscVInlineAsmReg` (`def_regs!`; not ported) */
export type RiscVInlineAsmReg = string & { readonly __brand: "RiscVInlineAsmReg" };
export const RiscVInlineAsmReg = stub_impls<StubReg<RiscVInlineAsmReg, RiscVInlineAsmRegClass>>("riscv", "RiscVInlineAsmReg");

/** `pub(super) fn regclass_map()` (`def_reg_class!`; not ported) */
export const regclass_map: () => RegClassMap = stub_fn("riscv", "regclass_map");

/** `pub(super) fn fill_reg_map(..)` (`def_regs!`; not ported) */
export const fill_reg_map: DefRegs<string, string>["fill_reg_map"] = stub_fn("riscv", "fill_reg_map");

/** `pub(crate) fn is_e(target_features: &FxIndexSet<Symbol>) -> bool` (not ported) */
export const is_e: (target_features: ReadonlySet<Symbol>) => boolean = stub_fn("riscv", "is_e");

