#![feature(no_core)]
#![no_core]
#![crate_type = "lib"]
extern crate orphan_aux;
use orphan_aux::*;

pub struct Local;
pub struct LocalG<T>(T);

// ok
impl<T> Foreign2<T, T> for Local {}
// E0210: uncovered before the first local type
impl<T> Foreign1<Local> for T {}
// E0210: uncovered, no local type
impl<T> Foreign for T {}
