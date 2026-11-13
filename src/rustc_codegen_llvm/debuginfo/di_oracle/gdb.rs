// Fixture of debuginfo/mod.test.ts (lane cg-di-a): a `no_core` executable, whose IR under `-Cdebuginfo=2` holds the
// `.debug_gdb_scripts` global, the entry wrapper's volatile load of it, and the debuginfo module flags. See README.md.
#![feature(no_core, lang_items)]
#![allow(internal_features, unused)]
#![no_core]

#[lang = "pointee_sized"]
pub trait PointeeSized {}
#[lang = "meta_sized"]
pub trait MetaSized: PointeeSized {}
#[lang = "sized"]
pub trait Sized: MetaSized {}
#[lang = "copy"]
pub trait Copy {}

#[lang = "start"]
fn start<T>(_main: fn() -> T, _argc: isize, _argv: *const *const u8, _sigpipe: u8) -> isize {
    0
}

fn main() {}
