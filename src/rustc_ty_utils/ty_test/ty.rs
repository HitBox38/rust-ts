// Fixture of src/rustc_ty_utils/ty.test.ts (lane ty-utils).
pub trait Tr {
    fn required(&self);
    fn provided(&self) {}
    const C: u8;
}

pub struct S;

impl Tr for S {
    fn required(&self) {}
    const C: u8 = 0;
}

impl S {
    pub fn inherent(&self) {}
}

pub async fn af() {}

pub fn f() -> u8 {
    let c = |x: u8| {
        let d = || x;
        d()
    };
    fn inner() {}
    inner();
    c(1)
}

pub fn g() -> u8 {
    const { 1 }
}
