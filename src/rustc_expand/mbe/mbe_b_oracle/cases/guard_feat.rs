#![feature(macro_guard_matcher)]
macro_rules! g1 { ($p:pat $g:guard => $e:expr) => { match 1 { $p $g => $e, _ => 0 } } }
const _: u8 = g1!(x if x > 1 => 2);
macro_rules! g2 { ($g:guard x) => {} }
macro_rules! g3 { ($p:pat_param $g:guard , $q:pat $h:guard x) => {} }
macro_rules! g4 { ($p:pat_param $g:guard {}) => {} }
