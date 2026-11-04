//@ flags: -Ctarget-feature=+aes,+sse2
#![feature(link_llvm_intrinsics)]
#![allow(internal_features, improper_ctypes)]
unsafe extern "llvm-intrinsic" {
    #[link_name = "llvm.x86.aesni.nonexistent"] fn nonexistent();
}
fn main() {
    unsafe { nonexistent() };
}
