//@ edition: 2021
// global_asm! operands and asm! sym operands: const, sym fn, sym static.
#![crate_type = "lib"]
use std::arch::{asm, global_asm};
#[no_mangle] pub static SYM_STATIC: u32 = 1;
fn sym_fn() {}
fn used_from_asm() {}
global_asm!(".pushsection .text.unused,\"ax\"", "call {f}", "mov eax, offset {s}", "mov eax, {c}", ".popsection", f = sym sym_fn, s = sym SYM_STATIC, c = const 1);
pub fn f() { unsafe { asm!("/* {} */", sym used_from_asm); } }
