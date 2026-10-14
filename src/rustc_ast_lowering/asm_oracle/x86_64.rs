// Cases of src/rustc_ast_lowering/asm.test.ts (--target x86_64-unknown-linux-gnu): every `asm!` here is lowered by the
// port (with a recording LoweringContext) and compared with the pinned rustc's `-Zunpretty=hir` of this file.
#![allow(unused)]
use std::arch::asm;

static S: i32 = 0;
fn f() {}

unsafe fn cases(x: u64, mut y: u64, z: u32) {
    asm!("mov {0}, {1}", "add {0:e}, 1", out(reg) y, in(reg) x, options(nostack));
    asm!("nop", options(nomem, preserves_flags, nostack, noreturn));
    asm!("nop", clobber_abi("C"));
    asm!("call {}", sym f, in("rdi") x, lateout("rax") y, clobber_abi("sysv64"));
    asm!("call {}", sym f, out("xmm0") _, clobber_abi("C", "win64"));
    asm!("lea {}, [{}]", out(reg) y, sym S);
    asm!("{0} {1:x}", const 5, inout(xmm_reg) x => y, options(att_syntax));
    asm!("{0:r} {1}", inlateout(reg) x => _, inout(reg_abcd) z);
    asm!("{}", out(reg_byte) _, in("eax") z, lateout("edx") y, out("ecx") _);
    asm!("jmp {}", label { f(); });
    asm!("", in("al") 1u8, out("ah") _, inout("bx") z);
}

fn main() {}
