macro_rules! ce {
    () => { compile_error!("no") };
    (a) => { 1 };
    (b) => { { compile_error!{"nested"} } };
    (c) => { compile_error![x] };
    (d) => { compile_error ! ("spaced") };
}
macro_rules! cs { () => { struct S; } }
cs!();
macro_rules! lt { ($l:lifetime) => { fn f<$l>() {} } }
lt!('a);
lt!('static);
macro_rules! rawid { ($i:ident) => { fn $i() {} } }
rawid!(r#match);
macro_rules! bracket { ($($t:tt)*) => { [$($t)*] x } }
const _: () = bracket!([1] 2);
macro_rules! emptyrhs { () => {} }
emptyrhs!();
macro_rules! nested_delims { ($($t:tt)*) => { ( [ { $($t)* } ] ) } }
const _: () = nested_delims!(1);
macro_rules! dollar_tt { ($d:tt) => { macro_rules! generated { ($d x:ident) => {} } } }
dollar_tt!($);
