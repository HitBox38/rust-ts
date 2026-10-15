#![feature(no_core, lang_items, const_trait_impl, const_closures, rustc_attrs)]
#![no_core]
#![allow(internal_features)]
#![crate_type = "lib"]

#[lang = "pointee_sized"]
pub trait PointeeSized {}
#[lang = "meta_sized"]
pub trait MetaSized: PointeeSized {}
#[lang = "sized"]
pub trait Sized: MetaSized {}

pub struct S;
pub struct T(u8);
pub enum E {
    A(u8),
    B { x: u8 },
}

pub const fn cf() {}
pub fn nf() {}

impl S {
    pub const fn icf() {}
    pub fn inf() {}
}

const impl S {
    pub fn in_const_impl() {}
}

pub const trait Tr {
    fn m();
    #[rustc_non_const_trait_method]
    fn non_const_m();
}
const impl Tr for S {
    fn m() {}
    fn non_const_m() {}
}

pub trait Plain {
    fn p();
}
impl Plain for T {
    fn p() {}
}

unsafe extern "C" {
    pub fn ext();
}

pub const fn with_closures() {
    let _a = || {};
    let _b = const || {};
}

pub fn closure_outside() {
    let _c = || {};
}
