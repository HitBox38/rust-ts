// `macro_rules` scopes across modules, `#[macro_use]`, `$crate` and `#[macro_export]`.
#[macro_use]
mod a {
    macro_rules! from_a { () => {} }
    #[macro_export]
    macro_rules! exported { () => { fn from_exported() { $crate::a::b::f() } } }
    pub mod b {
        pub fn f() {}
    }
}
mod c {
    from_a!();
    fn g() { exported!(); from_exported(); }
    macro_rules! local { () => {} }
}
from_a!();
crate::exported!();
local!();
