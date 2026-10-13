// imports.test.ts: `pub use` re-export errors (E0364/E0365, crate-private, macro_rules) and the
// redundant visibility lint.
mod a {
    struct P;
    pub(crate) struct Q;
    pub(crate) mod inner { pub struct R; }
    pub struct S;
    pub(crate) fn q() {}
    macro_rules! mac { () => {} }
    pub(crate) use mac;
}
pub use a::P;
pub use a::Q;
pub use a::inner;
pub use a::q;
pub use a::mac;
mod b {
    pub(super) mod c { pub(crate) struct T; }
    pub use self::c::*;
}
pub(crate) use a::S;
