#![feature(no_core, lang_items)]
#![no_core]
#[lang = "pointee_sized"] pub trait PointeeSized {}
#[lang = "meta_sized"] pub trait MetaSized: PointeeSized {}
#[lang = "sized"] pub trait Sized: MetaSized {}
#[lang = "copy"] pub trait Copy {}
// Supported ABIs (`AbiMapping::Direct`): `check_abi` emits nothing.
pub type A = extern "C" fn();
pub type B = extern "system" fn(u8) -> u8;
pub type C = fn(u32);
pub struct S { pub f: extern "C-unwind" fn(), pub g: unsafe extern "C" fn() }
extern "C" {}
