#![feature(no_core)]
#![no_core]
#![crate_type = "lib"]
extern crate orphan_aux;
use orphan_aux::*;

pub struct Local;

// E0117: only traits defined in the current crate can be implemented for primitive types
impl Foreign for u8 {}
// E0117: arbitrary types
impl Foreign1<u8> for () {}
// ok
impl Foreign1<u8> for Local {}
