#![feature(no_debug)]
#![cfg_attr(true, crate_type = "lib")]
#![cfg_attr(true, crate_name = "foo")]
#[cfg(false)]
fn f() {}
#[cfg_attr(true, cfg(false))]
fn g() {}
#[cfg_attr(all(), cfg_attr(any(), cfg(false)), inline)]
fn h() {}
#[cfg_attr(all(), inline, cold)]
fn i() {}
#[cfg_attr(any(), inline)]
fn j() {}
mod m {
    #[cfg(false)]
    fn hidden() {}
    #[cfg_attr(not(any()), allow(unused))]
    fn shown() {}
}
fn main() {}
