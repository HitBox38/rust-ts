#![feature(no_core, lang_items)]
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
pub struct PhantomData<T: PointeeSized>;

// E0392 with a `phantom_data` lang item: `Adt` help.
pub struct A<T>;
pub struct B<'a>;
pub enum C<T> {
    X,
}
pub struct D<T: Copy>;
pub struct E<T>
where
    T: Copy;
pub struct F<T>(*const F<T>);
pub struct G<T, U>(U);
pub struct H<const N: usize>;
pub struct I<'a, T>(&'a T);
pub enum J<'a, 'b, T> {
    X(&'a T),
    Y(*const J<'a, 'b, T>),
}
pub struct K<T>(*const Self);
