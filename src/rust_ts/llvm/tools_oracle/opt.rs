#![crate_type = "lib"]
#![no_std]
// What tools.test.ts runs through LLVMRustOptimize at -Copt-level=0 and 2: a loop the loop vectorizer and unroller take, two
// identical bodies MergeFunctions folds into an alias (`-mergefunc-use-aliases`), and a small callee the inliner takes.
#[inline(never)]
pub fn sum(xs: &[u32]) -> u32 {
    let mut s = 0u32;
    for x in xs {
        s = s.wrapping_add(x.wrapping_mul(3));
    }
    s
}

#[inline(never)]
pub fn twin_a(a: u64, b: u64) -> u64 {
    a.wrapping_mul(b).rotate_left(7) ^ b
}

#[inline(never)]
pub fn twin_b(a: u64, b: u64) -> u64 {
    a.wrapping_mul(b).rotate_left(7) ^ b
}

fn helper(x: i32) -> i32 {
    x * 2 + 1
}

#[inline(never)]
pub fn caller(x: i32) -> i32 {
    helper(x) + helper(x + 1)
}
