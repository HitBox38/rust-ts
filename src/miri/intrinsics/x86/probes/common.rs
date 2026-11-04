// Runtime of the probes of lane miri-x86-a. `std`'s formatting and iterators cost far more interpreted steps than the
// intrinsics under test, so a probe starts at `miri_start` (no std runtime), appends raw bytes to one buffer with the
// interpreter's memcpy, and writes it with a single `write(2)`. A record is a tag and the value's bytes in memory order.
use std::mem::transmute as t;

// The vector types stdarch declares these LLVM intrinsics with (core_arch::simd is private): the lane type is what the
// emulation reads.
macro_rules! simd {
    ($($name:ident: [$elem:ty; $n:literal];)*) => {
        $(#[repr(simd)] #[derive(Copy, Clone)] struct $name([$elem; $n]);)*
    };
}
simd! {
    i8x16: [i8; 16];
    u8x16: [u8; 16];
    i16x8: [i16; 8];
    u16x8: [u16; 8];
    i32x4: [i32; 4];
    i64x2: [i64; 2];
    u64x2: [u64; 2];
}

unsafe extern "C" {
    fn write(fd: i32, buf: *const std::ffi::c_void, n: usize) -> isize;
}

const OUT_CAP: usize = 1 << 19;
static mut OUT: [u8; OUT_CAP] = [0; OUT_CAP];
static mut OUT_LEN: usize = 0;
fn raw(p: *const u8, n: usize) {
    unsafe {
        std::ptr::copy_nonoverlapping(p, ((&raw mut OUT) as *mut u8).add(OUT_LEN), n);
        OUT_LEN += n;
    }
}
fn put(c: u8) {
    raw(&raw const c, 1);
}
fn s(x: &str) {
    raw(x.as_ptr(), x.len());
}
fn hex<T>(v: T) {
    raw((&raw const v) as *const u8, size_of::<T>());
}
/// ` <tag>=<bytes>`
fn f<T>(tag: &str, v: T) {
    put(b' ');
    s(tag);
    put(b'=');
    hex(v);
}
fn nl() {
    put(b'\n');
}
fn flush() {
    unsafe {
        write(1, (&raw const OUT).cast(), OUT_LEN);
    }
}
/// `for x in ARRAY` without an iterator.
macro_rules! each {
    ($x:ident in $a:expr => $body:block) => {{
        let mut i_ = 0;
        while i_ < $a.len() {
            let $x = $a[i_];
            $body
            i_ += 1;
        }
    }};
}
