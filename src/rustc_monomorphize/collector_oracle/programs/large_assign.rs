//@ edition: 2021
// check_moves: the large_assignments lint through move_size_limit, with Box::new skipped.
#![crate_type = "lib"]
#![feature(large_assignments)]
#![move_size_limit = "1000"]
#![warn(large_assignments)]
pub fn take(_: [u8; 2000]) {}
pub struct NotCopy(pub [u8; 2000]);
pub fn take_move(_: NotCopy) {}
// A moved argument is passed by pointer, so it does not lint; a copied one does.
pub fn moved(n: NotCopy) { take_move(n) }
// Overlapping spans lint once: the moves inside the block, then the temporary in the whole tuple's statement.
pub fn overlap(a: [u8; 2000]) -> ([u8; 2000], u8) { let c = ({ let x = a; x }, 1u8); c }
pub fn f() -> ([u8; 2000], Box<[u8; 2000]>) {
    let a = [0u8; 2000];
    let b = a;
    take(a);
    (b, Box::new(a))
}
// A copy at or above 2^53 bytes: the size test and the lint's `size` are `u64`s (docs/reviews/fixers-44.md F5, lane fixers-46).
#[derive(Clone, Copy)]
pub struct Huge(pub [u8; 9007199254741001]);
pub fn huge(h: &Huge) -> Huge { *h }
