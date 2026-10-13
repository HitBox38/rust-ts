macro_rules! one { (a) => {}; (b c) => {} }
one!(x);
one!(b);
one!(b d);
one!();
macro_rules! comma { ($a:expr, $b:expr) => {} }
comma!(1 2);
comma!("a" b);
macro_rules! docm { (a) => {} }
docm! {
    /// doc
}
docm! {
    //! inner
}
macro_rules! amb { ($($i:ident)* $j:ident) => {} }
amb!(a b);
macro_rules! amb2 { ($($i:ident)* $($j:ident)*) => {} }
amb2!(a);
macro_rules! amb3 { ($($i:ident)?, $($j:tt)?) => {} }
amb3!(a,);
macro_rules! fwd { ($e:expr) => { inner!($e) } }
macro_rules! inner { (1) => {} }
macro_rules! nt { ($e:expr) => {}; ($i:ident +) => {} }
nt!(a b);
nt!(1 +);
macro_rules! seqm { ($($a:ident),+ ;) => {} }
seqm!(a, b c);
seqm!(a,);
macro_rules! ext_nom { (x) => {} }
ext_nom!(y);
