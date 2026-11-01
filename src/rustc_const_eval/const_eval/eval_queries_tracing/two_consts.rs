const fn g(x: u32) -> u32 { if x > 2 { panic!("boom") } x }
const fn f(x: u32) -> u32 { g(x) }
const A: u32 = f(5);
const fn h(x: u32) -> u32 { x + 1 }
const B: u32 = h(1);
fn main() { println!("{}", B); let _ = A; }
