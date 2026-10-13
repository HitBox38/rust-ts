#![feature(macro_metavar_expr_concat)]
macro_rules! mk {
    ($a:ident, $b:literal, $c:tt) => {
        fn ${concat($a, _, $b, $c, foo)}() {}
        const ${concat(X, $a)}: () = ();
    };
}
mk!(hello, 1, world);
mk!(r#loop, "s", t);
macro_rules! bad { ($a:tt) => { fn ${concat($a, x)}() {} } }
bad!(1);
bad!(-);
macro_rules! bad2 { ($a:literal) => { fn ${concat(x, $a)}() {} } }
bad2!(1.5);
bad2!(2u8);
bad2!('c');
macro_rules! bad3 { ($($a:ident)*) => { fn ${concat(x, $a)}() {} } }
bad3!(a b);
macro_rules! bad4 { ($a:expr) => { fn ${concat(x, $a)}() {} } }
bad4!(a);
macro_rules! rep { ($($a:ident)*) => { $(fn ${concat(get_, $a)}() {})* } }
rep!(a b c);
macro_rules! sp { ($a:ident) => { fn ${concat($a, " ")}() {} } }
sp!(x);
