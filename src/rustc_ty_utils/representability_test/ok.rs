struct A { b: B, c: (u8, [C; 2]) }
struct B(u8);
struct C { b: B }
enum E { V(A), W { c: C } }

fn main() {}
