#[proc_macro]
pub fn bang(x: u8) -> u8 { x }
#[proc_macro_attribute]
fn attr(x: u8) -> u8 { x }
#[proc_macro_derive(Derived, attributes(helper))]
pub fn derive(x: u8) -> u8 { x }
#[macro_use]
mod with_macro_use {}
fn main() {}
