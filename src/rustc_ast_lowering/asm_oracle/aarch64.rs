// Cases of src/rustc_ast_lowering/asm.test.ts (--target aarch64-apple-darwin, the host's std).
#![allow(unused)]
use std::arch::asm;

unsafe fn cases(x: u64, mut y: u64, v: f64) {
    asm!("add {0}, {1}, #1", out(reg) y, in(reg) x);
    asm!("mov {0:w}, w2", in(reg) x, lateout("x2") y, clobber_abi("C"));
    asm!("fadd {0:d}, {0:d}, {0:d}", inout(vreg) v => _, in("x0") x, out("v1") _);
    asm!("nop", in("x8") x, out("w9") y, options(nostack, nomem));
}

fn main() {}
