// E0512 and E0080 at or above 2^53 bytes: the sizes in bits (rustc_hir_typeck intrinsicck `skeleton_string`), a generic struct with a
// field that large (lane fixers-46), and a `static` that large (lane fixers-47). See big.rs.
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

// rustc_hir_typeck intrinsicck `check_transmute`'s E0591: a function item transmuted to a type of 2^53 bytes (review fixers-46 F1).
fn foo() {}
pub fn fn_item() -> B53 {
    unsafe { transmute(foo) }
}

// rustc_middle mir::interpret allocation `AllocBytes::zeroed` (and rustc_const_eval interpret util `create_static_alloc`'s
// `assert_eq!` of the sizes) for a `static` of 2^53 + 1 bytes: E0080 (review fixers-46 F4).
impl Copy for u8 {}
pub static mut STATIC: [u8; 9007199254740993] = [0; 9007199254740993];
