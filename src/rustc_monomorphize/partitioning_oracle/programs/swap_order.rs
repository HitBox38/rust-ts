// lane mono-partition: `-Ccodegen-units=2`, where the order `Vec::swap_remove` leaves decides the result. x is the
// biggest, then d, then a, and b and c tie below it. Round 1 merges a into d, the only overlap (`shared`), and moves c into
// a's slot: the tail is c, b, not b, c. Round 2's stable sort keeps that; d is now bigger than x, and with no overlap the
// first of the tail goes into x: c, not b. Round 3 merges what is left into d, now the smaller.
#![crate_type = "lib"]

macro_rules! x5 { ($v:ident) => { $v ^= 1; $v ^= 2; $v ^= 3; $v ^= 4; $v ^= 5; } }

#[inline(always)]
fn shared(x: u32) -> u32 {
    let mut v = x;
    x5!(v);
    v
}

pub mod x {
    pub fn f(x: u32) -> u32 {
        let mut v = x;
        x5!(v); x5!(v); x5!(v); x5!(v); x5!(v); x5!(v); x5!(v); x5!(v);
        v
    }
}

pub mod d {
    pub fn f(x: u32) -> u32 {
        let mut v = super::shared(x);
        x5!(v); x5!(v); x5!(v); x5!(v);
        v
    }
}

pub mod a {
    pub fn f(x: u32) -> u32 {
        let mut v = super::shared(x);
        x5!(v); x5!(v); x5!(v);
        v
    }
}

pub mod b {
    pub fn f(x: u32) -> u32 {
        let mut v = x;
        x5!(v); x5!(v);
        v
    }
}

pub mod c {
    pub fn f(x: u32) -> u32 {
        let mut v = x;
        x5!(v); x5!(v);
        v
    }
}
