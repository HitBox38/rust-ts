#![feature(no_core, lang_items)]
#![no_core]
#[lang = "pointee_sized"] pub trait PointeeSized {}
#[lang = "meta_sized"] pub trait MetaSized: PointeeSized {}
#[lang = "sized"] pub trait Sized: MetaSized {}
#[lang = "copy"] pub trait Copy {}
// `check_abi` on a deprecated ABI (`AbiMapping::Deprecated` on non-x86 targets): the UNSUPPORTED_CALLING_CONVENTIONS lint
// for fn pointer types (type aliases, a field) and an extern block.
pub type A = extern "cdecl" fn();
pub type B = extern "cdecl-unwind" fn(u8) -> u8;
pub struct S { pub f: extern "cdecl" fn() }
extern "cdecl" {}
