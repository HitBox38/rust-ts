mod m { pub fn f() {} pub mod n {} }
use m::f;
use m::{self as mm, n::{self}, f as g};
use m::n::{};
fn main() {}
