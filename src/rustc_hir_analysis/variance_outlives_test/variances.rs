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
#[lang = "copy"]
pub trait Copy {}

#[lang = "phantom_data"]
pub struct PhantomData<T: ?Sized>;
#[lang = "unsafe_cell"]
pub struct UnsafeCell<T: ?Sized> {
    value: T,
}

#[rustc_dump_variances]
pub struct Co<'a, T>(&'a T);
#[rustc_dump_variances]
pub struct Inv<'a, T>(&'a mut T);
#[rustc_dump_variances]
pub struct Cell<T>(UnsafeCell<T>);
#[rustc_dump_variances]
pub struct Phantom<'a, T>(PhantomData<&'a T>);
#[rustc_dump_variances]
pub struct Nested<'a, 'b, T, U> {
    a: Co<'a, T>,
    b: Inv<'b, U>,
    c: *mut U,
}
#[rustc_dump_variances]
pub enum E<'a, T> {
    A(&'a T),
    B(*const T),
    C,
}
#[rustc_dump_variances]
pub struct List<'a, T> {
    head: &'a T,
    tail: *const List<'a, T>,
}
#[rustc_dump_variances]
pub struct A<T>(*const B<T>, T);
#[rustc_dump_variances]
pub struct B<T>(*mut A<T>);
#[rustc_dump_variances]
pub struct Arr<T, const N: usize>([T; N]);
#[rustc_dump_variances]
pub struct Tup<'a, 'b, T>((&'a T, &'b mut ()));
#[rustc_dump_variances]
pub fn f<'a: 'a, T, U>(_x: &'a T) {}
#[rustc_dump_variances]
pub fn h<'a: 'a, 'b: 'b, 'c: 'c, T, U>(_x: &'a mut Co<'b, T>, _y: *const U) -> Co<'c, U> {
    loop {}
}
#[rustc_dump_variances]
pub union Un<'a, T: Copy> {
    a: &'a T,
}
pub struct S;
impl S {
    #[rustc_dump_variances]
    pub fn m<'b: 'b, T>(_x: &'b T) {}
}
