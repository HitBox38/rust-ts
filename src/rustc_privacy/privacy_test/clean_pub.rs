pub struct S { pub a: u8, b: u16 }
pub enum E { A(S), B { x: u32 } }
pub trait T { type X; fn f(&self) -> u8; const N: usize; }
impl T for S { type X = E; fn f(&self) -> u8 { 0 } const N: usize = 3; }
pub fn g(_: &S, _: (u8, u16)) -> E { E::B { x: 1 } }
pub type Alias<'a> = &'a (S, E);
pub union U { a: u8, pub b: u32 }
pub const C: &str = "";
