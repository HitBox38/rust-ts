struct P { x: u8, y: u8 }
enum E { A(u8), B { z: u8 } }
fn f(p: P, e: E) -> u8 {
    let P { x, y: _ } = p;
    let arr = [x; 4];
    let t = (|| 1u8, || 2u8);
    let c = |q: u8| -> u8 { let inner = |r: u8| r; inner(q) };
    match e {
        E::A(v) if (|| true)() => v,
        E::B { z } => z,
        _ => 0,
    };
    let _blk = { struct InBlock; 1 };
    let _ = P { x: 1, y: [0u8; 2][0] };
    loop { break; }
    while false { fn in_loop() {} }
    if true { fn in_if() {} } else { fn in_else() {} }
    c(arr[0]) + (t.0)()
}
fn g<const N: usize>() -> [u8; N] { [0; N] }
fn h() -> [u8; 3] { g::<3>() }
fn main() {}
