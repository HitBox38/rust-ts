//@ flags: -Ctarget-feature=+sha,+sse2,+ssse3
#![feature(repr_simd, link_llvm_intrinsics, simd_ffi)]
#![allow(internal_features, non_camel_case_types, improper_ctypes, dead_code, unused_macros)]
include!("prelude.rs");
unsafe extern "llvm-intrinsic" {
    #[link_name = "llvm.x86.sha256rnds2"] fn rnds2(a: i32x4, b: i32x4, k: i32x4) -> i32x4;
    #[link_name = "llvm.x86.sha256msg1"] fn msg1(a: i32x4, b: i32x4) -> i32x4;
    #[link_name = "llvm.x86.sha256msg2"] fn msg2(a: i32x4, b: i32x4) -> i32x4;
}
const K: [u32; 64] = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01,
    0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
    0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
    0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08,
    0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];
fn v(a: [u32; 4]) -> i32x4 {
    i32x4(a.map(|x| x as i32))
}
fn u(a: i32x4) -> [u32; 4] {
    unsafe { core::mem::transmute(a) }
}
fn main() {
    let mut r = Bytes(0xcafe_f00d);
    for _ in 0..16 {
        let (a, b, k): (i32x4, i32x4, i32x4) = (r.v::<_, 16>(), r.v::<_, 16>(), r.v::<_, 16>());
        t!("llvm.x86.sha256rnds2", rnds2(a, b, k));
        t!("llvm.x86.sha256msg1", msg1(a, b));
        t!("llvm.x86.sha256msg2", msg2(a, b));
    }
    let zero = v([0; 4]);
    let ones = v([u32::MAX; 4]);
    t!("llvm.x86.sha256rnds2", rnds2(zero, zero, zero));
    t!("llvm.x86.sha256rnds2", rnds2(ones, ones, ones));
    t!("llvm.x86.sha256msg1", msg1(zero, ones));
    t!("llvm.x86.sha256msg2", msg2(ones, zero));

    // Known vector: SHA-256("abc") (FIPS 180-4). The schedule goes through msg1 / msg2, the rounds through rnds2.
    let mut w = [0u32; 64];
    w[0] = 0x61626380;
    w[15] = 24;
    let mut i = 16;
    while i < 64 {
        // Lane 0 holds the oldest word (Intel's W0 = SRC1[31:0]).
        let x = u(unsafe { msg1(v([w[i - 16], w[i - 15], w[i - 14], w[i - 13]]), v([w[i - 12], w[i - 11], w[i - 10], w[i - 9]])) });
        let y = [
            x[0].wrapping_add(w[i - 7]),
            x[1].wrapping_add(w[i - 6]),
            x[2].wrapping_add(w[i - 5]),
            x[3].wrapping_add(w[i - 4]),
        ];
        let z = u(unsafe { msg2(v(y), v([w[i - 4], w[i - 3], w[i - 2], w[i - 1]])) });
        w[i] = z[0];
        w[i + 1] = z[1];
        w[i + 2] = z[2];
        w[i + 3] = z[3];
        i += 4;
    }
    let h0: [u32; 8] = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    // Lanes are ABEF / CDGH with A in lane 3.
    let (mut abef, mut cdgh) = ([h0[5], h0[4], h0[1], h0[0]], [h0[7], h0[6], h0[3], h0[2]]);
    let mut i = 0;
    while i < 64 {
        let wk = [w[i].wrapping_add(K[i]), w[i + 1].wrapping_add(K[i + 1]), 0, 0];
        let next = u(unsafe { rnds2(v(cdgh), v(abef), v(wk)) });
        cdgh = abef;
        abef = next;
        i += 2;
    }
    let d = [
        h0[0].wrapping_add(abef[3]), h0[1].wrapping_add(abef[2]), h0[2].wrapping_add(cdgh[3]), h0[3].wrapping_add(cdgh[2]),
        h0[4].wrapping_add(abef[1]), h0[5].wrapping_add(abef[0]), h0[6].wrapping_add(cdgh[1]), h0[7].wrapping_add(cdgh[0]),
    ];
    println!("sha256-abc {:08x}{:08x}{:08x}{:08x}{:08x}{:08x}{:08x}{:08x}", d[0], d[1], d[2], d[3], d[4], d[5], d[6], d[7]);
    assert_eq!(d, [0xba7816bf, 0x8f01cfea, 0x414140de, 0x5dae2223, 0xb00361a3, 0x96177a9c, 0xb410ff61, 0xf20015ad]);
}
