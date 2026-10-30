// Port of compiler/rustc_target/src/asm/mod.rs.
//
// PORT: representation choices (lane target-asm):
// - The per-architecture fieldless enums (`X86InlineAsmRegClass`, `X86InlineAsmReg`, ...) are
//   string-literal unions of the variant names, with a companion const that carries the macro-generated
//   impls (`def_reg_class!` / `def_regs!`, ported as the `def_reg_class` / `def_regs` helpers below, with
//   markers on the macro's fns) and the hand-written impls of the arch module. Their `ALL` array is the
//   declaration order, so `self as u32` is `ALL.indexOf(self)` (`discriminant`).
// - `InlineAsmReg` / `InlineAsmRegClass` / `InlineAsmRegOrRegClass` values are interned (frozen
//   singletons built by the companion consts' variant functions, e.g. `InlineAsmReg.X86(r)`), so `===`
//   is the derived `PartialEq` and they can key `Map`s / `Set`s, as rustc's `FxHashMap<InlineAsmReg, _>` do.
// - Only the modules of architectures rust-ts has targets for (x86, aarch64, wasm) are ported; the
//   others are stubs whose fns call `unported` (rust-ts cannot select their targets).
// - `fmt::Write` (`emit`) is `FmtWrite`: one `write_str` per `write!` (equivalent for `String`).

import { type KeyType, FxHashMap, type Layout } from "../../rust_ts/hash_map.ts";
import { Symbol, sym } from "../../rustc_span/symbol.ts";
import { type Debug, debug_char, debug_str, debug_tuple, debug_vec } from "../../std/fmt.ts";
import { panic, unported, unreachable } from "../../std/panic.ts";
import type { SpanDecoder, SpanEncoder } from "../../rustc_span/lib.ts";
import { type StableHashCtxt, type StableHasher, stable_hash_Discriminant } from "../../rustc_data_structures/stable_hash.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
import type { Arch, RelocModel, Target } from "../spec/mod.ts";

import * as aarch64 from "./aarch64.ts";
import * as amdgpu from "./amdgpu.ts";
import * as arm from "./arm.ts";
import * as avr from "./avr.ts";
import * as bpf from "./bpf.ts";
import * as csky from "./csky.ts";
import * as hexagon from "./hexagon.ts";
import * as loongarch from "./loongarch.ts";
import * as m68k from "./m68k.ts";
import * as mips from "./mips.ts";
import * as msp430 from "./msp430.ts";
import * as nvptx from "./nvptx.ts";
import * as powerpc from "./powerpc.ts";
import * as riscv from "./riscv.ts";
import * as s390x from "./s390x.ts";
import * as sparc from "./sparc.ts";
import * as spirv from "./spirv.ts";
import * as wasm from "./wasm.ts";
import * as x86 from "./x86.ts";
import * as xtensa from "./xtensa.ts";

import { AArch64InlineAsmReg, AArch64InlineAsmRegClass } from "./aarch64.ts";
import { AmdgpuInlineAsmReg, AmdgpuInlineAsmRegClass } from "./amdgpu.ts";
import { ArmInlineAsmReg, ArmInlineAsmRegClass } from "./arm.ts";
import { AvrInlineAsmReg, AvrInlineAsmRegClass } from "./avr.ts";
import { BpfInlineAsmReg, BpfInlineAsmRegClass } from "./bpf.ts";
import { CSKYInlineAsmReg, CSKYInlineAsmRegClass } from "./csky.ts";
import { HexagonInlineAsmReg, HexagonInlineAsmRegClass } from "./hexagon.ts";
import { LoongArchInlineAsmReg, LoongArchInlineAsmRegClass } from "./loongarch.ts";
import { M68kInlineAsmReg, M68kInlineAsmRegClass } from "./m68k.ts";
import { MipsInlineAsmReg, MipsInlineAsmRegClass } from "./mips.ts";
import { Msp430InlineAsmReg, Msp430InlineAsmRegClass } from "./msp430.ts";
import { NvptxInlineAsmReg, NvptxInlineAsmRegClass } from "./nvptx.ts";
import { PowerPCInlineAsmReg, PowerPCInlineAsmRegClass } from "./powerpc.ts";
import { RiscVInlineAsmReg, RiscVInlineAsmRegClass } from "./riscv.ts";
import { S390xInlineAsmReg, S390xInlineAsmRegClass } from "./s390x.ts";
import { SparcInlineAsmReg, SparcInlineAsmRegClass } from "./sparc.ts";
import { SpirVInlineAsmReg, SpirVInlineAsmRegClass } from "./spirv.ts";
import { WasmInlineAsmReg, WasmInlineAsmRegClass } from "./wasm.ts";
import { X86InlineAsmReg, X86InlineAsmRegClass } from "./x86.ts";
import { XtensaInlineAsmReg, XtensaInlineAsmRegClass } from "./xtensa.ts";

/** `char` (a Unicode scalar value). */
type char = number;

/** `fmt::Error` */
export type FmtError = { readonly $: "Error" };
/** `fmt::Result` */
export type FmtResult = Result<null, FmtError>;
/** `dyn fmt::Write` (only `write_str` is used). */
export interface FmtWrite {
  write_str(s: string): FmtResult;
}

export interface ModifierInfo {
  modifier: char;
  result: string;
  size: InlineAsmSize;
}

export const ModifierInfo = {
  // impl From<(char, &'static str, InlineAsmSize)> for ModifierInfo
  // rustc: compiler/rustc_target/src/asm/mod.rs:17 from
  from([modifier, result, size]: readonly [char, string, InlineAsmSize]): ModifierInfo {
    return { modifier, result, size };
  },
} as const;

// ---- `def_reg_class!` ----

/** The `InlineAsmRegClass` / `InlineAsmReg` variants that wrap an architecture's enums. */
export type InlineAsmArchVariant = Exclude<InlineAsmRegClass["$"], "Err">;

/** `$arch::regclass_map()` / `fill_reg_map(..)`'s map. */
export type RegClassMap = FxHashMap<InlineAsmRegClass, Set<InlineAsmReg>>;

/** The impls `def_reg_class!` generates for `$arch_regclass` (mod.rs:22). */
export interface DefRegClass<C extends string> {
  /** `$($class,)*` in declaration order (`self as isize`). */
  readonly ALL: readonly C[];
  name(self: C): Symbol;
  parse(name: Symbol): Result<C, readonly Symbol[]>;
  regclass_map(): RegClassMap;
  /** `#[derive(Decodable)]` (`__D: SpanDecoder`). */
  decode(__decoder: SpanDecoder): C;
  /** `#[derive(Encodable)]` (`__E: SpanEncoder`). */
  encode(self: C, __encoder: SpanEncoder): void;
  /** `#[derive(StableHash)]`. */
  stable_hash(self: C, __hcx: StableHashCtxt, __hasher: StableHasher): void;
}

/**
 * `def_reg_class! { $arch $arch_regclass { $($class,)* } }`
 * PORT: the macro is a helper building the generated impls from the class list (`rustc_span::sym::$class`
 * is looked up by name). A function declaration, so the arch modules can call it while this module is
 * still being evaluated.
 */
export function def_reg_class<C extends string>(arch: InlineAsmArchVariant, classes: readonly C[]): DefRegClass<C> {
  const sym_of = (c: C): Symbol => (sym as unknown as Record<string, Symbol>)[c]!;
  return {
    ALL: classes,

    // rustc: compiler/rustc_target/src/asm/mod.rs:35 name
    name(self: C): Symbol {
      return sym_of(self);
    },

    // rustc: compiler/rustc_target/src/asm/mod.rs:41 parse
    parse(name: Symbol): Result<C, readonly Symbol[]> {
      for (const c of classes) {
        if (name === sym_of(c)) return Ok(c);
      }
      return Err(classes.map(sym_of));
    },

    // pub(super) fn regclass_map()
    // rustc: compiler/rustc_target/src/asm/mod.rs:51 regclass_map
    regclass_map(): RegClassMap {
      const map: RegClassMap = FxHashMap.default(InlineAsmRegClass_key, LAYOUT_FxIndexSet_InlineAsmReg);
      for (const c of classes) {
        map.set(InlineAsmRegClass.of(arch, c), new Set());
      }
      return map;
    },

    // rustc-derive: compiler/rustc_target/src/asm/mod.rs:28 Decodable for $arch_regclass
    decode(__decoder: SpanDecoder): C {
      return decode_fieldless_enum(__decoder, `${arch}InlineAsmRegClass`, classes);
    },

    // rustc-derive: compiler/rustc_target/src/asm/mod.rs:28 Encodable for $arch_regclass
    encode(self: C, __encoder: SpanEncoder): void {
      encode_fieldless_enum(self, __encoder, `${arch}InlineAsmRegClass`, classes.indexOf(self), classes.length);
    },

    // rustc-derive: compiler/rustc_target/src/asm/mod.rs:28 StableHash for $arch_regclass
    stable_hash(self: C, __hcx: StableHashCtxt, __hasher: StableHasher): void {
      // `::std::mem::discriminant(self).stable_hash(__hcx, __hasher);` (no `#[repr]`: `isize`); no variant has fields
      const discriminant = classes.indexOf(self);
      if (discriminant < 0) panic(`${arch}InlineAsmRegClass: not a variant`);
      stable_hash_Discriminant(discriminant, __hcx, __hasher);
    },
  };
}

/**
 * The `#[derive(Decodable)]` body (rustc_macros serialize.rs `decodable_body`) of a fieldless enum whose variants are
 * `variants`, in declaration order (the arch enums of `def_reg_class!` / `def_regs!`).
 */
function decode_fieldless_enum<T>(__decoder: SpanDecoder, ty_name: string, variants: readonly T[]): T {
  if (variants.length === 0) return panic(`\`${ty_name}\` has no variants to decode`);
  if (variants.length === 1) return variants[0]!;
  const tag = variants.length < 255 ? __decoder.read_u8() : __decoder.read_usize();
  const v = variants[tag];
  if (v === undefined) {
    return panic(`invalid enum variant tag while decoding \`${ty_name}\`, expected 0..${variants.length}, actual ${tag}`);
  }
  return v;
}

/** `encodable_body` of a fieldless enum: nothing for one variant, else the variant index (`emit_u8` below 255 variants). */
function encode_fieldless_enum<T>(self: T, __encoder: SpanEncoder, ty_name: string, disc: number, len: number): void {
  if (disc < 0) panic(`${ty_name}: not a variant`);
  if (len === 1) return;
  if (len < 255) __encoder.emit_u8(disc);
  else __encoder.emit_usize(disc);
}

// ---- `def_regs!` ----

/** A register filter (`% $filter`): `fn(arch, reloc_model, target_features, target, is_clobber)`. */
export type RegFilter = (
  arch: InlineAsmArch,
  reloc_model: RelocModel,
  target_features: ReadonlySet<Symbol>,
  target: Target,
  is_clobber: boolean,
) => Result<null, string>;

/** One `$reg: $class $(, $extra_class)* = [$reg_name $(, $alias)*] $(% $filter)*,` line. */
export interface RegDef<R extends string, C extends string> {
  readonly reg: R;
  readonly classes: readonly [C, ...C[]];
  readonly names: readonly [string, ...string[]];
  readonly filters: readonly RegFilter[];
}

/** One `#error = [$($bad_reg),+] => $error,` line. */
export type RegError = readonly [bad_regs: readonly string[], error: string];

/** The impls `def_regs!` generates for `$arch_reg` (mod.rs:66). */
export interface DefRegs<R extends string, C extends string> {
  /** `$($reg,)*` in declaration order (`self as u32`). */
  readonly ALL: readonly R[];
  discriminant(self: R): number;
  name(self: R): string;
  reg_class(self: R): C;
  parse(name: string): Result<R, string>;
  validate(
    self: R,
    _arch: InlineAsmArch,
    _reloc_model: RelocModel,
    _target_features: ReadonlySet<Symbol>,
    _target: Target,
    _is_clobber: boolean,
  ): Result<null, string>;
  fill_reg_map(
    _arch: InlineAsmArch,
    _reloc_model: RelocModel,
    _target_features: ReadonlySet<Symbol>,
    _target: Target,
    _map: RegClassMap,
  ): void;
  /** `#[derive(Decodable)]` (`__D: SpanDecoder`). */
  decode(__decoder: SpanDecoder): R;
  /** `#[derive(Encodable)]` (`__E: SpanEncoder`). */
  encode(self: R, __encoder: SpanEncoder): void;
  /** `#[derive(StableHash)]`. */
  stable_hash(self: R, __hcx: StableHashCtxt, __hasher: StableHasher): void;
}

/**
 * `def_regs! { $arch $arch_reg $arch_regclass { $($reg: $class .. ,)* $(#error = [..] => $error,)* } }`
 * PORT: the macro is a helper building the generated impls from the register table (see `def_reg_class`).
 */
export function def_regs<R extends string, C extends string>(
  arch: InlineAsmArchVariant,
  regs: readonly RegDef<R, C>[],
  errors: readonly RegError[],
): DefRegs<R, C> {
  const ALL = regs.map((d) => d.reg);
  const by_reg = new Map(regs.map((d, i) => [d.reg, [d, i] as const]));
  const def = (self: R): RegDef<R, C> => by_reg.get(self)![0];
  return {
    ALL,
    discriminant(self: R): number {
      return by_reg.get(self)![1];
    },

    // rustc: compiler/rustc_target/src/asm/mod.rs:84 name
    name(self: R): string {
      return def(self).names[0];
    },

    // rustc: compiler/rustc_target/src/asm/mod.rs:90 reg_class
    reg_class(self: R): C {
      return def(self).classes[0];
    },

    // rustc: compiler/rustc_target/src/asm/mod.rs:96 parse
    parse(name: string): Result<R, string> {
      // `$($alias)|* | $reg_name => Ok(Self::$reg),`
      for (const d of regs) {
        if (d.names.includes(name)) return Ok(d.reg);
      }
      // `$($bad_reg)|* => Err($error),`
      for (const [bad_regs, error] of errors) {
        if (bad_regs.includes(name)) return Err(error);
      }
      return Err("unknown register");
    },

    // rustc: compiler/rustc_target/src/asm/mod.rs:108 validate
    validate(self, _arch, _reloc_model, _target_features, _target, _is_clobber): Result<null, string> {
      for (const filter of def(self).filters) {
        const r = filter(_arch, _reloc_model, _target_features, _target, _is_clobber);
        if (r.$ === "Err") return r;
      }
      return Ok(null);
    },

    // pub(super) fn fill_reg_map(..)
    // rustc: compiler/rustc_target/src/asm/mod.rs:132 fill_reg_map
    fill_reg_map(_arch, _reloc_model, _target_features, _target, _map): void {
      for (const d of regs) {
        if (d.filters.every((filter) => filter(_arch, _reloc_model, _target_features, _target, false).$ === "Ok")) {
          const [cls, ...extra_classes] = d.classes;
          const set = _map.get(InlineAsmRegClass.of(arch, cls));
          if (set !== undefined) {
            set.add(InlineAsmReg.of(arch, d.reg));
          }
          for (const extra_class of extra_classes) {
            const set = _map.get(InlineAsmRegClass.of(arch, extra_class));
            if (set !== undefined) {
              set.add(InlineAsmReg.of(arch, d.reg));
            }
          }
        }
      }
    },

    // rustc-derive: compiler/rustc_target/src/asm/mod.rs:77 Decodable for $arch_reg
    decode(__decoder: SpanDecoder): R {
      return decode_fieldless_enum(__decoder, `${arch}InlineAsmReg`, ALL);
    },

    // rustc-derive: compiler/rustc_target/src/asm/mod.rs:77 Encodable for $arch_reg
    encode(self: R, __encoder: SpanEncoder): void {
      encode_fieldless_enum(self, __encoder, `${arch}InlineAsmReg`, by_reg.get(self)?.[1] ?? -1, ALL.length);
    },

    // rustc-derive: compiler/rustc_target/src/asm/mod.rs:77 StableHash for $arch_reg
    stable_hash(self: R, __hcx: StableHashCtxt, __hasher: StableHasher): void {
      // `::std::mem::discriminant(self).stable_hash(__hcx, __hasher);` (no `#[repr]`: `isize`); no variant has fields
      stable_hash_Discriminant(by_reg.get(self)![1], __hcx, __hasher);
    },
  };
}

// ---- `types!` ----

/** The element of a `supported_types` slice: `(InlineAsmType, Option<Symbol>)`. */
export type SupportedType = readonly [InlineAsmType, Symbol | undefined];

/**
 * `types! { $(_ : $($ty),+;)? $($feature: $($ty2),+;)* }`
 * PORT: `types(untagged, [feature, tys], ..)`; `untagged` is the `_ :` list (`undefined` if absent).
 */
export function types(untagged: readonly InlineAsmType[] | undefined, ...featured: (readonly [Symbol, readonly InlineAsmType[]])[]): readonly SupportedType[] {
  const out: SupportedType[] = [];
  for (const ty of untagged ?? []) out.push([ty, undefined]);
  for (const [feature, tys] of featured) {
    for (const ty of tys) out.push([ty, feature]);
  }
  return out;
}

// ---- arch module stubs ----

/** The impls of an arch module's register class enum that are not ported (stub modules). */
export interface StubRegClass<C> {
  name(self: C): Symbol;
  parse(name: Symbol): Result<C, readonly Symbol[]>;
  valid_modifiers(self: C, arch: InlineAsmArch): readonly char[];
  suggest_class(self: C, arch: InlineAsmArch, ty: InlineAsmType): C | undefined;
  suggest_modifier(self: C, arch: InlineAsmArch, ty: InlineAsmType): ModifierInfo | undefined;
  default_modifier(self: C, arch: InlineAsmArch): ModifierInfo | undefined;
  supported_types(self: C, arch: InlineAsmArch, allow_experimental_reg?: boolean): readonly SupportedType[];
  decode(__decoder: SpanDecoder): C;
  /** `#[derive(Encodable)]` (`__E: SpanEncoder`). */
  encode(self: C, __encoder: SpanEncoder): void;
  stable_hash(self: C, __hcx: StableHashCtxt, __hasher: StableHasher): void;
}

/** The impls of an arch module's register enum that are not ported (stub modules). */
export interface StubReg<R, C> {
  name(self: R): string;
  reg_class(self: R): C;
  parse(name: string): Result<R, string>;
  validate(
    self: R,
    arch: InlineAsmArch,
    reloc_model: RelocModel,
    target_features: ReadonlySet<Symbol>,
    target: Target,
    is_clobber: boolean,
  ): Result<null, string>;
  emit(self: R, out: FmtWrite, arch: InlineAsmArch, modifier: char | undefined): FmtResult;
  overlapping_regs(self: R, cb: (r: R) => void): void;
  decode(__decoder: SpanDecoder): R;
  /** `#[derive(Encodable)]` (`__E: SpanEncoder`). */
  encode(self: R, __encoder: SpanEncoder): void;
  stable_hash(self: R, __hcx: StableHashCtxt, __hasher: StableHasher): void;
}

/** PORT: stub for an arch module rust-ts has no target for: every fn of `$Type` calls `unported`. */
export function stub_impls<T extends object>(module: string, type: string): T {
  return new Proxy({} as T, {
    get(_t, p) {
      return () => unported(`rustc_target::asm::${module}::${type}::${String(p)}`);
    },
  });
}

/** PORT: stub for a free fn of an arch module rust-ts has no target for. */
export function stub_fn(module: string, name: string): () => never {
  return () => unported(`rustc_target::asm::${module}::${name}`);
}

// mod aarch64; .. mod xtensa;  (imported above)

export { AArch64InlineAsmReg, AArch64InlineAsmRegClass } from "./aarch64.ts";
export { AmdgpuInlineAsmReg, AmdgpuInlineAsmRegClass } from "./amdgpu.ts";
export { ArmInlineAsmReg, ArmInlineAsmRegClass } from "./arm.ts";
export { AvrInlineAsmReg, AvrInlineAsmRegClass } from "./avr.ts";
export { BpfInlineAsmReg, BpfInlineAsmRegClass } from "./bpf.ts";
export { CSKYInlineAsmReg, CSKYInlineAsmRegClass } from "./csky.ts";
export { HexagonInlineAsmReg, HexagonInlineAsmRegClass } from "./hexagon.ts";
export { LoongArchInlineAsmReg, LoongArchInlineAsmRegClass } from "./loongarch.ts";
export { M68kInlineAsmReg, M68kInlineAsmRegClass } from "./m68k.ts";
export { MipsInlineAsmReg, MipsInlineAsmRegClass } from "./mips.ts";
export { Msp430InlineAsmReg, Msp430InlineAsmRegClass } from "./msp430.ts";
export { NvptxInlineAsmReg, NvptxInlineAsmRegClass } from "./nvptx.ts";
export { PowerPCInlineAsmReg, PowerPCInlineAsmRegClass } from "./powerpc.ts";
export { RiscVInlineAsmReg, RiscVInlineAsmRegClass } from "./riscv.ts";
export { S390xInlineAsmReg, S390xInlineAsmRegClass } from "./s390x.ts";
export { SparcInlineAsmReg, SparcInlineAsmRegClass } from "./sparc.ts";
export { SpirVInlineAsmReg, SpirVInlineAsmRegClass } from "./spirv.ts";
export { WasmInlineAsmReg, WasmInlineAsmRegClass } from "./wasm.ts";
export { X86InlineAsmReg, X86InlineAsmRegClass } from "./x86.ts";
export { XtensaInlineAsmReg, XtensaInlineAsmRegClass } from "./xtensa.ts";

// #[derive(Copy, Clone, Encodable, Decodable, Debug, Eq, PartialEq, Hash)]
export type InlineAsmArch =
  | "X86"
  | "X86_64"
  | "Arm"
  | "AArch64"
  | "Arm64EC"
  | "RiscV32"
  | "RiscV64"
  | "Nvptx64"
  | "Amdgpu"
  | "Hexagon"
  | "LoongArch32"
  | "LoongArch64"
  | "Mips"
  | "Mips64"
  | "PowerPC"
  | "PowerPC64"
  | "S390x"
  | "Sparc"
  | "Sparc64"
  | "SpirV"
  | "Wasm32"
  | "Wasm64"
  | "Xtensa"
  | "Bpf"
  | "Avr"
  | "Msp430"
  | "M68k"
  | "CSKY";

export const InlineAsmArch = {
  X86: "X86",
  X86_64: "X86_64",
  Arm: "Arm",
  AArch64: "AArch64",
  Arm64EC: "Arm64EC",
  RiscV32: "RiscV32",
  RiscV64: "RiscV64",
  Nvptx64: "Nvptx64",
  Amdgpu: "Amdgpu",
  Hexagon: "Hexagon",
  LoongArch32: "LoongArch32",
  LoongArch64: "LoongArch64",
  Mips: "Mips",
  Mips64: "Mips64",
  PowerPC: "PowerPC",
  PowerPC64: "PowerPC64",
  S390x: "S390x",
  Sparc: "Sparc",
  Sparc64: "Sparc64",
  SpirV: "SpirV",
  Wasm32: "Wasm32",
  Wasm64: "Wasm64",
  Xtensa: "Xtensa",
  Bpf: "Bpf",
  Avr: "Avr",
  Msp430: "Msp430",
  M68k: "M68k",
  CSKY: "CSKY",

  // rustc: compiler/rustc_target/src/asm/mod.rs:254 from_arch
  from_arch(arch: Arch): InlineAsmArch | undefined {
    switch (arch.$) {
      case "X86":
        return "X86";
      case "X86_64":
        return "X86_64";
      case "Arm":
        return "Arm";
      case "Arm64EC":
        return "Arm64EC";
      case "AArch64":
        return "AArch64";
      case "AmdGpu":
        return "Amdgpu";
      case "RiscV32":
        return "RiscV32";
      case "RiscV64":
        return "RiscV64";
      case "Nvptx64":
        return "Nvptx64";
      case "Hexagon":
        return "Hexagon";
      case "LoongArch32":
        return "LoongArch32";
      case "LoongArch64":
        return "LoongArch64";
      case "Mips":
      case "Mips32r6":
        return "Mips";
      case "Mips64":
      case "Mips64r6":
        return "Mips64";
      case "PowerPC":
        return "PowerPC";
      case "PowerPC64":
        return "PowerPC64";
      case "S390x":
        return "S390x";
      case "Sparc":
        return "Sparc";
      case "Sparc64":
        return "Sparc64";
      case "SpirV":
        return "SpirV";
      case "Wasm32":
        return "Wasm32";
      case "Wasm64":
        return "Wasm64";
      case "Bpf":
        return "Bpf";
      case "Avr":
        return "Avr";
      case "Msp430":
        return "Msp430";
      case "M68k":
        return "M68k";
      case "CSky":
        return "CSKY";
      case "Xtensa":
        return "Xtensa";
      case "Other":
        return undefined;
    }
  },
} as const;

/** `#[derive(Debug)]` of `InlineAsmArch` */
export const debug_InlineAsmArch: Debug<InlineAsmArch> = (v) => v;

// #[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Hash)]
// #[derive(StableHash, Encodable, Decodable)]
export type InlineAsmReg =
  | { readonly $: "X86"; readonly _0: X86InlineAsmReg }
  | { readonly $: "Arm"; readonly _0: ArmInlineAsmReg }
  | { readonly $: "Amdgpu"; readonly _0: AmdgpuInlineAsmReg }
  | { readonly $: "AArch64"; readonly _0: AArch64InlineAsmReg }
  | { readonly $: "RiscV"; readonly _0: RiscVInlineAsmReg }
  | { readonly $: "Nvptx"; readonly _0: NvptxInlineAsmReg }
  | { readonly $: "PowerPC"; readonly _0: PowerPCInlineAsmReg }
  | { readonly $: "Hexagon"; readonly _0: HexagonInlineAsmReg }
  | { readonly $: "LoongArch"; readonly _0: LoongArchInlineAsmReg }
  | { readonly $: "Mips"; readonly _0: MipsInlineAsmReg }
  | { readonly $: "S390x"; readonly _0: S390xInlineAsmReg }
  | { readonly $: "Sparc"; readonly _0: SparcInlineAsmReg }
  | { readonly $: "SpirV"; readonly _0: SpirVInlineAsmReg }
  | { readonly $: "Wasm"; readonly _0: WasmInlineAsmReg }
  | { readonly $: "Xtensa"; readonly _0: XtensaInlineAsmReg }
  | { readonly $: "Bpf"; readonly _0: BpfInlineAsmReg }
  | { readonly $: "Avr"; readonly _0: AvrInlineAsmReg }
  | { readonly $: "Msp430"; readonly _0: Msp430InlineAsmReg }
  | { readonly $: "M68k"; readonly _0: M68kInlineAsmReg }
  | { readonly $: "CSKY"; readonly _0: CSKYInlineAsmReg }
  // Placeholder for invalid register constraints for the current target
  | { readonly $: "Err" };

type RegOf<A extends InlineAsmReg["$"]> = Extract<InlineAsmReg, { $: A }>;

/** PORT: interned `InlineAsmReg` values (see the header). */
const reg_interner = new Map<string, InlineAsmReg>();
function intern_reg<A extends InlineAsmArchVariant>(arch: A, r: RegOf<A>["_0"]): RegOf<A> {
  const key = `${arch}::${r as string}`;
  let v = reg_interner.get(key);
  if (v === undefined) {
    v = Object.freeze({ $: arch, _0: r }) as InlineAsmReg;
    reg_interner.set(key, v);
  }
  return v as RegOf<A>;
}

export const InlineAsmReg = {
  X86: (r: X86InlineAsmReg) => intern_reg("X86", r),
  Arm: (r: ArmInlineAsmReg) => intern_reg("Arm", r),
  Amdgpu: (r: AmdgpuInlineAsmReg) => intern_reg("Amdgpu", r),
  AArch64: (r: AArch64InlineAsmReg) => intern_reg("AArch64", r),
  RiscV: (r: RiscVInlineAsmReg) => intern_reg("RiscV", r),
  Nvptx: (r: NvptxInlineAsmReg) => intern_reg("Nvptx", r),
  PowerPC: (r: PowerPCInlineAsmReg) => intern_reg("PowerPC", r),
  Hexagon: (r: HexagonInlineAsmReg) => intern_reg("Hexagon", r),
  LoongArch: (r: LoongArchInlineAsmReg) => intern_reg("LoongArch", r),
  Mips: (r: MipsInlineAsmReg) => intern_reg("Mips", r),
  S390x: (r: S390xInlineAsmReg) => intern_reg("S390x", r),
  Sparc: (r: SparcInlineAsmReg) => intern_reg("Sparc", r),
  SpirV: (r: SpirVInlineAsmReg) => intern_reg("SpirV", r),
  Wasm: (r: WasmInlineAsmReg) => intern_reg("Wasm", r),
  Xtensa: (r: XtensaInlineAsmReg) => intern_reg("Xtensa", r),
  Bpf: (r: BpfInlineAsmReg) => intern_reg("Bpf", r),
  Avr: (r: AvrInlineAsmReg) => intern_reg("Avr", r),
  Msp430: (r: Msp430InlineAsmReg) => intern_reg("Msp430", r),
  M68k: (r: M68kInlineAsmReg) => intern_reg("M68k", r),
  CSKY: (r: CSKYInlineAsmReg) => intern_reg("CSKY", r),
  Err: Object.freeze({ $: "Err" }) as InlineAsmReg,

  /** `InlineAsmReg::$arch(r)` for a macro-generated arch name (`def_regs!`). */
  of(arch: InlineAsmArchVariant, r: string): InlineAsmReg {
    return intern_reg(arch, r as never);
  },

  // rustc: compiler/rustc_target/src/asm/mod.rs:317 name
  name(self: InlineAsmReg): string {
    switch (self.$) {
      case "X86":
        return X86InlineAsmReg.name(self._0);
      case "Arm":
        return ArmInlineAsmReg.name(self._0);
      case "AArch64":
        return AArch64InlineAsmReg.name(self._0);
      case "Amdgpu":
        return AmdgpuInlineAsmReg.name(self._0);
      case "RiscV":
        return RiscVInlineAsmReg.name(self._0);
      case "PowerPC":
        return PowerPCInlineAsmReg.name(self._0);
      case "Hexagon":
        return HexagonInlineAsmReg.name(self._0);
      case "LoongArch":
        return LoongArchInlineAsmReg.name(self._0);
      case "Mips":
        return MipsInlineAsmReg.name(self._0);
      case "S390x":
        return S390xInlineAsmReg.name(self._0);
      case "Sparc":
        return SparcInlineAsmReg.name(self._0);
      case "Xtensa":
        return XtensaInlineAsmReg.name(self._0);
      case "Bpf":
        return BpfInlineAsmReg.name(self._0);
      case "Avr":
        return AvrInlineAsmReg.name(self._0);
      case "Msp430":
        return Msp430InlineAsmReg.name(self._0);
      case "M68k":
        return M68kInlineAsmReg.name(self._0);
      case "CSKY":
        return CSKYInlineAsmReg.name(self._0);
      case "Err":
        return "<reg>";
      // PORT: `Nvptx`/`SpirV`/`Wasm` registers are uninhabited (empty `def_regs!`), so upstream has no arm.
      case "Nvptx":
      case "SpirV":
      case "Wasm":
        return unreachable();
    }
  },

  // rustc: compiler/rustc_target/src/asm/mod.rs:340 reg_class
  reg_class(self: InlineAsmReg): InlineAsmRegClass {
    switch (self.$) {
      case "X86":
        return InlineAsmRegClass.X86(X86InlineAsmReg.reg_class(self._0));
      case "Arm":
        return InlineAsmRegClass.Arm(ArmInlineAsmReg.reg_class(self._0));
      case "AArch64":
        return InlineAsmRegClass.AArch64(AArch64InlineAsmReg.reg_class(self._0));
      case "Amdgpu":
        return InlineAsmRegClass.Amdgpu(AmdgpuInlineAsmReg.reg_class(self._0));
      case "RiscV":
        return InlineAsmRegClass.RiscV(RiscVInlineAsmReg.reg_class(self._0));
      case "PowerPC":
        return InlineAsmRegClass.PowerPC(PowerPCInlineAsmReg.reg_class(self._0));
      case "Hexagon":
        return InlineAsmRegClass.Hexagon(HexagonInlineAsmReg.reg_class(self._0));
      case "LoongArch":
        return InlineAsmRegClass.LoongArch(LoongArchInlineAsmReg.reg_class(self._0));
      case "Mips":
        return InlineAsmRegClass.Mips(MipsInlineAsmReg.reg_class(self._0));
      case "S390x":
        return InlineAsmRegClass.S390x(S390xInlineAsmReg.reg_class(self._0));
      case "Sparc":
        return InlineAsmRegClass.Sparc(SparcInlineAsmReg.reg_class(self._0));
      case "Xtensa":
        return InlineAsmRegClass.Xtensa(XtensaInlineAsmReg.reg_class(self._0));
      case "Bpf":
        return InlineAsmRegClass.Bpf(BpfInlineAsmReg.reg_class(self._0));
      case "Avr":
        return InlineAsmRegClass.Avr(AvrInlineAsmReg.reg_class(self._0));
      case "Msp430":
        return InlineAsmRegClass.Msp430(Msp430InlineAsmReg.reg_class(self._0));
      case "M68k":
        return InlineAsmRegClass.M68k(M68kInlineAsmReg.reg_class(self._0));
      case "CSKY":
        return InlineAsmRegClass.CSKY(CSKYInlineAsmReg.reg_class(self._0));
      case "Err":
        return InlineAsmRegClass.Err;
      // PORT: uninhabited (see `name`).
      case "Nvptx":
      case "SpirV":
      case "Wasm":
        return unreachable();
    }
  },

  // rustc: compiler/rustc_target/src/asm/mod.rs:363 parse
  parse(arch: InlineAsmArch, name_: Symbol): Result<InlineAsmReg, string> {
    // FIXME: use direct symbol comparison for register names
    // Use `Symbol::as_str` instead of `Symbol::with` here because `has_feature` may access `Symbol`.
    const name = Symbol.as_str(name_);
    const wrap = <R>(r: Result<R, string>, f: (r: R) => InlineAsmReg): Result<InlineAsmReg, string> =>
      r.$ === "Err" ? r : Ok(f(r._0));
    switch (arch) {
      case "X86":
      case "X86_64":
        return wrap(X86InlineAsmReg.parse(name), InlineAsmReg.X86);
      case "Arm":
        return wrap(ArmInlineAsmReg.parse(name), InlineAsmReg.Arm);
      case "AArch64":
      case "Arm64EC":
        return wrap(AArch64InlineAsmReg.parse(name), InlineAsmReg.AArch64);
      case "Amdgpu":
        return wrap(AmdgpuInlineAsmReg.parse(name), InlineAsmReg.Amdgpu);
      case "RiscV32":
      case "RiscV64":
        return wrap(RiscVInlineAsmReg.parse(name), InlineAsmReg.RiscV);
      case "Nvptx64":
        return wrap(NvptxInlineAsmReg.parse(name), InlineAsmReg.Nvptx);
      case "PowerPC":
      case "PowerPC64":
        return wrap(PowerPCInlineAsmReg.parse(name), InlineAsmReg.PowerPC);
      case "Hexagon":
        return wrap(HexagonInlineAsmReg.parse(name), InlineAsmReg.Hexagon);
      case "LoongArch32":
      case "LoongArch64":
        return wrap(LoongArchInlineAsmReg.parse(name), InlineAsmReg.LoongArch);
      case "Mips":
      case "Mips64":
        return wrap(MipsInlineAsmReg.parse(name), InlineAsmReg.Mips);
      case "Xtensa":
        return wrap(XtensaInlineAsmReg.parse(name), InlineAsmReg.Xtensa);
      case "S390x":
        return wrap(S390xInlineAsmReg.parse(name), InlineAsmReg.S390x);
      case "Sparc":
      case "Sparc64":
        return wrap(SparcInlineAsmReg.parse(name), InlineAsmReg.Sparc);
      case "SpirV":
        return wrap(SpirVInlineAsmReg.parse(name), InlineAsmReg.SpirV);
      case "Wasm32":
      case "Wasm64":
        return wrap(WasmInlineAsmReg.parse(name), InlineAsmReg.Wasm);
      case "Bpf":
        return wrap(BpfInlineAsmReg.parse(name), InlineAsmReg.Bpf);
      case "Avr":
        return wrap(AvrInlineAsmReg.parse(name), InlineAsmReg.Avr);
      case "Msp430":
        return wrap(Msp430InlineAsmReg.parse(name), InlineAsmReg.Msp430);
      case "M68k":
        return wrap(M68kInlineAsmReg.parse(name), InlineAsmReg.M68k);
      case "CSKY":
        return wrap(CSKYInlineAsmReg.parse(name), InlineAsmReg.CSKY);
    }
  },

  // rustc: compiler/rustc_target/src/asm/mod.rs:405 validate
  validate(
    self: InlineAsmReg,
    arch: InlineAsmArch,
    reloc_model: RelocModel,
    target_features: ReadonlySet<Symbol>,
    target: Target,
    is_clobber: boolean,
  ): Result<null, string> {
    switch (self.$) {
      case "X86":
        return X86InlineAsmReg.validate(self._0, arch, reloc_model, target_features, target, is_clobber);
      case "Arm":
        return ArmInlineAsmReg.validate(self._0, arch, reloc_model, target_features, target, is_clobber);
      case "AArch64":
        return AArch64InlineAsmReg.validate(self._0, arch, reloc_model, target_features, target, is_clobber);
      case "Amdgpu":
        return AmdgpuInlineAsmReg.validate(self._0, arch, reloc_model, target_features, target, is_clobber);
      case "RiscV":
        return RiscVInlineAsmReg.validate(self._0, arch, reloc_model, target_features, target, is_clobber);
      case "PowerPC":
        return PowerPCInlineAsmReg.validate(self._0, arch, reloc_model, target_features, target, is_clobber);
      case "Hexagon":
        return HexagonInlineAsmReg.validate(self._0, arch, reloc_model, target_features, target, is_clobber);
      case "LoongArch": {
        return LoongArchInlineAsmReg.validate(self._0, arch, reloc_model, target_features, target, is_clobber);
      }
      case "Mips":
        return MipsInlineAsmReg.validate(self._0, arch, reloc_model, target_features, target, is_clobber);
      case "S390x":
        return S390xInlineAsmReg.validate(self._0, arch, reloc_model, target_features, target, is_clobber);
      case "Sparc":
        return SparcInlineAsmReg.validate(self._0, arch, reloc_model, target_features, target, is_clobber);
      case "Bpf":
        return BpfInlineAsmReg.validate(self._0, arch, reloc_model, target_features, target, is_clobber);
      case "Avr":
        return AvrInlineAsmReg.validate(self._0, arch, reloc_model, target_features, target, is_clobber);
      case "Xtensa":
        return XtensaInlineAsmReg.validate(self._0, arch, reloc_model, target_features, target, is_clobber);
      case "Msp430":
        return Msp430InlineAsmReg.validate(self._0, arch, reloc_model, target_features, target, is_clobber);
      case "M68k":
        return M68kInlineAsmReg.validate(self._0, arch, reloc_model, target_features, target, is_clobber);
      case "CSKY":
        return CSKYInlineAsmReg.validate(self._0, arch, reloc_model, target_features, target, is_clobber);
      case "Err":
        return unreachable();
      // PORT: uninhabited (see `name`).
      case "Nvptx":
      case "SpirV":
      case "Wasm":
        return unreachable();
    }
  },

  // NOTE: This function isn't used at the moment, but is needed to support
  // falling back to an external assembler.
  // rustc: compiler/rustc_target/src/asm/mod.rs:439 emit
  emit(self: InlineAsmReg, out: FmtWrite, arch: InlineAsmArch, modifier: char | undefined): FmtResult {
    switch (self.$) {
      case "X86":
        return X86InlineAsmReg.emit(self._0, out, arch, modifier);
      case "Arm":
        return ArmInlineAsmReg.emit(self._0, out, arch, modifier);
      case "AArch64":
        return AArch64InlineAsmReg.emit(self._0, out, arch, modifier);
      case "Amdgpu":
        return AmdgpuInlineAsmReg.emit(self._0, out, arch, modifier);
      case "RiscV":
        return RiscVInlineAsmReg.emit(self._0, out, arch, modifier);
      case "PowerPC":
        return PowerPCInlineAsmReg.emit(self._0, out, arch, modifier);
      case "Hexagon":
        return HexagonInlineAsmReg.emit(self._0, out, arch, modifier);
      case "LoongArch":
        return LoongArchInlineAsmReg.emit(self._0, out, arch, modifier);
      case "Mips":
        return MipsInlineAsmReg.emit(self._0, out, arch, modifier);
      case "S390x":
        return S390xInlineAsmReg.emit(self._0, out, arch, modifier);
      case "Sparc":
        return SparcInlineAsmReg.emit(self._0, out, arch, modifier);
      case "Xtensa":
        return XtensaInlineAsmReg.emit(self._0, out, arch, modifier);
      case "Bpf":
        return BpfInlineAsmReg.emit(self._0, out, arch, modifier);
      case "Avr":
        return AvrInlineAsmReg.emit(self._0, out, arch, modifier);
      case "Msp430":
        return Msp430InlineAsmReg.emit(self._0, out, arch, modifier);
      case "M68k":
        return M68kInlineAsmReg.emit(self._0, out, arch, modifier);
      case "CSKY":
        return CSKYInlineAsmReg.emit(self._0, out, arch, modifier);
      case "Err":
        return unreachable("Use of InlineAsmReg::Err");
      // PORT: uninhabited (see `name`).
      case "Nvptx":
      case "SpirV":
      case "Wasm":
        return unreachable();
    }
  },

  // rustc: compiler/rustc_target/src/asm/mod.rs:467 overlapping_regs
  overlapping_regs(self: InlineAsmReg, cb: (r: InlineAsmReg) => void): void {
    switch (self.$) {
      case "X86":
        return X86InlineAsmReg.overlapping_regs(self._0, (r) => cb(InlineAsmReg.X86(r)));
      case "Arm":
        return ArmInlineAsmReg.overlapping_regs(self._0, (r) => cb(InlineAsmReg.Arm(r)));
      case "AArch64":
        return cb(self);
      case "Amdgpu":
        return AmdgpuInlineAsmReg.overlapping_regs(self._0, (r) => cb(InlineAsmReg.Amdgpu(r)));
      case "RiscV":
        return cb(self);
      case "PowerPC":
        return PowerPCInlineAsmReg.overlapping_regs(self._0, (r) => cb(InlineAsmReg.PowerPC(r)));
      case "Hexagon":
        return HexagonInlineAsmReg.overlapping_regs(self._0, (r) => cb(InlineAsmReg.Hexagon(r)));
      case "LoongArch":
        return LoongArchInlineAsmReg.overlapping_regs(self._0, (r) => cb(InlineAsmReg.LoongArch(r)));
      case "Mips":
        return MipsInlineAsmReg.overlapping_regs(self._0, (r) => cb(InlineAsmReg.Mips(r)));
      case "S390x":
        return S390xInlineAsmReg.overlapping_regs(self._0, (r) => cb(InlineAsmReg.S390x(r)));
      case "Sparc":
        return SparcInlineAsmReg.overlapping_regs(self._0, (r) => cb(InlineAsmReg.Sparc(r)));
      case "Xtensa":
        return cb(self);
      case "Bpf":
        return BpfInlineAsmReg.overlapping_regs(self._0, (r) => cb(InlineAsmReg.Bpf(r)));
      case "Avr":
        return AvrInlineAsmReg.overlapping_regs(self._0, (r) => cb(InlineAsmReg.Avr(r)));
      case "Msp430":
        return cb(self);
      case "M68k":
        return cb(self);
      case "CSKY":
        return cb(self);
      case "Err":
        return unreachable("Use of InlineAsmReg::Err");
      // PORT: uninhabited (see `name`).
      case "Nvptx":
      case "SpirV":
      case "Wasm":
        return unreachable();
    }
  },
} as const;

/** `#[derive(Debug)]` of `InlineAsmReg` (the arch enums' Debug is the variant name). */
export const debug_InlineAsmReg: Debug<InlineAsmReg> = (v, f) =>
  v.$ === "Err" ? "Err" : debug_tuple(f, v.$, [v._0 as string]);

// #[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Hash)]
// #[derive(StableHash, Encodable, Decodable)]
export type InlineAsmRegClass =
  | { readonly $: "X86"; readonly _0: X86InlineAsmRegClass }
  | { readonly $: "Arm"; readonly _0: ArmInlineAsmRegClass }
  | { readonly $: "AArch64"; readonly _0: AArch64InlineAsmRegClass }
  | { readonly $: "Amdgpu"; readonly _0: AmdgpuInlineAsmRegClass }
  | { readonly $: "RiscV"; readonly _0: RiscVInlineAsmRegClass }
  | { readonly $: "Nvptx"; readonly _0: NvptxInlineAsmRegClass }
  | { readonly $: "PowerPC"; readonly _0: PowerPCInlineAsmRegClass }
  | { readonly $: "Hexagon"; readonly _0: HexagonInlineAsmRegClass }
  | { readonly $: "LoongArch"; readonly _0: LoongArchInlineAsmRegClass }
  | { readonly $: "Mips"; readonly _0: MipsInlineAsmRegClass }
  | { readonly $: "S390x"; readonly _0: S390xInlineAsmRegClass }
  | { readonly $: "Sparc"; readonly _0: SparcInlineAsmRegClass }
  | { readonly $: "SpirV"; readonly _0: SpirVInlineAsmRegClass }
  | { readonly $: "Wasm"; readonly _0: WasmInlineAsmRegClass }
  | { readonly $: "Xtensa"; readonly _0: XtensaInlineAsmRegClass }
  | { readonly $: "Bpf"; readonly _0: BpfInlineAsmRegClass }
  | { readonly $: "Avr"; readonly _0: AvrInlineAsmRegClass }
  | { readonly $: "Msp430"; readonly _0: Msp430InlineAsmRegClass }
  | { readonly $: "M68k"; readonly _0: M68kInlineAsmRegClass }
  | { readonly $: "CSKY"; readonly _0: CSKYInlineAsmRegClass }
  // Placeholder for invalid register constraints for the current target
  | { readonly $: "Err" };

type RegClassOf<A extends InlineAsmRegClass["$"]> = Extract<InlineAsmRegClass, { $: A }>;

/** PORT: interned `InlineAsmRegClass` values (see the header). */
const reg_class_interner = new Map<string, InlineAsmRegClass>();
function intern_reg_class<A extends InlineAsmArchVariant>(arch: A, c: RegClassOf<A>["_0"]): RegClassOf<A> {
  const key = `${arch}::${c as string}`;
  let v = reg_class_interner.get(key);
  if (v === undefined) {
    v = Object.freeze({ $: arch, _0: c }) as InlineAsmRegClass;
    reg_class_interner.set(key, v);
  }
  return v as RegClassOf<A>;
}

/** The variant order of `InlineAsmRegClass` (its derived `Hash` writes the discriminant). */
const InlineAsmRegClass_VARIANTS: readonly InlineAsmRegClass["$"][] = [
  "X86",
  "Arm",
  "AArch64",
  "Amdgpu",
  "RiscV",
  "Nvptx",
  "PowerPC",
  "Hexagon",
  "LoongArch",
  "Mips",
  "S390x",
  "Sparc",
  "SpirV",
  "Wasm",
  "Xtensa",
  "Bpf",
  "Avr",
  "Msp430",
  "M68k",
  "CSKY",
  "Err",
];

/** `self as isize` of an arch's register class enum (ported arch modules only). */
function reg_class_discriminant(v: InlineAsmRegClass): number {
  switch (v.$) {
    case "X86":
      return X86InlineAsmRegClass.ALL.indexOf(v._0);
    case "AArch64":
      return AArch64InlineAsmRegClass.ALL.indexOf(v._0);
    case "Wasm":
      return WasmInlineAsmRegClass.ALL.indexOf(v._0);
    default:
      return unported(`rustc_target::asm::${v.$}InlineAsmRegClass (Hash)`);
  }
}

/**
 * `FxHashMap<InlineAsmRegClass, _>` key: the derived `Hash` (`write_isize` of the discriminant, then the
 * inner fieldless enum's discriminant); `size_of::<InlineAsmRegClass>()` is 2 (tag + inner tag), align 1.
 * PORT: checked against the oracle's `allocatable_registers` iteration order (asm.oracle.test.ts).
 */
export const InlineAsmRegClass_key: KeyType<InlineAsmRegClass> = {
  hash: (v, state) => {
    state.write_isize(InlineAsmRegClass_VARIANTS.indexOf(v.$));
    if (v.$ !== "Err") state.write_isize(reg_class_discriminant(v));
  },
  size: 2,
  align: 1,
};

/** `size_of::<FxIndexSet<InlineAsmReg>>()`: `IndexMapCore { entries: Vec, indices: HashTable }` = 24 + 32 (checked as above). */
export const LAYOUT_FxIndexSet_InlineAsmReg: Layout = { size: 56, align: 8 };

export const InlineAsmRegClass = {
  X86: (r: X86InlineAsmRegClass) => intern_reg_class("X86", r),
  Arm: (r: ArmInlineAsmRegClass) => intern_reg_class("Arm", r),
  AArch64: (r: AArch64InlineAsmRegClass) => intern_reg_class("AArch64", r),
  Amdgpu: (r: AmdgpuInlineAsmRegClass) => intern_reg_class("Amdgpu", r),
  RiscV: (r: RiscVInlineAsmRegClass) => intern_reg_class("RiscV", r),
  Nvptx: (r: NvptxInlineAsmRegClass) => intern_reg_class("Nvptx", r),
  PowerPC: (r: PowerPCInlineAsmRegClass) => intern_reg_class("PowerPC", r),
  Hexagon: (r: HexagonInlineAsmRegClass) => intern_reg_class("Hexagon", r),
  LoongArch: (r: LoongArchInlineAsmRegClass) => intern_reg_class("LoongArch", r),
  Mips: (r: MipsInlineAsmRegClass) => intern_reg_class("Mips", r),
  S390x: (r: S390xInlineAsmRegClass) => intern_reg_class("S390x", r),
  Sparc: (r: SparcInlineAsmRegClass) => intern_reg_class("Sparc", r),
  SpirV: (r: SpirVInlineAsmRegClass) => intern_reg_class("SpirV", r),
  Wasm: (r: WasmInlineAsmRegClass) => intern_reg_class("Wasm", r),
  Xtensa: (r: XtensaInlineAsmRegClass) => intern_reg_class("Xtensa", r),
  Bpf: (r: BpfInlineAsmRegClass) => intern_reg_class("Bpf", r),
  Avr: (r: AvrInlineAsmRegClass) => intern_reg_class("Avr", r),
  Msp430: (r: Msp430InlineAsmRegClass) => intern_reg_class("Msp430", r),
  M68k: (r: M68kInlineAsmRegClass) => intern_reg_class("M68k", r),
  CSKY: (r: CSKYInlineAsmRegClass) => intern_reg_class("CSKY", r),
  Err: Object.freeze({ $: "Err" }) as InlineAsmRegClass,

  /** `InlineAsmRegClass::$arch(c)` for a macro-generated arch name (`def_reg_class!` / `def_regs!`). */
  of(arch: InlineAsmArchVariant, c: string): InlineAsmRegClass {
    return intern_reg_class(arch, c as never);
  },

  // rustc: compiler/rustc_target/src/asm/mod.rs:519 name
  name(self: InlineAsmRegClass): Symbol {
    switch (self.$) {
      case "X86":
        return X86InlineAsmRegClass.name(self._0);
      case "Arm":
        return ArmInlineAsmRegClass.name(self._0);
      case "AArch64":
        return AArch64InlineAsmRegClass.name(self._0);
      case "Amdgpu":
        return AmdgpuInlineAsmRegClass.name(self._0);
      case "RiscV":
        return RiscVInlineAsmRegClass.name(self._0);
      case "Nvptx":
        return NvptxInlineAsmRegClass.name(self._0);
      case "PowerPC":
        return PowerPCInlineAsmRegClass.name(self._0);
      case "Hexagon":
        return HexagonInlineAsmRegClass.name(self._0);
      case "LoongArch":
        return LoongArchInlineAsmRegClass.name(self._0);
      case "Mips":
        return MipsInlineAsmRegClass.name(self._0);
      case "S390x":
        return S390xInlineAsmRegClass.name(self._0);
      case "Sparc":
        return SparcInlineAsmRegClass.name(self._0);
      case "SpirV":
        return SpirVInlineAsmRegClass.name(self._0);
      case "Wasm":
        return WasmInlineAsmRegClass.name(self._0);
      case "Xtensa":
        return XtensaInlineAsmRegClass.name(self._0);
      case "Bpf":
        return BpfInlineAsmRegClass.name(self._0);
      case "Avr":
        return AvrInlineAsmRegClass.name(self._0);
      case "Msp430":
        return Msp430InlineAsmRegClass.name(self._0);
      case "M68k":
        return M68kInlineAsmRegClass.name(self._0);
      case "CSKY":
        return CSKYInlineAsmRegClass.name(self._0);
      case "Err":
        return sym.reg;
    }
  },

  /// Returns a suggested register class to use for this type. This is called
  /// when `supported_types` fails to give a better error
  /// message to the user.
  // rustc: compiler/rustc_target/src/asm/mod.rs:548 suggest_class
  suggest_class(self: InlineAsmRegClass, arch: InlineAsmArch, ty: InlineAsmType): InlineAsmRegClass | undefined {
    const map = <C>(c: C | undefined, f: (c: C) => InlineAsmRegClass): InlineAsmRegClass | undefined =>
      c === undefined ? undefined : f(c);
    switch (self.$) {
      case "X86":
        return map(X86InlineAsmRegClass.suggest_class(self._0, arch, ty), InlineAsmRegClass.X86);
      case "Arm":
        return map(ArmInlineAsmRegClass.suggest_class(self._0, arch, ty), InlineAsmRegClass.Arm);
      case "AArch64":
        return map(AArch64InlineAsmRegClass.suggest_class(self._0, arch, ty), InlineAsmRegClass.AArch64);
      case "Amdgpu":
        return map(AmdgpuInlineAsmRegClass.suggest_class(self._0, arch, ty), InlineAsmRegClass.Amdgpu);
      case "RiscV":
        return map(RiscVInlineAsmRegClass.suggest_class(self._0, arch, ty), InlineAsmRegClass.RiscV);
      case "Nvptx":
        return map(NvptxInlineAsmRegClass.suggest_class(self._0, arch, ty), InlineAsmRegClass.Nvptx);
      case "PowerPC":
        return map(PowerPCInlineAsmRegClass.suggest_class(self._0, arch, ty), InlineAsmRegClass.PowerPC);
      case "Hexagon":
        return map(HexagonInlineAsmRegClass.suggest_class(self._0, arch, ty), InlineAsmRegClass.Hexagon);
      case "LoongArch":
        return map(LoongArchInlineAsmRegClass.suggest_class(self._0, arch, ty), InlineAsmRegClass.LoongArch);
      case "Mips":
        return map(MipsInlineAsmRegClass.suggest_class(self._0, arch, ty), InlineAsmRegClass.Mips);
      case "S390x":
        return map(S390xInlineAsmRegClass.suggest_class(self._0, arch, ty), InlineAsmRegClass.S390x);
      case "Sparc":
        return map(SparcInlineAsmRegClass.suggest_class(self._0, arch, ty), InlineAsmRegClass.Sparc);
      case "SpirV":
        return map(SpirVInlineAsmRegClass.suggest_class(self._0, arch, ty), InlineAsmRegClass.SpirV);
      case "Wasm":
        return map(WasmInlineAsmRegClass.suggest_class(self._0, arch, ty), InlineAsmRegClass.Wasm);
      case "Xtensa":
        return map(XtensaInlineAsmRegClass.suggest_class(self._0, arch, ty), InlineAsmRegClass.Xtensa);
      case "Bpf":
        return map(BpfInlineAsmRegClass.suggest_class(self._0, arch, ty), InlineAsmRegClass.Bpf);
      case "Avr":
        return map(AvrInlineAsmRegClass.suggest_class(self._0, arch, ty), InlineAsmRegClass.Avr);
      case "Msp430":
        return map(Msp430InlineAsmRegClass.suggest_class(self._0, arch, ty), InlineAsmRegClass.Msp430);
      case "M68k":
        return map(M68kInlineAsmRegClass.suggest_class(self._0, arch, ty), InlineAsmRegClass.M68k);
      case "CSKY":
        return map(CSKYInlineAsmRegClass.suggest_class(self._0, arch, ty), InlineAsmRegClass.CSKY);
      case "Err":
        return unreachable("Use of InlineAsmRegClass::Err");
    }
  },

  /// Returns a suggested template modifier to use for this type and an
  /// example of a register named formatted with it.
  ///
  /// Such suggestions are useful if a type smaller than the full register
  /// size is used and a modifier can be used to point to the subregister of
  /// the correct size.
  // rustc: compiler/rustc_target/src/asm/mod.rs:580 suggest_modifier
  suggest_modifier(self: InlineAsmRegClass, arch: InlineAsmArch, ty: InlineAsmType): ModifierInfo | undefined {
    switch (self.$) {
      case "X86":
        return X86InlineAsmRegClass.suggest_modifier(self._0, arch, ty);
      case "Arm":
        return ArmInlineAsmRegClass.suggest_modifier(self._0, arch, ty);
      case "AArch64":
        return AArch64InlineAsmRegClass.suggest_modifier(self._0, arch, ty);
      case "Amdgpu":
        return AmdgpuInlineAsmRegClass.suggest_modifier(self._0, arch, ty);
      case "RiscV":
        return RiscVInlineAsmRegClass.suggest_modifier(self._0, arch, ty);
      case "Nvptx":
        return NvptxInlineAsmRegClass.suggest_modifier(self._0, arch, ty);
      case "PowerPC":
        return PowerPCInlineAsmRegClass.suggest_modifier(self._0, arch, ty);
      case "Hexagon":
        return HexagonInlineAsmRegClass.suggest_modifier(self._0, arch, ty);
      case "LoongArch":
        return LoongArchInlineAsmRegClass.suggest_modifier(self._0, arch, ty);
      case "Mips":
        return MipsInlineAsmRegClass.suggest_modifier(self._0, arch, ty);
      case "S390x":
        return S390xInlineAsmRegClass.suggest_modifier(self._0, arch, ty);
      case "Sparc":
        return SparcInlineAsmRegClass.suggest_modifier(self._0, arch, ty);
      case "SpirV":
        return SpirVInlineAsmRegClass.suggest_modifier(self._0, arch, ty);
      case "Wasm":
        return WasmInlineAsmRegClass.suggest_modifier(self._0, arch, ty);
      case "Xtensa":
        return XtensaInlineAsmRegClass.suggest_modifier(self._0, arch, ty);
      case "Bpf":
        return BpfInlineAsmRegClass.suggest_modifier(self._0, arch, ty);
      case "Avr":
        return AvrInlineAsmRegClass.suggest_modifier(self._0, arch, ty);
      case "Msp430":
        return Msp430InlineAsmRegClass.suggest_modifier(self._0, arch, ty);
      case "M68k":
        return M68kInlineAsmRegClass.suggest_modifier(self._0, arch, ty);
      case "CSKY":
        return CSKYInlineAsmRegClass.suggest_modifier(self._0, arch, ty);
      case "Err":
        return unreachable("Use of InlineAsmRegClass::Err");
    }
  },

  /// Returns the default modifier for this register and an example of a
  /// register named formatted with it.
  ///
  /// This is only needed when the register class can suggest a modifier, so
  /// that the user can be shown how to get the default behavior without a
  /// warning.
  // rustc: compiler/rustc_target/src/asm/mod.rs:612 default_modifier
  default_modifier(self: InlineAsmRegClass, arch: InlineAsmArch): ModifierInfo | undefined {
    switch (self.$) {
      case "X86":
        return X86InlineAsmRegClass.default_modifier(self._0, arch);
      case "Arm":
        return ArmInlineAsmRegClass.default_modifier(self._0, arch);
      case "AArch64":
        return AArch64InlineAsmRegClass.default_modifier(self._0, arch);
      case "Amdgpu":
        return AmdgpuInlineAsmRegClass.default_modifier(self._0, arch);
      case "RiscV":
        return RiscVInlineAsmRegClass.default_modifier(self._0, arch);
      case "Nvptx":
        return NvptxInlineAsmRegClass.default_modifier(self._0, arch);
      case "PowerPC":
        return PowerPCInlineAsmRegClass.default_modifier(self._0, arch);
      case "Hexagon":
        return HexagonInlineAsmRegClass.default_modifier(self._0, arch);
      case "LoongArch":
        return LoongArchInlineAsmRegClass.default_modifier(self._0, arch);
      case "Mips":
        return MipsInlineAsmRegClass.default_modifier(self._0, arch);
      case "S390x":
        return S390xInlineAsmRegClass.default_modifier(self._0, arch);
      case "Sparc":
        return SparcInlineAsmRegClass.default_modifier(self._0, arch);
      case "SpirV":
        return SpirVInlineAsmRegClass.default_modifier(self._0, arch);
      case "Wasm":
        return WasmInlineAsmRegClass.default_modifier(self._0, arch);
      case "Xtensa":
        return XtensaInlineAsmRegClass.default_modifier(self._0, arch);
      case "Bpf":
        return BpfInlineAsmRegClass.default_modifier(self._0, arch);
      case "Avr":
        return AvrInlineAsmRegClass.default_modifier(self._0, arch);
      case "Msp430":
        return Msp430InlineAsmRegClass.default_modifier(self._0, arch);
      case "M68k":
        return M68kInlineAsmRegClass.default_modifier(self._0, arch);
      case "CSKY":
        return CSKYInlineAsmRegClass.default_modifier(self._0, arch);
      case "Err":
        return unreachable("Use of InlineAsmRegClass::Err");
    }
  },

  /// Returns a list of supported types for this register class, each with an
  /// options target feature required to use this type.
  ///
  /// At the codegen stage, it is fine to always pass true for `allow_experimental_reg`,
  /// since all the stability checking will have been done in prior stages.
  // rustc: compiler/rustc_target/src/asm/mod.rs:643 supported_types
  supported_types(self: InlineAsmRegClass, arch: InlineAsmArch, allow_experimental_reg: boolean): readonly SupportedType[] {
    switch (self.$) {
      case "X86":
        return X86InlineAsmRegClass.supported_types(self._0, arch, allow_experimental_reg);
      case "Arm":
        return ArmInlineAsmRegClass.supported_types(self._0, arch);
      case "AArch64":
        return AArch64InlineAsmRegClass.supported_types(self._0, arch, allow_experimental_reg);
      case "Amdgpu":
        return AmdgpuInlineAsmRegClass.supported_types(self._0, arch);
      case "RiscV":
        return RiscVInlineAsmRegClass.supported_types(self._0, arch);
      case "Nvptx":
        return NvptxInlineAsmRegClass.supported_types(self._0, arch);
      case "PowerPC":
        return PowerPCInlineAsmRegClass.supported_types(self._0, arch);
      case "Hexagon":
        return HexagonInlineAsmRegClass.supported_types(self._0, arch);
      case "LoongArch":
        return LoongArchInlineAsmRegClass.supported_types(self._0, arch, allow_experimental_reg);
      case "Mips":
        return MipsInlineAsmRegClass.supported_types(self._0, arch);
      case "S390x":
        return S390xInlineAsmRegClass.supported_types(self._0, arch);
      case "Sparc":
        return SparcInlineAsmRegClass.supported_types(self._0, arch);
      case "SpirV":
        return SpirVInlineAsmRegClass.supported_types(self._0, arch);
      case "Wasm":
        return WasmInlineAsmRegClass.supported_types(self._0, arch);
      case "Xtensa":
        return XtensaInlineAsmRegClass.supported_types(self._0, arch);
      case "Bpf":
        return BpfInlineAsmRegClass.supported_types(self._0, arch);
      case "Avr":
        return AvrInlineAsmRegClass.supported_types(self._0, arch);
      case "Msp430":
        return Msp430InlineAsmRegClass.supported_types(self._0, arch);
      case "M68k":
        return M68kInlineAsmRegClass.supported_types(self._0, arch);
      case "CSKY":
        return CSKYInlineAsmRegClass.supported_types(self._0, arch);
      case "Err":
        return unreachable("Use of InlineAsmRegClass::Err");
    }
  },

  // rustc: compiler/rustc_target/src/asm/mod.rs:673 parse
  parse(arch: InlineAsmArch, name: Symbol): Result<InlineAsmRegClass, readonly Symbol[]> {
    const wrap = <C>(r: Result<C, readonly Symbol[]>, f: (c: C) => InlineAsmRegClass): Result<InlineAsmRegClass, readonly Symbol[]> =>
      r.$ === "Err" ? r : Ok(f(r._0));
    switch (arch) {
      case "X86":
      case "X86_64": {
        return wrap(X86InlineAsmRegClass.parse(name), InlineAsmRegClass.X86);
      }
      case "Arm":
        return wrap(ArmInlineAsmRegClass.parse(name), InlineAsmRegClass.Arm);
      case "AArch64":
      case "Arm64EC": {
        return wrap(AArch64InlineAsmRegClass.parse(name), InlineAsmRegClass.AArch64);
      }
      case "Amdgpu":
        return wrap(AmdgpuInlineAsmRegClass.parse(name), InlineAsmRegClass.Amdgpu);
      case "RiscV32":
      case "RiscV64": {
        return wrap(RiscVInlineAsmRegClass.parse(name), InlineAsmRegClass.RiscV);
      }
      case "Nvptx64":
        return wrap(NvptxInlineAsmRegClass.parse(name), InlineAsmRegClass.Nvptx);
      case "PowerPC":
      case "PowerPC64": {
        return wrap(PowerPCInlineAsmRegClass.parse(name), InlineAsmRegClass.PowerPC);
      }
      case "Hexagon":
        return wrap(HexagonInlineAsmRegClass.parse(name), InlineAsmRegClass.Hexagon);
      case "LoongArch32":
      case "LoongArch64": {
        return wrap(LoongArchInlineAsmRegClass.parse(name), InlineAsmRegClass.LoongArch);
      }
      case "Mips":
      case "Mips64": {
        return wrap(MipsInlineAsmRegClass.parse(name), InlineAsmRegClass.Mips);
      }
      case "S390x":
        return wrap(S390xInlineAsmRegClass.parse(name), InlineAsmRegClass.S390x);
      case "Sparc":
      case "Sparc64": {
        return wrap(SparcInlineAsmRegClass.parse(name), InlineAsmRegClass.Sparc);
      }
      case "SpirV":
        return wrap(SpirVInlineAsmRegClass.parse(name), InlineAsmRegClass.SpirV);
      case "Wasm32":
      case "Wasm64": {
        return wrap(WasmInlineAsmRegClass.parse(name), InlineAsmRegClass.Wasm);
      }
      case "Bpf":
        return wrap(BpfInlineAsmRegClass.parse(name), InlineAsmRegClass.Bpf);
      case "Avr":
        return wrap(AvrInlineAsmRegClass.parse(name), InlineAsmRegClass.Avr);
      case "Xtensa":
        return wrap(XtensaInlineAsmRegClass.parse(name), InlineAsmRegClass.Xtensa);
      case "Msp430":
        return wrap(Msp430InlineAsmRegClass.parse(name), InlineAsmRegClass.Msp430);
      case "M68k":
        return wrap(M68kInlineAsmRegClass.parse(name), InlineAsmRegClass.M68k);
      case "CSKY":
        return wrap(CSKYInlineAsmRegClass.parse(name), InlineAsmRegClass.CSKY);
    }
  },

  /// Returns the list of template modifiers that can be used with this
  /// register class.
  // rustc: compiler/rustc_target/src/asm/mod.rs:716 valid_modifiers
  valid_modifiers(self: InlineAsmRegClass, arch: InlineAsmArch): readonly char[] {
    switch (self.$) {
      case "X86":
        return X86InlineAsmRegClass.valid_modifiers(self._0, arch);
      case "Arm":
        return ArmInlineAsmRegClass.valid_modifiers(self._0, arch);
      case "AArch64":
        return AArch64InlineAsmRegClass.valid_modifiers(self._0, arch);
      case "Amdgpu":
        return AmdgpuInlineAsmRegClass.valid_modifiers(self._0, arch);
      case "RiscV":
        return RiscVInlineAsmRegClass.valid_modifiers(self._0, arch);
      case "Nvptx":
        return NvptxInlineAsmRegClass.valid_modifiers(self._0, arch);
      case "PowerPC":
        return PowerPCInlineAsmRegClass.valid_modifiers(self._0, arch);
      case "Hexagon":
        return HexagonInlineAsmRegClass.valid_modifiers(self._0, arch);
      case "LoongArch":
        return LoongArchInlineAsmRegClass.valid_modifiers(self._0, arch);
      case "Mips":
        return MipsInlineAsmRegClass.valid_modifiers(self._0, arch);
      case "S390x":
        return S390xInlineAsmRegClass.valid_modifiers(self._0, arch);
      case "Sparc":
        return SparcInlineAsmRegClass.valid_modifiers(self._0, arch);
      case "SpirV":
        return SpirVInlineAsmRegClass.valid_modifiers(self._0, arch);
      case "Wasm":
        return WasmInlineAsmRegClass.valid_modifiers(self._0, arch);
      case "Xtensa":
        return XtensaInlineAsmRegClass.valid_modifiers(self._0, arch);
      case "Bpf":
        return BpfInlineAsmRegClass.valid_modifiers(self._0, arch);
      case "Avr":
        return AvrInlineAsmRegClass.valid_modifiers(self._0, arch);
      case "Msp430":
        return Msp430InlineAsmRegClass.valid_modifiers(self._0, arch);
      case "M68k":
        return M68kInlineAsmRegClass.valid_modifiers(self._0, arch);
      case "CSKY":
        return CSKYInlineAsmRegClass.valid_modifiers(self._0, arch);
      case "Err":
        return unreachable("Use of InlineAsmRegClass::Err");
    }
  },

  /// Returns whether registers in this class can only be used as clobbers
  /// and not as inputs/outputs.
  ///
  /// At the codegen stage, it is fine to always pass true for `allow_experimental_reg`,
  /// since all the stability checking will have been done in prior stages.
  // rustc: compiler/rustc_target/src/asm/mod.rs:747 is_clobber_only
  is_clobber_only(self: InlineAsmRegClass, arch: InlineAsmArch, allow_experimental_reg: boolean): boolean {
    return InlineAsmRegClass.supported_types(self, arch, allow_experimental_reg).length === 0;
  },
} as const;

/** `#[derive(Debug)]` of `InlineAsmRegClass` */
export const debug_InlineAsmRegClass: Debug<InlineAsmRegClass> = (v, f) =>
  v.$ === "Err" ? "Err" : debug_tuple(f, v.$, [v._0 as string]);

// #[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Hash)]
// #[derive(StableHash, Encodable, Decodable)]
export type InlineAsmRegOrRegClass =
  | { readonly $: "Reg"; readonly _0: InlineAsmReg }
  | { readonly $: "RegClass"; readonly _0: InlineAsmRegClass };

export const InlineAsmRegOrRegClass = {
  // rustc: compiler/rustc_target/src/asm/mod.rs:760 reg_class
  reg_class(self: InlineAsmRegOrRegClass): InlineAsmRegClass {
    switch (self.$) {
      case "Reg":
        return InlineAsmReg.reg_class(self._0);
      case "RegClass":
        return self._0;
    }
  },

  // impl fmt::Display for InlineAsmRegOrRegClass
  // rustc: compiler/rustc_target/src/asm/mod.rs:769 fmt
  display(self: InlineAsmRegOrRegClass): string {
    switch (self.$) {
      case "Reg":
        return `"${InlineAsmReg.name(self._0)}"`;
      case "RegClass":
        return Symbol.as_str(InlineAsmRegClass.name(self._0));
    }
  },

  /** `==` (derived `PartialEq`; the payloads are interned). */
  eq(a: InlineAsmRegOrRegClass, b: InlineAsmRegOrRegClass): boolean {
    return a.$ === b.$ && a._0 === b._0;
  },
} as const;

/** `#[derive(Debug)]` of `InlineAsmRegOrRegClass` */
export const debug_InlineAsmRegOrRegClass: Debug<InlineAsmRegOrRegClass> = (v, f) =>
  debug_tuple(f, v.$, [v.$ === "Reg" ? debug_InlineAsmReg(v._0, f) : debug_InlineAsmRegClass(v._0, f)]);

/// Set of types which can be used with a particular register class.
// #[derive(Copy, Clone, Debug, Eq, PartialEq)]
// PORT: the `u64` lane counts are `number` (small).
export type InlineAsmType =
  | { readonly $: "I8" }
  | { readonly $: "I16" }
  | { readonly $: "I32" }
  | { readonly $: "I64" }
  | { readonly $: "I128" }
  | { readonly $: "F16" }
  | { readonly $: "F32" }
  | { readonly $: "F64" }
  | { readonly $: "F128" }
  | { readonly $: "VecI8"; readonly _0: number }
  | { readonly $: "VecI16"; readonly _0: number }
  | { readonly $: "VecI32"; readonly _0: number }
  | { readonly $: "VecI64"; readonly _0: number }
  | { readonly $: "VecI128"; readonly _0: number }
  | { readonly $: "VecF16"; readonly _0: number }
  | { readonly $: "VecF32"; readonly _0: number }
  | { readonly $: "VecF64"; readonly _0: number }
  | { readonly $: "VecF128"; readonly _0: number }
  | { readonly $: "SveVecI8" }
  | { readonly $: "SveVecI16" }
  | { readonly $: "SveVecI32" }
  | { readonly $: "SveVecI64" }
  | { readonly $: "SveVecI128" }
  | { readonly $: "SveVecF16" }
  | { readonly $: "SveVecF32" }
  | { readonly $: "SveVecF64" }
  | { readonly $: "SveVecF128" }
  | { readonly $: "SveVecBool" };

// #[derive(Copy, Clone, Debug, Eq, PartialEq)]
export type InlineAsmSize = { readonly $: "FixedBytes"; readonly _0: number } | { readonly $: "Scalable" };

export const InlineAsmSize = {
  FixedBytes: (size: number): InlineAsmSize => ({ $: "FixedBytes", _0: size }),
  Scalable: Object.freeze({ $: "Scalable" }) as InlineAsmSize,

  // rustc: compiler/rustc_target/src/asm/mod.rs:817 fixed_size_bytes
  fixed_size_bytes(self: InlineAsmSize): number | undefined {
    switch (self.$) {
      case "FixedBytes":
        return self._0;
      case "Scalable":
        return undefined;
    }
  },

  /** `==` (derived `PartialEq`) */
  eq(a: InlineAsmSize, b: InlineAsmSize): boolean {
    return a.$ === b.$ && (a.$ !== "FixedBytes" || a._0 === (b as typeof a)._0);
  },
} as const;

/** `#[derive(Debug)]` of `InlineAsmSize` */
export const debug_InlineAsmSize: Debug<InlineAsmSize> = (v, f) =>
  v.$ === "FixedBytes" ? debug_tuple(f, "FixedBytes", [String(v._0)]) : "Scalable";

const unit = <T extends InlineAsmType["$"]>(t: T) => Object.freeze({ $: t }) as Extract<InlineAsmType, { $: T }>;

export const InlineAsmType = {
  I8: unit("I8"),
  I16: unit("I16"),
  I32: unit("I32"),
  I64: unit("I64"),
  I128: unit("I128"),
  F16: unit("F16"),
  F32: unit("F32"),
  F64: unit("F64"),
  F128: unit("F128"),
  VecI8: (n: number): InlineAsmType => ({ $: "VecI8", _0: n }),
  VecI16: (n: number): InlineAsmType => ({ $: "VecI16", _0: n }),
  VecI32: (n: number): InlineAsmType => ({ $: "VecI32", _0: n }),
  VecI64: (n: number): InlineAsmType => ({ $: "VecI64", _0: n }),
  VecI128: (n: number): InlineAsmType => ({ $: "VecI128", _0: n }),
  VecF16: (n: number): InlineAsmType => ({ $: "VecF16", _0: n }),
  VecF32: (n: number): InlineAsmType => ({ $: "VecF32", _0: n }),
  VecF64: (n: number): InlineAsmType => ({ $: "VecF64", _0: n }),
  VecF128: (n: number): InlineAsmType => ({ $: "VecF128", _0: n }),
  SveVecI8: unit("SveVecI8"),
  SveVecI16: unit("SveVecI16"),
  SveVecI32: unit("SveVecI32"),
  SveVecI64: unit("SveVecI64"),
  SveVecI128: unit("SveVecI128"),
  SveVecF16: unit("SveVecF16"),
  SveVecF32: unit("SveVecF32"),
  SveVecF64: unit("SveVecF64"),
  SveVecF128: unit("SveVecF128"),
  SveVecBool: unit("SveVecBool"),

  // rustc: compiler/rustc_target/src/asm/mod.rs:826 is_integer
  is_integer(self: InlineAsmType): boolean {
    return self.$ === "I8" || self.$ === "I16" || self.$ === "I32" || self.$ === "I64" || self.$ === "I128";
  },

  // rustc: compiler/rustc_target/src/asm/mod.rs:830 size
  size(self: InlineAsmType): InlineAsmSize {
    switch (self.$) {
      case "I8":
        return InlineAsmSize.FixedBytes(1);
      case "I16":
      case "F16":
        return InlineAsmSize.FixedBytes(2);
      case "I32":
      case "F32":
        return InlineAsmSize.FixedBytes(4);
      case "I64":
      case "F64":
        return InlineAsmSize.FixedBytes(8);
      case "I128":
      case "F128":
        return InlineAsmSize.FixedBytes(16);
      case "VecI8":
        return InlineAsmSize.FixedBytes(self._0);
      case "VecI16":
      case "VecF16":
        return InlineAsmSize.FixedBytes(self._0 * 2);
      case "VecI32":
      case "VecF32":
        return InlineAsmSize.FixedBytes(self._0 * 4);
      case "VecI64":
      case "VecF64":
        return InlineAsmSize.FixedBytes(self._0 * 8);
      case "VecI128":
      case "VecF128":
        return InlineAsmSize.FixedBytes(self._0 * 16);
      case "SveVecI8":
      case "SveVecI16":
      case "SveVecI32":
      case "SveVecI64":
      case "SveVecI128":
      case "SveVecF16":
      case "SveVecF32":
      case "SveVecF64":
      case "SveVecF128":
      case "SveVecBool":
        return InlineAsmSize.Scalable;
    }
  },

  // impl fmt::Display for InlineAsmType
  // rustc: compiler/rustc_target/src/asm/mod.rs:857 fmt
  display(self: InlineAsmType): string {
    switch (self.$) {
      case "I8":
        return "i8";
      case "I16":
        return "i16";
      case "I32":
        return "i32";
      case "I64":
        return "i64";
      case "I128":
        return "i128";
      case "F16":
        return "f16";
      case "F32":
        return "f32";
      case "F64":
        return "f64";
      case "F128":
        return "f128";
      case "VecI8":
        return `i8x${self._0}`;
      case "VecI16":
        return `i16x${self._0}`;
      case "VecI32":
        return `i32x${self._0}`;
      case "VecI64":
        return `i64x${self._0}`;
      case "VecI128":
        return `i128x${self._0}`;
      case "VecF16":
        return `f16x${self._0}`;
      case "VecF32":
        return `f32x${self._0}`;
      case "VecF64":
        return `f64x${self._0}`;
      case "VecF128":
        return `f128x${self._0}`;
      case "SveVecI8":
        return "svint8_t";
      case "SveVecI16":
        return "svint16_t";
      case "SveVecI32":
        return "svint32_t";
      case "SveVecI64":
        return "svint64_t";
      case "SveVecI128":
        return "svint128_t";
      case "SveVecF16":
        return "svfloat26_t";
      case "SveVecF32":
        return "svfloat32_t";
      case "SveVecF64":
        return "svfloat64_t";
      case "SveVecF128":
        return "svfloat128_t";
      case "SveVecBool":
        return "svbool_t";
    }
  },

  /** `==` (derived `PartialEq`) */
  eq(a: InlineAsmType, b: InlineAsmType): boolean {
    return a.$ === b.$ && ("_0" in a ? a._0 === (b as typeof a)._0 : true);
  },
} as const;

/** `#[derive(Debug)]` of `InlineAsmType` */
export const debug_InlineAsmType: Debug<InlineAsmType> = (v, f) =>
  "_0" in v ? debug_tuple(f, v.$, [String(v._0)]) : v.$;

/** `{:?}` of a `supported_types` slice: `[(I16, None), (I32, Some("sse")), ..]`. */
export const debug_supported_types: Debug<readonly SupportedType[]> = (v, f) =>
  debug_vec(v, f, ([ty, feature], f) =>
    debug_tuple(f, "", [debug_InlineAsmType(ty, f), feature === undefined ? "None" : debug_tuple(f, "Some", [debug_str(Symbol.as_str(feature))])]),
  );

/** `{:?}` of a `&[char]` (`valid_modifiers`). */
export const debug_chars: Debug<readonly char[]> = (v, f) => debug_vec(v, f, (c) => debug_char(c));

/// Returns the full set of allocatable registers for a given architecture.
///
/// The registers are structured as a map containing the set of allocatable
/// registers in each register class. A particular register may be allocatable
/// from multiple register classes, in which case it will appear multiple times
/// in the map.
// NOTE: This function isn't used at the moment, but is needed to support
// falling back to an external assembler.
// rustc: compiler/rustc_target/src/asm/mod.rs:899 allocatable_registers
export function allocatable_registers(
  arch: InlineAsmArch,
  reloc_model: RelocModel,
  target_features: ReadonlySet<Symbol>,
  target: Target,
): RegClassMap {
  switch (arch) {
    case "X86":
    case "X86_64": {
      const map = x86.regclass_map();
      x86.fill_reg_map(arch, reloc_model, target_features, target, map);
      return map;
    }
    case "Arm": {
      const map = arm.regclass_map();
      arm.fill_reg_map(arch, reloc_model, target_features, target, map);
      return map;
    }
    case "AArch64":
    case "Arm64EC": {
      const map = aarch64.regclass_map();
      aarch64.fill_reg_map(arch, reloc_model, target_features, target, map);
      return map;
    }
    case "Amdgpu": {
      const map = amdgpu.regclass_map();
      amdgpu.fill_reg_map(arch, reloc_model, target_features, target, map);
      return map;
    }
    case "RiscV32":
    case "RiscV64": {
      const map = riscv.regclass_map();
      riscv.fill_reg_map(arch, reloc_model, target_features, target, map);
      return map;
    }
    case "Nvptx64": {
      const map = nvptx.regclass_map();
      nvptx.fill_reg_map(arch, reloc_model, target_features, target, map);
      return map;
    }
    case "PowerPC":
    case "PowerPC64": {
      const map = powerpc.regclass_map();
      powerpc.fill_reg_map(arch, reloc_model, target_features, target, map);
      return map;
    }
    case "Hexagon": {
      const map = hexagon.regclass_map();
      hexagon.fill_reg_map(arch, reloc_model, target_features, target, map);
      return map;
    }
    case "LoongArch32":
    case "LoongArch64": {
      const map = loongarch.regclass_map();
      loongarch.fill_reg_map(arch, reloc_model, target_features, target, map);
      return map;
    }
    case "Mips":
    case "Mips64": {
      const map = mips.regclass_map();
      mips.fill_reg_map(arch, reloc_model, target_features, target, map);
      return map;
    }
    case "S390x": {
      const map = s390x.regclass_map();
      s390x.fill_reg_map(arch, reloc_model, target_features, target, map);
      return map;
    }
    case "Sparc":
    case "Sparc64": {
      const map = sparc.regclass_map();
      sparc.fill_reg_map(arch, reloc_model, target_features, target, map);
      return map;
    }
    case "SpirV": {
      const map = spirv.regclass_map();
      spirv.fill_reg_map(arch, reloc_model, target_features, target, map);
      return map;
    }
    case "Wasm32":
    case "Wasm64": {
      const map = wasm.regclass_map();
      wasm.fill_reg_map(arch, reloc_model, target_features, target, map);
      return map;
    }
    case "Xtensa": {
      const map = xtensa.regclass_map();
      xtensa.fill_reg_map(arch, reloc_model, target_features, target, map);
      return map;
    }
    case "Bpf": {
      const map = bpf.regclass_map();
      bpf.fill_reg_map(arch, reloc_model, target_features, target, map);
      return map;
    }
    case "Avr": {
      const map = avr.regclass_map();
      avr.fill_reg_map(arch, reloc_model, target_features, target, map);
      return map;
    }
    case "Msp430": {
      const map = msp430.regclass_map();
      msp430.fill_reg_map(arch, reloc_model, target_features, target, map);
      return map;
    }
    case "M68k": {
      const map = m68k.regclass_map();
      m68k.fill_reg_map(arch, reloc_model, target_features, target, map);
      return map;
    }
    case "CSKY": {
      const map = csky.regclass_map();
      csky.fill_reg_map(arch, reloc_model, target_features, target, map);
      return map;
    }
  }
}

// #[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Hash)]
// #[derive(StableHash, Encodable, Decodable)]
export type InlineAsmClobberAbi =
  | "X86"
  | "X86_64Win"
  | "X86_64SysV"
  | "Arm"
  | "AArch64"
  | "AArch64NoX18"
  | "Arm64EC"
  | "Avr"
  | "RiscV"
  | "RiscVE"
  | "LoongArch"
  | "PowerPC"
  | "PowerPCSPE"
  | "S390x"
  | "Bpf"
  | "Msp430"
  | "Xtensa";

/** `clobbered_regs! { $arch $arch_reg { $($reg,)* } }` */
function clobbered_regs_x86(regs: readonly X86InlineAsmReg[]): readonly InlineAsmReg[] {
  return regs.map(InlineAsmReg.X86);
}
function clobbered_regs_aarch64(regs: readonly AArch64InlineAsmReg[]): readonly InlineAsmReg[] {
  return regs.map(InlineAsmReg.AArch64);
}

export const InlineAsmClobberAbi = {
  X86: "X86",
  X86_64Win: "X86_64Win",
  X86_64SysV: "X86_64SysV",
  Arm: "Arm",
  AArch64: "AArch64",
  AArch64NoX18: "AArch64NoX18",
  Arm64EC: "Arm64EC",
  Avr: "Avr",
  RiscV: "RiscV",
  RiscVE: "RiscVE",
  LoongArch: "LoongArch",
  PowerPC: "PowerPC",
  PowerPCSPE: "PowerPCSPE",
  S390x: "S390x",
  Bpf: "Bpf",
  Msp430: "Msp430",
  Xtensa: "Xtensa",

  /// Parses a clobber ABI for the given target, or returns a list of supported
  /// clobber ABIs for the target.
  // rustc: compiler/rustc_target/src/asm/mod.rs:1034 parse
  parse(arch: InlineAsmArch, target: Target, target_features: ReadonlySet<Symbol>, name_: Symbol): Result<InlineAsmClobberAbi, readonly string[]> {
    const name = Symbol.as_str(name_);
    switch (arch) {
      case "X86":
        switch (name) {
          case "C":
          case "system":
          case "efiapi":
          case "cdecl":
          case "stdcall":
          case "fastcall": {
            return Ok("X86");
          }
          default:
            return Err(["C", "system", "efiapi", "cdecl", "stdcall", "fastcall"]);
        }
      case "X86_64":
        if ((name === "C" || name === "system") && !target.is_like_windows) return Ok("X86_64SysV");
        if ((name === "C" || name === "system") && target.is_like_windows) return Ok("X86_64Win");
        if (name === "win64" || name === "efiapi") return Ok("X86_64Win");
        if (name === "sysv64") return Ok("X86_64SysV");
        return Err(["C", "system", "efiapi", "win64", "sysv64"]);
      case "Arm":
        switch (name) {
          case "C":
          case "system":
          case "efiapi":
          case "aapcs":
            return Ok("Arm");
          default:
            return Err(["C", "system", "efiapi", "aapcs"]);
        }
      case "AArch64":
        switch (name) {
          case "C":
          case "system":
          case "efiapi": {
            return Ok(aarch64.target_reserves_x18(target, target_features) ? "AArch64NoX18" : "AArch64");
          }
          default:
            return Err(["C", "system", "efiapi"]);
        }
      case "Arm64EC":
        switch (name) {
          case "C":
          case "system":
            return Ok("Arm64EC");
          default:
            return Err(["C", "system"]);
        }
      case "RiscV32":
      case "RiscV64":
        switch (name) {
          case "C":
          case "system":
          case "efiapi":
            return Ok(riscv.is_e(target_features) ? "RiscVE" : "RiscV");
          default:
            return Err(["C", "system", "efiapi"]);
        }
      case "Avr":
        switch (name) {
          case "C":
          case "system":
            return Ok("Avr");
          default:
            return Err(["C", "system"]);
        }
      case "LoongArch32":
      case "LoongArch64":
        switch (name) {
          case "C":
          case "system":
          case "efiapi":
            return Ok("LoongArch");
          default:
            return Err(["C", "system", "efiapi"]);
        }
      case "PowerPC":
      case "PowerPC64":
        switch (name) {
          case "C":
          case "system":
            return Ok(powerpc.is_spe(target) ? "PowerPCSPE" : "PowerPC");
          default:
            return Err(["C", "system"]);
        }
      case "S390x":
        switch (name) {
          case "C":
          case "system":
            return Ok("S390x");
          default:
            return Err(["C", "system"]);
        }
      case "Bpf":
        switch (name) {
          case "C":
          case "system":
            return Ok("Bpf");
          default:
            return Err(["C", "system"]);
        }
      case "Msp430":
        switch (name) {
          case "C":
          case "system":
            return Ok("Msp430");
          default:
            return Err(["C", "system"]);
        }
      case "Xtensa":
        switch (name) {
          case "C":
          case "system":
            return Ok("Xtensa");
          default:
            return Err(["C", "system"]);
        }
      default:
        return Err([]);
    }
  },

  /// Returns the set of registers which are clobbered by this ABI.
  // rustc: compiler/rustc_target/src/asm/mod.rs:1118 clobbered_regs
  clobbered_regs(self: InlineAsmClobberAbi): readonly InlineAsmReg[] {
    switch (self) {
      case "X86":
        return clobbered_regs_x86([
          "ax", "cx", "dx",

          "xmm0", "xmm1", "xmm2", "xmm3", "xmm4", "xmm5", "xmm6", "xmm7",

          "k0", "k1", "k2", "k3", "k4", "k5", "k6", "k7",

          "mm0", "mm1", "mm2", "mm3", "mm4", "mm5", "mm6", "mm7",
          "st0", "st1", "st2", "st3", "st4", "st5", "st6", "st7",
        ]);
      case "X86_64SysV":
        return clobbered_regs_x86([
          "ax", "cx", "dx", "si", "di", "r8", "r9", "r10", "r11",

          "xmm0", "xmm1", "xmm2", "xmm3", "xmm4", "xmm5", "xmm6", "xmm7",
          "xmm8", "xmm9", "xmm10", "xmm11", "xmm12", "xmm13", "xmm14", "xmm15",
          "zmm16", "zmm17", "zmm18", "zmm19", "zmm20", "zmm21", "zmm22", "zmm23",
          "zmm24", "zmm25", "zmm26", "zmm27", "zmm28", "zmm29", "zmm30", "zmm31",

          "k0", "k1", "k2", "k3", "k4", "k5", "k6", "k7",

          "mm0", "mm1", "mm2", "mm3", "mm4", "mm5", "mm6", "mm7",
          "st0", "st1", "st2", "st3", "st4", "st5", "st6", "st7",
          "tmm0", "tmm1", "tmm2", "tmm3", "tmm4", "tmm5", "tmm6", "tmm7",
        ]);
      case "X86_64Win":
        return clobbered_regs_x86([
          // rdi and rsi are callee-saved on windows
          "ax", "cx", "dx", "r8", "r9", "r10", "r11",

          // xmm6-xmm15 are callee-saved on windows, but we need to
          // mark them as clobbered anyways because the upper portions
          // of ymm6-ymm15 are volatile.
          "xmm0", "xmm1", "xmm2", "xmm3", "xmm4", "xmm5", "xmm6", "xmm7",
          "xmm8", "xmm9", "xmm10", "xmm11", "xmm12", "xmm13", "xmm14", "xmm15",
          "zmm16", "zmm17", "zmm18", "zmm19", "zmm20", "zmm21", "zmm22", "zmm23",
          "zmm24", "zmm25", "zmm26", "zmm27", "zmm28", "zmm29", "zmm30", "zmm31",

          "k0", "k1", "k2", "k3", "k4", "k5", "k6", "k7",

          "mm0", "mm1", "mm2", "mm3", "mm4", "mm5", "mm6", "mm7",
          "st0", "st1", "st2", "st3", "st4", "st5", "st6", "st7",
          "tmm0", "tmm1", "tmm2", "tmm3", "tmm4", "tmm5", "tmm6", "tmm7",
        ]);
      case "AArch64":
        return clobbered_regs_aarch64([
          "x0", "x1", "x2", "x3", "x4", "x5", "x6", "x7",
          "x8", "x9", "x10", "x11", "x12", "x13", "x14", "x15",
          "x16", "x17", "x18", "x30",

          // Technically the low 64 bits of v8-v15 are preserved, but
          // we have no way of expressing this using clobbers.
          "v0", "v1", "v2", "v3", "v4", "v5", "v6", "v7",
          "v8", "v9", "v10", "v11", "v12", "v13", "v14", "v15",
          "v16", "v17", "v18", "v19", "v20", "v21", "v22", "v23",
          "v24", "v25", "v26", "v27", "v28", "v29", "v30", "v31",

          "p0", "p1", "p2", "p3", "p4", "p5", "p6", "p7",
          "p8", "p9", "p10", "p11", "p12", "p13", "p14", "p15",
          "ffr",
        ]);
      case "AArch64NoX18":
        return clobbered_regs_aarch64([
          "x0", "x1", "x2", "x3", "x4", "x5", "x6", "x7",
          "x8", "x9", "x10", "x11", "x12", "x13", "x14", "x15",
          "x16", "x17", "x30",

          // Technically the low 64 bits of v8-v15 are preserved, but
          // we have no way of expressing this using clobbers.
          "v0", "v1", "v2", "v3", "v4", "v5", "v6", "v7",
          "v8", "v9", "v10", "v11", "v12", "v13", "v14", "v15",
          "v16", "v17", "v18", "v19", "v20", "v21", "v22", "v23",
          "v24", "v25", "v26", "v27", "v28", "v29", "v30", "v31",

          "p0", "p1", "p2", "p3", "p4", "p5", "p6", "p7",
          "p8", "p9", "p10", "p11", "p12", "p13", "p14", "p15",
          "ffr",
        ]);
      case "Arm64EC":
        return clobbered_regs_aarch64([
          // x13 and x14 cannot be used in Arm64EC.
          "x0", "x1", "x2", "x3", "x4", "x5", "x6", "x7",
          "x8", "x9", "x10", "x11", "x12", "x15",
          "x16", "x17", "x30",

          // Technically the low 64 bits of v8-v15 are preserved, but
          // we have no way of expressing this using clobbers.
          "v0", "v1", "v2", "v3", "v4", "v5", "v6", "v7",
          "v8", "v9", "v10", "v11", "v12", "v13", "v14", "v15",
          // v16-v31, p*, and ffr cannot be used in Arm64EC.
        ]);
      // PORT: the register lists of the architectures whose modules are stubs need their register enums.
      case "Arm":
        return unported("rustc_target::asm::arm::ArmInlineAsmReg (InlineAsmClobberAbi::clobbered_regs)");
      case "Avr":
        return unported("rustc_target::asm::avr::AvrInlineAsmReg (InlineAsmClobberAbi::clobbered_regs)");
      case "RiscV":
      case "RiscVE":
        return unported("rustc_target::asm::riscv::RiscVInlineAsmReg (InlineAsmClobberAbi::clobbered_regs)");
      case "LoongArch":
        return unported("rustc_target::asm::loongarch::LoongArchInlineAsmReg (InlineAsmClobberAbi::clobbered_regs)");
      case "PowerPC":
      case "PowerPCSPE":
        return unported("rustc_target::asm::powerpc::PowerPCInlineAsmReg (InlineAsmClobberAbi::clobbered_regs)");
      case "S390x":
        return unported("rustc_target::asm::s390x::S390xInlineAsmReg (InlineAsmClobberAbi::clobbered_regs)");
      case "Bpf":
        return unported("rustc_target::asm::bpf::BpfInlineAsmReg (InlineAsmClobberAbi::clobbered_regs)");
      case "Msp430":
        return unported("rustc_target::asm::msp430::Msp430InlineAsmReg (InlineAsmClobberAbi::clobbered_regs)");
      case "Xtensa":
        return unported("rustc_target::asm::xtensa::XtensaInlineAsmReg (InlineAsmClobberAbi::clobbered_regs)");
    }
  },
} as const;

/** `#[derive(Debug)]` of `InlineAsmClobberAbi` */
export const debug_InlineAsmClobberAbi: Debug<InlineAsmClobberAbi> = (v) => v;
