pub trait Tr { fn go(&self); }
impl Tr for u8 { fn go(&self) {} }
impl Tr for u16 { fn go(&self) {} }
pub fn need<T: Tr>() {}
pub fn a() {
    need();
}
pub fn b() {
    let x = "5".parse().unwrap();
}
