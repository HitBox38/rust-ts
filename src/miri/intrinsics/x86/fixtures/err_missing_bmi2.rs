//@ flags: 
#![feature(link_llvm_intrinsics)]
#![allow(internal_features, improper_ctypes)]
unsafe extern "llvm-intrinsic" {
    #[link_name = "llvm.x86.bmi.pext.64"] fn pext(a: u64, b: u64) -> u64;
}
fn main() {
    println!("{}", unsafe { pext(1, 1) });
}
