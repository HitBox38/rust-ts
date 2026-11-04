// miri-flags: -Zmiri-tree-borrows
// review miri-tb-a F2 program A: which protected sibling is reported depends on the traversal order (tree_visitor.ts).
fn two(_a: &mut i32, _b: &mut i32, _c: &mut i32, p: *mut i32) { unsafe { p.write(1) }; }
fn main() {
    let mut v = 0i32;
    let p = &raw mut v;
    unsafe { two(&mut *p, &mut *p, &mut *p, p) };
}
