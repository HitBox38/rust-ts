// `--print link-args` input (link.test.ts, `linker_and_flavor`): an executable with nothing to link.
#![feature(no_core, lang_items)]
#![allow(internal_features)]
#![no_core]
#![no_main]
#[lang = "pointee_sized"] pub trait PointeeSized {}
#[lang = "meta_sized"] pub trait MetaSized: PointeeSized {}
#[lang = "sized"] pub trait Sized: MetaSized {}
