// asm goto (`callbr`) and the IR mangler (`LLVMRustGetMangledName`) on x86_64-unknown-linux-gnu (ELF: no global prefix), with
// the vectorcall rule (`name@@<bytes>`) that applies on every data layout.
#![feature(asm_goto_with_outputs, asm_const_ptr, abi_vectorcall)]
use std::arch::{asm, global_asm, naked_asm};

pub fn goto_two(x: u64) -> u32 {
    unsafe {
        asm!("test {0}, {0}", "jz {1}", "jmp {2}", in(reg) x, label { return 1; }, label { return 2; });
    }
    0
}

pub fn goto_inout(mut x: u64) -> u64 {
    unsafe {
        asm!("dec {0}", "jz {1}", inout(reg) x, label { return 100; }, options(att_syntax));
    }
    x
}

pub fn goto_unwind_free(p: *const u8) -> u8 {
    let mut r = 0;
    unsafe {
        asm!("cmp byte ptr [{0}], 0", "je {1}", in(reg) p, label { r = 1; }, options(readonly, nostack));
    }
    r
}

#[unsafe(naked)]
pub extern "C" fn naked_plain() -> u64 {
    naked_asm!("mov eax, 1", "ret")
}

#[unsafe(naked)]
#[unsafe(no_mangle)]
pub extern "C" fn naked_no_mangle() -> u64 {
    naked_asm!("jmp {}", sym naked_plain)
}

#[unsafe(naked)]
#[unsafe(no_mangle)]
pub extern "vectorcall" fn naked_vectorcall() {
    naked_asm!("ret")
}

#[unsafe(naked)]
#[unsafe(export_name = "\u{1}raw_name")]
pub extern "vectorcall" fn naked_vectorcall_raw() {
    naked_asm!("ret")
}

#[unsafe(naked)]
#[unsafe(export_name = "?question")]
pub extern "C" fn naked_question() -> u64 {
    naked_asm!("ret")
}

pub static STATIC: u64 = 7;
#[unsafe(no_mangle)]
pub static STATIC_NM: u64 = 8;

global_asm!(".globl {0}", ".set {0}_alias, {1}", sym naked_no_mangle, sym STATIC);
global_asm!("// {0} {1} {2}", sym STATIC_NM, sym goto_two, sym naked_vectorcall);
global_asm!("// {0} {1} {2}", const &STATIC, const &[1u8, 2, 3], const &STATIC_NM);
