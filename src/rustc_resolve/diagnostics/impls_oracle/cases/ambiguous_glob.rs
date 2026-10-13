// E0659: a name imported by two glob imports, then used by an import (`ambiguity_diagnostic`).
#![crate_type = "lib"]
#![allow(unused)]
mod a {
    pub mod x {}
}
mod b {
    pub mod x {}
}
use a::*;
use b::*;
use x::*;
