// `--crate-type staticlib --print native-static-libs` input (link.test.ts, `print_native_static_libs`).
#![feature(no_core, lang_items, link_arg_attribute)]
#![allow(internal_features)]
#![no_core]
#[lang = "pointee_sized"] pub trait PointeeSized {}
#[lang = "meta_sized"] pub trait MetaSized: PointeeSized {}
#[lang = "sized"] pub trait Sized: MetaSized {}
#[link(name = "a")] unsafe extern "C" {}
#[link(name = "a")] unsafe extern "C" {}
#[link(name = "b", kind = "dylib")] unsafe extern "C" {}
#[link(name = "c", kind = "static", modifiers = "-bundle")] unsafe extern "C" {}
#[link(name = "d.so", kind = "dylib", modifiers = "+verbatim")] unsafe extern "C" {}
#[link(name = "-Wl,--foo", kind = "link-arg")] unsafe extern "C" {}
#[link(name = "a")] unsafe extern "C" {}
