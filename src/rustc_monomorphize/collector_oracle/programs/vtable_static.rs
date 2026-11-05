//@ edition: 2021
// A vtable pointer in a static: `collect_alloc`'s `GlobalAlloc::VTable` arm calls `tcx.vtable_allocation`.
// What `vtable_allocation_provider` writes (plan-m7 O3), which oracle/vtable_static.vtables.txt holds slot by slot: drop slots
// (null / glue), size and align, overriding and default methods, vacant slots, supertrait pointers, no principal, a closure,
// and a type of more than 2^53 bytes.
#![feature(negative_impls)]
#![crate_type = "lib"]
#![allow(dead_code)]

pub trait Plain {
    fn own(&self) -> u32;
    fn with_default(&self) -> u32 {
        self.own() + 1
    }
    fn not_in_vtable() -> u32
    where
        Self: Sized,
    {
        3
    }
}

pub struct NoDrop(pub u32);
impl Plain for NoDrop {
    fn own(&self) -> u32 {
        self.0
    }
}
pub struct NeedsDrop(pub u8, pub Vec<u8>);
impl Plain for NeedsDrop {
    fn own(&self) -> u32 {
        self.0 as u32
    }
    fn with_default(&self) -> u32 {
        4
    }
}
pub struct Zst;
impl Plain for Zst {
    fn own(&self) -> u32 {
        5
    }
}
#[repr(align(64))]
pub struct Aligned(u8);
impl Plain for Aligned {
    fn own(&self) -> u32 {
        6
    }
}
pub struct Generic<T>(pub T);
impl<T: Sync> Plain for Generic<T> {
    fn own(&self) -> u32 {
        7
    }
}
// Private: `pub` would reach the `Size` stop at rustc_lint/builtin.ts `MissingCopyImplementations` (see docs/handoff/abi-vtable.md).
struct Huge([u8; 1 << 60]);
impl Plain for Huge {
    fn own(&self) -> u32 {
        8
    }
}

// As tests/ui/traits/vtable/vtable-vacant.rs: a method whose where clause does not hold is a `Vacant` slot, left uninit.
pub trait Vacant {
    fn present(&self) {}
    fn vacant(&self)
    where
        Self: Send,
    {
    }
    fn after(&self) {}
}
pub struct NotSend;
impl !Send for NotSend {}
unsafe impl Sync for NotSend {}
impl Vacant for NotSend {}

// As tests/ui/traits/vtable/vtable-multiple.rs: the second supertrait needs a `TraitVPtr`.
pub trait First {
    fn first(&self) {}
}
pub trait Second {
    fn second(&self) {}
}
pub trait Both: First + Second {
    fn both(&self) {}
}
pub struct Diamond;
impl First for Diamond {}
impl Second for Diamond {}
impl Both for Diamond {}

pub struct Raw(pub *const dyn Plain);
unsafe impl Sync for Raw {}

pub static NO_DROP: &(dyn Plain + Sync) = &NoDrop(1);
pub static NEEDS_DROP_PTR: Raw = Raw(8 as *const NeedsDrop as *const dyn Plain);
pub static ZST: &(dyn Plain + Sync) = &Zst;
pub static ALIGNED: &(dyn Plain + Sync) = &Aligned(1);
pub static GENERIC: &(dyn Plain + Sync) = &Generic(1u16);
pub static HUGE_PTR: Raw = Raw(8 as *const Huge as *const dyn Plain);
pub static VACANT: &(dyn Vacant + Sync) = &NotSend;
pub static SUPERTRAITS: &(dyn Both + Sync) = &Diamond;
pub static NO_PRINCIPAL: &(dyn Send + Sync) = &1u32;
pub static CLOSURE: &(dyn Fn(u32) -> u32 + Sync) = &|x| x + 1;
pub static NESTED: &&(dyn Plain + Sync) = &NO_DROP;

// The case this program started from.
pub trait Tr { fn m(&self) -> u32; fn d(&self) -> u32 { self.m() + 1 } }
pub struct S(pub u32);
impl Tr for S { fn m(&self) -> u32 { self.0 } }
static OBJ: &(dyn Tr + Sync) = &S(1);
pub static REF_TO_OBJ: &&(dyn Tr + Sync) = &OBJ;
