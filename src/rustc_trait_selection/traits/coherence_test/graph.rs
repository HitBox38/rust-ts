// coherence_test (lane trait-sel-traits-c): specialization graphs whose impls never overlap, so that
// `specialization_graph_of` completes without the trait solver: every pair of impls of a trait is either rejected by
// `DeepRejectCtxt` or fails `equate_impl_headers`.
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

pub struct A;
pub struct B<T>(T);
pub enum E {}
pub struct L<'a>(&'a ());

// Non-blanket impls in several `SimplifiedType` buckets, out of the definition order of their self types.
pub trait Tr {}
impl Tr for B<A> {}
impl Tr for A {}
impl<T> Tr for B<B<T>> {}
impl Tr for E {}
impl Tr for (A, E) {}
impl Tr for (E, A) {}
impl<'a> Tr for &'a A {}
impl Tr for &'static mut A {}
impl Tr for u8 {}
impl Tr for [A] {}
impl<const N: usize> Tr for [E; N] {}
impl<'a> Tr for L<'a> {}
impl Tr for *const A {}
impl Tr for str {}
impl Tr for bool {}
impl Tr for char {}

// Blanket impls, rejected against each other by their trait arguments.
pub trait Tr2<T> {}
impl<T> Tr2<A> for T {}
impl<T> Tr2<E> for T {}
impl Tr2<B<A>> for A {}
impl<T> Tr2<u8> for B<T> {}

// `DeepRejectCtxt` lets these through; the impl headers do not unify.
pub trait Tr3<T> {}
impl<T> Tr3<T> for T {}
impl Tr3<u8> for u16 {}
impl Tr3<B<u8>> for B<u16> {}

pub trait Empty {}
pub trait One {}
impl<T> One for T {}

impl A {}
impl B<A> {}
impl<T> B<B<T>> {}
impl E {}
impl<'a> L<'a> {}
