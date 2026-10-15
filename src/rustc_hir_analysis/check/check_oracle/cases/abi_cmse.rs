#![feature(no_core, lang_items)]
#![no_core]
#[lang = "pointee_sized"] pub trait PointeeSized {}
#[lang = "meta_sized"] pub trait MetaSized: PointeeSized {}
#[lang = "sized"] pub trait Sized: MetaSized {}
#[lang = "copy"] pub trait Copy {}
// cmse ABIs on a non-Armv8-M target: the old name is no longer an ABI (E0703); the new one on an extern block is
// unsupported (E0570) and feature-gated (E0658), both from ast_lowering, so `check_abi` only delays a bug.
pub type A = extern "C-cmse-nonsecure-call" fn();
extern "cmse-nonsecure-call" {}
