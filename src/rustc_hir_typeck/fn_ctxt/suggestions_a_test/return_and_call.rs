pub fn missing_ret() {
    1u32
}
pub fn g() -> u32 {
    1
}
pub fn call_fn() -> u32 {
    g
}
pub fn call_closure() -> u32 {
    let c = || 1u32;
    c
}
pub fn boxing() -> Box<u32> {
    1u32
}
pub fn generic_ret<T: Default>() -> T {
    1u32
}
pub fn unit_if(c: bool) {
    if c { 1u32 } else { 2u32 }
}
pub struct W { pub inner: u32 }
pub fn field(w: W) -> u64 {
    w
}
pub fn remove_call(s: &str) -> &str {
    s.to_string()
}
pub fn opt(x: Option<u32>) -> u32 {
    x
}
