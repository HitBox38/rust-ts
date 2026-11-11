#![crate_type = "lib"]
// A by-value copy of a large array: LLVMRustBuildMemCpy, an `llvm.memcpy` intrinsic call.
pub fn copy(p: &[u64; 8]) -> [u64; 8] {
    *p
}
