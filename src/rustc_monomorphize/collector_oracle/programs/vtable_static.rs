//@ edition: 2021
// A vtable pointer in a static: `collect_alloc`'s `GlobalAlloc::VTable` arm calls `tcx.vtable_allocation`.
#![crate_type = "lib"]
pub trait Tr { fn m(&self) -> u32; fn d(&self) -> u32 { self.m() + 1 } }
pub struct S(pub u32);
impl Tr for S { fn m(&self) -> u32 { self.0 } }
static OBJ: &(dyn Tr + Sync) = &S(1);
pub static REF_TO_OBJ: &&(dyn Tr + Sync) = &OBJ;
