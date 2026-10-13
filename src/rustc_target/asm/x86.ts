// Port of compiler/rustc_target/src/asm/x86.rs.

import { sym, type Symbol } from "../../rustc_span/symbol.ts";
import { ch } from "../../std/char.ts";
import { unreachable } from "../../std/panic.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
import type { RelocModel, Target } from "../spec/mod.ts";
import {
  def_reg_class,
  def_regs,
  type FmtResult,
  type FmtWrite,
  type InlineAsmArch,
  InlineAsmSize,
  InlineAsmType,
  ModifierInfo,
  type RegClassMap,
  type RegDef,
  type RegFilter,
  type SupportedType,
  types,
} from "./mod.ts";

type char = number;

// def_reg_class! { X86 X86InlineAsmRegClass { .. } }
export type X86InlineAsmRegClass =
  | "reg"
  | "reg_abcd"
  | "reg_byte"
  | "xmm_reg"
  | "ymm_reg"
  | "zmm_reg"
  | "kreg"
  | "kreg0"
  | "mmx_reg"
  | "x87_reg"
  | "tmm_reg";

const X86InlineAsmRegClass_impl = def_reg_class<X86InlineAsmRegClass>("X86", [
  "reg",
  "reg_abcd",
  "reg_byte",
  "xmm_reg",
  "ymm_reg",
  "zmm_reg",
  "kreg",
  "kreg0",
  "mmx_reg",
  "x87_reg",
  "tmm_reg",
]);

/** `FixedBytes(n)` patterns. */
const is_fixed = (size: InlineAsmSize, n: number): boolean => size.$ === "FixedBytes" && size._0 === n;

export const X86InlineAsmRegClass = {
  ...X86InlineAsmRegClass_impl,

  // rustc: compiler/rustc_target/src/asm/x86.rs:26 valid_modifiers
  valid_modifiers(self: X86InlineAsmRegClass, arch: InlineAsmArch): readonly char[] {
    switch (self) {
      case "reg": {
        if (arch === "X86_64") {
          return [ch("l"), ch("x"), ch("e"), ch("r")];
        } else {
          return [ch("x"), ch("e")];
        }
      }
      case "reg_abcd": {
        if (arch === "X86_64") {
          return [ch("l"), ch("h"), ch("x"), ch("e"), ch("r")];
        } else {
          return [ch("l"), ch("h"), ch("x"), ch("e")];
        }
      }
      case "reg_byte":
        return [];
      case "xmm_reg":
      case "ymm_reg":
      case "zmm_reg":
        return [ch("x"), ch("y"), ch("z")];
      case "kreg":
      case "kreg0":
        return [];
      case "mmx_reg":
      case "x87_reg":
        return [];
      case "tmm_reg":
        return [];
    }
  },

  // rustc: compiler/rustc_target/src/asm/x86.rs:50 suggest_class
  suggest_class(self: X86InlineAsmRegClass, _arch: InlineAsmArch, ty: InlineAsmType): X86InlineAsmRegClass | undefined {
    if ((self === "reg" || self === "reg_abcd") && InlineAsmSize.eq(InlineAsmType.size(ty), InlineAsmSize.FixedBytes(1))) {
      return "reg_byte";
    }
    return undefined;
  },

  // rustc: compiler/rustc_target/src/asm/x86.rs:59 suggest_modifier
  suggest_modifier(self: X86InlineAsmRegClass, arch: InlineAsmArch, ty: InlineAsmType): ModifierInfo | undefined {
    switch (self) {
      case "reg": {
        const size = InlineAsmType.size(ty);
        if (is_fixed(size, 2)) {
          return ModifierInfo.from([ch("x"), "ax", InlineAsmSize.FixedBytes(2)]);
        }
        if (is_fixed(size, 4) && arch === "X86_64") {
          return ModifierInfo.from([ch("e"), "eax", InlineAsmSize.FixedBytes(4)]);
        }
        return undefined;
      }
      case "reg_abcd": {
        const size = InlineAsmType.size(ty);
        if (is_fixed(size, 2)) {
          return ModifierInfo.from([ch("x"), "ax", InlineAsmSize.FixedBytes(2)]);
        }
        if (is_fixed(size, 4) && arch === "X86_64") {
          return ModifierInfo.from([ch("e"), "eax", InlineAsmSize.FixedBytes(4)]);
        }
        return undefined;
      }
      case "reg_byte":
        return undefined;
      case "xmm_reg":
        return undefined;
      case "ymm_reg": {
        const size = InlineAsmType.size(ty);
        if (is_fixed(size, 32)) return undefined;
        return ModifierInfo.from([ch("x"), "xmm0", InlineAsmSize.FixedBytes(16)]);
      }
      case "zmm_reg": {
        const size = InlineAsmType.size(ty);
        if (is_fixed(size, 64)) return undefined;
        if (is_fixed(size, 32)) {
          return ModifierInfo.from([ch("y"), "ymm0", InlineAsmSize.FixedBytes(32)]);
        }
        return ModifierInfo.from([ch("x"), "xmm0", InlineAsmSize.FixedBytes(16)]);
      }
      case "kreg":
      case "kreg0":
        return undefined;
      case "mmx_reg":
      case "x87_reg":
        return undefined;
      case "tmm_reg":
        return undefined;
    }
  },

  // rustc: compiler/rustc_target/src/asm/x86.rs:98 default_modifier
  default_modifier(self: X86InlineAsmRegClass, arch: InlineAsmArch): ModifierInfo | undefined {
    switch (self) {
      case "reg":
      case "reg_abcd": {
        if (arch === "X86_64") {
          return ModifierInfo.from([ch("r"), "rax", InlineAsmSize.FixedBytes(8)]);
        } else {
          return ModifierInfo.from([ch("e"), "eax", InlineAsmSize.FixedBytes(4)]);
        }
      }
      case "reg_byte":
        return undefined;
      case "xmm_reg":
        return ModifierInfo.from([ch("x"), "xmm0", InlineAsmSize.FixedBytes(16)]);
      case "ymm_reg":
        return ModifierInfo.from([ch("y"), "ymm0", InlineAsmSize.FixedBytes(32)]);
      case "zmm_reg":
        return ModifierInfo.from([ch("z"), "zmm0", InlineAsmSize.FixedBytes(64)]);
      case "kreg":
      case "kreg0":
        return undefined;
      case "mmx_reg":
      case "x87_reg":
        return undefined;
      case "tmm_reg":
        return undefined;
    }
  },

  // rustc: compiler/rustc_target/src/asm/x86.rs:117 supported_types
  supported_types(self: X86InlineAsmRegClass, arch: InlineAsmArch, _allow_experimental_reg: boolean): readonly SupportedType[] {
    const { I8, I16, I32, I64, I128, F16, F32, F64, F128, VecI8, VecI16, VecI32, VecI64, VecF16, VecF32, VecF64 } = InlineAsmType;
    switch (self) {
      case "reg":
      case "reg_abcd": {
        if (arch === "X86_64") {
          return types([I16, I32, I64, F16, F32, F64]);
        } else {
          return types([I16, I32, F16, F32]);
        }
      }
      case "reg_byte":
        return types([I8]);
      case "xmm_reg": {
        return types(undefined, [
          sym.sse,
          [I32, I64, I128, F16, F32, F64, F128,
            VecI8(16), VecI16(8), VecI32(4), VecI64(2), VecF16(8), VecF32(4), VecF64(2)],
        ]);
      }
      case "ymm_reg": {
        return types(undefined, [
          sym.avx,
          [I32, I64, I128, F16, F32, F64, F128,
            VecI8(16), VecI16(8), VecI32(4), VecI64(2), VecF16(8), VecF32(4), VecF64(2),
            VecI8(32), VecI16(16), VecI32(8), VecI64(4), VecF16(16), VecF32(8), VecF64(4)],
        ]);
      }
      case "zmm_reg": {
        return types(undefined, [
          sym.avx512f,
          [I32, I64, I128, F16, F32, F64, F128,
            VecI8(16), VecI16(8), VecI32(4), VecI64(2), VecF16(8), VecF32(4), VecF64(2),
            VecI8(32), VecI16(16), VecI32(8), VecI64(4), VecF16(16), VecF32(8), VecF64(4),
            VecI8(64), VecI16(32), VecI32(16), VecI64(8), VecF16(32), VecF32(16), VecF64(8)],
        ]);
      }

      case "kreg":
        return types(undefined, [sym.avx512f, [I8, I16]], [sym.avx512bw, [I32, I64]]);
      case "kreg0":
        return [];
      case "mmx_reg":
      case "x87_reg":
        return [];
      case "tmm_reg":
        return [];
    }
  },
} as const;

// rustc: compiler/rustc_target/src/asm/x86.rs:164 x86_64_only
function x86_64_only(
  arch: InlineAsmArch,
  _reloc_model: RelocModel,
  _target_features: ReadonlySet<Symbol>,
  _target: Target,
  _is_clobber: boolean,
): Result<null, string> {
  switch (arch) {
    case "X86":
      return Err("register is only available on x86_64");
    case "X86_64":
      return Ok(null);
    default:
      return unreachable();
  }
}

// rustc: compiler/rustc_target/src/asm/x86.rs:178 high_byte
function high_byte(
  arch: InlineAsmArch,
  _reloc_model: RelocModel,
  _target_features: ReadonlySet<Symbol>,
  _target: Target,
  _is_clobber: boolean,
): Result<null, string> {
  switch (arch) {
    case "X86_64":
      return Err("high byte registers cannot be used as an operand on x86_64");
    default:
      return Ok(null);
  }
}

// rustc: compiler/rustc_target/src/asm/x86.rs:191 rbx_reserved
function rbx_reserved(
  arch: InlineAsmArch,
  _reloc_model: RelocModel,
  _target_features: ReadonlySet<Symbol>,
  _target: Target,
  _is_clobber: boolean,
): Result<null, string> {
  switch (arch) {
    case "X86":
      return Ok(null);
    case "X86_64": {
      return Err("rbx is used internally by LLVM and cannot be used as an operand for inline asm");
    }
    default:
      return unreachable();
  }
}

// rustc: compiler/rustc_target/src/asm/x86.rs:207 esi_reserved
function esi_reserved(
  arch: InlineAsmArch,
  _reloc_model: RelocModel,
  _target_features: ReadonlySet<Symbol>,
  _target: Target,
  _is_clobber: boolean,
): Result<null, string> {
  switch (arch) {
    case "X86": {
      return Err("esi is used internally by LLVM and cannot be used as an operand for inline asm");
    }
    case "X86_64":
      return Ok(null);
    default:
      return unreachable();
  }
}

// def_regs! { X86 X86InlineAsmReg X86InlineAsmRegClass { .. } }
export type X86InlineAsmReg =
  | "ax" | "bx" | "cx" | "dx" | "si" | "di"
  | "r8" | "r9" | "r10" | "r11" | "r12" | "r13" | "r14" | "r15"
  | "al" | "ah" | "bl" | "bh" | "cl" | "ch" | "dl" | "dh" | "sil" | "dil"
  | "r8b" | "r9b" | "r10b" | "r11b" | "r12b" | "r13b" | "r14b" | "r15b"
  | "xmm0" | "xmm1" | "xmm2" | "xmm3" | "xmm4" | "xmm5" | "xmm6" | "xmm7"
  | "xmm8" | "xmm9" | "xmm10" | "xmm11" | "xmm12" | "xmm13" | "xmm14" | "xmm15"
  | "ymm0" | "ymm1" | "ymm2" | "ymm3" | "ymm4" | "ymm5" | "ymm6" | "ymm7"
  | "ymm8" | "ymm9" | "ymm10" | "ymm11" | "ymm12" | "ymm13" | "ymm14" | "ymm15"
  | "zmm0" | "zmm1" | "zmm2" | "zmm3" | "zmm4" | "zmm5" | "zmm6" | "zmm7"
  | "zmm8" | "zmm9" | "zmm10" | "zmm11" | "zmm12" | "zmm13" | "zmm14" | "zmm15"
  | "zmm16" | "zmm17" | "zmm18" | "zmm19" | "zmm20" | "zmm21" | "zmm22" | "zmm23"
  | "zmm24" | "zmm25" | "zmm26" | "zmm27" | "zmm28" | "zmm29" | "zmm30" | "zmm31"
  | "k0" | "k1" | "k2" | "k3" | "k4" | "k5" | "k6" | "k7"
  | "mm0" | "mm1" | "mm2" | "mm3" | "mm4" | "mm5" | "mm6" | "mm7"
  | "st0" | "st1" | "st2" | "st3" | "st4" | "st5" | "st6" | "st7"
  | "tmm0" | "tmm1" | "tmm2" | "tmm3" | "tmm4" | "tmm5" | "tmm6" | "tmm7";

type C = X86InlineAsmRegClass;
const r = (
  reg: X86InlineAsmReg,
  classes: readonly [C, ...C[]],
  names: readonly [string, ...string[]],
  ...filters: RegFilter[]
): RegDef<X86InlineAsmReg, C> => ({ reg, classes, names, filters });

const X86InlineAsmReg_impl = def_regs<X86InlineAsmReg, C>(
  "X86",
  [
    r("ax", ["reg", "reg_abcd"], ["ax", "eax", "rax"]),
    r("bx", ["reg", "reg_abcd"], ["bx", "ebx", "rbx"], rbx_reserved),
    r("cx", ["reg", "reg_abcd"], ["cx", "ecx", "rcx"]),
    r("dx", ["reg", "reg_abcd"], ["dx", "edx", "rdx"]),
    r("si", ["reg"], ["si", "esi", "rsi"], esi_reserved),
    r("di", ["reg"], ["di", "edi", "rdi"]),
    r("r8", ["reg"], ["r8", "r8w", "r8d"], x86_64_only),
    r("r9", ["reg"], ["r9", "r9w", "r9d"], x86_64_only),
    r("r10", ["reg"], ["r10", "r10w", "r10d"], x86_64_only),
    r("r11", ["reg"], ["r11", "r11w", "r11d"], x86_64_only),
    r("r12", ["reg"], ["r12", "r12w", "r12d"], x86_64_only),
    r("r13", ["reg"], ["r13", "r13w", "r13d"], x86_64_only),
    r("r14", ["reg"], ["r14", "r14w", "r14d"], x86_64_only),
    r("r15", ["reg"], ["r15", "r15w", "r15d"], x86_64_only),
    r("al", ["reg_byte"], ["al"]),
    r("ah", ["reg_byte"], ["ah"], high_byte),
    r("bl", ["reg_byte"], ["bl"], rbx_reserved),
    r("bh", ["reg_byte"], ["bh"], rbx_reserved, high_byte),
    r("cl", ["reg_byte"], ["cl"]),
    r("ch", ["reg_byte"], ["ch"], high_byte),
    r("dl", ["reg_byte"], ["dl"]),
    r("dh", ["reg_byte"], ["dh"], high_byte),
    r("sil", ["reg_byte"], ["sil"], x86_64_only),
    r("dil", ["reg_byte"], ["dil"], x86_64_only),
    r("r8b", ["reg_byte"], ["r8b"], x86_64_only),
    r("r9b", ["reg_byte"], ["r9b"], x86_64_only),
    r("r10b", ["reg_byte"], ["r10b"], x86_64_only),
    r("r11b", ["reg_byte"], ["r11b"], x86_64_only),
    r("r12b", ["reg_byte"], ["r12b"], x86_64_only),
    r("r13b", ["reg_byte"], ["r13b"], x86_64_only),
    r("r14b", ["reg_byte"], ["r14b"], x86_64_only),
    r("r15b", ["reg_byte"], ["r15b"], x86_64_only),
    r("xmm0", ["xmm_reg"], ["xmm0"]),
    r("xmm1", ["xmm_reg"], ["xmm1"]),
    r("xmm2", ["xmm_reg"], ["xmm2"]),
    r("xmm3", ["xmm_reg"], ["xmm3"]),
    r("xmm4", ["xmm_reg"], ["xmm4"]),
    r("xmm5", ["xmm_reg"], ["xmm5"]),
    r("xmm6", ["xmm_reg"], ["xmm6"]),
    r("xmm7", ["xmm_reg"], ["xmm7"]),
    r("xmm8", ["xmm_reg"], ["xmm8"], x86_64_only),
    r("xmm9", ["xmm_reg"], ["xmm9"], x86_64_only),
    r("xmm10", ["xmm_reg"], ["xmm10"], x86_64_only),
    r("xmm11", ["xmm_reg"], ["xmm11"], x86_64_only),
    r("xmm12", ["xmm_reg"], ["xmm12"], x86_64_only),
    r("xmm13", ["xmm_reg"], ["xmm13"], x86_64_only),
    r("xmm14", ["xmm_reg"], ["xmm14"], x86_64_only),
    r("xmm15", ["xmm_reg"], ["xmm15"], x86_64_only),
    r("ymm0", ["ymm_reg"], ["ymm0"]),
    r("ymm1", ["ymm_reg"], ["ymm1"]),
    r("ymm2", ["ymm_reg"], ["ymm2"]),
    r("ymm3", ["ymm_reg"], ["ymm3"]),
    r("ymm4", ["ymm_reg"], ["ymm4"]),
    r("ymm5", ["ymm_reg"], ["ymm5"]),
    r("ymm6", ["ymm_reg"], ["ymm6"]),
    r("ymm7", ["ymm_reg"], ["ymm7"]),
    r("ymm8", ["ymm_reg"], ["ymm8"], x86_64_only),
    r("ymm9", ["ymm_reg"], ["ymm9"], x86_64_only),
    r("ymm10", ["ymm_reg"], ["ymm10"], x86_64_only),
    r("ymm11", ["ymm_reg"], ["ymm11"], x86_64_only),
    r("ymm12", ["ymm_reg"], ["ymm12"], x86_64_only),
    r("ymm13", ["ymm_reg"], ["ymm13"], x86_64_only),
    r("ymm14", ["ymm_reg"], ["ymm14"], x86_64_only),
    r("ymm15", ["ymm_reg"], ["ymm15"], x86_64_only),
    r("zmm0", ["zmm_reg"], ["zmm0"]),
    r("zmm1", ["zmm_reg"], ["zmm1"]),
    r("zmm2", ["zmm_reg"], ["zmm2"]),
    r("zmm3", ["zmm_reg"], ["zmm3"]),
    r("zmm4", ["zmm_reg"], ["zmm4"]),
    r("zmm5", ["zmm_reg"], ["zmm5"]),
    r("zmm6", ["zmm_reg"], ["zmm6"]),
    r("zmm7", ["zmm_reg"], ["zmm7"]),
    r("zmm8", ["zmm_reg"], ["zmm8"], x86_64_only),
    r("zmm9", ["zmm_reg"], ["zmm9"], x86_64_only),
    r("zmm10", ["zmm_reg"], ["zmm10"], x86_64_only),
    r("zmm11", ["zmm_reg"], ["zmm11"], x86_64_only),
    r("zmm12", ["zmm_reg"], ["zmm12"], x86_64_only),
    r("zmm13", ["zmm_reg"], ["zmm13"], x86_64_only),
    r("zmm14", ["zmm_reg"], ["zmm14"], x86_64_only),
    r("zmm15", ["zmm_reg"], ["zmm15"], x86_64_only),
    r("zmm16", ["zmm_reg"], ["zmm16", "xmm16", "ymm16"], x86_64_only),
    r("zmm17", ["zmm_reg"], ["zmm17", "xmm17", "ymm17"], x86_64_only),
    r("zmm18", ["zmm_reg"], ["zmm18", "xmm18", "ymm18"], x86_64_only),
    r("zmm19", ["zmm_reg"], ["zmm19", "xmm19", "ymm19"], x86_64_only),
    r("zmm20", ["zmm_reg"], ["zmm20", "xmm20", "ymm20"], x86_64_only),
    r("zmm21", ["zmm_reg"], ["zmm21", "xmm21", "ymm21"], x86_64_only),
    r("zmm22", ["zmm_reg"], ["zmm22", "xmm22", "ymm22"], x86_64_only),
    r("zmm23", ["zmm_reg"], ["zmm23", "xmm23", "ymm23"], x86_64_only),
    r("zmm24", ["zmm_reg"], ["zmm24", "xmm24", "ymm24"], x86_64_only),
    r("zmm25", ["zmm_reg"], ["zmm25", "xmm25", "ymm25"], x86_64_only),
    r("zmm26", ["zmm_reg"], ["zmm26", "xmm26", "ymm26"], x86_64_only),
    r("zmm27", ["zmm_reg"], ["zmm27", "xmm27", "ymm27"], x86_64_only),
    r("zmm28", ["zmm_reg"], ["zmm28", "xmm28", "ymm28"], x86_64_only),
    r("zmm29", ["zmm_reg"], ["zmm29", "xmm29", "ymm29"], x86_64_only),
    r("zmm30", ["zmm_reg"], ["zmm30", "xmm30", "ymm30"], x86_64_only),
    r("zmm31", ["zmm_reg"], ["zmm31", "xmm31", "ymm31"], x86_64_only),
    r("k0", ["kreg0"], ["k0"]),
    r("k1", ["kreg"], ["k1"]),
    r("k2", ["kreg"], ["k2"]),
    r("k3", ["kreg"], ["k3"]),
    r("k4", ["kreg"], ["k4"]),
    r("k5", ["kreg"], ["k5"]),
    r("k6", ["kreg"], ["k6"]),
    r("k7", ["kreg"], ["k7"]),
    r("mm0", ["mmx_reg"], ["mm0"]),
    r("mm1", ["mmx_reg"], ["mm1"]),
    r("mm2", ["mmx_reg"], ["mm2"]),
    r("mm3", ["mmx_reg"], ["mm3"]),
    r("mm4", ["mmx_reg"], ["mm4"]),
    r("mm5", ["mmx_reg"], ["mm5"]),
    r("mm6", ["mmx_reg"], ["mm6"]),
    r("mm7", ["mmx_reg"], ["mm7"]),
    r("st0", ["x87_reg"], ["st(0)", "st"]),
    r("st1", ["x87_reg"], ["st(1)"]),
    r("st2", ["x87_reg"], ["st(2)"]),
    r("st3", ["x87_reg"], ["st(3)"]),
    r("st4", ["x87_reg"], ["st(4)"]),
    r("st5", ["x87_reg"], ["st(5)"]),
    r("st6", ["x87_reg"], ["st(6)"]),
    r("st7", ["x87_reg"], ["st(7)"]),
    r("tmm0", ["tmm_reg"], ["tmm0"], x86_64_only),
    r("tmm1", ["tmm_reg"], ["tmm1"], x86_64_only),
    r("tmm2", ["tmm_reg"], ["tmm2"], x86_64_only),
    r("tmm3", ["tmm_reg"], ["tmm3"], x86_64_only),
    r("tmm4", ["tmm_reg"], ["tmm4"], x86_64_only),
    r("tmm5", ["tmm_reg"], ["tmm5"], x86_64_only),
    r("tmm6", ["tmm_reg"], ["tmm6"], x86_64_only),
    r("tmm7", ["tmm_reg"], ["tmm7"], x86_64_only),
  ],
  [
    [["bp", "bpl", "ebp", "rbp"], "the frame pointer cannot be used as an operand for inline asm"],
    [["sp", "spl", "esp", "rsp"], "the stack pointer cannot be used as an operand for inline asm"],
    [["ip", "eip", "rip"], "the instruction pointer cannot be used as an operand for inline asm"],
  ],
);

// pub(super) fn regclass_map() (def_reg_class!)
export function regclass_map(): RegClassMap {
  return X86InlineAsmRegClass_impl.regclass_map();
}

// pub(super) fn fill_reg_map(..) (def_regs!)
export const fill_reg_map = X86InlineAsmReg_impl.fill_reg_map;

/** `self as u32` */
const d = (reg: X86InlineAsmReg): number => X86InlineAsmReg_impl.discriminant(reg);

/** `reg_conflicts!` arms: `$w : $l $h`, `$w2 : $l2`, `$x : $y : $z`. */
const REG_CONFLICTS_W_L_H: readonly (readonly [X86InlineAsmReg, X86InlineAsmReg, X86InlineAsmReg])[] = [
  ["ax", "al", "ah"],
  ["bx", "bl", "bh"],
  ["cx", "cl", "ch"],
  ["dx", "dl", "dh"],
];
const REG_CONFLICTS_W2_L2: readonly (readonly [X86InlineAsmReg, X86InlineAsmReg])[] = [
  ["si", "sil"],
  ["di", "dil"],
  ["r8", "r8b"],
  ["r9", "r9b"],
  ["r10", "r10b"],
  ["r11", "r11b"],
  ["r12", "r12b"],
  ["r13", "r13b"],
  ["r14", "r14b"],
  ["r15", "r15b"],
];
const REG_CONFLICTS_X_Y_Z: readonly (readonly [X86InlineAsmReg, X86InlineAsmReg, X86InlineAsmReg])[] = [
  ["xmm0", "ymm0", "zmm0"],
  ["xmm1", "ymm1", "zmm1"],
  ["xmm2", "ymm2", "zmm2"],
  ["xmm3", "ymm3", "zmm3"],
  ["xmm4", "ymm4", "zmm4"],
  ["xmm5", "ymm5", "zmm5"],
  ["xmm6", "ymm6", "zmm6"],
  ["xmm7", "ymm7", "zmm7"],
  ["xmm8", "ymm8", "zmm8"],
  ["xmm9", "ymm9", "zmm9"],
  ["xmm10", "ymm10", "zmm10"],
  ["xmm11", "ymm11", "zmm11"],
  ["xmm12", "ymm12", "zmm12"],
  ["xmm13", "ymm13", "zmm13"],
  ["xmm14", "ymm14", "zmm14"],
  ["xmm15", "ymm15", "zmm15"],
];

export const X86InlineAsmReg = {
  ...X86InlineAsmReg_impl,

  // rustc: compiler/rustc_target/src/asm/x86.rs:363 emit
  emit(self: X86InlineAsmReg, out: FmtWrite, arch: InlineAsmArch, modifier: char | undefined): FmtResult {
    let reg_default_modifier: char;
    switch (arch) {
      case "X86":
        reg_default_modifier = ch("e");
        break;
      case "X86_64":
        reg_default_modifier = ch("r");
        break;
      default:
        return unreachable();
    }
    if (d(self) <= d("dx")) {
      const root = ["a", "b", "c", "d"][d(self) - d("ax")]!;
      switch (modifier ?? reg_default_modifier) {
        case ch("l"):
          return out.write_str(`${root}l`);
        case ch("h"):
          return out.write_str(`${root}h`);
        case ch("x"):
          return out.write_str(`${root}x`);
        case ch("e"):
          return out.write_str(`e${root}x`);
        case ch("r"):
          return out.write_str(`r${root}x`);
        default:
          return unreachable();
      }
    } else if (d(self) <= d("di")) {
      const root = X86InlineAsmReg_impl.name(self);
      switch (modifier ?? reg_default_modifier) {
        case ch("l"):
          return out.write_str(`${root}l`);
        case ch("x"):
          return out.write_str(`${root}`);
        case ch("e"):
          return out.write_str(`e${root}`);
        case ch("r"):
          return out.write_str(`r${root}`);
        default:
          return unreachable();
      }
    } else if (d(self) <= d("r15")) {
      const root = X86InlineAsmReg_impl.name(self);
      switch (modifier ?? reg_default_modifier) {
        case ch("l"):
          return out.write_str(`${root}b`);
        case ch("x"):
          return out.write_str(`${root}w`);
        case ch("e"):
          return out.write_str(`${root}d`);
        case ch("r"):
          return out.write_str(root);
        default:
          return unreachable();
      }
    } else if (d(self) <= d("r15b")) {
      return out.write_str(X86InlineAsmReg_impl.name(self));
    } else if (d(self) <= d("xmm15")) {
      const prefix = modifier ?? ch("x");
      const index = d(self) - d("xmm0");
      return out.write_str(`${String.fromCodePoint(prefix)}${index}`);
    } else if (d(self) <= d("ymm15")) {
      const prefix = modifier ?? ch("y");
      const index = d(self) - d("ymm0");
      return out.write_str(`${String.fromCodePoint(prefix)}${index}`);
    } else if (d(self) <= d("zmm31")) {
      const prefix = modifier ?? ch("z");
      const index = d(self) - d("zmm0");
      return out.write_str(`${String.fromCodePoint(prefix)}${index}`);
    } else {
      return out.write_str(X86InlineAsmReg_impl.name(self));
    }
  },

  // rustc: compiler/rustc_target/src/asm/x86.rs:421 overlapping_regs
  overlapping_regs(self: X86InlineAsmReg, cb: (r: X86InlineAsmReg) => void): void {
    // `reg_conflicts! { .. }` expands to one `match self` over these arms, then `r => cb(r)`.

    // XMM*, YMM* and ZMM* are all different views of the same register.
    //
    // See section 15.5 of the combined Intel® 64 and IA-32 Architectures
    // Software Developer’s Manual for more details.
    //
    // We don't need to specify conflicts for [x,y,z]mm[16-31] since these
    // registers are only available with AVX-512, so we just specify them
    // as aliases directly.
    for (const [w, l, h] of REG_CONFLICTS_W_L_H) {
      if (self === w) {
        cb(w);
        cb(l);
        cb(h);
        return;
      }
      if (self === l) {
        cb(w);
        cb(l);
        return;
      }
      if (self === h) {
        cb(w);
        cb(h);
        return;
      }
    }
    for (const [w2, l2] of REG_CONFLICTS_W2_L2) {
      if (self === w2 || self === l2) {
        cb(w2);
        cb(l2);
        return;
      }
    }
    for (const [x, y, z] of REG_CONFLICTS_X_Y_Z) {
      if (self === x || self === y || self === z) {
        cb(x);
        cb(y);
        cb(z);
        return;
      }
    }
    cb(self);
  },
} as const;
