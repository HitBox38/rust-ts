// Fixture of base.test.ts (lane ssa-base): a bin crate whose items spread over several codegen units of different
// sizes (`-Ccodegen-units=4`), so `codegen_crate`'s size ordering and interleaving show, plus `main` for
// `maybe_create_entry_wrapper`.

pub mod small {
    #[inline(never)]
    pub fn one(x: u32) -> u32 {
        x + 1
    }
}

pub mod medium {
    #[inline(never)]
    pub fn a(x: u64) -> u64 {
        x.wrapping_mul(3) ^ 7
    }
    #[inline(never)]
    pub fn b(v: &[u8]) -> usize {
        v.iter().filter(|&&c| c > 3).count()
    }
}

pub mod large {
    #[inline(never)]
    pub fn sum(v: &[u32]) -> u32 {
        let mut s = 0u32;
        for x in v {
            s = s.wrapping_add(*x);
        }
        s
    }
    #[inline(never)]
    pub fn sort(v: &mut Vec<i64>) {
        v.sort();
    }
    #[inline(never)]
    pub fn text(n: usize) -> String {
        let mut s = String::new();
        for i in 0..n {
            s.push_str(&i.to_string());
        }
        s
    }
}

pub mod generic {
    #[inline(never)]
    pub fn twice<T: Clone>(t: T) -> (T, T) {
        (t.clone(), t)
    }
}

fn main() {
    let v = vec![1u32, 2, 3];
    let mut w = vec![3i64, 1, 2];
    large::sort(&mut w);
    let t = generic::twice(small::one(large::sum(&v)));
    let u = generic::twice(medium::a(t.0 as u64));
    let s = large::text(medium::b(&[1, 5, 9]));
    std::process::exit((u.1 as usize + s.len() + w.len()) as i32 & 1);
}
