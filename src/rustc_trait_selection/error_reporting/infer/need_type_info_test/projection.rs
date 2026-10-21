pub trait Assoc { type Out; }
impl Assoc for u8 { type Out = u16; }
impl Assoc for u16 { type Out = u16; }
pub fn get<T: Assoc>() -> T::Out { loop {} }
pub fn a() {
    let z: u16 = get();
}
pub fn b() {
    let x = 1u8.into();
}
