#![crate_type = "lib"]
#![feature(core_intrinsics)]
#![allow(internal_features)]
// Atomic read-modify-write, compare-exchange, load, store and fence, through the intrinsics directly.
use std::intrinsics::{self, AtomicOrdering};
pub unsafe fn atom(p: *mut u32, q: *mut u64) -> u32 {
    let old = intrinsics::atomic_xadd::<u32, u32, { AtomicOrdering::SeqCst }>(p, 5);
    let (v, ok) = intrinsics::atomic_cxchg::<u64, { AtomicOrdering::AcqRel }, { AtomicOrdering::Acquire }>(q, 1, 2);
    intrinsics::atomic_store::<u32, { AtomicOrdering::Release }, false>(p, v as u32);
    intrinsics::atomic_fence::<{ AtomicOrdering::SeqCst }>();
    old + ok as u32 + intrinsics::atomic_load::<u32, { AtomicOrdering::Relaxed }, true>(p)
}
