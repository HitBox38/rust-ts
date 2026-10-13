// check_unused.test.ts: `unused_imports` spans (calc_unused_spans) against the oracle.
#![feature(no_core)]
#![no_core]
pub mod a {
    pub struct B;
    pub struct C;
    pub struct D;
    pub mod e { pub struct F; pub struct G; pub struct H; }
}
mod m1 {
    use crate::a::{B, C, D};
    pub type X = C;
}
mod m2 {
    use crate::a::{self as aa, e::{F, G}};
    pub type Y = G;
}
mod m3 {
    use crate::a::e::*;
    use crate::a::{};
    use crate::a::{e::{}, B};
}
mod m4 {
    use crate::a::{B, C, e::{F, G, H}, D};
    pub type Z = D;
    pub type Z2 = H;
}
mod m5 {
    use crate::a::{
        B,
        C,
    };
    pub type W = C;
}
mod tests {
    use crate::a::B;
}
mod m6 {
    use crate::a::{self, B};
    pub type V = a::C;
}
mod m7 {
    use crate::a::{B, C, D,};
    pub type U = D;
}
mod m8 {
    #[allow(dead_code)]
    use crate::a::{B, C};
}
mod m9 {
    use crate::a::{e::{F, G}, B};
    pub type T = B;
}
mod m10 {
    use crate::a::{e::{F}, B, C};
    pub type S = F;
    pub type S2 = C;
}
mod m11 {
    use crate::a::{B as B2, C};
    pub type R = C;
}
