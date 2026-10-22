pub fn a1(_x: u32) {}
pub fn a2(_x: u32) {}
pub fn take(_f: &fn(u32)) {}
pub fn take_val(_f: fn(u32)) {}
pub fn both() {
    let mut f = a1;
    f = a2;
}
pub fn both_ref() {
    let mut f = &a1;
    f = &a2;
}
pub fn cast_ref() {
    take(&a1);
}
pub fn cast_val() {
    take(a1);
}
pub fn cast_deref(g: &fn(u32) -> u8) {
    take_val(g);
}
