// Patterns: fresh bindings, or-patterns, struct/tuple-struct/path patterns, `..` rests, guards,
// unit structs and consts in pattern position, fn params.
enum E {
    A(u8, u8),
    B(u8),
    C,
}
struct P {
    x: u8,
    y: u8,
}
struct U;
const K: u8 = 3;

fn params((a, b): (u8, u8), P { x, .. }: P) -> u8 {
    let _ = (a, b);
    x
}

fn f(e: E, p: P) -> u8 {
    let P { x, y: ref yy } = p;
    let _ = yy;
    match e {
        E::A(a, _) | E::B(a) => a,
        E::C if x == K => x,
        E::C => {
            let U = U;
            let mut m = 1;
            m = m;
            m
        }
    }
}

fn g(v: u8) -> u8 {
    match v {
        K => 0,
        n @ 1 => n,
        ref r => *r,
    }
}
