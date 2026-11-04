//@ edition: 2021
// A post-monomorphization error, with the "the above error was encountered while instantiating" note.
#![crate_type = "lib"]
struct Fail<T>(T);
impl<T> Fail<T> { const C: () = panic!("no"); }
fn inner<T>() { let _ = Fail::<T>::C; }
fn outer<T>() { inner::<T>() }
pub fn f() { outer::<u8>() }
