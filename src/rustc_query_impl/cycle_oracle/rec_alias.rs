struct A { b: Alias }
type Alias = B;
struct B { a: A }

fn main() {}
