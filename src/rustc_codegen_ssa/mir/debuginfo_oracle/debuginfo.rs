// Fixture of mir/debuginfo.test.ts (lane ssa-debuginfo): `#[no_mangle]` fns whose argument and alloca names, debuginfo
// variables and debuginfo type names the test checks against the pinned rustc's IR (debuginfo_oracle/README.md).
#![feature(no_core, lang_items, auto_traits, rustc_attrs, unboxed_closures)]
#![allow(internal_features, unused)]
#![crate_type = "lib"]
#![no_core]

#[lang = "pointee_sized"]
pub trait PointeeSized {}
#[lang = "meta_sized"]
pub trait MetaSized: PointeeSized {}
#[lang = "sized"]
pub trait Sized: MetaSized {}
#[lang = "copy"]
pub trait Copy {}
impl Copy for u8 {}
impl Copy for i8 {}
impl Copy for usize {}
impl Copy for u32 {}
impl Copy for u64 {}
impl Copy for bool {}
impl<T: PointeeSized> Copy for &T {}
#[lang = "freeze"]
pub unsafe auto trait Freeze {}
pub unsafe auto trait Send {}
#[lang = "legacy_receiver"]
pub trait LegacyReceiver {}
impl<T: PointeeSized> LegacyReceiver for &T {}
impl<T: PointeeSized> LegacyReceiver for &mut T {}
#[lang = "unsize"]
pub trait Unsize<T: PointeeSized>: PointeeSized {}
#[lang = "coerce_unsized"]
pub trait CoerceUnsized<T> {}
impl<'a, 'b: 'a, T: PointeeSized + Unsize<U>, U: PointeeSized> CoerceUnsized<&'a U> for &'b T {}
#[lang = "dispatch_from_dyn"]
pub trait DispatchFromDyn<T> {}
impl<'a, T: PointeeSized + Unsize<U>, U: PointeeSized> DispatchFromDyn<&'a U> for &'a T {}
#[lang = "const_param_ty"]
pub trait ConstParamTy_ {}
impl ConstParamTy_ for usize {}
impl ConstParamTy_ for i8 {}
impl ConstParamTy_ for bool {}
#[lang = "neg"]
pub trait Neg {
    type Output;
    fn neg(self) -> Self::Output;
}
impl Neg for i8 {
    type Output = i8;
    fn neg(self) -> i8 {
        loop {}
    }
}
#[lang = "tuple_trait"]
pub trait Tuple {}
#[lang = "fn_once"]
#[rustc_paren_sugar]
pub trait FnOnce<Args: Tuple> {
    #[lang = "fn_once_output"]
    type Output;
    extern "rust-call" fn call_once(self, args: Args) -> Self::Output;
}
#[lang = "fn_mut"]
#[rustc_paren_sugar]
pub trait FnMut<Args: Tuple>: FnOnce<Args> {
    extern "rust-call" fn call_mut(&mut self, args: Args) -> Self::Output;
}
#[lang = "fn"]
#[rustc_paren_sugar]
pub trait Fn<Args: Tuple>: FnMut<Args> {
    extern "rust-call" fn call(&self, args: Args) -> Self::Output;
}

pub struct Pair {
    a: u32,
    b: u32,
}
pub struct Big {
    a: u64,
    b: u64,
    c: u64,
}
pub struct Wrap<T> {
    t: T,
}
pub struct ConstU<const N: usize>;
pub struct ConstI<const N: i8>;
pub struct ConstB<const B: bool>;
pub enum CLike {
    A,
    B,
}
pub enum Opt<T> {
    None,
    Some(T),
}
pub trait Tr {
    fn m(&self) -> u32;
}
pub trait WithAssoc {
    type Out;
}
pub mod inner {
    pub struct In;
}

impl Pair {
    #[no_mangle]
    pub fn pair_first(&self) -> u32 {
        self.a
    }
    #[no_mangle]
    pub fn pair_by_value(self) -> u32 {
        self.b
    }
    #[no_mangle]
    pub fn pair_closure(&self) {
        let c = |y: u32| y;
        let w = Wrap { t: c };
        let rw = &w;
    }
}

#[no_mangle]
pub fn scalar(x: u32) -> u32 {
    x
}
#[no_mangle]
pub fn pair(p: Pair) -> u32 {
    p.b
}
#[no_mangle]
pub fn big(b: Big) -> u64 {
    b.c
}
#[no_mangle]
pub fn borrowed(x: u32) -> u32 {
    let r = &x;
    *r
}
#[no_mangle]
pub fn unnamed(_: u32, y: u32) -> u32 {
    y
}
#[no_mangle]
pub fn locals(x: u32) -> u32 {
    let a = x;
    let b = a;
    b
}
#[no_mangle]
pub fn types(
    w: Wrap<u32>,
    ww: &Wrap<Wrap<u8>>,
    t: (u32, bool),
    unit: (),
    r: &mut u64,
    p: *const u8,
    m: *mut Wrap<u8>,
    d: &dyn Tr,
    ds: &(dyn Tr + Send),
    da: &dyn WithAssoc<Out = u32>,
    e: CLike,
    o: Opt<u32>,
    i: inner::In,
    f: fn(u32) -> bool,
    fu: unsafe extern "C" fn(),
    arr: Wrap<[u8; 4]>,
    sl: &[u32],
    s: &str,
    cu: ConstU<4>,
    ci: ConstI<-3>,
    cb: ConstB<true>,
) {
}
#[no_mangle]
pub fn closure(x: u32) {
    let c = |y: u32| y;
    let rc = &c;
}
