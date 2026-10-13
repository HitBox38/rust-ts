// Effective visibilities: modules, re-exports, fields, variants, traits, macros 2.0.
#![feature(decl_macro)]
pub mod a {
    pub struct S { pub f: u8, g: u8 }
    pub(crate) fn h() {}
    pub mod inner {
        pub fn deep() {}
    }
    pub(crate) mod hidden {
        pub fn reached() {}
        pub struct Adt;
    }
    pub macro m() { $crate::a::hidden::reached() }
}
pub use a::S as T;
pub use a::inner::*;
pub enum E { V { x: u8 }, W(u8) }
pub trait Tr { fn method(); }
mod private {
    pub fn p() {}
}
pub use private::p;
