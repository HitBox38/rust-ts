// late/diagnostics.test.ts: input of the unit checks (parsed only, not an oracle case).
pub trait Tr<A> { type Item; }
pub fn bounds<T: Tr<u8, Item = u8>, U: Tr<Item = u8>, V: ::Tr<u8>>() {}
pub struct S(u8);
pub fn calls() { f(&self, 1, 2); f(&&self); f(self); g(1, self); f(); }
pub fn fptr() { a(); b; }
pub fn pats(arr: [u8; 3]) { let [first, rest..] = arr; let [x, ..tail] = arr; }
pub fn lits(v: u8) { let _ = S { 0: { 1 } }; let _ = v + 1; }
pub fn gen<T, N>() {}
