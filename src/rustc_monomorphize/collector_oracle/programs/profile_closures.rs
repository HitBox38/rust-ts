//@ edition: 2021
//@ compile-flags: -Zprofile-closures
// `dump_closure_profile`: the test also compares the closure_profile_<pid>.csv this writes.
#![crate_type = "lib"]
// The csv is appended to in `create_fn_mono_item` call order, so it also shows the collector's walk order, which nothing
// else from the oracle does.
fn second() -> u32 { let e = |x: u32| x + 1; e(1) }
pub fn f(a: (String, u32)) -> usize {
    let c = move || a.0.len();
    let d = |x: u32| x + second();
    let p: fn(u32) -> u32 = |x| x;
    c() + d(1) as usize + p(2) as usize
}
pub fn g(b: (u8, u64)) -> u64 { let h = || b.1; h() }
// Disjoint captures: the whole of `big` before RFC 2229, one field after.
pub fn sizes(big: (String, [u64; 8]), r: &(u8, [u64; 8])) -> usize { let k = move || big.0.len(); let l = || r.0; k() + l() as usize }
