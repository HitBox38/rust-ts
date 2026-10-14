#![feature(no_core, lang_items)]
#![no_core]
#[lang = "pointee_sized"] pub trait PointeeSized {}
#[lang = "meta_sized"] pub trait MetaSized: PointeeSized {}
#[lang = "sized"] pub trait Sized: MetaSized {}
#[lang = "copy"] pub trait Copy {}
// `cmse-nonsecure-call` fn pointer types on a non-Armv8-M target: E0570 and E0658 (ast_lowering); lowering then calls
// `check_abi` (a delayed bug) and `validate_cmse_abi` (hir_ty_lowering/cmse.rs).
pub type B = extern "cmse-nonsecure-call" fn();
pub struct S { pub f: extern "cmse-nonsecure-call" fn(u32) -> u32 }
