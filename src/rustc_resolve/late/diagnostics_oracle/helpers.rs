// late/diagnostics.test.ts: pieces of the error that need no other lane (pattern `let`, `@` in
// slice patterns, calls with a `self` argument).
pub struct P(u8, u8);
pub fn pattern_let(v: u8) { if x = v {} }
pub fn slice(arr: [u8; 3]) { let [first, rest..] = arr; }
pub fn slice_end(arr: [u8; 3]) { let [first, ..tail] = arr; }
impl P {
    pub fn m(&self, a: u8, b: u8) {}
    pub fn call(&self) { m(&self, 1, 2); }
}
