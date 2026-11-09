// A `#![no_core]` lib crate that loads `nc_link` (an rlib bundling `libfoo.a`) through `--extern` (harness/suites.ts `rlib-native`).
#![feature(no_core)]
#![allow(internal_features)]
#![no_core]

extern crate nc_link;

pub fn g() {
    nc_link::f()
}
