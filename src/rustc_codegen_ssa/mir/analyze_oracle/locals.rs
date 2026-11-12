// Fixture of mir/analyze.test.ts (lane ssa-mir-core): one `#[no_mangle]` fn per `non_ssa_locals` rule. Variable
// names are unique within each fn, so the oracle's IR value names map back to locals (driver.ts header).
#![crate_type = "lib"]

pub struct Pair {
    pub a: u32,
    pub b: u32,
}

pub struct Big {
    pub a: [u64; 8],
}

pub struct Noisy(pub u32);

impl Drop for Noisy {
    fn drop(&mut self) {
        side(self.0);
    }
}

#[inline(never)]
pub fn side(x: u32) {
    core::hint::black_box(x);
}

/// Scalars only; the overflow checks read `.0` / `.1` of a `(u32, bool)` pair: all SSA.
#[no_mangle]
pub fn scalars(a: u32, b: u32) -> u32 {
    let s = a + b;
    let t = s * 2;
    t
}

/// `&x` is a `SharedBorrow` of `x`: memory.
#[no_mangle]
pub fn borrowed(a: u32) -> u32 {
    let x = a;
    let r = &x;
    *r
}

/// A store through a field projection (`p.b = ..`) is a mutating use with projections: memory.
#[no_mangle]
pub fn mutated_field(a: u32) -> u32 {
    let mut p = Pair { a, b: 0 };
    p.b = a;
    p.a + p.b
}

/// Field reads of a scalar pair defined once: SSA.
#[no_mangle]
pub fn read_fields(a: u32, b: u32) -> u32 {
    let p = Pair { a, b };
    p.a ^ p.b
}

/// `BackendRepr::Memory` (an array of 8 `u64`): memory on its definition; the index is a local (`Index`).
#[no_mangle]
pub fn big(x: u64, i: usize) -> u64 {
    let bg = Big { a: [x; 8] };
    bg.a[i]
}

/// A type that needs drop, dropped: memory.
#[no_mangle]
pub fn dropper(a: u32) -> u32 {
    let n = Noisy(a);
    side(a);
    n.0
}

/// Two definitions: SSA, then memory.
#[no_mangle]
pub fn branches(c: bool, a: u32) -> u32 {
    let y;
    if c {
        y = a;
    } else {
        y = a + 1;
    }
    y
}

/// Loop counters are redefined: memory.
#[no_mangle]
pub fn loop_sum(n: u32) -> u32 {
    let mut s = 0;
    let mut i = 0;
    while i < n {
        s += i;
        i += 1;
    }
    s
}

/// `(o as Some).0` downcasts a multi-variant layout: memory.
#[no_mangle]
pub fn opt(o: Option<u32>) -> u32 {
    match o {
        Some(v) => v,
        None => 0,
    }
}

/// A borrowed ZST: memory (an empty alloca).
#[no_mangle]
pub fn unit_borrow() -> usize {
    let u = ();
    let ru = &u;
    core::mem::size_of_val(ru)
}

/// A scalar-pair return place.
#[no_mangle]
pub fn tuple_ret(a: u32) -> (u32, u32) {
    (a, a)
}

/// A call into `black_box` and a call result used later.
#[no_mangle]
pub fn call_result(a: u32) -> u32 {
    let k = core::hint::black_box(a);
    k + 1
}
