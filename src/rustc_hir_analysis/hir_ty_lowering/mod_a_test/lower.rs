// Fixture of src/rustc_hir_analysis/hir_ty_lowering/mod_a.test.ts (lane hir-ty-lowering-a): no_core items whose HIR the
// `impl dyn HirTyLowerer` methods of hir_ty_lowering/mod.rs:1..2185 are run on.
#![feature(no_core)]
#![no_core]

pub trait Tr {
    type Assoc;
    const C: u8;
    fn f();
}

pub trait Other {}

pub trait Sub: Tr {}

pub struct S;

pub struct Wrap<T>(T);

impl Tr for S {
    type Assoc = S;
    const C: u8 = 0;
    fn f() {}
}

pub fn with_lt<'a, T>(x: &'a T, y: Wrap<S>) {}

pub mod m {
    pub trait Inner {
        type Item;
    }
}
