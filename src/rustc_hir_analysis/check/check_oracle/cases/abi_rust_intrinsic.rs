#![feature(no_core, lang_items)]
#![no_core]
#[lang = "pointee_sized"] pub trait PointeeSized {}
#[lang = "meta_sized"] pub trait MetaSized: PointeeSized {}
#[lang = "sized"] pub trait Sized: MetaSized {}
#[lang = "copy"] pub trait Copy {}
// `extern "rust-intrinsic"` is no longer an ABI: E0703 (ast_lowering); the fn pointer type is still lowered and checked.
pub type A = extern "rust-intrinsic" fn();
