//@ edition: 2021
// `create_mono_items_for_vtable_methods`' destructor: nothing but the vtable uses this drop glue.
#![crate_type = "lib"]
pub trait Tr { fn m(&self) -> u32; }
pub struct D(pub u32);
impl Drop for D { fn drop(&mut self) {} }
impl Tr for D { fn m(&self) -> u32 { self.0 } }
pub fn f(d: &'static D) -> &'static dyn Tr { d }
