#![allow(dead_code, unused_variables)]
enum Void {}
struct W(Void);
fn g() -> Void { loop {} }
fn w() -> W { loop {} }
fn a() -> u32 { let x = g(); let y = 3; y + 1 }
fn b() -> u32 { w(); 7 }
fn c() { let v = w(); }
fn d() -> u32 { match g() {} }
fn main() {}
