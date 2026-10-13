// expand-core's error scenarios with the real resolver: unresolved macros (retried, then forced),
// incomplete parses of a macro's expansion, `cfg` / `cfg_attr` stripping.
macro_rules! echo { ($($t:tt)*) => { $($t)* } }
missing!();
fn f() { let x = missing!(1); }
fn g() -> u8 { echo!(1 2) }
fn h() { let _: echo!(u8 u16) = 1; }
#[cfg_attr(all(), inert)] fn a() {}
#[cfg_attr(any(), inert)] fn b() {}
#[cfg(false)] fn c() {}
struct St { #[cfg(false)] a: u8, b: u8 }
later!();
macro_rules! later { () => {} }
