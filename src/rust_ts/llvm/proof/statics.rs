#![crate_type = "lib"]
pub static A: u32 = 7;
pub static B: [u16; 3] = [1, 2, 3];
pub static S: &str = "hello\n";
pub static T: (u8, u64) = (1, 2);
pub static P: &u32 = &A;
pub static mut M: i64 = -1;
pub static F: f64 = 1.5;
pub static Z: [u8; 4] = [0; 4];
pub static BIG: u128 = 0x0123_4567_89ab_cdef_0123_4567_89ab_cdef;
#[unsafe(no_mangle)]
pub static NM: u8 = 1;
#[unsafe(link_section = ".foo")]
pub static SEC: u32 = 1;
pub static PS: &[u8] = b"bytes\x00\xff";
pub static OPT: Option<&u32> = None;
