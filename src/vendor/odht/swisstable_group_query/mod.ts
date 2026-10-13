// Port of odht =0.3.1 `src/swisstable_group_query/mod.rs`.
//
// PORT: the `cfg_if!` below picks `sse2` only on x86/x86_64 with `target_feature = "sse2"`. The oracle
// host is aarch64-apple-darwin (and odht is built without the `no_simd` feature), so the oracle's odht
// uses `no_simd` (GROUP_SIZE = 8); that is the implementation ported. The binary table layout does not
// depend on the choice: probing always walks the slots as if GROUP_SIZE were REFERENCE_GROUP_SIZE.
// crate-skip: odht-0.3.1/src/swisstable_group_query/sse2.rs:17 from x86 SSE2 group query (not compiled on the aarch64 oracle host; no_simd is ported)
// crate-skip: odht-0.3.1/src/swisstable_group_query/sse2.rs:31 any_empty x86 SSE2 group query (not compiled on the aarch64 oracle host; no_simd is ported)
// crate-skip: odht-0.3.1/src/swisstable_group_query/sse2.rs:36 first_empty x86 SSE2 group query (not compiled on the aarch64 oracle host; no_simd is ported)
// crate-skip: odht-0.3.1/src/swisstable_group_query/sse2.rs:45 next x86 SSE2 group query (not compiled on the aarch64 oracle host; no_simd is ported)
//
// cfg_if::cfg_if! {
//     if #[cfg(all(
//         target_feature = "sse2",
//         any(target_arch = "x86", target_arch = "x86_64"),
//         not(miri),
//         not(feature = "no_simd"),
//     ))] {
//         mod sse2;
//         use sse2 as imp;
//     } else {
//         mod no_simd;
//         use no_simd as imp;
//     }
// }

export { GroupQuery, GROUP_SIZE } from "./no_simd.ts";

// While GROUP_SIZE is target-dependent for performance reasons,
// we always do probing as if it was the same as REFERENCE_GROUP_SIZE.
// This way the same slot indices will be assigned to the same
// entries no matter the underlying target. This allows the
// binary format of the table to be portable.
export const REFERENCE_GROUP_SIZE = 16;
