mod m {
    pub struct S(u8, pub u8);
    pub enum E { A, B(u8), C { x: u8 } }
    fn f() {}
    pub mod inner {
        pub fn g() {}
        struct Hidden;
    }
}
pub trait Tr { fn g(&self); type T; const C: u8; }
struct U;
union Un { a: u8 }
static X: u8 = 0;
static mut XM: u8 = 0;
const Y: u8 = { 1 };
type Alias = U;
fn main() { fn inner() {} let _c = |x: u8| x; }
