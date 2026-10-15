#![feature(no_core, lang_items)]
#![no_core]
#[lang = "pointee_sized"] pub trait PointeeSized {}
#[lang = "meta_sized"] pub trait MetaSized: PointeeSized {}
#[lang = "sized"] pub trait Sized: MetaSized {}
#[lang = "copy"] pub trait Copy {}

pub fn a() { break; }
pub fn b() { continue; }
pub fn c() { 'a: { loop { continue 'a; } } }
pub fn d() { 'b: { break; } }
pub fn e() { if true { break } else { break } }
pub fn f() { { break; } }
pub fn g() { let _c = || { break; }; }
pub fn h() { { break; break; } }
pub fn i() { loop { let _c = || { continue; }; } }
pub fn j() { 'x: loop { 'y: { break 'x; } } }
pub const K: () = { break; };
