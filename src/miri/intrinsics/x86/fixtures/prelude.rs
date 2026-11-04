// Shared by the miri-x86-b oracle programs (`include!`d). Prints one line per call:
//   <link name> <ty>:<lanes> ... => <ty>:<lanes>
// lanes are hex, lane 0 first, two's complement at the lane width; floats are their bit patterns.
// An including program declares its crate attributes itself: inner attributes cannot be included.

pub trait Hex: Copy {
    fn hex(self) -> String;
}
macro_rules! hex_int {
    ($($t:ty),*) => {$(impl Hex for $t {
        fn hex(self) -> String { format!("{:0w$x}", self, w = core::mem::size_of::<$t>() * 2) }
    })*};
}
hex_int!(u8, i8, u16, i16, u32, i32, u64, i64, u128);
impl Hex for f32 {
    fn hex(self) -> String { self.to_bits().hex() }
}
impl Hex for f64 {
    fn hex(self) -> String { self.to_bits().hex() }
}
pub trait Show {
    fn show(&self) -> String;
}
macro_rules! show_scalar {
    ($($t:ident),*) => {$(impl Show for $t {
        fn show(&self) -> String { format!("{}:{}", stringify!($t), self.hex()) }
    })*};
}
show_scalar!(u8, i8, u16, i16, u32, i32, u64, i64, u128);
macro_rules! simd_ty {
    ($($n:ident [$e:ident; $l:literal];)*) => {$(
        #[repr(simd)]
        #[derive(Copy, Clone)]
        pub struct $n(pub [$e; $l]);
        impl Show for $n {
            fn show(&self) -> String {
                let a: [$e; $l] = unsafe { core::mem::transmute(*self) };
                let lanes: Vec<String> = a.iter().map(|x| x.hex()).collect();
                format!("{}:{}", stringify!($n), lanes.join(","))
            }
        }
    )*};
}
simd_ty! {
    u8x16 [u8; 16]; u8x32 [u8; 32]; u8x64 [u8; 64];
    i8x16 [i8; 16]; i8x32 [i8; 32]; i8x64 [i8; 64];
    i16x8 [i16; 8]; i16x16 [i16; 16]; i16x32 [i16; 32];
    i32x4 [i32; 4]; i32x8 [i32; 8]; i32x16 [i32; 16];
    i64x2 [i64; 2]; i64x4 [i64; 4]; i64x8 [i64; 8];
    f32x4 [f32; 4]; f32x8 [f32; 8];
    f64x2 [f64; 2]; f64x4 [f64; 4];
}
macro_rules! t {
    ($name:literal, $f:ident ( $($a:expr),* )) => {{
        let r = unsafe { $f($($a),*) };
        let args: Vec<String> = vec![$(Show::show(&$a)),*];
        println!("{} {} => {}", $name, args.join(" "), Show::show(&r));
    }};
}
/// A small deterministic byte stream (xorshift32), so the inputs need no RNG from the interpreter.
pub struct Bytes(pub u32);
impl Bytes {
    pub fn u8(&mut self) -> u8 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 17;
        self.0 ^= self.0 << 5;
        (self.0 >> 8) as u8
    }
    pub fn arr<const N: usize>(&mut self) -> [u8; N] {
        let mut a = [0u8; N];
        for x in a.iter_mut() {
            *x = self.u8();
        }
        a
    }
    pub fn v<T: Copy, const N: usize>(&mut self) -> T {
        assert_eq!(core::mem::size_of::<T>(), N);
        let a: [u8; N] = self.arr();
        unsafe { core::mem::transmute_copy(&a) }
    }
}
