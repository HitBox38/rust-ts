// asm goto (`callbr`) and the IR mangler (`LLVMRustGetMangledName`) on aarch64-apple-darwin (Mach-O: `_` global prefix).
#![feature(asm_goto_with_outputs, asm_const_ptr)]
use std::arch::{asm, global_asm, naked_asm};

pub fn goto_one(x: u64) -> u64 {
    unsafe {
        asm!("cbz {0}, {1}", in(reg) x, label { return 1; });
    }
    2
}

pub fn goto_many(x: u64) -> u32 {
    let mut r = 0;
    unsafe {
        asm!(
            "cbz {0}, {1}",
            "cbnz {0}, {2}",
            "b {3}",
            in(reg) x,
            label { r = 10; },
            label { r = 20; },
            label { r = 30; },
        );
    }
    r
}

pub fn goto_out(x: u64) -> u64 {
    let y: u64;
    unsafe {
        asm!("mov {1}, {0}", "cbz {0}, {2}", in(reg) x, out(reg) y, label { return 0; });
    }
    y
}

pub fn goto_noreturn(x: u64) -> u64 {
    unsafe {
        asm!("cbz {0}, {1}", "b {2}", in(reg) x, label { return 5; }, label { return 6; }, options(noreturn));
    }
}

#[unsafe(naked)]
pub extern "C" fn naked_plain() -> u64 {
    naked_asm!("mov x0, #1", "ret")
}

#[unsafe(naked)]
#[unsafe(no_mangle)]
pub extern "C" fn naked_no_mangle() -> u64 {
    naked_asm!("b {}", sym naked_plain)
}

#[unsafe(naked)]
#[unsafe(export_name = "\u{1}raw_name")]
pub extern "C" fn naked_raw() -> u64 {
    naked_asm!("ret")
}

#[unsafe(naked)]
#[unsafe(export_name = "?question")]
pub extern "C" fn naked_question() -> u64 {
    naked_asm!("ret")
}

#[unsafe(naked)]
extern "C" fn naked_private() -> u64 {
    naked_asm!("ret")
}

pub fn use_private() -> u64 {
    naked_private()
}

pub static STATIC: u64 = 7;
#[unsafe(no_mangle)]
pub static STATIC_NM: u64 = 8;

global_asm!(".globl {0}", ".set {0}_alias, {1}", sym naked_no_mangle, sym STATIC);
global_asm!("// {0} {1}", sym STATIC_NM, sym goto_one);
global_asm!("// {0} {1} {2}", const &STATIC, const &[1u8, 2, 3], const &STATIC_NM);
