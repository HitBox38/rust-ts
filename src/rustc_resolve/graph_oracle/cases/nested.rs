pub mod a {
    pub mod b {
        pub mod c { pub fn f() {} }
        pub fn f() {}
    }
    #[no_implicit_prelude]
    pub mod np { pub struct S; fn g() { mod in_fn { pub fn h() {} } } }
    pub fn f() {}
}
mod a2 { mod a { mod b {} } }
const _: () = ();
const _: () = ();
static _S: u8 = 0;
pub trait Tr { const _X: u8; }
fn main() {
    {
        fn x() {}
        { fn x() {} }
    }
    { fn x() {} }
}
