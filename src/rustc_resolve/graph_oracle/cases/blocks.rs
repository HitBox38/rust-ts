fn f() -> u8 {
    struct Local;
    fn local_fn() {}
    let a: [u8; 3] = [0; 2 + 1];
    {
        enum Inner { V = 1, W }
        let _ = || { let _ = |y: u8| y; };
    }
    let _ = { fn deep() {} 0 };
    match 1u8 { x => x }
}
enum D { A = 10, B, C(u8) = 20 }
struct G<'a, T, const N: usize>(&'a T, [u8; N]);
fn generic<'a, T: 'a, const M: u8>(t: &'a T) where T: 'a { }
fn main() {}
