//@ flags: -Ctarget-feature=+sha,+sse2,+ssse3
#![feature(link_llvm_intrinsics)]
#![allow(internal_features, improper_ctypes)]
unsafe extern "llvm-intrinsic" {
    #[link_name = "llvm.x86.sha1rnds4"] fn sha1rnds4();
}
fn main() {
    unsafe { sha1rnds4() };
}
