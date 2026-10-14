// Fixture of src/rustc_ty_utils/assoc.test.ts (lane assoc-opaque): a no_core trait, a trait impl and an inherent impl.
#![feature(no_core)]
#![no_core]

pub trait Tr {
    const C: u8;
    type T;
    fn by_ref(&self);
    fn by_val(self, x: u8);
    fn assoc_fn(x: u8);
    fn provided(&self) {}
}

pub struct S;

impl Tr for S {
    const C: u8 = 0;
    type T = S;
    fn by_ref(&self) {}
    fn by_val(self, _x: u8) {}
    fn assoc_fn(_x: u8) {}
}

impl S {
    pub fn method(&self) {}
    pub fn new() -> S {
        S
    }
}
