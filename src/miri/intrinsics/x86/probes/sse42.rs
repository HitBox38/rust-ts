// Probe of lane miri-x86-a: every `llvm.x86.sse42.*` arm of intrinsics/x86/sse42.rs (`-C target-feature=+sse4.2`), called
// directly by link name: all 128 meaningful imm values of the string compares, implicit and explicit lengths, signed and
// unsigned ranges, and the CRC32C instructions.
#![feature(link_llvm_intrinsics, repr_simd, simd_ffi)]
#![no_main]
#![allow(unused, non_camel_case_types, improper_ctypes, internal_features, unnecessary_transmutes)]
use std::arch::x86_64::*;
include!("common.rs");

unsafe extern "llvm-intrinsic" {
    #[link_name = "llvm.x86.sse42.pcmpistrm128"] fn istrm(a: i8x16, b: i8x16, imm: i8) -> i8x16;
    #[link_name = "llvm.x86.sse42.pcmpestrm128"] fn estrm(a: i8x16, la: i32, b: i8x16, lb: i32, imm: i8) -> u8x16;
    #[link_name = "llvm.x86.sse42.pcmpistria128"] fn istria(a: i8x16, b: i8x16, imm: i8) -> i32;
    #[link_name = "llvm.x86.sse42.pcmpestria128"] fn estria(a: i8x16, la: i32, b: i8x16, lb: i32, imm: i8) -> i32;
    #[link_name = "llvm.x86.sse42.pcmpistri128"] fn istri(a: i8x16, b: i8x16, imm: i8) -> i32;
    #[link_name = "llvm.x86.sse42.pcmpestri128"] fn estri(a: i8x16, la: i32, b: i8x16, lb: i32, imm: i8) -> i32;
    #[link_name = "llvm.x86.sse42.pcmpistrio128"] fn istrio(a: i8x16, b: i8x16, imm: i8) -> i32;
    #[link_name = "llvm.x86.sse42.pcmpestrio128"] fn estrio(a: i8x16, la: i32, b: i8x16, lb: i32, imm: i8) -> i32;
    #[link_name = "llvm.x86.sse42.pcmpistric128"] fn istric(a: i8x16, b: i8x16, imm: i8) -> i32;
    #[link_name = "llvm.x86.sse42.pcmpestric128"] fn estric(a: i8x16, la: i32, b: i8x16, lb: i32, imm: i8) -> i32;
    #[link_name = "llvm.x86.sse42.pcmpistriz128"] fn istriz(a: i8x16, b: i8x16, imm: i8) -> i32;
    #[link_name = "llvm.x86.sse42.pcmpistris128"] fn istris(a: i8x16, b: i8x16, imm: i8) -> i32;
    #[link_name = "llvm.x86.sse42.pcmpestriz128"] fn estriz(a: i8x16, la: i32, b: i8x16, lb: i32, imm: i8) -> i32;
    #[link_name = "llvm.x86.sse42.pcmpestris128"] fn estris(a: i8x16, la: i32, b: i8x16, lb: i32, imm: i8) -> i32;
    #[link_name = "llvm.x86.sse42.crc32.32.8"] fn crc8(c: u32, d: u8) -> u32;
    #[link_name = "llvm.x86.sse42.crc32.32.16"] fn crc16(c: u32, d: u16) -> u32;
    #[link_name = "llvm.x86.sse42.crc32.32.32"] fn crc32(c: u32, d: u32) -> u32;
    #[link_name = "llvm.x86.sse42.crc32.64.64"] fn crc64(c: u64, d: u64) -> u64;
}

// No terminator; short; empty; high bytes (signed vs unsigned); character ranges; repeated; words with a terminator and high words.
static STRS: [[u8; 16]; 7] = [
    *b"abcabcabcabcabcd",
    *b"bc\0\0\0\0\0\0\0\0\0\0\0\0\0\0",
    [0; 16],
    *b"abc\xffabc\x80\x7f\0\0\0\0\0\0\0",
    *b"azAZ09\0\0\0\0\0\0\0\0\0\0",
    *b"aaaaaaaaaaaaaaaa",
    [0x61, 0, 0x62, 0, 0x63, 0, 0, 0, 0x61, 0, 0x62, 0, 0x64, 0, 0xff, 0xff],
];
// (str1, str2): one pair of each kind for all 128 imm values.
static PAIRS: [(usize, usize); 4] = [(1, 0), (4, 3), (0, 2), (6, 6)];
// Fewer imm values for the other string pairs: each compare mode, in each element type, with each polarity.
static MORE_PAIRS: [(usize, usize); 4] = [(4, 0), (2, 0), (3, 5), (1, 6)];
static MORE_IMMS: [i8; 12] = [0x00, 0x05, 0x0a, 0x0f, 0x10, 0x15, 0x2a, 0x3f, 0x40, 0x4c, 0x6d, 0x7e];
static LENS: [(i32, i32); 10] = [(2, 16), (0, 16), (16, 0), (0, 0), (3, 7), (100, 100), (-1, -5), (17, 8), (8, 9), (7, 8)];
static E_IMMS: [i8; 26] = [
    0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x10, 0x18, 0x24, 0x30,
    0x38, 0x40, 0x4c, 0x4d, 0x70, 0x7f,
];
static CRCS: [(u32, u64); 5] = [(0, 0), (u32::MAX, u64::MAX), (0x1234_5678, 0x9abc_def0_1234_5678), (1, 1), (0x8000_0000, 0x8000_0000_0000_0000)];

fn implicit(imm: i8, i: usize, j: usize) { unsafe {
    let (a, b): (i8x16, i8x16) = (t(STRS[i]), t(STRS[j]));
    hex(imm); put(b' '); hex(i as u8); hex(j as u8);
    f("m", istrm(a, b, imm));
    f("r", [istria(a, b, imm), istri(a, b, imm), istrio(a, b, imm), istric(a, b, imm), istriz(a, b, imm), istris(a, b, imm)]);
    nl();
} }

#[unsafe(no_mangle)]
fn miri_start(_: isize, _: *const *const u8) -> isize { unsafe {
    let mut imm = 0i8;
    while imm >= 0 {
        each!(p in PAIRS => { implicit(imm, p.0, p.1); });
        imm = imm.wrapping_add(1);
    }
    each!(imm in MORE_IMMS => { each!(p in MORE_PAIRS => { implicit(imm, p.0, p.1); }); });
    each!(imm in E_IMMS => { each!(l in LENS => {
        let (la, lb) = l;
        let (a, b): (i8x16, i8x16) = (t(STRS[1]), t(STRS[0]));
        hex(imm); put(b' '); hex(la); put(b' '); hex(lb);
        f("m", estrm(a, la, b, lb, imm));
        f("r", [estria(a, la, b, lb, imm), estri(a, la, b, lb, imm), estrio(a, la, b, lb, imm), estric(a, la, b, lb, imm), estriz(a, la, b, lb, imm), estris(a, la, b, lb, imm)]);
        nl();
    }); });
    // A set bit 7 of imm is ignored.
    let (a, b): (i8x16, i8x16) = (t(STRS[1]), t(STRS[0]));
    f("imm7", istrm(a, b, -128)); f("imm7", istri(a, b, -128)); nl();

    each!(p in CRCS => {
        let (c, d) = p;
        f("c8", crc8(c, d as u8)); f("c16", crc16(c, d as u16)); f("c32", crc32(c, d as u32));
        f("c64", crc64(c as u64, d)); f("c64h", crc64(0xffff_ffff_0000_0000 | c as u64, d));
        nl();
    });
    flush();
    0
} }
