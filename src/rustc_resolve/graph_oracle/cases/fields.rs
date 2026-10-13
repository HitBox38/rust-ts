pub struct P { pub x: u8, y: u8 }
pub struct Tup(pub u8, u8);
#[non_exhaustive]
pub struct Ne(pub u8);
pub struct Unit;
#[non_exhaustive]
pub struct NeUnit;
pub enum E {
    #[non_exhaustive]
    V(u8),
    W { f: u8 },
    X,
}
mod m {
    pub struct Q(pub u8, u8);
}
