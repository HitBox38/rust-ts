// Native oracle probe of lane miri-shims-d for `compute_crc32` (src/tools/miri/src/intrinsics/math.rs:215): the host's
// hardware CRC32 / CRC32C instructions (aarch64 `crc32{b,h,w,x}` / `crc32c{b,h,w,x}`, which, like x86 `crc32`, take
// and return the bit-reversed CRC without pre/post inversion). Built with the oracle rustc for aarch64-apple-darwin;
// its stdout is src/miri/intrinsics/crc32.oracle.txt. Each line: `<poly> <bits> <crc> <data> <result>` (hex).
use core::arch::aarch64::*;
use std::hint::black_box;

fn main() {
    let crcs: [u32; 4] = [0, 0xffff_ffff, 0x1234_5678, 0xdead_beef];
    let datas: [u64; 6] = [0, 1, 0xff, 0xabcd, 0x0123_4567_89ab_cdef, u64::MAX];
    for &crc in &crcs {
        for &d in &datas {
            unsafe {
                let (b, h, w) = (d as u8, d as u16, d as u32);
                println!("crc32c 8 {:08x} {:016x} {:08x}", crc, b, __crc32cb(black_box(crc), black_box(b)));
                println!("crc32c 16 {:08x} {:016x} {:08x}", crc, h, __crc32ch(black_box(crc), black_box(h)));
                println!("crc32c 32 {:08x} {:016x} {:08x}", crc, w, __crc32cw(black_box(crc), black_box(w)));
                println!("crc32c 64 {:08x} {:016x} {:08x}", crc, d, __crc32cd(black_box(crc), black_box(d)));
                println!("crc32 8 {:08x} {:016x} {:08x}", crc, b, __crc32b(black_box(crc), black_box(b)));
                println!("crc32 16 {:08x} {:016x} {:08x}", crc, h, __crc32h(black_box(crc), black_box(h)));
                println!("crc32 32 {:08x} {:016x} {:08x}", crc, w, __crc32w(black_box(crc), black_box(w)));
                println!("crc32 64 {:08x} {:016x} {:08x}", crc, d, __crc32d(black_box(crc), black_box(d)));
            }
        }
    }
}
