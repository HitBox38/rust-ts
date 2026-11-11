#![crate_type = "lib"]
// A match lowered to a switch.
pub fn sw(x: u32) -> u8 {
    match x {
        0 => 10,
        1 => 3,
        7 => 99,
        1000 => 4,
        _ => 0,
    }
}
