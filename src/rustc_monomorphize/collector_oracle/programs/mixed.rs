//@ edition: 2021
// Statics, vtables, drop glue, closures, fn pointers, `#[inline]`, thread locals.
#![crate_type = "lib"]
#![feature(thread_local)]
use std::cell::Cell;
use std::fmt::Debug;

pub trait Tr {
    fn m(&self) -> u32;
    fn d(&self) -> u32 { self.m() + 1 }
    fn g<T>(&self, _: T) where Self: Sized {}
}
pub struct S(pub u32);
impl Tr for S { fn m(&self) -> u32 { self.0 } }
pub struct D(pub S, pub Vec<u8>);
impl Drop for D { fn drop(&mut self) {} }

fn id(x: u32) -> u32 { x }
fn gen_fn<X: Tr>(x: X) -> u32 { x.d() }
#[inline] pub fn inl() -> u32 { id(1) }
#[inline(always)] fn inl_always() -> u32 { id(2) }
#[inline(never)] fn inl_never<T>(_: T) -> u32 { id(3) }

pub static TABLE: [fn(u32) -> u32; 2] = [id, |x| x + 1];
#[thread_local] pub static TL: Cell<u32> = Cell::new(0);

pub fn f(o: &dyn Debug) -> u32 {
    let d = D(S(1), vec![1]);
    let b: Box<dyn Tr> = Box::new(S(2));
    let c = |y: u32| y + d.0.m();
    let p: fn(u32) -> u32 = |y| y;
    TL.set(1);
    let _ = format!("{:?}", o);
    gen_fn(S(2)) + c(1) + p(1) + b.d() + inl_always() + inl_never(1u8) + inl_never("a") + TL.get()
}
