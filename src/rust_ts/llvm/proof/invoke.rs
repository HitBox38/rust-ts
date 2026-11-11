#![crate_type = "lib"]
// A call that may unwind with a value to drop: an invoke, a landingpad and a resume.
pub struct D(pub u32);
impl Drop for D {
    fn drop(&mut self) {
        unsafe { release(self.0) }
    }
}
unsafe extern "C-unwind" {
    fn may_unwind(x: u32) -> u32;
    fn release(x: u32);
}
pub fn guarded(x: u32) -> u32 {
    let _d = D(x);
    unsafe { may_unwind(x) }
}
