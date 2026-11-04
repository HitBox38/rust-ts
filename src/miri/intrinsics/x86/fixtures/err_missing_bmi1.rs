//@ flags: -Ctarget-feature=+bmi2
#![feature(link_llvm_intrinsics)]
#![allow(internal_features, improper_ctypes)]
unsafe extern "llvm-intrinsic" {
    #[link_name = "llvm.x86.bmi.bextr.32"] fn bextr(a: u32, b: u32) -> u32;
}
fn main() {
    println!("{}", unsafe { bextr(1, 1) });
}
