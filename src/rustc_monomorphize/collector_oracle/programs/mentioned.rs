//@ edition: 2021
// A failing const in a generic fn only reached through a dead call: "mentioned" collection must still evaluate it.
#![crate_type = "lib"]
struct Fail<T>(T);
impl<T> Fail<T> { const C: () = panic!("no"); }
#[inline(never)] fn not_called<T>() { let _ = Fail::<T>::C; }
pub fn f() { if false { not_called::<u8>() } }
