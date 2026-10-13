#![feature(macro_attr)]
// `NamedMatches` (`FxHashMap<MacroRulesNormalizedIdent, NamedMatch>`) iteration order: the list of
// repeatable meta-variables in `transcribe_sequence`'s error and its `find_best_match_for_name` ties.
// The meta-variable names are predefined symbols, so their `Symbol` indices (which the keys hash) do
// not depend on what the driver interned before the case.
macro_rules! many {
    ($($alloc:ident)* ; $($align:ident)* ; $($abi:ident)* ; $($add:ident)* ; $($asm:ident)*) => { $(nope $zzz)* };
}
const _: () = many!(a ; b ; c ; d ; e);
macro_rules! grow {
    ($($u8:ident)* ; $($i8:ident)* ; $($u16:ident)* ; $($i16:ident)* ; $($u32:ident)* ; $($i32:ident)* ;
     $($u64:ident)* ; $($i64:ident)* ; $($u128:ident)* ; $($i128:ident)* ; $($f16:ident)* ; $($f32:ident)* ;
     $($f64:ident)* ; $($f128:ident)* ; $($usize:ident)* ; $isize:ident $bool:ident $char:ident) => { $(nope $zzz)* };
}
const _: () = grow!(a ; ; ; ; ; ; ; ; ; ; ; ; ; ; ; x y z);
macro_rules! ties {
    ($($u32:ident)* , $($i32:ident)* , $($f32:ident)* , $u64:ident $i64:ident $f64:ident) => { $($x32)* $($x64)* };
}
const _: () = ties!(a , b , c , x y z);
macro_rules! unties {
    ($($u32:ident)* , $($i32:ident)* , $($f32:ident)* , $u64:ident $i64:ident $f64:ident) => { $($x64)* };
}
const _: () = unties!(a , b , c , x y z);
// `named_matches.extend(body_named_matches)` in `try_match_macro_attr`.
macro_rules! at {
    attr($($alloc:ident)* , $($align:ident)* , $abi:ident) ($add:vis struct $asm:ident $($alias:tt)*) => { $(oops $zzz)* };
}
#[at(x y , z , k)]
struct S;
