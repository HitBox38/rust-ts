// imports.test.ts: glob conflicts, glob vs non-glob shadowing, ambiguous/hidden glob re-exports.
pub mod a { pub struct X; pub struct Y; pub struct W; }
pub mod b { pub struct X; pub struct Z; pub struct W; }
pub mod c {
    pub use crate::a::*;
    pub use crate::b::*;
}
mod d {
    use crate::a::*;
    use crate::b::*;
    pub type T = X;
}
mod e {
    use crate::a::*;
    pub struct Y;
    pub type U = (Y, W);
}
pub mod f {
    pub use crate::a::*;
    struct X;
    pub type V = X;
}
mod g {
    use crate::a::*;
    use crate::a::*;
    pub type S = Y;
}
mod h {
    pub use self::h1::*;
    pub use self::h2::*;
    mod h1 { pub use super::h2::*; pub struct Q; }
    mod h2 { pub use super::h1::*; pub struct R; }
    pub type P = (Q, R);
}
