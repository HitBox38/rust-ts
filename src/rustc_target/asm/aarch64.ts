// Port of compiler/rustc_target/src/asm/aarch64.rs.

import { sym, type Symbol } from "../../rustc_span/symbol.ts";
import { ch } from "../../std/char.ts";
import { assert } from "../../std/panic.ts";
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

// def_reg_class! { AArch64 AArch64InlineAsmRegClass { .. } }
export type AArch64InlineAsmRegClass = "reg" | "vreg" | "vreg_low16" | "preg" | "ffr";

const AArch64InlineAsmRegClass_impl = def_reg_class<AArch64InlineAsmRegClass>("AArch64", ["reg", "vreg", "vreg_low16", "preg", "ffr"]);

export const AArch64InlineAsmRegClass = {
  ...AArch64InlineAsmRegClass_impl,

  // rustc: compiler/rustc_target/src/asm/aarch64.rs:21 valid_modifiers
  valid_modifiers(self: AArch64InlineAsmRegClass, _arch: InlineAsmArch): readonly char[] {
    switch (self) {
      case "reg":
        return [ch("w"), ch("x")];
      case "vreg":
      case "vreg_low16":
        return [ch("b"), ch("h"), ch("s"), ch("d"), ch("q"), ch("v"), ch("z")];
      case "preg":
      case "ffr":
        return [];
    }
  },

  // rustc: compiler/rustc_target/src/asm/aarch64.rs:29 suggest_class
  suggest_class(self: AArch64InlineAsmRegClass, _arch: InlineAsmArch, _ty: InlineAsmType): AArch64InlineAsmRegClass | undefined {
    return undefined;
  },

  // rustc: compiler/rustc_target/src/asm/aarch64.rs:33 suggest_modifier
  suggest_modifier(self: AArch64InlineAsmRegClass, _arch: InlineAsmArch, ty: InlineAsmType): ModifierInfo | undefined {
    switch (self) {
      case "reg": {
        const size = InlineAsmType.size(ty);
        if (size.$ === "FixedBytes" && size._0 === 8) return undefined;
        return ModifierInfo.from([ch("w"), "w0", InlineAsmSize.FixedBytes(4)]);
      }
      case "vreg":
      case "vreg_low16": {
        const size = InlineAsmType.size(ty);
        if (size.$ === "FixedBytes") {
          switch (size._0) {
            case 1:
              return ModifierInfo.from([ch("b"), "b0", InlineAsmType.size(ty)]);
            case 2:
              return ModifierInfo.from([ch("h"), "h0", InlineAsmType.size(ty)]);
            case 4:
              return ModifierInfo.from([ch("s"), "s0", InlineAsmType.size(ty)]);
            case 8:
              return ModifierInfo.from([ch("d"), "d0", InlineAsmType.size(ty)]);
            case 16:
              return ModifierInfo.from([ch("q"), "q0", InlineAsmType.size(ty)]);
          }
        } else {
          return ModifierInfo.from([ch("z"), "z0", InlineAsmSize.Scalable]);
        }
        return undefined;
      }
      case "preg":
      case "ffr":
        return undefined;
    }
  },

  // rustc: compiler/rustc_target/src/asm/aarch64.rs:52 default_modifier
  default_modifier(self: AArch64InlineAsmRegClass, _arch: InlineAsmArch): ModifierInfo | undefined {
    switch (self) {
      case "reg":
        return ModifierInfo.from([ch("x"), "x0", InlineAsmSize.FixedBytes(8)]);
      case "vreg":
      case "vreg_low16": {
        return ModifierInfo.from([ch("v"), "v0", InlineAsmSize.FixedBytes(16)]);
      }
      case "preg":
      case "ffr":
        return undefined;
    }
  },

  // rustc: compiler/rustc_target/src/asm/aarch64.rs:62 supported_types
  supported_types(self: AArch64InlineAsmRegClass, _arch: InlineAsmArch, allow_experimental_reg: boolean): readonly SupportedType[] {
    const {
      I8, I16, I32, I64, F16, F32, F64, F128, VecI8, VecI16, VecI32, VecI64, VecF16, VecF32, VecF64,
      SveVecI8, SveVecI16, SveVecI32, SveVecI64, SveVecI128, SveVecF16, SveVecF32, SveVecF64, SveVecF128, SveVecBool,
    } = InlineAsmType;
    switch (self) {
      case "reg":
        return types([I8, I16, I32, I64, F16, F32, F64]);
      case "vreg":
      case "vreg_low16": {
        if (allow_experimental_reg) {
          return types(
            undefined,
            [
              sym.neon,
              [I8, I16, I32, I64, F16, F32, F64, F128,
                VecI8(8), VecI16(4), VecI32(2), VecI64(1), VecF16(4), VecF32(2), VecF64(1),
                VecI8(16), VecI16(8), VecI32(4), VecI64(2), VecF16(8), VecF32(4), VecF64(2)],
            ],
            [
              sym.sve,
              [SveVecI8, SveVecI16, SveVecI32, SveVecI64, SveVecI128, SveVecF16, SveVecF32,
                SveVecF64, SveVecI128, SveVecF128],
            ],
          );
        } else {
          return types(undefined, [
            sym.neon,
            [I8, I16, I32, I64, F16, F32, F64, F128,
              VecI8(8), VecI16(4), VecI32(2), VecI64(1), VecF16(4), VecF32(2), VecF64(1),
              VecI8(16), VecI16(8), VecI32(4), VecI64(2), VecF16(8), VecF32(4), VecF64(2)],
          ]);
        }
      }
      case "preg": {
        if (allow_experimental_reg) {
          return types(undefined, [sym.sve, [SveVecBool]]);
        } else {
          return [];
        }
      }
      case "ffr":
        return [];
    }
  },
} as const;

// pub(crate) fn target_reserves_x18
// rustc: compiler/rustc_target/src/asm/aarch64.rs:100 target_reserves_x18
export function target_reserves_x18(target: Target, target_features: ReadonlySet<Symbol>): boolean {
  // See isX18ReservedByDefault in LLVM for targets reserve x18 by default:
  // https://github.com/llvm/llvm-project/blob/llvmorg-19.1.0/llvm/lib/TargetParser/AArch64TargetParser.cpp#L102-L105
  // Note that +reserve-x18 is currently not set for the above targets.
  return (
    target.os.$ === "Android" ||
    target.os.$ === "Fuchsia" ||
    target.env.$ === "Ohos" ||
    target.is_like_darwin ||
    target.is_like_windows ||
    target_features.has(sym.reserve_x18)
  );
}

// rustc: compiler/rustc_target/src/asm/aarch64.rs:112 reserved_x18
function reserved_x18(
  _arch: InlineAsmArch,
  _reloc_model: RelocModel,
  target_features: ReadonlySet<Symbol>,
  target: Target,
  _is_clobber: boolean,
): Result<null, string> {
  if (target_reserves_x18(target, target_features)) {
    return Err("x18 is a reserved register on this target");
  } else {
    return Ok(null);
  }
}

// rustc: compiler/rustc_target/src/asm/aarch64.rs:126 restricted_for_arm64ec
function restricted_for_arm64ec(
  arch: InlineAsmArch,
  _reloc_model: RelocModel,
  _target_features: ReadonlySet<Symbol>,
  _target: Target,
  _is_clobber: boolean,
): Result<null, string> {
  if (arch === "Arm64EC") {
    return Err("x13, x14, x23, x24, x28, v16-v31, p*, ffr cannot be used for Arm64EC");
  } else {
    return Ok(null);
  }
}

// def_regs! { AArch64 AArch64InlineAsmReg AArch64InlineAsmRegClass { .. } }
export type AArch64InlineAsmReg =
  | "x0" | "x1" | "x2" | "x3" | "x4" | "x5" | "x6" | "x7" | "x8" | "x9"
  | "x10" | "x11" | "x12" | "x13" | "x14" | "x15" | "x16" | "x17" | "x18"
  | "x20" | "x21" | "x22" | "x23" | "x24" | "x25" | "x26" | "x27" | "x28" | "x30"
  | "v0" | "v1" | "v2" | "v3" | "v4" | "v5" | "v6" | "v7"
  | "v8" | "v9" | "v10" | "v11" | "v12" | "v13" | "v14" | "v15"
  | "v16" | "v17" | "v18" | "v19" | "v20" | "v21" | "v22" | "v23"
  | "v24" | "v25" | "v26" | "v27" | "v28" | "v29" | "v30" | "v31"
  | "p0" | "p1" | "p2" | "p3" | "p4" | "p5" | "p6" | "p7"
  | "p8" | "p9" | "p10" | "p11" | "p12" | "p13" | "p14" | "p15"
  | "ffr";

type C = AArch64InlineAsmRegClass;
const r = (
  reg: AArch64InlineAsmReg,
  classes: readonly [C, ...C[]],
  names: readonly [string, ...string[]],
  ...filters: RegFilter[]
): RegDef<AArch64InlineAsmReg, C> => ({ reg, classes, names, filters });

const AArch64InlineAsmReg_impl = def_regs<AArch64InlineAsmReg, C>(
  "AArch64",
  [
    r("x0", ["reg"], ["x0", "w0"]),
    r("x1", ["reg"], ["x1", "w1"]),
    r("x2", ["reg"], ["x2", "w2"]),
    r("x3", ["reg"], ["x3", "w3"]),
    r("x4", ["reg"], ["x4", "w4"]),
    r("x5", ["reg"], ["x5", "w5"]),
    r("x6", ["reg"], ["x6", "w6"]),
    r("x7", ["reg"], ["x7", "w7"]),
    r("x8", ["reg"], ["x8", "w8"]),
    r("x9", ["reg"], ["x9", "w9"]),
    r("x10", ["reg"], ["x10", "w10"]),
    r("x11", ["reg"], ["x11", "w11"]),
    r("x12", ["reg"], ["x12", "w12"]),
    r("x13", ["reg"], ["x13", "w13"], restricted_for_arm64ec),
    r("x14", ["reg"], ["x14", "w14"], restricted_for_arm64ec),
    r("x15", ["reg"], ["x15", "w15"]),
    r("x16", ["reg"], ["x16", "w16"]),
    r("x17", ["reg"], ["x17", "w17"]),
    r("x18", ["reg"], ["x18", "w18"], reserved_x18),
    r("x20", ["reg"], ["x20", "w20"]),
    r("x21", ["reg"], ["x21", "w21"]),
    r("x22", ["reg"], ["x22", "w22"]),
    r("x23", ["reg"], ["x23", "w23"], restricted_for_arm64ec),
    r("x24", ["reg"], ["x24", "w24"], restricted_for_arm64ec),
    r("x25", ["reg"], ["x25", "w25"]),
    r("x26", ["reg"], ["x26", "w26"]),
    r("x27", ["reg"], ["x27", "w27"]),
    r("x28", ["reg"], ["x28", "w28"], restricted_for_arm64ec),
    r("x30", ["reg"], ["x30", "w30", "lr", "wlr"]),
    r("v0", ["vreg", "vreg_low16"], ["v0", "b0", "h0", "s0", "d0", "q0", "z0"]),
    r("v1", ["vreg", "vreg_low16"], ["v1", "b1", "h1", "s1", "d1", "q1", "z1"]),
    r("v2", ["vreg", "vreg_low16"], ["v2", "b2", "h2", "s2", "d2", "q2", "z2"]),
    r("v3", ["vreg", "vreg_low16"], ["v3", "b3", "h3", "s3", "d3", "q3", "z3"]),
    r("v4", ["vreg", "vreg_low16"], ["v4", "b4", "h4", "s4", "d4", "q4", "z4"]),
    r("v5", ["vreg", "vreg_low16"], ["v5", "b5", "h5", "s5", "d5", "q5", "z5"]),
    r("v6", ["vreg", "vreg_low16"], ["v6", "b6", "h6", "s6", "d6", "q6", "z6"]),
    r("v7", ["vreg", "vreg_low16"], ["v7", "b7", "h7", "s7", "d7", "q7", "z7"]),
    r("v8", ["vreg", "vreg_low16"], ["v8", "b8", "h8", "s8", "d8", "q8", "z8"]),
    r("v9", ["vreg", "vreg_low16"], ["v9", "b9", "h9", "s9", "d9", "q9", "z9"]),
    r("v10", ["vreg", "vreg_low16"], ["v10", "b10", "h10", "s10", "d10", "q10", "z10"]),
    r("v11", ["vreg", "vreg_low16"], ["v11", "b11", "h11", "s11", "d11", "q11", "z11"]),
    r("v12", ["vreg", "vreg_low16"], ["v12", "b12", "h12", "s12", "d12", "q12", "z12"]),
    r("v13", ["vreg", "vreg_low16"], ["v13", "b13", "h13", "s13", "d13", "q13", "z13"]),
    r("v14", ["vreg", "vreg_low16"], ["v14", "b14", "h14", "s14", "d14", "q14", "z14"]),
    r("v15", ["vreg", "vreg_low16"], ["v15", "b15", "h15", "s15", "d15", "q15", "z15"]),
    r("v16", ["vreg"], ["v16", "b16", "h16", "s16", "d16", "q16", "z16"], restricted_for_arm64ec),
    r("v17", ["vreg"], ["v17", "b17", "h17", "s17", "d17", "q17", "z17"], restricted_for_arm64ec),
    r("v18", ["vreg"], ["v18", "b18", "h18", "s18", "d18", "q18", "z18"], restricted_for_arm64ec),
    r("v19", ["vreg"], ["v19", "b19", "h19", "s19", "d19", "q19", "z19"], restricted_for_arm64ec),
    r("v20", ["vreg"], ["v20", "b20", "h20", "s20", "d20", "q20", "z20"], restricted_for_arm64ec),
    r("v21", ["vreg"], ["v21", "b21", "h21", "s21", "d21", "q21", "z21"], restricted_for_arm64ec),
    r("v22", ["vreg"], ["v22", "b22", "h22", "s22", "d22", "q22", "z22"], restricted_for_arm64ec),
    r("v23", ["vreg"], ["v23", "b23", "h23", "s23", "d23", "q23", "z23"], restricted_for_arm64ec),
    r("v24", ["vreg"], ["v24", "b24", "h24", "s24", "d24", "q24", "z24"], restricted_for_arm64ec),
    r("v25", ["vreg"], ["v25", "b25", "h25", "s25", "d25", "q25", "z25"], restricted_for_arm64ec),
    r("v26", ["vreg"], ["v26", "b26", "h26", "s26", "d26", "q26", "z26"], restricted_for_arm64ec),
    r("v27", ["vreg"], ["v27", "b27", "h27", "s27", "d27", "q27", "z27"], restricted_for_arm64ec),
    r("v28", ["vreg"], ["v28", "b28", "h28", "s28", "d28", "q28", "z28"], restricted_for_arm64ec),
    r("v29", ["vreg"], ["v29", "b29", "h29", "s29", "d29", "q29", "z29"], restricted_for_arm64ec),
    r("v30", ["vreg"], ["v30", "b30", "h30", "s30", "d30", "q30", "z30"], restricted_for_arm64ec),
    r("v31", ["vreg"], ["v31", "b31", "h31", "s31", "d31", "q31", "z31"], restricted_for_arm64ec),
    r("p0", ["preg"], ["p0"], restricted_for_arm64ec),
    r("p1", ["preg"], ["p1"], restricted_for_arm64ec),
    r("p2", ["preg"], ["p2"], restricted_for_arm64ec),
    r("p3", ["preg"], ["p3"], restricted_for_arm64ec),
    r("p4", ["preg"], ["p4"], restricted_for_arm64ec),
    r("p5", ["preg"], ["p5"], restricted_for_arm64ec),
    r("p6", ["preg"], ["p6"], restricted_for_arm64ec),
    r("p7", ["preg"], ["p7"], restricted_for_arm64ec),
    r("p8", ["preg"], ["p8"], restricted_for_arm64ec),
    r("p9", ["preg"], ["p9"], restricted_for_arm64ec),
    r("p10", ["preg"], ["p10"], restricted_for_arm64ec),
    r("p11", ["preg"], ["p11"], restricted_for_arm64ec),
    r("p12", ["preg"], ["p12"], restricted_for_arm64ec),
    r("p13", ["preg"], ["p13"], restricted_for_arm64ec),
    r("p14", ["preg"], ["p14"], restricted_for_arm64ec),
    r("p15", ["preg"], ["p15"], restricted_for_arm64ec),
    r("ffr", ["ffr"], ["ffr"], restricted_for_arm64ec),
  ],
  [
    [["x19", "w19"], "x19 is used internally by LLVM and cannot be used as an operand for inline asm"],
    [["x29", "w29", "fp", "wfp"], "the frame pointer cannot be used as an operand for inline asm"],
    [["sp", "wsp"], "the stack pointer cannot be used as an operand for inline asm"],
    [["xzr", "wzr"], "the zero register cannot be used as an operand for inline asm"],
  ],
);

// pub(super) fn regclass_map() (def_reg_class!)
export function regclass_map(): RegClassMap {
  return AArch64InlineAsmRegClass_impl.regclass_map();
}

// pub(super) fn fill_reg_map(..) (def_regs!)
export const fill_reg_map = AArch64InlineAsmReg_impl.fill_reg_map;

/** `self as u32` */
const d = (reg: AArch64InlineAsmReg): number => AArch64InlineAsmReg_impl.discriminant(reg);

export const AArch64InlineAsmReg = {
  ...AArch64InlineAsmReg_impl,

  // rustc: compiler/rustc_target/src/asm/aarch64.rs:232 emit
  emit(self: AArch64InlineAsmReg, out: FmtWrite, _arch: InlineAsmArch, modifier: char | undefined): FmtResult {
    let prefix: char;
    let index: number;
    const reg_index = AArch64InlineAsmReg.reg_index(self);
    if (reg_index !== undefined) {
      [prefix, index] = [modifier ?? ch("x"), reg_index];
    } else {
      const vreg_index = AArch64InlineAsmReg.vreg_index(self);
      if (vreg_index !== undefined) {
        [prefix, index] = [modifier ?? ch("v"), vreg_index];
      } else {
        return out.write_str(AArch64InlineAsmReg_impl.name(self));
      }
    }
    assert(index < 32, "assertion failed: index < 32");
    return out.write_str(`${String.fromCodePoint(prefix)}${index}`);
  },

  /// If the register is an integer register then return its index.
  // rustc: compiler/rustc_target/src/asm/aarch64.rs:250 reg_index
  reg_index(self: AArch64InlineAsmReg): number | undefined {
    // Unlike `vreg_index`, we can't subtract `x0` to get the u32 because
    // `x19` and `x29` are missing and the integer constants for the
    // `x0`..`x30` enum variants don't all match the register number. E.g. the
    // integer constant for `x18` is 18, but the constant for `x20` is 19.
    switch (self) {
      case "x0":
        return 0;
      case "x1":
        return 1;
      case "x2":
        return 2;
      case "x3":
        return 3;
      case "x4":
        return 4;
      case "x5":
        return 5;
      case "x6":
        return 6;
      case "x7":
        return 7;
      case "x8":
        return 8;
      case "x9":
        return 9;
      case "x10":
        return 10;
      case "x11":
        return 11;
      case "x12":
        return 12;
      case "x13":
        return 13;
      case "x14":
        return 14;
      case "x15":
        return 15;
      case "x16":
        return 16;
      case "x17":
        return 17;
      case "x18":
        return 18;
      // x19 is reserved
      case "x20":
        return 20;
      case "x21":
        return 21;
      case "x22":
        return 22;
      case "x23":
        return 23;
      case "x24":
        return 24;
      case "x25":
        return 25;
      case "x26":
        return 26;
      case "x27":
        return 27;
      case "x28":
        return 28;
      // x29 is reserved
      case "x30":
        return 30;
      default:
        return undefined;
    }
  },

  /// If the register is a vector register then return its index.
  // rustc: compiler/rustc_target/src/asm/aarch64.rs:293 vreg_index
  vreg_index(self: AArch64InlineAsmReg): number | undefined {
    if (d(self) >= d("v0") && d(self) <= d("v31")) {
      return d(self) - d("v0");
    }
    return undefined;
  },
} as const;
