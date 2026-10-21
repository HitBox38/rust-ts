pub fn match_arms(c: u8) -> u32 {
    match c {
        0 => 1u32,
        1 => 2u16,
        _ => 3u32,
    }
}
pub fn if_else(c: bool) -> u32 {
    if c { 1u32 } else { 2u8 }
}
pub fn if_no_else(c: bool) -> u32 {
    if c { 1u32 }
}
pub fn let_else(x: Option<u8>) {
    let Some(y): Option<u16> = x else { return };
}
pub fn pattern(x: (u8, u16)) {
    let (a, b): (u8, u8) = x;
}
pub fn wrap_tuple() {
    let _x: (u8,) = 1u8;
}
pub fn char_str() {
    let _c: char = "a";
    let _s: &str = 'b';
}
pub fn shadow<T: Iterator>(x: T::Item) -> T {
    x
}
pub fn loop_break() -> u32 {
    loop {
        break 1u8;
    }
}
pub fn while_let(x: Option<u8>) {
    while let Some(1u16) = x {}
}
