#![crate_type = "lib"]
#![feature(f16, f128)]
// Floating-point constants that rustc hands the builder as operands at opt-level 0 (lane llir-apfloat), which LLVM folds:
// casts between integers and floats, f64/f32/f16/f128 arithmetic, negation and comparisons of constants, and NaN,
// infinity, signed-zero and subnormal operands (compiled with -Coverflow-checks=off).
pub fn int_to_float() -> f64 {
    let x = 5i64;
    x as f64
}
pub fn mul() -> f64 {
    1.5 * 2.0
}
pub fn f32_ops() -> f32 {
    let a = 0.1f32;
    let b = 3.0f32;
    (a + b) * (a - b) / b % 0.7
}
pub fn conversions() -> (f32, f64, f32, f64) {
    let a = 1.0e300f64;
    let b = 0.1f32;
    let c = u64::MAX;
    let d = -7i8;
    (a as f32, b as f64, c as f32, d as f64)
}
pub fn unchecked() -> (i32, u8, i64) {
    let a = -2.75f64;
    let b = 255.5f32;
    let c = 1.0e10f64;
    unsafe { (a.to_int_unchecked::<i32>(), b.to_int_unchecked::<u8>(), c.to_int_unchecked::<i64>()) }
}
pub fn specials() -> (f64, f64, f32, f64, bool, bool) {
    let nan = f64::NAN;
    let inf = f64::INFINITY;
    let tiny = f32::MIN_POSITIVE;
    let z = -0.0f64;
    (nan + 1.0, inf - inf, tiny / 3.0, -z, nan < 1.0, z == 0.0)
}
pub fn half_quad() -> (f16, f128, f32, f128) {
    let h = 1.5f16;
    let q = 1.0f128;
    (h * h + 0.25, q / 3.0, h as f32, h as f128)
}
pub fn neg(x: f64) -> f64 {
    let c = 2.5f64;
    -c + x
}
