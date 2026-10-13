// Traits and impls: trait_map for method calls and field accesses, `Self`, qualified paths,
// associated consts/types, generics, consts/statics with bodies, closures, inline consts, repeats.
trait Tr {
    const C: u8;
    type T;
    fn m(&self) -> u8;
    fn n() -> u8 {
        Self::C
    }
}
struct S {
    f: u8,
}
impl S {
    fn new() -> S {
        S { f: 0 }
    }
    fn get(&self) -> u8 {
        self.f
    }
}
impl Tr for S {
    const C: u8 = 1;
    type T = u8;
    fn m(&self) -> u8 {
        self.get()
    }
}
static ST: u8 = 4;
const CO: [u8; 2] = [0; 2];

fn gen<T: Tr, const N: usize>(t: T) -> u8 {
    let _ = <T as Tr>::C;
    let _ = T::n();
    t.m()
}

fn f() -> u8 {
    let s = <S>::new();
    let k = |x: u8| x;
    let _ = const { 1 };
    let _ = s.f;
    let _ = CO;
    k(s.m()) + <S as Tr>::n() + ST
}
