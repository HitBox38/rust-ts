// Review mir-alias F1: `unify_if_equal_const`'s `dest`. At -O GVN has given every constant the same span, so `identical_stmts`
// takes this case first; it stays for this one only with GVN off. `#![no_core]` so that the extra run stays cheap.
#![feature(no_core, lang_items)]
#![crate_type = "lib"]
#![no_core]

#[lang = "pointee_sized"]
pub trait PointeeSized {}
#[lang = "meta_sized"]
pub trait MetaSized: PointeeSized {}
#[lang = "sized"]
pub trait Sized: MetaSized {}
#[lang = "copy"]
pub trait Copy {}
impl Copy for i32 {}
impl Copy for bool {}

pub fn same_const_in_each_arm(i: i32) -> bool {
    match i {
        7 => false,
        _ => false,
    }
}
