// Input of the unit checks in late_b.test.ts (section 2); not an oracle case.
mod a {
    pub fn b() {}
}
struct L<'x, 'y, T>(&'x T, &'y T);
trait Tr {
    type A<'a, T>;
    type B<T = u8>;
    fn m(&self);
    fn n();
}
extern "C" {
    fn ext(x: u8);
}
fn f() {
    {}
}
