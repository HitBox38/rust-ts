//@ flags: -Ctarget-feature=+avx
#![feature(link_llvm_intrinsics)]
#![allow(internal_features, improper_ctypes)]
unsafe extern "llvm-intrinsic" {
    #[link_name = "llvm.x86.avx.nonexistent"] fn nonexistent();
}
fn main() {
    unsafe { nonexistent() };
}
