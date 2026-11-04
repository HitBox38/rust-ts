//@ edition: 2018
//@ compile-flags: -Zprofile-closures
// Before edition 2021 a closure captures whole variables, while `closure_size_eval` also records the precise captures:
// the two sizes in the csv differ here.
#![crate_type = "lib"]
pub fn sizes(big: (String, [u64; 8]), r: (u8, [u64; 8])) -> usize {
    let k = move || big.0.len();
    let l = move || r.0;
    k() + l() as usize
}
