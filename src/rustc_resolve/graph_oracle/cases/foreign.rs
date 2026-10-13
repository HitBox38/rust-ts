unsafe extern "C" {
    fn a();
    pub fn b(x: u8) -> u8;
    static C: u8;
    pub static mut D: u8;
    safe fn e();
    unsafe static F: u8;
}
extern "C" {}
pub union U { pub a: u8, b: u16 }
pub enum Big { A = 1, B = 2 + 3, C { x: [u8; 2] }, D([u8; 1 + 1]) }
pub struct Gen<T, U = u8, const N: usize = 3> where T: Sized2 { t: T, u: U, a: [u8; N] }
pub trait Sized2 {}
fn main() {}
