// The random float error of Miri's float operations (miri-shims-d review M1). Under -Zmiri-max-extra-rounding-error each
// result is off by exactly its maximum, so a changed error scale changes the bits; only the sign comes from the RNG.
#![feature(core_intrinsics, float_gamma)]
#![allow(internal_features)]
use std::hint::black_box as bb;
use std::intrinsics::*;

fn main() {
    let (a, b) = (bb(1.7f32), bb(2.3f32));
    let (c, d) = (bb(1.7f64), bb(2.3f64));
    unsafe {
        // intrinsics/math.rs pow / powi: 4 ULP
        println!("powf32 {:08x}", powf32(a, b).to_bits());
        println!("powf64 {:016x}", powf64(c, d).to_bits());
        println!("powif32 {:08x}", powif32(a, bb(7)).to_bits());
        println!("powif64 {:016x}", powif64(c, bb(7)).to_bits());
        // intrinsics/math.rs fast math: 4 ULP
        println!("fadd_fast {:08x} {:016x}", fadd_fast(a, b).to_bits(), fadd_fast(c, d).to_bits());
        println!("fsub_fast {:08x} {:016x}", fsub_fast(a, b).to_bits(), fsub_fast(c, d).to_bits());
        println!("fmul_fast {:08x} {:016x}", fmul_fast(a, b).to_bits(), fmul_fast(c, d).to_bits());
        println!("fdiv_fast {:08x} {:016x}", fdiv_fast(a, b).to_bits(), fdiv_fast(c, d).to_bits());
        println!("frem_fast {:08x} {:016x}", frem_fast(a, b).to_bits(), frem_fast(c, d).to_bits());
    }
    // math.rs host_unary_float_op: 4 ULP
    println!("sin {:08x} {:016x}", a.sin().to_bits(), c.sin().to_bits());
    println!("exp2 {:08x} {:016x}", a.exp2().to_bits(), c.exp2().to_bits());
    // shims/math.rs: 4 ULP
    println!("tan {:08x} {:016x}", a.tan().to_bits(), c.tan().to_bits());
    println!("gamma {:08x} {:016x}", a.gamma().to_bits(), c.gamma().to_bits());
    println!("ln_gamma {:08x} {:016x}", a.ln_gamma().0.to_bits(), c.ln_gamma().0.to_bits());
    println!("done");
}
