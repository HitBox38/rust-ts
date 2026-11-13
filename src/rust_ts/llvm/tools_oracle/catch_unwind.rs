// tools.test.ts compiles this with -Ctarget-feature=+avx2: `catch_unwind` makes rustc's `__rust_try`, a definition with a
// `target-cpu` attribute and no `target-features` (rustc_codegen_llvm intrinsic.rs:1751), which takes the machine's global
// features in rustc (review llir-tools F2).
use std::panic::catch_unwind;

fn main() {
    let r = catch_unwind(|| {
        let v: Vec<u32> = (0..8).collect();
        v.iter().sum::<u32>()
    });
    println!("{:?}", r.is_ok());
}
