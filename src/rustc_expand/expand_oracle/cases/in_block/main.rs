fn f() {
    mod x;
}
fn g() {
    mod nope;
}
fn h() {
    #[path = "x.rs"]
    mod ok;
}
fn main() {}
