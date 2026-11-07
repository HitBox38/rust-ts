// E0512 at or above 2^53 bytes: the sizes in bits (rustc_hir_typeck intrinsicck `skeleton_string`), and a generic struct with a
// field that large (lane fixers-46). See big.rs.
#![feature(no_core, lang_items, rustc_attrs, intrinsics)]
#![crate_type = "lib"]
#![no_core]
#![allow(dead_code, internal_features)]

#[lang = "pointee_sized"]
pub trait PointeeSized {}
#[lang = "meta_sized"]
pub trait MetaSized: PointeeSized {}
#[lang = "sized"]
pub trait Sized: MetaSized {}
#[lang = "copy"]
pub trait Copy {}

#[rustc_intrinsic]
pub unsafe fn transmute<Src, Dst>(src: Src) -> Dst;

pub struct B53([u8; 9007199254740992]);
pub struct B53Above([u8; 9007199254740993]);

pub fn different(x: B53) -> B53Above {
    unsafe { transmute(x) }
}

// rustc_middle ty::layout `SizeSkeleton::compute`: the 1-ZST test on a known-size field of a generic struct.
// `T` makes the layout `TooGeneric`, and the known field comes first.
pub struct Generic<T>([u8; 9007199254740992], T);
pub fn generic<T>(x: Generic<T>) -> &'static u8 {
    unsafe { transmute(x) }
}
