#![allow(dead_code, unused_variables)]
struct S { x: u32 }
impl S { fn m(&mut self) {} }
const K: S = S { x: 0 };
const A: [u32; 2] = [1, 2];
fn main() {
    K.x = 5;
    A[0] = 3;
    K.m();
    let r = &mut K;
}
