pub fn f<F: Fn(u8)>(_f: F) {}
pub fn g<F: Fn(u8, u16)>(_f: F) {}
pub fn h<F: Fn((u8, u16))>(_f: F) {}
pub fn r<F: Fn(&u8)>(_f: F) {}
pub fn a() {
    f(|a, b| ());
}
pub fn b() {
    f(|| ());
}
pub fn c() {
    g(|(a, b)| ());
}
pub fn d() {
    h(|a, b| ());
}
pub fn e() {
    r(|x: u8| ());
}
pub fn takes(_x: u16) {}
pub fn i() {
    f(takes);
}
