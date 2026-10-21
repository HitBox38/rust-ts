pub trait Tr {
    fn m(&self, x: u8) -> u16;
    fn n<'a>(&self, x: &'a u8) -> &'a u8;
    unsafe fn u(&self);
}
pub struct S;
impl Tr for S {
    fn m(&self, x: u16) -> u16 {
        0
    }
    fn n<'a>(&self, x: &'a u16) -> &'a u8 {
        loop {}
    }
    fn u(&self) {}
}
pub fn a(x: u8) -> u16 {
    0
}
pub fn b(x: u16) -> u16 {
    0
}
pub fn items(c: bool) {
    let f = if c { a } else { b };
}
