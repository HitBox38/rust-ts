// Fixture for diagnostics.test.ts: `span_lint_hir` takes the lint level at the `HirId` it is given (here each `fn ne`
// impl item, with its own `#[allow]` / `#[deny]`), not at the node the lint pass was called on (the `impl`).
#![allow(unused)]

struct P;
impl PartialEq for P {
    fn eq(&self, _: &P) -> bool {
        true
    }
    #[allow(clippy::partialeq_ne_impl)]
    fn ne(&self, _: &P) -> bool {
        false
    }
}

struct Q;
impl PartialEq for Q {
    fn eq(&self, _: &Q) -> bool {
        true
    }
    #[deny(clippy::partialeq_ne_impl)]
    fn ne(&self, _: &Q) -> bool {
        false
    }
}

struct R;
impl PartialEq for R {
    fn eq(&self, _: &R) -> bool {
        true
    }
    fn ne(&self, _: &R) -> bool {
        false
    }
}

fn main() {}
