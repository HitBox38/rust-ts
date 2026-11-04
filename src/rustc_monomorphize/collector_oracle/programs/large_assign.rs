//@ edition: 2021
// check_moves: the large_assignments lint through move_size_limit, with Box::new skipped.
#![crate_type = "lib"]
#![feature(large_assignments)]
#![move_size_limit = "1000"]
#![warn(large_assignments)]
pub fn take(_: [u8; 2000]) {}
pub fn f() -> ([u8; 2000], Box<[u8; 2000]>) {
    let a = [0u8; 2000];
    let b = a;
    take(a);
    (b, Box::new(a))
}
