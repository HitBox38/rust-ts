// imports.test.ts: `use` forms (single, renamed, nested, self, glob, super/crate/self paths,
// underscore, block-local, re-exports) and what they resolve to.
pub mod a {
    pub struct B;
    pub struct C;
    pub fn f() {}
    pub mod e {
        pub struct F;
        pub use super::B as BB;
        pub(crate) use super::C;
    }
    pub trait Tr {}
}
mod m1 {
    use crate::a::B;
    use crate::a::C as C2;
    use crate::a::{f, e::{self, F}};
    use super::a::e::*;
    use self::inner::G;
    use crate::a::Tr as _;
    mod inner { pub struct G; }
    pub type X = (B, C2, F, BB, G);
    pub fn g() { use crate::a::f as h; h(); f(); let _ = e::F; }
}
pub use a::e::BB as Reexported;
pub use a::*;
