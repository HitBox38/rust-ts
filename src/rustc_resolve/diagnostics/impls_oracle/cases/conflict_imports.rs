// E0255 / E0252: imports against items and against each other (rename suggestions).
#![crate_type = "lib"]
#![allow(unused)]
mod a {
    pub const f: () = ();
    pub const g: () = ();
    pub struct Big;
}
mod b {
    pub const g: () = ();
}
use a::f;
const f: () = ();
use a::g;
use b::g;
use a::Big;
struct Big;
