// Resolution errors of macro paths.
macro_rules! bang { () => {} }
undefined!();
a::b!();
#[rustc_foo]
fn f() {}
#[a::rustc_bar]
fn g() {}
#[derive(bang)]
struct S;
#[bang]
fn h() {}
