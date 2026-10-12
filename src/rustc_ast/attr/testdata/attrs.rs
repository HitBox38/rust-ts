#![allow(unused)]
#[doc(alias = "foo", hidden)]
#[a::b = "v"]
#[deprecated(note = "n", since = "1.0")]
#[x(1, true, ::p::q(r), s = 2u8)]
/// line doc
/** block doc */
#[doc = "raw doc"]
#[w(y("z"))]
fn f() {}
