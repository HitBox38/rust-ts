// Oracle crate of asm.test.ts (lane cg-asm): inline asm through codegen_inline_asm on aarch64-apple-darwin: register classes and explicit
// registers, in/out/inout/lateout and discarded outputs, `const`, `sym`, every option that changes the IR (pure, nomem,
// readonly, nostack, preserves_flags, noreturn, may_unwind with and without a cleanup), clobber_abi, and template escaping.
#![feature(asm_unwind)]
#![allow(asm_sub_register)]
use std::arch::asm;
#[unsafe(no_mangle)] pub static mut SV: u64 = 3;
#[unsafe(no_mangle)] pub fn reg_classes(a: u64, b: u32, c: f64, d: f32, e: u8, v: std::arch::aarch64::uint8x16_t) -> u64 {
    let mut x = a;
    let y: u32;
    let z: f64;
    let w: f32;
    let q: u8;
    let r: std::arch::aarch64::uint8x16_t;
    unsafe {
        asm!("add {0}, {0}, {1}", inout(reg) x, in(reg) a);
        asm!("mov {0:w}, {1:w}", out(reg) y, in(reg) b);
        asm!("fmov {0:d}, {1:d}", out(vreg) z, in(vreg) c);
        asm!("fmov {0:s}, {1:s}", lateout(vreg) w, in(vreg_low16) d);
        asm!("mov {0:w}, {1:w}", out(reg) q, in(reg) e);
        asm!("mov {0:v}.16b, {1:v}.16b", out(vreg) r, in(vreg) v);
        asm!("mov x1, x2", out("x1") _, in("x2") a, options(nomem, nostack, preserves_flags));
        let p1: u64; asm!("mov {0}, 1", out(reg) p1, options(pure, nomem, nostack)); x += p1;
        let p2: u64; asm!("mov {0}, 2", out(reg) p2, options(pure, readonly, nostack)); x += p2;
        asm!("nop", options(readonly));
        asm!("nop", options(nomem));
        asm!("ldr {0}, [{1}]", out(reg) x, in(reg) &raw const SV);
        asm!("adrp {0}, {1}", out(reg) _, sym SV);
        asm!("mov {0}, #{1}", out(reg) _, const 42);
        asm!("bl {0}", sym helper, clobber_abi("C"));
        asm!("mov x30, x30", out("x30") _, in("v3") c);
        asm!("mov {0}, {1}", inout(reg) x => _, in(reg) 1u64);
        asm!("mov {0}, {1}", inout(reg) x, in(reg) 1u64);
        asm!("mov x5, {0}", in(reg) 2u64, inout("x5") x);
        asm!("mov {0:x}, {1}", out(reg) x, in(reg) e as u64);
    }
    x + y as u64 + z as u64 + w as u64 + q as u64 + unsafe { std::mem::transmute::<_, [u8; 16]>(r)[0] } as u64
}
#[unsafe(no_mangle)] pub extern "C" fn helper() {}
#[unsafe(no_mangle)] pub fn multi_line() {
    unsafe { asm!("nop", "nop", "nop $ 1"); }
}
#[unsafe(no_mangle)] pub fn noreturn() -> ! {
    unsafe { asm!("brk #0", options(noreturn)); }
}
pub struct D;
impl Drop for D { fn drop(&mut self) {} }
#[unsafe(no_mangle)] pub fn unwind_call() { unsafe { asm!("", options(may_unwind)); } }
#[unsafe(no_mangle)] pub fn unwind_invoke() { let _d = D; unsafe { asm!("", options(may_unwind)); } }
