// lane mono-partition: modules of equal and of different sizes that share `#[inline]` helpers, so that
// `merge_codegen_units` meets size ties, overlap ties and several rounds of `swap_remove`.
#![crate_type = "lib"]

#[inline(always)]
pub fn shared_a(x: u32) -> u32 {
    let y = x ^ 1;
    let z = y ^ 2;
    z ^ 3
}

#[inline(always)]
pub fn shared_b(x: u32) -> u32 {
    x ^ 4
}

#[inline(always)]
pub fn shared_c(x: u32) -> u32 {
    let a = x ^ 5;
    let b = a ^ 6;
    let c = b ^ 7;
    let d = c ^ 8;
    let e = d ^ 9;
    e ^ 10
}

pub fn generic<T>(x: T) -> T {
    x
}

pub mod big {
    pub fn f(x: u32) -> u32 {
        let a = super::shared_a(x);
        let b = super::shared_b(a);
        let c = super::shared_c(b);
        let d = a ^ b;
        let e = d ^ c;
        e ^ 11
    }
    pub fn g(x: u32) -> u32 {
        super::generic(f(x))
    }
}

pub mod same_size_1 {
    pub fn f(x: u32) -> u32 {
        super::shared_a(x)
    }
}

pub mod same_size_2 {
    pub fn f(x: u32) -> u32 {
        super::shared_a(x)
    }
}

pub mod same_size_3 {
    pub fn f(x: u32) -> u32 {
        super::shared_b(x)
    }
}

pub mod same_size_4 {
    pub fn f(x: u32) -> u32 {
        super::shared_c(x)
    }
}

pub mod small {
    pub fn f() {}
}

pub mod small2 {
    pub fn f() {}
}

pub mod uses_generic {
    pub fn f(x: u64) -> u64 {
        super::generic(x)
    }
    pub fn g(x: u8) -> u8 {
        super::generic(x)
    }
}

mod private_used_elsewhere {
    pub fn helper(x: u32) -> u32 {
        x ^ 12
    }
    pub(crate) static INNER: u32 = 13;
}

pub mod caller {
    pub fn f(x: u32) -> u32 {
        super::private_used_elsewhere::helper(x) ^ super::private_used_elsewhere::INNER
    }
}
