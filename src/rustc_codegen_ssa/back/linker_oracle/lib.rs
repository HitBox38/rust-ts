pub fn add(a: u32, b: u32) -> u32 {
    a + b
}

#[unsafe(no_mangle)]
pub extern "C" fn exp_c(x: u32) -> u32 {
    x + 1
}
