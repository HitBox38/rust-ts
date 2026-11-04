// lane mono-partition: modules on both sides of `NON_INCR_MIN_CGU_SIZE` (1800), so that the default CGU count merges
// the small ones and keeps the big ones; twelve modules, so that `-Ccodegen-units=16` pads the `-cgu.NN` suffix.
#![crate_type = "lib"]

macro_rules! x4 { ($v:ident) => { $v ^= 1; $v ^= 2; $v ^= 3; $v ^= 4; } }
macro_rules! x16 { ($v:ident) => { x4!($v); x4!($v); x4!($v); x4!($v); } }
macro_rules! x64 { ($v:ident) => { x16!($v); x16!($v); x16!($v); x16!($v); } }
macro_rules! x256 { ($v:ident) => { x64!($v); x64!($v); x64!($v); x64!($v); } }
macro_rules! x1024 { ($v:ident) => { x256!($v); x256!($v); x256!($v); x256!($v); } }

pub mod big_a {
    pub fn f(x: u32) -> u32 {
        let mut v = x;
        x1024!(v); x1024!(v); x1024!(v);
        v
    }
}

pub mod big_b {
    pub fn f(x: u32) -> u32 {
        let mut v = x;
        x1024!(v); x1024!(v);
        v
    }
}

pub mod just_over {
    pub fn f(x: u32) -> u32 {
        let mut v = x;
        x1024!(v); x256!(v); x256!(v); x256!(v);
        v
    }
}

pub mod just_under {
    pub fn f(x: u32) -> u32 {
        let mut v = x;
        x1024!(v); x256!(v); x256!(v);
        v
    }
}

pub mod small_0 {
    pub fn f(x: u32) -> u32 {
        let mut v = x;
        x16!(v);
        v
    }
}

pub mod small_1 {
    pub fn f(x: u32) -> u32 {
        let mut v = x;
        x16!(v);x16!(v);
        v
    }
}

pub mod small_2 {
    pub fn f(x: u32) -> u32 {
        let mut v = x;
        x16!(v);x16!(v);x16!(v);
        v
    }
}

pub mod small_3 {
    pub fn f(x: u32) -> u32 {
        let mut v = x;
        x16!(v);x16!(v);x16!(v);x16!(v);
        v
    }
}

pub mod small_4 {
    pub fn f(x: u32) -> u32 {
        let mut v = x;
        x16!(v);x16!(v);x16!(v);x16!(v);x16!(v);
        v
    }
}

pub mod small_5 {
    pub fn f(x: u32) -> u32 {
        let mut v = x;
        x16!(v);x16!(v);x16!(v);x16!(v);x16!(v);x16!(v);
        v
    }
}

pub mod small_6 {
    pub fn f(x: u32) -> u32 {
        let mut v = x;
        x16!(v);x16!(v);x16!(v);x16!(v);x16!(v);x16!(v);x16!(v);
        v
    }
}

pub mod small_7 {
    pub fn f(x: u32) -> u32 {
        let mut v = x;
        x16!(v);x16!(v);x16!(v);x16!(v);x16!(v);x16!(v);x16!(v);x16!(v);
        v
    }
}
