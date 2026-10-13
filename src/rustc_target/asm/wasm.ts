// Port of compiler/rustc_target/src/asm/wasm.rs.

import { def_reg_class, def_regs, type InlineAsmArch, InlineAsmType, type ModifierInfo, type RegClassMap, type SupportedType, types } from "./mod.ts";

type char = number;

// def_reg_class! { Wasm WasmInlineAsmRegClass { local, } }
export type WasmInlineAsmRegClass = "local";

const WasmInlineAsmRegClass_impl = def_reg_class<WasmInlineAsmRegClass>("Wasm", ["local"]);

export const WasmInlineAsmRegClass = {
  ...WasmInlineAsmRegClass_impl,

  // rustc: compiler/rustc_target/src/asm/wasm.rs:12 valid_modifiers
  valid_modifiers(self: WasmInlineAsmRegClass, _arch: InlineAsmArch): readonly char[] {
    return [];
  },

  // rustc: compiler/rustc_target/src/asm/wasm.rs:16 suggest_class
  suggest_class(self: WasmInlineAsmRegClass, _arch: InlineAsmArch, _ty: InlineAsmType): WasmInlineAsmRegClass | undefined {
    return undefined;
  },

  // rustc: compiler/rustc_target/src/asm/wasm.rs:20 suggest_modifier
  suggest_modifier(self: WasmInlineAsmRegClass, _arch: InlineAsmArch, _ty: InlineAsmType): ModifierInfo | undefined {
    return undefined;
  },

  // rustc: compiler/rustc_target/src/asm/wasm.rs:28 default_modifier
  default_modifier(self: WasmInlineAsmRegClass, _arch: InlineAsmArch): ModifierInfo | undefined {
    return undefined;
  },

  // rustc: compiler/rustc_target/src/asm/wasm.rs:32 supported_types
  supported_types(self: WasmInlineAsmRegClass, _arch: InlineAsmArch): readonly SupportedType[] {
    const { I8, I16, I32, I64, F32, F64 } = InlineAsmType;
    switch (self) {
      case "local": {
        return types([I8, I16, I32, I64, F32, F64]);
      }
    }
  },
} as const;

// WebAssembly doesn't have registers.
// def_regs! { Wasm WasmInlineAsmReg WasmInlineAsmRegClass {} }
// PORT: the enum is uninhabited.
export type WasmInlineAsmReg = never;

const WasmInlineAsmReg_impl = def_regs<WasmInlineAsmReg, WasmInlineAsmRegClass>("Wasm", [], []);

export const WasmInlineAsmReg = {
  ...WasmInlineAsmReg_impl,
} as const;

// pub(super) fn regclass_map() (def_reg_class!)
export function regclass_map(): RegClassMap {
  return WasmInlineAsmRegClass_impl.regclass_map();
}

// pub(super) fn fill_reg_map(..) (def_regs!)
export const fill_reg_map = WasmInlineAsmReg_impl.fill_reg_map;
