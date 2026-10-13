mod a {
    pub struct Foo;
}
mod x {}
fn f(_: x::Foo) {}
