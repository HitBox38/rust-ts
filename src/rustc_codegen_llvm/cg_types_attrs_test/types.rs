// Fixture of type_of.test.ts (lane cg-types-attrs): one item per layout shape. The oracle's `--emit=llvm-ir` shows each
// type's `llvm_type` as the element type of the `getelementptr` in `g_<Name>`, and each immediate type as the return type of
// `i_<Name>`; the port computes them from the layouts (cg_types_attrs_test/run.ts).
#![crate_type = "lib"]
#![no_std]
#![allow(dead_code, non_snake_case)]
pub struct Foo { a: u8, b: u32, c: u16 }
pub struct Zst;
pub enum E { A(u32), B(u64), C }
pub struct Pair(u32, bool);
#[repr(C)] pub struct C3 { a: u8, b: u64, c: u8 }
#[repr(C, packed)] pub struct P { a: u8, b: u32 }
pub union U { a: u32, b: [u8; 6] }
pub enum One { Only(u16, u8) }
pub struct Nested { f: Foo, p: Pair, z: Zst, e: E }
pub struct Wide(&'static [u16], &'static str);
#[repr(transparent)] pub struct T(u64);
/// The non-ADT types, as fields: `layout.field(cx, i)` is their layout.
pub struct Probe(pub (u8, u16, u64), pub [u32; 3], pub &'static [u8], pub bool, pub &'static u8, pub f32, pub (), pub u128, pub *const dyn core::any::Any);

#[no_mangle] pub unsafe fn g_Foo(x: *const Foo, i: usize) -> *const Foo { x.add(i) }
#[no_mangle] pub unsafe fn g_E(x: *const E, i: usize) -> *const E { x.add(i) }
#[no_mangle] pub unsafe fn g_Pair(x: *const Pair, i: usize) -> *const Pair { x.add(i) }
#[no_mangle] pub unsafe fn g_C3(x: *const C3, i: usize) -> *const C3 { x.add(i) }
#[no_mangle] pub unsafe fn g_P(x: *const P, i: usize) -> *const P { x.add(i) }
#[no_mangle] pub unsafe fn g_U(x: *const U, i: usize) -> *const U { x.add(i) }
#[no_mangle] pub unsafe fn g_One(x: *const One, i: usize) -> *const One { x.add(i) }
#[no_mangle] pub unsafe fn g_Nested(x: *const Nested, i: usize) -> *const Nested { x.add(i) }
#[no_mangle] pub unsafe fn g_Wide(x: *const Wide, i: usize) -> *const Wide { x.add(i) }
#[no_mangle] pub unsafe fn g_T(x: *const T, i: usize) -> *const T { x.add(i) }
#[no_mangle] pub unsafe fn g_Probe0(x: *const (u8, u16, u64), i: usize) -> *const (u8, u16, u64) { x.add(i) }
#[no_mangle] pub unsafe fn g_Probe1(x: *const [u32; 3], i: usize) -> *const [u32; 3] { x.add(i) }
#[no_mangle] pub unsafe fn g_Probe2(x: *const &'static [u8], i: usize) -> *const &'static [u8] { x.add(i) }
#[no_mangle] pub unsafe fn g_Probe3(x: *const bool, i: usize) -> *const bool { x.add(i) }
#[no_mangle] pub unsafe fn g_Probe4(x: *const &'static u8, i: usize) -> *const &'static u8 { x.add(i) }
#[no_mangle] pub unsafe fn g_Probe5(x: *const f32, i: usize) -> *const f32 { x.add(i) }
#[no_mangle] pub unsafe fn g_Probe7(x: *const u128, i: usize) -> *const u128 { x.add(i) }
#[no_mangle] pub unsafe fn g_Probe8(x: *const *const dyn core::any::Any, i: usize) -> *const *const dyn core::any::Any { x.add(i) }
#[no_mangle] pub fn i_Pair(x: Pair) -> Pair { x }
#[no_mangle] pub fn i_T(x: T) -> T { x }
#[no_mangle] pub fn i_Probe2(x: &'static [u8]) -> &'static [u8] { x }
#[no_mangle] pub fn i_Probe3(x: bool) -> bool { x }
#[no_mangle] pub fn i_Probe4(x: &'static u8) -> &'static u8 { x }
#[no_mangle] pub fn i_Probe8(x: *const dyn core::any::Any) -> *const dyn core::any::Any { x }
