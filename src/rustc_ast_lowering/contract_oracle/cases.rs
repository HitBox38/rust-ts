// Cases of src/rustc_ast_lowering/contract.test.ts: every fn with a contract here is lowered by the port (with a
// recording LoweringContext) and compared with the pinned rustc's `-Zunpretty=hir` of this file.
#![feature(contracts)]
#![allow(incomplete_features, unused)]

#[core::contracts::requires(x > 0)]
fn requires_only(x: i32) -> i32 {
    x + 1
}

#[core::contracts::ensures(|r| *r > 0)]
fn ensures_only(x: i32) -> i32 {
    let y = x * 2;
    y + 1
}

#[core::contracts::requires(x > 0)]
#[core::contracts::ensures(|r| *r > x)]
fn both(x: i32) -> i32 {
    x + 1
}

#[core::contracts::requires(true)]
#[core::contracts::ensures(|_| true)]
fn unit_body() {}

fn main() {}
