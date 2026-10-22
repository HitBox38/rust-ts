// The generalizer's `warn!("may incompletely handle alias type: ..")` under the next solver
// (from tests/ui/traits/next-solver/issue-118950-root-region.rs, without core).
#![feature(no_core, lang_items, checked_type_aliases)]
#![no_core]
#![crate_type = "lib"]

#[lang = "pointee_sized"]
pub trait PointeeSized {}
#[lang = "meta_sized"]
pub trait MetaSized: PointeeSized {}
#[lang = "sized"]
pub trait Sized: MetaSized {}

trait ToUnit<'a> {
    type Unit;
}

trait Overlap<T> {}

type Assoc<'a, T> = <*const T as ToUnit<'a>>::Unit;

impl<T> Overlap<T> for T {}

impl<T> Overlap<for<'a> fn(Assoc<'a, T>)> for T where Missing: Overlap<T> {}
