#![crate_type = "lib"]
// Integer and floating-point arithmetic, shifts, comparisons, casts and a select-like branch in one body
// (compiled with -Coverflow-checks=off).
pub fn arith(a: u32, b: i32, c: f64) -> i64 {
    let x = a * 3 ^ (a >> 2) | a - 7 & a << 1;
    let y = (b + 1) / 3 - (b >> 5) * b;
    let z = c * 2.0 - 1.0 / c;
    let w = if x > 10 && y < -2 { x as i64 } else { -(y as i64) };
    let f = (z as f32 as f64 + y as f64 + x as f32 as f64) > 0.25;
    w + f as i64 + (c < 0.5) as i64 + (!a as u8 as i64) - (b as i16 as i64)
}
