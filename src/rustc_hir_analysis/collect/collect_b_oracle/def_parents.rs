#![feature(no_core, lang_items, rustc_attrs)]
#![allow(internal_features)]
#![no_core]
#![crate_type = "lib"]

#[lang = "pointee_sized"]
pub trait PointeeSized {}
#[lang = "meta_sized"]
pub trait MetaSized: PointeeSized {}
#[lang = "sized"]
pub trait Sized: MetaSized {}

pub struct Struct<const N: usize>;

pub const fn qux<const N: usize>() {}

fn parent() {
    #[rustc_dump_def_parents]
    fn child() {}
}

mod m {
    #[rustc_dump_def_parents]
    pub fn g() -> super::Struct<3> {
        super::qux::<{ let _x = 1; 2 }>();
        fn inner() {
            super::qux::<{ let _y = 3; 4 }>();
        }
        loop {}
    }
}

pub fn not_dumped() {}
