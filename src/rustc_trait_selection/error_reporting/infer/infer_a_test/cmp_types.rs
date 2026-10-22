pub struct S<T, U = u8>(pub T, pub U);
pub struct One<T>(pub T);
pub fn adt(x: S<u32, u16>) -> S<u8, u16> {
    x
}
pub fn adt_default(x: S<u32>) -> S<u32, u16> {
    x
}
pub fn nested(x: One<One<u8>>) -> One<One<u16>> {
    x
}
pub fn refs(x: &mut u8) -> &u16 {
    x
}
pub fn refs2<'a>(x: &'a One<u8>) -> &'a mut One<u8> {
    x
}
pub fn tuples(x: (u8, u16, u32)) -> (u8, u32, u32) {
    x
}
pub fn fn_ptrs(x: fn(u8) -> u16) -> fn(u8, u8) -> u16 {
    x
}
pub fn unsafe_fn_ptrs(x: unsafe fn(u8)) -> fn(u8) {
    x
}
pub fn closures() {
    let mut c = |x: u8| x;
    c = |x: u8| x + 1;
}
pub fn slices(x: &[u8]) -> &[u16] {
    x
}
pub fn raw(x: *const u8) -> *mut u8 {
    x
}
pub fn options(x: Option<Result<u8, u16>>) -> Option<Result<u8, u32>> {
    x
}
