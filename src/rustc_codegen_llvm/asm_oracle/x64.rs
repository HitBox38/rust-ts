// Oracle crate of asm.test.ts (lane cg-asm): inline asm through codegen_inline_asm on x86_64-unknown-linux-gnu: register classes and explicit
// registers, in/out/inout/lateout and discarded outputs, `const`, `sym`, every option that changes the IR (pure, nomem,
// readonly, nostack, preserves_flags, noreturn, att_syntax, may_unwind with and without a cleanup), clobber_abi, and template escaping.
#![feature(asm_unwind)]
use std::arch::asm;
#[unsafe(no_mangle)] pub static mut SV: u64 = 3;
#[unsafe(no_mangle)] pub fn reg_classes(a: u64, b: u32, c: f64, d: f32, e: u8, h: u16) -> u64 {
    let mut x = a;
    let y: u32; let z: f64; let w: f32; let q: u8; let k: u16;
    unsafe {
        asm!("add {0}, {1}", inout(reg) x, in(reg) a);
        asm!("mov {0:e}, {1:e}", out(reg) y, in(reg) b);
        asm!("movsd {0}, {1}", out(xmm_reg) z, in(xmm_reg) c);
        asm!("movss {0}, {1}", lateout(xmm_reg) w, in(xmm_reg) d);
        asm!("mov {0}, {1}", out(reg_byte) q, in(reg_byte) e);
        asm!("mov {0:x}, {1:x}", out(reg_abcd) k, in(reg_abcd) h);
        asm!("mov rax, rbx", out("rax") _, in("rcx") a, options(nomem, nostack, preserves_flags));
        let p1: u64; asm!("mov {0}, 1", out(reg) p1, options(pure, nomem, nostack)); x += p1;
        let p2: u64; asm!("mov {0}, 2", out(reg) p2, options(pure, readonly, nostack)); x += p2;
        asm!("nop", options(readonly));
        asm!("nop", options(nomem, att_syntax));
        asm!("mov {0}, [{1}]", out(reg) x, in(reg) &raw const SV);
        asm!("lea {0}, [rip + {1}]", out(reg) _, sym SV);
        asm!("mov {0}, {1}", out(reg) _, const -3i32);
        asm!("call {0}", sym helper, clobber_abi("C"));
        asm!("", out("xmm0") _, out("ymm1") _, out("st(0)") _, out("mm0") _, out("k1") _);
        asm!("mov {0}, {1}", inout(reg) x => _, in(reg) 1u64);
        asm!("mov rdx, {0}", in(reg) 2u64, inout("rdx") x);
        asm!("mov {0:l}, {1:h}", out(reg_abcd) _, in(reg_abcd) 2u64);
        asm!("nop", in("eax") 1u32, in("cx") 2u16, in("dl") 3u8);
        asm!("", options(may_unwind));
    }
    x + y as u64 + z as u64 + w as u64 + q as u64 + k as u64
}
#[unsafe(no_mangle)] pub extern "C" fn helper() {}
#[unsafe(no_mangle)] pub fn multi_line() { unsafe { asm!("nop", "nop", "nop $ 1"); } }
#[target_feature(enable = "avx")] #[unsafe(no_mangle)] pub fn avx(c: f64, v: std::arch::x86_64::__m256) -> std::arch::x86_64::__m256 {
    let r; unsafe { asm!("vmovaps {0}, {1}", out(ymm_reg) _, in(xmm_reg) c); asm!("vmovaps {0}, {1}", out(ymm_reg) r, in(ymm_reg) v); } r
}
pub struct D;
impl Drop for D { fn drop(&mut self) {} }
#[unsafe(no_mangle)] pub fn unwind_call() { unsafe { asm!("", options(may_unwind)); } }
#[unsafe(no_mangle)] pub fn unwind_invoke() { let _d = D; unsafe { asm!("", options(may_unwind)); } }
#[unsafe(no_mangle)] pub fn noreturn() -> ! { unsafe { asm!("ud2", options(noreturn)); } }
