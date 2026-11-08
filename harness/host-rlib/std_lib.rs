// A lib crate on std: a `Vec`, a generic fn and a trait impl (harness/suites.ts `host-rlib`).
use std::fmt;

pub struct Meters(pub u32);

impl fmt::Display for Meters {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{} m", self.0)
    }
}

pub fn longest<T: Clone + PartialOrd>(xs: &[T]) -> Option<T> {
    let mut best: Option<T> = None;
    for x in xs {
        if best.as_ref().map_or(true, |b| x > b) {
            best = Some(x.clone());
        }
    }
    best
}

pub fn lengths() -> Vec<Meters> {
    vec![Meters(1), Meters(20)]
}
