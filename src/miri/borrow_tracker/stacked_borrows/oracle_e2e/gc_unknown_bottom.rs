// A wildcard access collapses a stack into an unknown bottom; the provenance GC then calls `Stack::retain` on an empty
// stack, whose `truncate(1)` must not grow it (docs/reviews/miri-perf.md O1: the port grew it with a hole and crashed).
fn main() {
    let a = [1u8, 2, 3, 4, 5, 6, 7, 8];
    let p = a.as_ptr();
    let e = std::ptr::with_exposed_provenance::<u8>(p.expose_provenance());
    unsafe { println!("{}", *e) };
    let mut d = [0u8; 8];
    unsafe { std::ptr::copy(p, d.as_mut_ptr(), 8) };
    println!("{:?}", d);
}
