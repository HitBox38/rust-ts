#![feature(no_core)]
#![no_core]
#![crate_type = "lib"]
extern crate orphan_aux;
use orphan_aux::*;

pub struct Local;

// ok
unsafe impl ForeignAuto for Local {}
// E0321: cross-crate auto trait for a non-nominal type
unsafe impl ForeignAuto for &'static Local {}
// E0117 (a tuple is not local)
unsafe impl ForeignAuto for (Local, u8) {}
