#![allow(dead_code, unused_variables)]
enum Void {}
fn g() -> Void { loop {} }
fn f() -> u32 { let x = g(); 5 }
fn h() -> u32 { g(); 7 }
fn k() -> Void { g() }
fn main() {}
