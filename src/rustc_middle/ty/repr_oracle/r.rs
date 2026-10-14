#![feature(no_core, lang_items, rustc_attrs, repr_simd)]
#![no_core]

#[lang = "pointee_sized"]
pub trait PointeeSized {}
#[lang = "meta_sized"]
pub trait MetaSized: PointeeSized {}
#[lang = "sized"]
pub trait Sized: MetaSized {}

pub struct Plain;
#[repr(C)]
pub struct C(u8);
#[repr(u8)]
pub enum E8 { A, B }
#[repr(packed(2))]
pub struct P2 { a: u32 }
#[repr(align(8))]
pub struct A8;
#[repr(transparent)]
pub struct T(u32);
#[repr(C, packed(4), packed(1))]
pub struct CP { a: u8 }
#[repr(packed)]
pub struct P1 { a: u8 }
#[repr(align(2), align(16), align(4))]
pub union U { a: u8 }
#[repr(isize)]
pub enum Ei { A }
#[repr(usize)]
pub enum Eu { A }
#[repr(i128)]
pub enum E128 { A }
#[repr(C, u16)]
pub enum Cu16 { A }
pub enum Plain2 { A }
#[repr(Rust)]
pub struct R;
#[repr(simd)]
pub struct Simd([u8; 4]);
#[lang = "owned_box"]
pub struct Box<T>(T);
#[rustc_pass_indirectly_in_non_rustic_abis]
pub struct Pi;
#[rustc_scalable_vector(4)]
pub struct Sv(u8);
#[rustc_scalable_vector]
pub struct Svc(Sv);
