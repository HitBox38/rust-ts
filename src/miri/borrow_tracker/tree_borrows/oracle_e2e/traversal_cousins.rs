// miri-flags: -Zmiri-tree-borrows
// review miri-tb-a F2 program B: the same, for cousins at different depths.
fn two(_a: &mut i32, _b: &mut i32, _c: &mut i32, q: *mut i32) { unsafe { q.write(1) }; }
fn main() {
    let mut v = 0i32;
    let p = &raw mut v;
    unsafe {
        let m1 = &mut *p;
        let r1 = &raw mut *m1;
        let m2 = &mut *r1;
        let r2 = &raw mut *m2;
        let a = &mut *r2;
        let b = &mut *r1;
        let c = &mut *p;
        two(a, b, c, r2);
    }
}
