macro_rules! grid {
    ($($($x:expr),*);*) => { [$([$($x + 1),*]),*] };
}
const _: () = grid!(1, 2; 3; 4, 5, 6);
const _: () = grid!();
macro_rules! zip {
    ($($a:ident)*; $($b:ident)*) => { $(let $a = $b;)* };
}
fn f() {
    zip!(x y; 1 2);
    zip!(x y; 1);
}
macro_rules! novar { ($($a:ident)*) => { $(oops)* } }
const _: () = novar!(a b);
macro_rules! novar2 { ($($a:ident)*) => { $(x $aa)* } }
const _: () = novar2!(a b);
macro_rules! novar3 { ($b:ident $($a:ident)*) => { $($bb)* } }
const _: () = novar3!(z a b);
macro_rules! novar4 { ($b:ident) => { $($bq)* } }
const _: () = novar4!(z);
macro_rules! still { ($($a:ident)*) => { $a } }
const _: () = still!(a b);
macro_rules! once { ($($a:ident)*) => { $($a)+ } }
const _: () = once!();
macro_rules! deep { ($($($a:ident)*),*) => { $($($a)*)* } }
const _: () = deep!(a b, c, , d e f);
macro_rules! sepout { ($($a:ident)*) => { $($a)+* + $($a)|* } }
const _: () = sepout!(a b c);
macro_rules! nodescend { ($($a:ident)*) => { $($a $($a)*)* } }
const _: () = nodescend!(a b);
