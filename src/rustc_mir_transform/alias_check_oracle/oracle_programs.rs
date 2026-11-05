// docs/reviews/fixers-39.md F1: `MatchBranchSimplification` stored the arm's `Place` in its new statement. An or-pattern
// keeps the arm alive through its second predecessor, so both statements stay in the body and `SimplifyLocals` renumbers
// the one object twice. `e3` then failed MIR validation (an ICE); in `wrong` the local before the right one was assigned,
// `_9 = Eq(..)` where the oracle has `_10`, with exit 0 and valid MIR.
//
// `f`: `clone_Body` copied `user_type_annotations` one level, so `RegionRenumberer` wrote into the input body's `inferred_ty`.
// With `-Zverbose-internals`, the `CleanupPostBorrowck.before` dump printed `&'?6 i32` where the oracle prints
// `&'{erased} i32`.
#![crate_type = "lib"]

pub fn f<'a>(y: &'a i32) -> &'a i32 {
    let z: &'a i32 = y;
    z
}

pub fn e3(k: i32, a: i32) -> u32 {
    let pre = a == 3;
    let mut acc = 0u32;
    let mut i = 0;
    while i < 3 {
        let r = match (pre, k) { (true, _) | (_, 1) => true, _ => false };
        if r { acc += 1; }
        i += 1;
    }
    acc
}

#[inline(never)]
pub fn opaque(x: bool) -> bool { x }

pub fn wrong(k: i32, a: i32) -> u32 {
    let pre = a == 3;
    let mut acc = 0u32;
    let mut i = 0u8;
    while i < 3 {
        let y = i == 2; let z = opaque(y);
        let r = match (pre, k) { (true, _) | (_, 1) => true, _ => false };
        if r { acc += 1; }
        if z { acc += 2; } if y { acc += 4; }
        i += 1;
    }
    acc
}
