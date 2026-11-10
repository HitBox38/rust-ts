// Input of graphviz.test.ts: `-Zdump-mir=f -Zdump-mir-dataflow` on a #![no_core] crate.
#![feature(no_core, lang_items)]
#![allow(internal_features)]
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
impl Copy for bool {}
impl<T: ?Sized> Copy for &T {}

pub struct S<'a> {
    pub r: &'a mut u8,
}

fn g(x: u8, _y: &u8) -> u8 {
    x
}

pub fn f<'a>(c: bool, a: u8, s: S<'a>, t: &'a mut u8) -> &'a mut u8 {
    let mut v = a;
    let w = &v;
    let z = g(a, w);
    if c {
        v = z;
        loop {
            if c { break; }
        }
        let _ = v;
        s.r
    } else {
        let u = S { r: t };
        u.r
    }
}
