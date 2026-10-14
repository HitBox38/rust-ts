// Test crate of print.oracle.test.ts (lane ty-print-a): def paths of local items and of std lang items.
pub mod m {
    pub struct S;
    pub mod n {
        pub enum E {
            A,
            B(u8),
        }
        pub trait Tr {
            fn f();
            type Assoc;
        }
        pub union U {
            x: u32,
        }
        pub static ST: u8 = 0;
        pub const C: u8 = 1;
        pub type Alias = u8;
    }
}

pub struct Top(pub u8);

pub fn free() {
    let _c = || ();
}

pub mod r#async {
    pub struct r#Fn;
}
