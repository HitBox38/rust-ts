#![feature(no_core, lang_items)]
#![no_core]
#[lang = "pointee_sized"] pub trait PointeeSized {}
#[lang = "meta_sized"] pub trait MetaSized: PointeeSized {}
#[lang = "sized"] pub trait Sized: MetaSized {}
#[lang = "copy"] pub trait Copy {}
// `check_abi` on an ABI the target does not support (`AbiMapping::Invalid`): ast_lowering already emitted E0570, so
// `check_abi` only delays a bug.
pub type A = extern "stdcall" fn();
pub type B = extern "thiscall" fn(u8);
extern "stdcall" {}
