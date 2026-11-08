// A lib crate that loads `dep` through `--extern dep=out/libdep.rlib` (harness/suites.ts `host-rlib`).
use dep::{Shape, Square};

pub struct Circle(pub f64);

impl Shape for Circle {
    fn area(&self) -> f64 {
        3.0 * self.0 * self.0
    }
}

pub fn squares(n: usize) -> f64 {
    let v: Vec<Square> = (0..n).map(|i| Square(i as f64)).collect();
    dep::total(&v)
}
