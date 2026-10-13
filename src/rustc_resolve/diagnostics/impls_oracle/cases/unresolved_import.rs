// E0432: unresolved imports, grouped per use tree (`throw_unresolved_import_error`).
#![crate_type = "lib"]
#![allow(unused)]
mod a {
    pub struct F;
}
use a::missing;
use a::{F, gone, lost};
