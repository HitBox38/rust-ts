#![feature(no_core, lang_items)]
#![allow(internal_features)]
#![no_core]

#[lang = "pointee_sized"]
pub trait PointeeSized {}
#[lang = "meta_sized"]
pub trait MetaSized: PointeeSized {}
#[lang = "sized"]
pub trait Sized: MetaSized {}
#[lang = "sync"]
pub unsafe trait Sync {}
unsafe impl Sync for u32 {}
#[lang = "copy"]
pub trait Copy: Sized {}
impl Copy for u32 {}
#[lang = "drop_glue"]
fn drop_glue<T>(_: &mut T) {}

mod a {
    #[inline(never)]
    pub fn helper(x: u32) -> u32 {
        x
    }
    pub static A_DATA: u32 = 11;
}

mod b {
    #[no_mangle]
    pub extern "C" fn nc_exported() -> u32 {
        crate::a::helper(crate::a::A_DATA)
    }
}

#[no_mangle]
pub static NC_DATA: u32 = 3;
