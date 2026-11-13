// Fixture of debuginfo/mod.test.ts (lane cg-di-a): value names that `set_var_name` gives without `-g`, a `static`
// (`build_global_var_di_node`) and a vtable (`apply_vcall_visibility_metadata`, `create_vtable_debuginfo`). See README.md.
#![feature(no_core, lang_items, rustc_attrs, auto_traits)]
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
impl Copy for u32 {}
impl Copy for u64 {}
impl Copy for bool {}
impl<T: PointeeSized> Copy for &T {}
#[lang = "freeze"]
pub unsafe auto trait Freeze {}
#[lang = "sync"]
pub unsafe auto trait Sync {}
unsafe impl Sync for u32 {}
#[lang = "legacy_receiver"]
pub trait LegacyReceiver {}
impl<T: PointeeSized> LegacyReceiver for &T {}
#[lang = "unsize"]
pub trait Unsize<T: PointeeSized>: PointeeSized {}
#[lang = "coerce_unsized"]
pub trait CoerceUnsized<T> {}
impl<'a, 'b: 'a, T: PointeeSized + Unsize<U>, U: PointeeSized> CoerceUnsized<&'a U> for &'b T {}
#[lang = "dispatch_from_dyn"]
pub trait DispatchFromDyn<T> {}
impl<'a, T: PointeeSized + Unsize<U>, U: PointeeSized> DispatchFromDyn<&'a U> for &'a T {}
#[lang = "drop_glue"]
pub unsafe fn drop_glue<T: PointeeSized>(_: &mut T) {}

pub struct Big {
    a: u64,
    b: u64,
    c: u64,
}
pub struct S(u32);
impl S {
    #[inline(never)]
    pub fn get(&self) -> u32 {
        self.0
    }
}
pub trait Tr {
    fn m(&self) -> u32;
}
impl Tr for u32 {
    fn m(&self) -> u32 {
        *self
    }
}

pub static GLOBAL: u32 = 7;

#[no_mangle]
pub fn scalar(x: u32, _unused: u32) -> u32 {
    x
}
#[no_mangle]
pub fn pair(p: (u32, u32)) -> u32 {
    let (a, b) = p;
    b
}
#[no_mangle]
pub fn indirect(b: Big) -> u64 {
    b.c
}
#[no_mangle]
pub fn borrowed(x: u32) -> u32 {
    let r = &x;
    *r
}
#[no_mangle]
pub fn locals(flag: bool) -> u32 {
    let arr = [1u32, 2, 3];
    let [first, _, last] = arr;
    let mut acc = first;
    if flag {
        acc = last;
    }
    acc
}
#[no_mangle]
pub fn method(s: &S) -> u32 {
    s.get()
}
#[no_mangle]
pub fn generic_caller(v: u64) -> u64 {
    ident(v)
}
#[inline(never)]
pub fn ident<T>(t: T) -> T {
    t
}
#[no_mangle]
pub fn global() -> &'static u32 {
    &GLOBAL
}
#[no_mangle]
pub fn vtable(x: &u32) -> &dyn Tr {
    x
}
#[no_mangle]
pub fn call_dyn(t: &dyn Tr) -> u32 {
    t.m()
}
