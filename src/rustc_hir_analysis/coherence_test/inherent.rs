#![feature(no_core, lang_items, extern_types)]
#![allow(internal_features, dead_code)]
#![no_core]
#![crate_type = "lib"]

#[lang = "pointee_sized"]
pub trait PointeeSized {}
#[lang = "meta_sized"]
pub trait MetaSized: PointeeSized {}
#[lang = "sized"]
pub trait Sized: MetaSized {}
#[lang = "copy"]
pub trait Copy {}

pub trait Tr {}

pub struct A;
pub struct B<T>(T);
pub enum E {}
unsafe extern "C" {
    pub type Ext;
}

impl A {
    pub fn f() {}
}
impl<T> B<T> {
    pub fn g() {}
}
impl B<A> {
    pub fn h() {}
}
impl E {}
impl Ext {}
pub mod m {
    pub struct C;
    impl super::A {
        pub fn in_mod() {}
    }
    impl C {}
    impl super::E {
        pub fn e() {}
    }
}
impl m::C {
    pub fn c() {}
}
impl A {
    pub const K: () = ();
}
pub type Alias = B<E>;
impl Alias {}
pub type AliasA = A;
impl AliasA {}
pub fn outer() {
    struct Local;
    impl Local {}
    impl A {
        fn in_fn() {}
    }
}
const _: () = {
    impl B<E> {
        pub fn anon() {}
    }
};
