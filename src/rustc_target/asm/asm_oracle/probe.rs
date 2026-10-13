// Oracle probe for `src/rustc_target/asm/asm.oracle.test.ts` (lane target-asm; not part of the build).
//
// Dumps the pinned `rustc_target::asm` (rustc-dev) for the built-in targets rust-ts ports: the
// session's `asm_arch` (`InlineAsmArch::from_arch` when `allow_asm`), register class and register
// parsing, every class's modifiers / supported types / suggestions, every register's validation,
// emission and overlaps, `allocatable_registers` (FxHashMap order), `InlineAsmClobberAbi` parsing and
// `clobbered_regs`, and `InlineAsmType` Display / size. The last section (`== session`) runs
// `rustc_interface::run_compiler` with `--target` for each target and prints the real session's
// `Session::asm_arch` (set by `build_session`). asm_oracle/run.ts prints the same lines from
// the port; asm.oracle.test.ts compares them section by section with out.stdout.
//
// Regenerate (the toolchain is UPSTREAM.json `nightlyName`, with the rustc-dev component):
//   rustc +nightly-2026-10-11 --edition 2024 probe.rs -o $RUST_TS_DATA/tmp/target-asm/probe
//   DYLD_LIBRARY_PATH=$(rustc +nightly-2026-10-11 --print sysroot)/lib \
//     $RUST_TS_DATA/tmp/target-asm/probe > out.stdout
#![feature(rustc_private)]
extern crate rustc_data_structures;
extern crate rustc_driver;
extern crate rustc_interface;
extern crate rustc_session;
extern crate rustc_span;
extern crate rustc_target;

use std::sync::atomic::AtomicBool;

use rustc_data_structures::fx::FxIndexSet;
use rustc_session::config::{Input, Options};
use rustc_span::FileName;
use rustc_span::{Symbol, create_default_session_globals_then};
use rustc_target::asm::{
    InlineAsmArch, InlineAsmClobberAbi, InlineAsmReg, InlineAsmRegClass, InlineAsmRegOrRegClass,
    InlineAsmType, ModifierInfo, allocatable_registers,
};
use rustc_target::spec::{Target, TargetTuple};

const TARGETS: &[&str] = &[
    "x86_64-unknown-linux-gnu",
    "aarch64-unknown-linux-gnu",
    "aarch64-apple-darwin",
    "x86_64-apple-darwin",
    "x86_64-pc-windows-msvc",
    "wasm32-wasip2",
];

/// Arch overrides run on a target of the same family (the arch is a parameter of every fn).
const OVERRIDES: &[(&str, InlineAsmArch)] = &[
    ("x86_64-unknown-linux-gnu", InlineAsmArch::X86),
    ("x86_64-pc-windows-msvc", InlineAsmArch::X86),
    ("aarch64-unknown-linux-gnu", InlineAsmArch::Arm64EC),
    ("wasm32-wasip2", InlineAsmArch::Wasm64),
];

const CLASSES: &[&str] = &[
    "reg", "reg_abcd", "reg_byte", "xmm_reg", "ymm_reg", "zmm_reg", "kreg", "kreg0", "mmx_reg",
    "x87_reg", "tmm_reg", "vreg", "vreg_low16", "preg", "ffr", "local", "freg", "sreg", "qreg",
    "Reg", "", "foo",
];

const REGS: &[&str] = &[
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

const CLOBBER_ABIS: &[&str] =
    &["C", "system", "efiapi", "win64", "sysv64", "cdecl", "stdcall", "fastcall", "aapcs", "foo"];

fn types() -> Vec<InlineAsmType> {
    use InlineAsmType::*;
    vec![
        I8, I16, I32, I64, I128, F16, F32, F64, F128,
        VecI8(8), VecI8(16), VecI8(32), VecI8(64), VecI16(4), VecI16(8), VecI16(16), VecI16(32),
        VecI32(2), VecI32(4), VecI32(8), VecI32(16), VecI64(1), VecI64(2), VecI64(4), VecI64(8),
        VecI128(1), VecI128(2), VecF16(4), VecF16(8), VecF16(16), VecF16(32), VecF32(2),
        VecF32(4), VecF32(8), VecF32(16), VecF64(1), VecF64(2), VecF64(4), VecF64(8), VecF128(1),
        VecF128(3), SveVecI8, SveVecI16, SveVecI32, SveVecI64, SveVecI128, SveVecF16, SveVecF32,
        SveVecF64, SveVecF128, SveVecBool,
    ]
}

fn modifier_info(m: Option<ModifierInfo>) -> String {
    match m {
        Some(ModifierInfo { modifier, result, size }) => {
            format!("Some(({modifier:?}, {result:?}, {size:?}))")
        }
        None => "None".to_string(),
    }
}

/// `emit` into a String (`fmt::Write`).
fn emit(reg: InlineAsmReg, arch: InlineAsmArch, modifier: Option<char>) -> String {
    let mut s = String::new();
    reg.emit(&mut s, arch, modifier).unwrap();
    s
}

fn dump(target: &Target, arch: InlineAsmArch) {
    let features_sets: Vec<(&str, FxIndexSet<Symbol>)> = vec![
        ("[]", FxIndexSet::default()),
        ("[reserve_x18]", [Symbol::intern("reserve_x18")].into_iter().collect()),
    ];
    let reloc_model = target.relocation_model;
    println!("reloc_model: {reloc_model:?}");

    println!("-- classes");
    for name in CLASSES {
        let r = InlineAsmRegClass::parse(arch, Symbol::intern(name));
        println!("class {name:?}: {r:?}");
        let Ok(class) = r else { continue };
        println!("  name: {:?}", class.name());
        println!("  display: {}", InlineAsmRegOrRegClass::RegClass(class));
        println!("  reg_or_class.reg_class: {:?}", InlineAsmRegOrRegClass::RegClass(class).reg_class());
        println!("  valid_modifiers: {:?}", class.valid_modifiers(arch));
        println!(
            "  is_clobber_only: {} {}",
            class.is_clobber_only(arch, false),
            class.is_clobber_only(arch, true)
        );
        println!("  supported_types(false): {:?}", class.supported_types(arch, false));
        println!("  supported_types(true): {:?}", class.supported_types(arch, true));
        println!("  default_modifier: {}", modifier_info(class.default_modifier(arch)));
        for ty in types() {
            println!(
                "  {ty}: suggest_class={:?} suggest_modifier={}",
                class.suggest_class(arch, ty),
                modifier_info(class.suggest_modifier(arch, ty))
            );
        }
    }

    println!("-- regs");
    for name in REGS {
        let r = InlineAsmReg::parse(arch, Symbol::intern(name));
        println!("reg {name:?}: {r:?}");
        let Ok(reg) = r else { continue };
        println!("  name: {}", reg.name());
        println!("  reg_class: {:?}", reg.reg_class());
        println!("  display: {}", InlineAsmRegOrRegClass::Reg(reg));
        println!("  reg_or_class.reg_class: {:?}", InlineAsmRegOrRegClass::Reg(reg).reg_class());
        for (fname, features) in &features_sets {
            println!(
                "  validate {fname}: {:?} clobber: {:?}",
                reg.validate(arch, reloc_model, features, target, false),
                reg.validate(arch, reloc_model, features, target, true)
            );
        }
        let mut emitted = vec![format!("None={}", emit(reg, arch, None))];
        for &m in reg.reg_class().valid_modifiers(arch) {
            emitted.push(format!("{m}={}", emit(reg, arch, Some(m))));
        }
        println!("  emit: {}", emitted.join(" "));
        let mut overlapping = vec![];
        reg.overlapping_regs(|r| overlapping.push(r));
        println!("  overlapping_regs: {overlapping:?}");
    }

    for (fname, features) in &features_sets {
        println!("-- allocatable_registers {fname}");
        let map = allocatable_registers(arch, reloc_model, features, target);
        for (class, regs) in &map {
            println!("{class:?}: {regs:?}");
        }
    }

    for (fname, features) in &features_sets {
        println!("-- clobber_abi {fname}");
        for name in CLOBBER_ABIS {
            let r = InlineAsmClobberAbi::parse(arch, target, features, Symbol::intern(name));
            println!("{name:?}: {r:?}");
            if let Ok(abi) = r {
                println!("  clobbered_regs: {:?}", abi.clobbered_regs());
            }
        }
    }
}

static USING_INTERNAL_FEATURES: AtomicBool = AtomicBool::new(false);

/// `Session::asm_arch` of a real session for `--target <tuple>`.
fn session_asm_arch(tuple: &str) {
    let mut opts = Options::default();
    opts.target_triple = TargetTuple::from_tuple(tuple);
    let config = rustc_interface::Config {
        opts,
        crate_cfg: vec![],
        crate_check_cfg: vec![],
        input: Input::Str { name: FileName::Custom("unused".into()), input: String::new() },
        output_dir: None,
        output_file: None,
        ice_file: None,
        file_loader: None,
        lint_caps: Default::default(),
        psess_created: None,
        track_state: None,
        register_lints: None,
        override_queries: None,
        extra_symbols: vec![],
        make_codegen_backend: None,
        using_internal_features: &USING_INTERNAL_FEATURES,
    };
    rustc_interface::run_compiler(config, |compiler| {
        println!("{tuple}: {:?}", compiler.sess.asm_arch);
    });
}

fn main() {
    create_default_session_globals_then(|| {
        println!("== types");
        for ty in types() {
            println!(
                "{ty:?}: display={ty} size={:?} fixed_size_bytes={:?} is_integer={}",
                ty.size(),
                ty.size().fixed_size_bytes(),
                ty.is_integer()
            );
        }
        for tuple in TARGETS {
            let target = Target::expect_builtin(&TargetTuple::from_tuple(tuple));
            let asm_arch =
                if target.allow_asm { InlineAsmArch::from_arch(&target.arch) } else { None };
            println!("== {tuple}");
            println!("arch: {:?} allow_asm: {} asm_arch: {asm_arch:?}", target.arch, target.allow_asm);
            if let Some(arch) = asm_arch {
                dump(&target, arch);
            }
        }
        for (tuple, arch) in OVERRIDES {
            let target = Target::expect_builtin(&TargetTuple::from_tuple(tuple));
            println!("== {tuple}@{arch:?}");
            dump(&target, *arch);
        }
    });
    println!("== session");
    for tuple in TARGETS {
        session_asm_arch(tuple);
    }
}
