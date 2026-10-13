#![feature(decl_macro)]
macro m2($x:expr) { let y = $x; y }
macro m3 {
    ($x:expr) => { $x },
    () => { 0 }
}
macro m4 { () => {}; () => {} }
fn f() {
    let a = m2!(1);
    let b = m3!(2);
    let c = m3!();
}
