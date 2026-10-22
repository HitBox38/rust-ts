#![warn(rust_2021_prelude_collisions)]
pub trait MyTryInto<T> {
    fn try_into(self) -> T;
}
impl MyTryInto<u16> for u8 {
    fn try_into(self) -> u16 {
        0
    }
}
pub trait MyFromIter {
    fn from_iter(x: u8) -> Self;
}
impl MyFromIter for Vec<u8> {
    fn from_iter(_x: u8) -> Self {
        Vec::new()
    }
}
pub trait MyTryFrom<T>: Sized {
    fn try_from(x: T) -> Option<Self>;
}
impl MyTryFrom<u8> for u16 {
    fn try_from(_x: u8) -> Option<u16> {
        None
    }
}
pub fn f(x: u8) -> u16 {
    x.try_into()
}
pub fn g() -> Vec<u8> {
    <Vec<u8>>::from_iter(1)
}
pub fn h(x: u8) -> Option<u16> {
    u16::try_from(x)
}
pub fn i(x: &u8) -> u16 {
    (*x).try_into()
}
