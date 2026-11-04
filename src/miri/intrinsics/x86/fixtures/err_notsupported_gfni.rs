//@ flags: -Ctarget-feature=+gfni,+sse2
#![feature(link_llvm_intrinsics)]
#![allow(internal_features, improper_ctypes)]
unsafe extern "llvm-intrinsic" {
    #[link_name = "llvm.x86.vgf2p8mulbx"] fn x();
}
fn main() {
    unsafe { x() };
}
