#![allow(dead_code, unused_variables)]
#[repr(packed)]
struct P { a: u8, b: u32 }
#[repr(packed(2))]
struct Q { a: u8, b: u64 }
fn main() {
    let p = P { a: 1, b: 2 };
    let r = &p.b;
    let q = Q { a: 1, b: 2 };
    let s = &q.b;
    let t = &p.a;
}
