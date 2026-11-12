// Fixture of attributes.test.ts (lane cg-types-attrs): functions whose LLVM function attributes differ by source attribute.
// The oracle's `--emit=llvm-ir` prints each one's attribute group; the port applies the attribute fns it can run today
// (cg_types_attrs_test/run.ts `attrs`).
#![crate_type = "lib"]
#![no_std]
#![feature(optimize_attribute)]
#[no_mangle] pub fn a_plain() {}
#[no_mangle] #[inline(never)] pub fn a_never() {}
#[no_mangle] #[inline] pub fn a_hint() {}
#[no_mangle] #[inline(always)] pub fn a_always() {}
#[no_mangle] #[optimize(size)] pub fn a_size() {}
#[no_mangle] #[optimize(none)] pub fn a_none() {}
#[no_mangle] #[optimize(speed)] pub fn a_speed() {}
#[no_mangle] #[cold] pub fn a_cold() {}
