// Correctly declared intrinsics whose signatures use lang items (lane check-region-intrinsic): the oracle accepts this
// crate, so each computed signature must equal the declared one.
#![feature(no_core, lang_items, intrinsics, rustc_attrs, auto_traits)]
#![no_core]
#![allow(internal_features)]

#[lang = "pointee_sized"]
pub trait PointeeSized {}
#[lang = "meta_sized"]
pub trait MetaSized: PointeeSized {}
#[lang = "sized"]
pub trait Sized: MetaSized {}
#[lang = "copy"]
pub trait Copy {}
#[lang = "freeze"]
pub unsafe auto trait Freeze {}

#[lang = "type_id"]
pub struct TypeId { pub t: (u64, u64) }
#[lang = "Ordering"]
pub enum Ordering { Less, Equal, Greater }
#[lang = "panic_location"]
pub struct Location<'a> { pub file: &'a str, pub line: u32, pub col: u32 }
#[lang = "Option"]
pub enum Option<T> { #[lang = "None"] None, #[lang = "Some"] Some(T) }
#[lang = "discriminant_kind"]
pub trait DiscriminantKind { #[lang = "discriminant_type"] type Discriminant; }

#[rustc_intrinsic]
pub const fn type_id<T: ?Sized>() -> TypeId;
#[rustc_intrinsic]
pub const fn type_id_eq(a: TypeId, b: TypeId) -> bool;
#[rustc_intrinsic]
pub fn type_name<T: ?Sized>() -> &'static str;
#[rustc_intrinsic]
pub fn three_way_compare<T: Copy>(lhs: T, rhss: T) -> Ordering;
#[rustc_intrinsic]
pub fn caller_location() -> &'static Location<'static>;
#[rustc_intrinsic]
pub const fn type_id_size_of(id: TypeId) -> Option<usize>;
#[rustc_intrinsic]
pub fn contract_check_ensures<C, Ret>(cond: Option<C>, ret: Ret) -> Ret;
#[rustc_intrinsic]
pub fn discriminant_value<T>(v: &T) -> <T as DiscriminantKind>::Discriminant;
