// Stub of compiler/rustc_target/src/asm/hexagon.rs.
// PORT: rust-ts has no built-in target with this architecture, so the module is not ported: its types
// are opaque and every fn calls `unported` (lane target-asm).
import { type DefRegs, type RegClassMap, type StubReg, type StubRegClass, stub_fn, stub_impls } from "./mod.ts";

/** `HexagonInlineAsmRegClass` (`def_reg_class!`; not ported) */
export type HexagonInlineAsmRegClass = string & { readonly __brand: "HexagonInlineAsmRegClass" };
export const HexagonInlineAsmRegClass = stub_impls<StubRegClass<HexagonInlineAsmRegClass>>("hexagon", "HexagonInlineAsmRegClass");

/** `HexagonInlineAsmReg` (`def_regs!`; not ported) */
export type HexagonInlineAsmReg = string & { readonly __brand: "HexagonInlineAsmReg" };
export const HexagonInlineAsmReg = stub_impls<StubReg<HexagonInlineAsmReg, HexagonInlineAsmRegClass>>("hexagon", "HexagonInlineAsmReg");

/** `pub(super) fn regclass_map()` (`def_reg_class!`; not ported) */
export const regclass_map: () => RegClassMap = stub_fn("hexagon", "regclass_map");

/** `pub(super) fn fill_reg_map(..)` (`def_regs!`; not ported) */
export const fill_reg_map: DefRegs<string, string>["fill_reg_map"] = stub_fn("hexagon", "fill_reg_map");

