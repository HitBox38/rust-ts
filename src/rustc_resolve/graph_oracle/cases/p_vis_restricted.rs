pub(crate) fn f() {}
mod m { pub(super) fn g() {} pub(in crate::m) fn h() {} }
fn main() {}
