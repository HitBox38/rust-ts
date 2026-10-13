// expand-core's mock-resolver scenarios (rustc_expand/expand_oracle/cases.txt) with real `macro_rules`:
// bang macros in every position, nesting, inline modules, doc comments and `cfg` on macro calls,
// `impl Trait` names, list delegation.
#![feature(fn_delegation)]
macro_rules! echo { ($($t:tt)*) => { $($t)* } }
echo! { fn f0() {} struct S; }
fn g() {}
fn f1() -> u8 { let x = echo!(1); x }
fn f2() { echo! { let a = 1; let b = a; } echo!(b); }
fn f3() -> u8 { echo!(5) }
echo! { fn f4() { echo! { let a = echo!(1); } } }
fn f5(x: echo!(u8)) { match x { echo!(_) => {} } }
trait T { echo! { fn a(&self); } fn b(&self); }
impl S { echo! { fn c() {} } }
impl T for S { echo! { fn a(&self) {} } fn b(&self) {} }
extern "C" { echo! { fn ext(); } }
mod m { echo! { fn f() {} } mod n { echo! { struct S; } } }
/// doc
echo! { fn f6() {} }
#[cfg(false)] echo! { fn f7() {} }
#[cfg(true)] echo! { fn f8() {} }
fn f9(x: impl T, y: &impl T) {}
struct D;
impl T for D { reuse T::{a, b}; }
