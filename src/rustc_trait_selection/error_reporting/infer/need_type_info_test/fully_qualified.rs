pub trait Make { fn make() -> Self; }
impl Make for u8 { fn make() -> u8 { 0 } }
impl Make for u16 { fn make() -> u16 { 0 } }
pub fn a() {
    let x = Make::make();
}
pub trait Conv<T> { fn conv(&self) -> T; }
impl Conv<u8> for u32 { fn conv(&self) -> u8 { 0 } }
impl Conv<u16> for u32 { fn conv(&self) -> u16 { 0 } }
pub fn b(v: u32) {
    let y = v.conv();
}
