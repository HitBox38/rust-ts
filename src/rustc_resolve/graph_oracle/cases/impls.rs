struct S { a: u8, pub b: u8 }
impl S {
    fn new() -> u8 { 0 }
    pub const K: u8 = 1;
    fn _hidden(&self) {}
}
trait T { fn m(&self); fn d(&self) {} type A; const C: u8 = 2; }
impl T for S { fn m(&self) {} type A = u8; const C: u8 = 3; }
impl S { fn other() {} }
extern "C" {
    fn ext(x: u8) -> u8;
    static EXT: u8;
    pub fn ext_pub();
}
const _: u8 = 0;
const _: u8 = 1;
fn _underscore() {}
