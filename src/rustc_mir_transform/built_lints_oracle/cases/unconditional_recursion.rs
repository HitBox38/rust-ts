#![allow(dead_code)]
fn f(x: u32) -> u32 { if x > 0 { f(x - 1) } else { f(x + 1) } }
fn ok(x: u32) -> u32 { if x > 0 { ok(x - 1) } else { 0 } }
fn lp() { loop { lp() } }
trait T { fn m(&self) { self.m() } fn n(&self) {} }
struct S;
impl T for S { fn n(&self) { self.n() } }
impl S { fn g(&self) -> u32 { self.g() + 1 } }
fn main() {}
