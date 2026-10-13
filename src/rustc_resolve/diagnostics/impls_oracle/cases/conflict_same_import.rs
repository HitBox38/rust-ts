// E0252 for the same import twice: the removal suggestion is tool-only.
#![crate_type = "lib"]
#![allow(unused)]
mod a {
    pub struct F;
}
use a::F;
use a::F;
