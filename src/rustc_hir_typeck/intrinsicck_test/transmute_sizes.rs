// `check_transmute` (intrinsicck.rs): `SizeSkeleton`s of known sizes, pointers, generic types and fn items.
#![feature(no_core, lang_items, intrinsics, rustc_attrs)]
#![no_core]

#[lang = "pointee_sized"]
pub trait PointeeSized {}
#[lang = "meta_sized"]
pub trait MetaSized: PointeeSized {}
#[lang = "sized"]
pub trait Sized: MetaSized {}
#[lang = "copy"]
pub trait Copy {}
impl Copy for u8 {}
impl Copy for u16 {}
impl Copy for u32 {}
impl Copy for usize {}
impl<T: ?Sized> Copy for &T {}
impl<T: ?Sized> Copy for *const T {}

#[rustc_intrinsic]
pub unsafe fn transmute<Src, Dst>(src: Src) -> Dst;

pub enum Option<T> {
    None,
    Some(T),
}

fn foo() {}

pub struct Wrapper<T>(T);

// same size: no error
pub unsafe fn same(x: u32) -> [u8; 4] {
    transmute(x)
}
pub unsafe fn thin_pointers<T>(x: &T) -> *const u8 {
    transmute(x)
}
pub unsafe fn newtype_pointer<T>(x: Wrapper<&T>) -> Option<&T> {
    transmute(x)
}
pub unsafe fn lifetimes<'a>(x: &'a u8) -> &'static u8 {
    transmute(x)
}

// E0512: known sizes
pub unsafe fn ints(x: u32) -> u64 {
    transmute(x)
}
pub unsafe fn tuple(x: (u8, u16)) -> [u8; 3] {
    transmute(x)
}
// E0512: generic sizes
pub unsafe fn generic<T>(x: T) -> u32 {
    transmute(x)
}
pub unsafe fn generic_array<T>(x: [T; 2]) -> [u8; 3] {
    transmute(x)
}
pub unsafe fn wide_pointer<T: ?Sized>(x: &T) -> usize {
    transmute(x)
}
pub unsafe fn generic_newtype<T>(x: Wrapper<T>) -> u8 {
    transmute(x)
}
// E0591: fn items
pub unsafe fn fn_item() -> usize {
    transmute(foo)
}
pub unsafe fn option_fn_item() -> usize {
    transmute(Option::Some(foo))
}
