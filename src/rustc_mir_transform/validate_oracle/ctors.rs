// Constructors (`mir_for_ctfe` of each is `shim::build_adt_ctor`, validated at the phase change to runtime-optimized)
// and a few small bodies.
#![crate_type = "lib"]

pub struct Unit;
pub struct Pair(pub u8, pub i64);
pub struct Gen<T, const N: usize>(pub [T; N], pub Option<T>);
pub struct Wrap<'a, T: ?Sized>(pub &'a T);

pub enum E<T> {
    A(u32),
    B(T, char, bool),
    C { x: u16 },
    D,
}

pub union U {
    pub a: u32,
    pub b: f32,
}

pub fn add(a: u32, b: u32) -> u32 {
    a.wrapping_add(b)
}

pub fn pick(x: Option<Pair>) -> i64 {
    match x {
        Some(Pair(_, y)) => y,
        None => 7,
    }
}

pub fn make(v: u8) -> E<Pair> {
    E::B(Pair(v, -1), 'x', v > 3)
}

pub fn cast(p: *mut u8, s: &[u16]) -> (*const u8, usize, f64) {
    (p as *const u8, s.len(), s.len() as f64)
}

pub const fn ctor_ptr() -> fn(u8, i64) -> Pair {
    Pair
}
