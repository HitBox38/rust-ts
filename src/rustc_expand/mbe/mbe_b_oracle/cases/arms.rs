macro_rules! add {
    ($a:expr, $b:expr) => { $a + $b };
    ($a:expr) => { $a };
    () => { 0 }
}
const _: u8 = add!(1, 2);
const _: u8 = add!();
fn f() {
    let x = add!(3);
    add!(4);
    add!(x, x);
}
macro_rules! items {
    ($($name:ident),*) => { $(fn $name() {})* };
}
items!(a, b, c);
items! { d }
macro_rules! ty { () => { (u8, u16) } }
type T = ty!();
macro_rules! pat { ($p:pat) => { ($p, _) } }
fn g() {
    let pat!(Some(y)) = (None, 1);
}
