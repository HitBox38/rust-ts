macro_rules! incomplete { () => { 1 + } }
const _: u8 = incomplete!();
macro_rules! extra { () => { 1 2 } }
const _: u8 = extra!();
macro_rules! unbound { ($a:ident) => { $b } }
const _: u8 = unbound!(x);
macro_rules! unbound2 { ($abc:ident) => { $abd + 1 }; ($zzz:expr, $q:tt) => {} }
const _: u8 = unbound2!(x);
macro_rules! unbound3 { ($a:ident) => { $zzz }; ($zzz:expr, $q:tt) => {} }
const _: u8 = unbound3!(x);
macro_rules! unbound4 { ($a:ident) => { $qwertyuiop } }
const _: u8 = unbound4!(x);
macro_rules! notexpr { () => { let x = 1; } }
const _: u8 = notexpr!();
fn f() {
    let a = notexpr!();
}
macro_rules! notty { () => { 1 } }
type T = notty!();
macro_rules! notpat { () => { + } }
fn g() {
    let notpat!() = 1;
}
macro_rules! items_bad { () => { fn } }
items_bad!();
macro_rules! stmts_ok { () => { let a = 1; a } }
fn h() {
    stmts_ok!();
}
