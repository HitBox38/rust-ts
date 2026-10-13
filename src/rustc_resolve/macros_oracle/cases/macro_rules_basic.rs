// Unused macros, unused rules, macro-expanded items, nested invocations.
macro_rules! m {
    () => { fn from_m() {} };
    (x) => {};
    ($e:expr) => { $e };
}
m!();
macro_rules! unused {
    () => {};
}
macro_rules! outer {
    ($name:ident) => {
        macro_rules! $name { () => { 1 } }
    };
}
outer!(inner);
fn main() {
    let _ = inner!();
    let _ = m!(2);
}
