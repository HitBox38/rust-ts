#![feature(f16)]
use std::hint::black_box;
fn main() {
    // Every f16 bit pattern, raised to runtime exponents through f16::powi (Miri's powif16 intrinsic).
    let exps: [i32; 6] = [3, -3, 2, 5, -7, 11];
    for &n in &exps {
        let mut out = String::with_capacity(65536 * 5);
        for b in 0u32..65536 {
            let x = f16::from_bits(b as u16);
            let r = black_box(x).powi(black_box(n));
            let rb = if r.is_nan() { 0x7e00u16 } else { r.to_bits() };
            out.push_str(&format!("{:04x}\n", rb));
        }
        print!("{}", out);
    }
}
