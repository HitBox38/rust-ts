#![crate_type = "lib"]
// An array repeat of a non-byte element: rustc's `write_operand_repeatedly` builds a loop with a phi.
pub fn rep(x: (u32, u16)) -> [(u32, u16); 6] {
    [x; 6]
}
