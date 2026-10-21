pub struct S;
impl S {
    pub fn m<T>(&self) -> u8 { 0 }
    pub fn n<A, B>(&self, a: A) -> u8 { 0 }
}
pub fn a(s: S) {
    s.m();
}
pub fn b(s: S) {
    s.n(1u8);
}
pub fn c(v: Vec<u8>) {
    let it = v.into_iter().map(|x| x).collect();
}
