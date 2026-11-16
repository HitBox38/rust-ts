// Fixture for diagnostics.test.ts: one on-by-default clippy lint per `clippy_utils::diagnostics` wrapper.
#![allow(unused)]

struct S {
    x: i32,
}

struct P;
impl PartialEq for P {
    fn eq(&self, _: &P) -> bool {
        true
    }
    fn ne(&self, _: &P) -> bool {
        false
    }
}

#[derive(Default)]
struct D {
    a: i32,
    b: i32,
}

fn main() {
    let pi = 3.14159;
    let x = 1;
    let s = S { x: x };
    let mut a = 1;
    a =- 1;
    let y = 1;
    let y = y;
    let mut d = D::default();
    d.a = 1;
    (0, 1).0 = 2;
}
