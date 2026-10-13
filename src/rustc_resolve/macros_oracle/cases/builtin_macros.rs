// `#[rustc_builtin_macro]` definitions: expanders replaced by the registered builtins.
#![feature(rustc_attrs, decl_macro, cfg_accessible)]
#[rustc_builtin_macro]
macro_rules! stringify { ($($t:tt)*) => {} }
#[rustc_builtin_macro]
macro_rules! line { () => {} }
#[rustc_builtin_macro]
macro_rules! concat { ($($t:tt)*) => {} }
#[rustc_builtin_macro]
macro cfg_accessible($item:item) {}
#[rustc_builtin_macro]
macro_rules! not_a_builtin { () => {} }
const S: &str = stringify!(a b c);
const L: u32 = line!();
const C: &str = concat!("a", 1);
#[cfg_accessible(S)]
fn present() {}
#[cfg_accessible(missing)]
fn absent() {}
