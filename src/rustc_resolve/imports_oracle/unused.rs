// imports.test.ts: unused and redundant imports through the whole pipeline (check_unused), including
// a `tests` module (the `#[cfg(test)]` help) and unused qualifications.
pub mod a {
    pub struct B;
    pub struct C;
    pub struct D;
}
use a::B;
mod m1 {
    use crate::a::{B, C, D};
    pub type X = C;
}
mod m2 {
    use crate::a::B;
    use crate::a::B as B2;
    pub type Y = B;
}
mod tests {
    use crate::a::*;
    use crate::a::{C};
}
mod m3 {
    use crate::a::C;
    pub type Z = crate::a::C;
    pub type Z2 = C;
}
