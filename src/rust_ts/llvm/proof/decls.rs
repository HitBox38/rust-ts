#![crate_type = "lib"]
unsafe extern "C" {
    fn ext_fn(p: *const u8, n: usize) -> i32;
    fn ext_void();
    pub static EXT: u32;
}
pub static FP: unsafe extern "C" fn(*const u8, usize) -> i32 = ext_fn;
pub static FV: unsafe extern "C" fn() = ext_void;
pub static EP: &u32 = unsafe { &EXT };
pub static PAIR: [&u32; 2] = [unsafe { &EXT }, &7];
pub static OFF: &u8 = &[1u8, 2, 3][1];
