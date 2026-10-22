pub trait A {}
impl A for u8 {}
impl A for u16 {}
impl A for (u8, u8) {}
impl A for (u8,) {}
impl A for &'static str {}
pub struct W<T>(pub T);
impl A for W<u8> {}
impl A for W<bool> {}
pub fn need<T: A>(_t: T) {}
pub fn a() {
    need(1u32);
}
pub fn b() {
    need(W(1u32));
}
pub fn c() {
    need((1u32, 2u32));
}
pub trait Many {}
impl Many for u8 {}
impl Many for u16 {}
impl Many for u32 {}
impl Many for u64 {}
impl Many for i8 {}
impl Many for i16 {}
impl Many for i32 {}
impl Many for i64 {}
impl Many for f32 {}
impl Many for f64 {}
impl Many for char {}
pub fn need_many<T: Many>(_t: T) {}
pub fn d() {
    need_many(true);
}
