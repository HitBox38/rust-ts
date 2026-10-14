struct A { x: (u8, [B; 1]) }
struct B { c: C }
struct C(A);

fn main() {}
