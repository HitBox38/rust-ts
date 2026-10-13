#[cfg_attr()]
fn a() {}
#[cfg(foo = 1)]
fn b() {}
#[cfg(a, b)]
fn c() {}
#[cfg_attr(true)]
fn d() {}
fn main() {}
