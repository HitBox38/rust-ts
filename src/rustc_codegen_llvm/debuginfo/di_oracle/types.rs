// Fixture of debuginfo/mod.test.ts (lane cg-di-b): the type debuginfo of metadata.rs and metadata/{type_map,enums/*}.rs at
// `-Cdebuginfo=2`/`1` (x86_64-unknown-linux-gnu) and CPP-like (x86_64-pc-windows-msvc). See README.md.
#![feature(no_core, lang_items, rustc_attrs, auto_traits, unboxed_closures, extern_types, f16, f128)]
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
#[lang = "tuple_trait"]
pub trait Tuple {}
#[lang = "fn_once"]
pub trait FnOnce<Args: Tuple> {
    #[lang = "fn_once_output"]
    type Output;
    extern "rust-call" fn call_once(self, args: Args) -> Self::Output;
}
// Structs: named (with private, `pub(crate)` and `pub` fields), tuple, unit, generic (template parameters), recursive.
pub struct Point {
    pub x: i32,
    y: f64,
    pub(crate) z: u8,
}
pub struct Pair(pub u16, i64);
pub struct Unit;
pub struct Gen<T, U> {
    t: T,
    u: U,
}
pub struct List<'a> {
    next: Option<&'a List<'a>>,
    v: i32,
}
// Enums: C-like (an enumeration type), tagged, niche (an untagged variant with a range), single-variant, empty, generic,
// a 128-bit tag, and an expanding recursive type (type_map.rs `build_type_with_children`).
pub enum CLike {
    A,
    B = 5,
    C,
}
pub enum Tagged {
    One(u32),
    Two { a: u64, b: i8 },
    Three,
}
pub enum Option<T> {
    None,
    Some(T),
}
pub enum Niche {
    A(bool),
    B,
    C,
}
pub enum Single {
    Only(u32, u64),
}
pub enum Empty {}
#[repr(u128)]
pub enum Wide {
    X(u8) = 1,
    Y = 0xffff_ffff_ffff_ffff_ffff,
}
pub enum Rec<T> {
    Recurse(*const Rec<Pair2<T>>),
    Item(T),
}
pub struct Pair2<T>(T, T);
pub union U {
    a: u32,
    b: f32,
}
extern "C" {
    pub type Opaque;
}
pub trait Shape {
    fn area(&self) -> u32;
}
impl Shape for Point {
    fn area(&self) -> u32 {
        self.z as u32
    }
}

pub static GLOBAL: Point = Point { x: 1, y: 2.0, z: 3 };

#[no_mangle]
pub fn structs(p: &Point, q: Pair, _u: Unit, g: Gen<u8, (char, bool)>, l: &List) -> u32 {
    let _ = (q, g, l);
    p.z as u32
}
#[no_mangle]
pub fn enums(c: CLike, t: Tagged, o: Option<&u32>, n: Niche, s: Single, e: Option<&Empty>, w: Wide, r: &Rec<u8>) -> u32 {
    let _ = (c, t, o, n, s, e, w, r);
    0
}
#[no_mangle]
pub fn pointers(sl: &[i64], s: &str, d: &dyn Shape, raw: *const u8, m: &mut [u16; 4], f: fn(u32) -> u32, op: &Opaque) -> u32 {
    let _ = (sl, s, raw, m, f, op);
    d.area()
}
#[no_mangle]
pub fn basics(a: i8, b: u64, c: f32, d: f64, e: isize, f: usize, g: i128, h: u128, i: f16, j: f128, k: (), l: char) -> u32 {
    let _ = (a, b, c, d, e, f, g, h, i, j, k, l);
    0
}
#[no_mangle]
pub fn union_(u: U) -> u32 {
    unsafe { u.a }
}
#[no_mangle]
pub fn never(flag: bool) -> u32 {
    if flag {
        diverge()
    }
    1
}
fn diverge() -> ! {
    loop {}
}
#[no_mangle]
pub fn closure(x: u32) -> u32 {
    let c = move |y: u32| x;
    take(c)
}
#[inline(never)]
fn take<T>(t: T) -> u32 {
    let _ = t;
    0
}
#[no_mangle]
pub fn vtable(p: &Point) -> &dyn Shape {
    p
}
#[no_mangle]
pub fn global() -> &'static Point {
    &GLOBAL
}
fn rec_impl() -> impl Copy {
    rec_impl
}
#[no_mangle]
pub fn recursive_fn_type() -> u32 {
    take(rec_impl())
}
pub mod inner {
    // Field visibility in a nested module: `pub(crate)` / `pub(super)` are DIFlagProtected, private is DIFlagPrivate.
    pub struct Vis {
        pub(crate) a: u8,
        pub(super) b: u8,
        c: u8,
        pub d: u8,
    }
}
#[no_mangle]
pub fn visibility(v: &inner::Vis) -> u8 {
    v.d
}
