//@ edition: 2021
// check_feature_dependent_abi: an `extern "C"` definition and call passing AVX vectors without the feature.
#![crate_type = "lib"]
#![allow(improper_ctypes_definitions)]
use std::arch::x86_64::__m256;
pub extern "C" fn def(x: __m256) -> __m256 { x }
pub unsafe fn call(p: extern "C" fn(__m256) -> __m256, x: __m256) -> __m256 { p(x) }
