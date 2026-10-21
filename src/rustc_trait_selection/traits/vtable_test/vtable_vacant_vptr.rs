// Vacant entries (where-clauses that do not hold), supertrait vptrs (multiple inheritance) and a by-value `self`
// method (`shim(vtable)`).
#![feature(rustc_attrs)]
#![feature(negative_impls)]

trait A {
    fn foo_a1(&self) {}
    fn foo_a2(&self) where Self: Send {}
}

trait B {
    fn foo_b(&self) {}
}

trait C: A + B {
    fn foo_c(&self) {}
    fn consume(self);
}

pub struct S;
impl !Send for S {}

#[rustc_dump_vtable]
impl A for S {}

impl B for S {}

#[rustc_dump_vtable]
impl C for S {
    fn consume(self) {}
}
