#![crate_type = "lib"]
// An unnamed global: `Global::alloc_impl`'s zero-size answer, which `vec!` brings in. The oracle's text names it
// `@anon.<md5>.0` (LLVMRustOptimize's name-anon-globals), the model prints `@0`; N1 runs that pass on both sides.
pub fn v() -> Vec<u8> {
    vec![1u8, 2, 3]
}
