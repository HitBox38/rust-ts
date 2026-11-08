// The dependency of `user.rs`, built first in the same case (harness/suites.ts `host-rlib`).
pub trait Shape {
    fn area(&self) -> f64;
}

pub struct Square(pub f64);

impl Shape for Square {
    fn area(&self) -> f64 {
        self.0 * self.0
    }
}

#[inline]
pub fn total<S: Shape>(shapes: &[S]) -> f64 {
    shapes.iter().map(Shape::area).sum()
}
