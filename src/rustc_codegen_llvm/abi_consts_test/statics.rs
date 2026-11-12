// Fixture of abi_consts.test.ts (lane cg-abi-consts): statics. The oracle's `--emit=llvm-ir` shows each global (its linkage,
// constness, type, initializer, section, thread-local mode and alignment) and the `llvm.used` / `llvm.compiler.used` arrays;
// the port builds them with `predefine_static` + `codegen_static` (consts.rs) and `create_used_variable_impl`.
#![crate_type = "lib"]
#![no_std]
#![feature(thread_local, linkage)]
#![allow(dead_code, static_mut_refs)]

use core::sync::atomic::AtomicU32;

pub static S_U32: u32 = 7;
pub static S_BYTES: [u8; 5] = *b"abcde";
// A string literal: a relocation to an anonymous constant allocation.
pub static S_STR: &str = "hello";
pub static S_STRS: [&str; 2] = ["ab", "cd"];
// Uninit padding: init and uninit chunks.
pub static S_PAD: (u8, u32) = (1, 2);
// A relocation to another static.
pub static S_REF: &u32 = &S_U32;
// Mutable, and interior mutability: not `constant`.
pub static mut S_MUT: [u16; 3] = [1, 2, 3];
pub static S_ATOMIC: AtomicU32 = AtomicU32::new(5);
// Not reachable from other crates.
static S_PRIV: u64 = 9;
pub static S_PRIV_REF: &u64 = &S_PRIV;
// `#[used]`, `#[link_section]`, thread-local.
#[used]
static S_USED: u32 = 1;
#[unsafe(link_section = ".custom")]
pub static S_SECT: u32 = 3;
#[thread_local]
pub static S_TLS: u32 = 4;
// A relocation to a fn.
#[no_mangle]
pub extern "C" fn target() {}
pub static S_FN: extern "C" fn() = target;
// A relocation to an extern static, and to an `extern_weak` one.
extern "C" {
    static EXT: u32;
    #[linkage = "extern_weak"]
    static WEAK: Option<&'static u32>;
}
pub static S_EXT: &u32 = unsafe { &EXT };
pub static S_WEAK: &Option<&u32> = unsafe { &WEAK };
// A zero-sized static.
pub static S_ZST: () = ();
