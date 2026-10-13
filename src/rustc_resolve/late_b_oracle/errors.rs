// Late resolution errors reported by the second half of late.rs.
enum E {
    A(u8),
    B(u8, u8),
}
trait Tr {
    fn m(&self);
    type T;
    const C: u8;
}
struct S;
impl Tr for S {
    fn m(&self) {}
    fn m(&self) {}
    fn missing(&self) {}
    const T: u8 = 0;
    type C = u8;
}
fn dup<T, T>() {}
fn params(a: u8, a: u8) {}
fn f(e: E) {
    match e {
        E::A(x) | E::B(y, _) => {}
        E::B(z, z) => {}
    }
    let (ref p | p) = (1u8);
}
static FOO: u8 = 1;
fn g(v: u8) {
    match v {
        FOO => {}
        _ => {}
    }
}
