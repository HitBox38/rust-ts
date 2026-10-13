// The port side of asm_oracle/probe.rs (see its header): the same dump, line for line, from the ported
// `rustc_target::asm`. `bun src/rustc_target/asm/asm_oracle/run.ts`; asm.oracle.test.ts compares its
// stdout section by section with out.stdout.
import { writeSync } from "node:fs";

import { type Config, run_compiler } from "../../../rustc_interface/interface.ts";
import { Options_default } from "../../../rustc_session/config.ts";
import { create_default_session_globals_then } from "../../../rustc_span/lib.ts";
import { debug_Symbol, Symbol } from "../../../rustc_span/symbol.ts";
import { debug_target_spec_other, spec } from "../../lib.ts";
import { type Debug, debug_char, debug_option, debug_set, debug_str, debug_vec, type Fmt, PLAIN } from "../../../std/fmt.ts";
import { debug_result, unwrap_result } from "../../../std/result.ts";
import {
  allocatable_registers,
  debug_chars,
  debug_InlineAsmArch,
  debug_InlineAsmClobberAbi,
  debug_InlineAsmReg,
  debug_InlineAsmRegClass,
  debug_InlineAsmSize,
  debug_InlineAsmType,
  debug_supported_types,
  InlineAsmArch,
  InlineAsmClobberAbi,
  InlineAsmReg,
  InlineAsmRegClass,
  InlineAsmRegOrRegClass,
  InlineAsmType,
  InlineAsmSize,
  type ModifierInfo,
} from "../mod.ts";

const { Target, TargetTuple } = spec;
type Target = spec.Target;

let buf = "";
const println = (s: string): void => {
  buf += `${s}\n`;
};

const TARGETS = [
  "x86_64-unknown-linux-gnu",
  "aarch64-unknown-linux-gnu",
  "aarch64-apple-darwin",
  "x86_64-apple-darwin",
  "x86_64-pc-windows-msvc",
  "wasm32-wasip2",
];

const OVERRIDES: [string, InlineAsmArch][] = [
  ["x86_64-unknown-linux-gnu", "X86"],
  ["x86_64-pc-windows-msvc", "X86"],
  ["aarch64-unknown-linux-gnu", "Arm64EC"],
  ["wasm32-wasip2", "Wasm64"],
];

const CLASSES = [
  "reg", "reg_abcd", "reg_byte", "xmm_reg", "ymm_reg", "zmm_reg", "kreg", "kreg0", "mmx_reg",
  "x87_reg", "tmm_reg", "vreg", "vreg_low16", "preg", "ffr", "local", "freg", "sreg", "qreg",
  "Reg", "", "foo",
];

const REGS = [
  // x86
  "ax", "eax", "rax", "bx", "ebx", "rbx", "cx", "ecx", "rcx", "dx", "edx", "rdx", "si", "esi",
  "rsi", "di", "edi", "rdi", "r8", "r8w", "r8d", "r9", "r10", "r11", "r12", "r13", "r14", "r15d",
  "al", "ah", "bl", "bh", "cl", "ch", "dl", "dh", "sil", "dil", "r8b", "r9b", "r10b", "r11b",
  "r12b", "r13b", "r14b", "r15b", "xmm0", "xmm1", "xmm7", "xmm8", "xmm15", "ymm0", "ymm3",
  "ymm8", "ymm15", "zmm0", "zmm5", "zmm8", "zmm15", "zmm16", "xmm16", "ymm17", "zmm31",
  "xmm31", "k0", "k1", "k7", "mm0", "mm7", "st(0)", "st", "st(1)", "st(7)", "tmm0", "tmm7",
  "bp", "bpl", "ebp", "rbp", "sp", "spl", "esp", "rsp", "ip", "eip", "rip",
  // aarch64
  "x0", "w0", "x1", "x12", "x13", "w14", "x15", "x16", "x17", "x18", "w18", "x19", "w19",
  "x20", "x23", "x24", "x28", "x29", "w29", "fp", "wfp", "x30", "w30", "lr", "wlr", "sp", "wsp",
  "xzr", "wzr", "v0", "b0", "h1", "s2", "d3", "q4", "z5", "v15", "v16", "q20", "v31", "z31",
  "p0", "p7", "p15", "ffr",
  // other / unknown
  "r0", "a0", "f0", "local", "", "RAX", "x31", "v32",
];

const CLOBBER_ABIS = ["C", "system", "efiapi", "win64", "sysv64", "cdecl", "stdcall", "fastcall", "aapcs", "foo"];

function types(): InlineAsmType[] {
  const {
    I8, I16, I32, I64, I128, F16, F32, F64, F128, VecI8, VecI16, VecI32, VecI64, VecI128, VecF16, VecF32,
    VecF64, VecF128, SveVecI8, SveVecI16, SveVecI32, SveVecI64, SveVecI128, SveVecF16, SveVecF32, SveVecF64,
    SveVecF128, SveVecBool,
  } = InlineAsmType;
  return [
    I8, I16, I32, I64, I128, F16, F32, F64, F128,
    VecI8(8), VecI8(16), VecI8(32), VecI8(64), VecI16(4), VecI16(8), VecI16(16), VecI16(32),
    VecI32(2), VecI32(4), VecI32(8), VecI32(16), VecI64(1), VecI64(2), VecI64(4), VecI64(8),
    VecI128(1), VecI128(2), VecF16(4), VecF16(8), VecF16(16), VecF16(32), VecF32(2),
    VecF32(4), VecF32(8), VecF32(16), VecF64(1), VecF64(2), VecF64(4), VecF64(8), VecF128(1),
    VecF128(3), SveVecI8, SveVecI16, SveVecI32, SveVecI64, SveVecI128, SveVecF16, SveVecF32,
    SveVecF64, SveVecF128, SveVecBool,
  ];
}

const f: Fmt = PLAIN;
const dbg = <T>(v: T, d: Debug<T>): string => d(v, f);
const debug_unit: Debug<null> = () => "()";
const debug_strs: Debug<readonly string[]> = (v) => debug_vec(v, f, (s) => debug_str(s));
const debug_syms: Debug<readonly Symbol[]> = (v) => debug_vec(v, f, debug_Symbol);
const debug_regs: Debug<readonly InlineAsmReg[]> = (v) => debug_vec(v, f, debug_InlineAsmReg);

function modifier_info(m: ModifierInfo | undefined): string {
  if (m === undefined) return "None";
  return `Some((${debug_char(m.modifier)}, ${debug_str(m.result)}, ${dbg(m.size, debug_InlineAsmSize)}))`;
}

/** `emit` into a String (`fmt::Write`). */
function emit(reg: InlineAsmReg, arch: InlineAsmArch, modifier: number | undefined): string {
  let s = "";
  unwrap_result(
    InlineAsmReg.emit(
      reg,
      {
        write_str(x) {
          s += x;
          return { $: "Ok", _0: null };
        },
      },
      arch,
      modifier,
    ),
  );
  return s;
}

function dump(target: Target, arch: InlineAsmArch): void {
  const features_sets: [string, Set<Symbol>][] = [
    ["[]", new Set()],
    ["[reserve_x18]", new Set([Symbol.intern("reserve_x18")])],
  ];
  const reloc_model = target.relocation_model;
  println(`reloc_model: ${reloc_model}`);

  println("-- classes");
  for (const name of CLASSES) {
    const r = InlineAsmRegClass.parse(arch, Symbol.intern(name));
    println(`class ${debug_str(name)}: ${dbg(r, (r, f) => debug_result(r, f, debug_InlineAsmRegClass, debug_syms))}`);
    if (r.$ !== "Ok") continue;
    const cls = r._0;
    const rc: InlineAsmRegOrRegClass = { $: "RegClass", _0: cls };
    println(`  name: ${debug_Symbol(InlineAsmRegClass.name(cls), f)}`);
    println(`  display: ${InlineAsmRegOrRegClass.display(rc)}`);
    println(`  reg_or_class.reg_class: ${dbg(InlineAsmRegOrRegClass.reg_class(rc), debug_InlineAsmRegClass)}`);
    println(`  valid_modifiers: ${dbg(InlineAsmRegClass.valid_modifiers(cls, arch), debug_chars)}`);
    println(`  is_clobber_only: ${InlineAsmRegClass.is_clobber_only(cls, arch, false)} ${InlineAsmRegClass.is_clobber_only(cls, arch, true)}`);
    println(`  supported_types(false): ${dbg(InlineAsmRegClass.supported_types(cls, arch, false), debug_supported_types)}`);
    println(`  supported_types(true): ${dbg(InlineAsmRegClass.supported_types(cls, arch, true), debug_supported_types)}`);
    println(`  default_modifier: ${modifier_info(InlineAsmRegClass.default_modifier(cls, arch))}`);
    for (const ty of types()) {
      println(
        `  ${InlineAsmType.display(ty)}: suggest_class=${debug_option(InlineAsmRegClass.suggest_class(cls, arch, ty), f, debug_InlineAsmRegClass)} suggest_modifier=${modifier_info(InlineAsmRegClass.suggest_modifier(cls, arch, ty))}`,
      );
    }
  }

  println("-- regs");
  for (const name of REGS) {
    const r = InlineAsmReg.parse(arch, Symbol.intern(name));
    println(`reg ${debug_str(name)}: ${dbg(r, (r, f) => debug_result(r, f, debug_InlineAsmReg, (e) => debug_str(e)))}`);
    if (r.$ !== "Ok") continue;
    const reg = r._0;
    const rr: InlineAsmRegOrRegClass = { $: "Reg", _0: reg };
    println(`  name: ${InlineAsmReg.name(reg)}`);
    println(`  reg_class: ${dbg(InlineAsmReg.reg_class(reg), debug_InlineAsmRegClass)}`);
    println(`  display: ${InlineAsmRegOrRegClass.display(rr)}`);
    println(`  reg_or_class.reg_class: ${dbg(InlineAsmRegOrRegClass.reg_class(rr), debug_InlineAsmRegClass)}`);
    for (const [fname, features] of features_sets) {
      const v = (is_clobber: boolean): string =>
        dbg(InlineAsmReg.validate(reg, arch, reloc_model, features, target, is_clobber), (r, f) => debug_result(r, f, debug_unit, (e) => debug_str(e)));
      println(`  validate ${fname}: ${v(false)} clobber: ${v(true)}`);
    }
    const emitted = [`None=${emit(reg, arch, undefined)}`];
    for (const m of InlineAsmRegClass.valid_modifiers(InlineAsmReg.reg_class(reg), arch)) {
      emitted.push(`${String.fromCodePoint(m)}=${emit(reg, arch, m)}`);
    }
    println(`  emit: ${emitted.join(" ")}`);
    const overlapping: InlineAsmReg[] = [];
    InlineAsmReg.overlapping_regs(reg, (r) => overlapping.push(r));
    println(`  overlapping_regs: ${debug_regs(overlapping, f)}`);
  }

  for (const [fname, features] of features_sets) {
    println(`-- allocatable_registers ${fname}`);
    const map = allocatable_registers(arch, reloc_model, features, target);
    for (const [cls, regs] of map) {
      println(`${dbg(cls, debug_InlineAsmRegClass)}: ${debug_set(f, [...regs].map((r) => debug_InlineAsmReg(r, f)))}`);
    }
  }

  for (const [fname, features] of features_sets) {
    println(`-- clobber_abi ${fname}`);
    for (const name of CLOBBER_ABIS) {
      const r = InlineAsmClobberAbi.parse(arch, target, features, Symbol.intern(name));
      println(`${debug_str(name)}: ${dbg(r, (r, f) => debug_result(r, f, debug_InlineAsmClobberAbi, debug_strs))}`);
      if (r.$ === "Ok") {
        println(`  clobbered_regs: ${debug_regs(InlineAsmClobberAbi.clobbered_regs(r._0), f)}`);
      }
    }
  }
}

create_default_session_globals_then(() => {
  println("== types");
  for (const ty of types()) {
    const size = InlineAsmType.size(ty);
    println(
      `${dbg(ty, debug_InlineAsmType)}: display=${InlineAsmType.display(ty)} size=${dbg(size, debug_InlineAsmSize)} fixed_size_bytes=${debug_option(InlineAsmSize.fixed_size_bytes(size), f, (n) => String(n))} is_integer=${InlineAsmType.is_integer(ty)}`,
    );
  }
  for (const tuple of TARGETS) {
    const target = Target.expect_builtin(TargetTuple.from_tuple(tuple));
    const asm_arch = target.allow_asm ? InlineAsmArch.from_arch(target.arch) : undefined;
    println(`== ${tuple}`);
    println(`arch: ${debug_target_spec_other(target.arch)} allow_asm: ${target.allow_asm} asm_arch: ${debug_option(asm_arch, f, debug_InlineAsmArch)}`);
    if (asm_arch !== undefined) {
      dump(target, asm_arch);
    }
  }
  for (const [tuple, arch] of OVERRIDES) {
    const target = Target.expect_builtin(TargetTuple.from_tuple(tuple));
    println(`== ${tuple}@${dbg(arch, debug_InlineAsmArch)}`);
    dump(target, arch);
  }
});

/** `Session::asm_arch` of a real session for `--target <tuple>`. */
function session_asm_arch(tuple: string): void {
  const opts = Options_default();
  opts.target_triple = TargetTuple.from_tuple(tuple);
  const config: Config = {
    opts,
    crate_cfg: [],
    crate_check_cfg: [],
    input: { $: "Str", name: { $: "Custom", _0: "unused" }, input: "" },
    output_dir: undefined,
    output_file: undefined,
    ice_file: undefined,
    file_loader: undefined,
    lint_caps: new Map(),
    psess_created: undefined,
    track_state: undefined,
    register_lints: undefined,
    override_queries: undefined,
    extra_symbols: [],
    make_codegen_backend: undefined,
    using_internal_features: { value: false },
  };
  run_compiler(config, (compiler) => {
    println(`${tuple}: ${debug_option(compiler.sess.asm_arch, f, debug_InlineAsmArch)}`);
  });
}

println("== session");
for (const tuple of TARGETS) {
  session_asm_arch(tuple);
}

const out = Buffer.from(buf, "utf8");
let off = 0;
while (off < out.length) off += writeSync(1, out, off);
