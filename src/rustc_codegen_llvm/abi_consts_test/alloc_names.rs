// Fixture of abi_consts.test.ts (lane stable-hash-alloc): the `alloc_<hash>` names of anonymous constant allocations, built
// without `-Zfewer-names`. Each name is `alloc_` and the allocation's `StableHash` (`Hash128`, 32 hex digits), so it covers
// the derives of `Allocation` and its parts, and `AllocId`'s impl through `GlobalAlloc` for a relocation.
#![crate_type = "lib"]
#![no_std]
#![allow(dead_code)]

pub static S_U32: u32 = 7;
// A string literal: bytes only, fully initialized (a lazy init mask).
pub static A_STR: &str = "hello";
// Uninit padding: `(u8, u32)` has three padding bytes (a materialized init mask, one block).
pub static A_PAD: &(u8, u32) = &(1, 2);
// More than 64 bytes with padding: several init mask blocks. The 12-byte period makes the two 32-bit halves of a block
// differ, so the block is hashed as one u64 (init_mask.ts keeps it as two words).
#[repr(C)]
#[derive(Clone, Copy)]
pub struct P {
    a: u8,
    b: u32,
    c: u8,
    d: u16,
}
pub static A_BIG: &[P; 8] = &[P { a: 1, b: 2, c: 3, d: 4 }; 8];
// A relocation to another static (`GlobalAlloc::Static`).
pub static A_REF: &&u32 = &&S_U32;
// A relocation to another anonymous allocation (`GlobalAlloc::Memory`).
pub static A_REFSTR: &&str = &"hi";
// A relocation to a fn (`GlobalAlloc::Function`).
#[no_mangle]
pub extern "C" fn target() {}
pub static A_FN: &extern "C" fn() = &(target as extern "C" fn());
// A relocation to a vtable (`GlobalAlloc::VTable`), in an allocation holding a `&dyn` (the vtable is named too).
pub static A_DYN: &&(dyn Sync + 'static) = &(&5u32 as &(dyn Sync + 'static));
