macro_rules! local {
    ($e:expr) => {{ let x = 1; $e + x }};
}
fn f() {
    let x = 2;
    let y = local!(x);
}
macro_rules! krate { () => { $crate::foo() } }
const _: () = krate!();
macro_rules! def_mac {
    ($name:ident) => { macro_rules! $name { ($x:ident) => { let $x = 1; } } };
}
def_mac!(inner);
macro_rules! ext_semi { () => { 1; } }
macro_rules! semi { () => { 2; } }
fn g() {
    let a = ext_semi!();
    let b = semi!();
}
macro_rules! tt_twice { ($t:tt) => { ($t, $t) } }
const _: () = tt_twice!(z);
macro_rules! tt_seq { ($($t:tt)*) => { [$($t)*] } }
const _: () = tt_seq!(a + b);
macro_rules! frags {
    ($i:ident $l:lifetime $lit:literal $b:block $m:meta $p:path ; $v:vis fn $s:stmt ; $it:item $ty:ty , $pt:pat , $e:expr) => {
        fn $i<$l>() -> $ty { $lit; $b; $s; let $pt = $e; $p }
        #[$m] $v struct S;
        $it
    };
}
frags!(foo 'a "s" { 1 } inline core::x; pub(crate) fn let z = 1; fn bar() {} u8, (a, _), -1);
