// Tool attributes: predefined tools, `#![register_tool]`, unknown tools.
#![feature(register_tool)]
#![register_tool(my_tool)]
#[rustfmt::skip]
fn f() {}
#[my_tool::anything]
fn g() {}
#[clippy::some_lint]
fn h() {}
#[unknown_tool::x]
fn i() {}
#[rustfmt]
fn j() {}
