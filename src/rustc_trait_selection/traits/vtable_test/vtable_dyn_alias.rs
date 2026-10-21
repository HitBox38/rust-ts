// `type X = dyn Trait` aliases: methods of a trait object are `<dyn T as T>::m - shim(reify)`; no principal gives
// only the common entries. A `#[track_caller]` impl method gets a reify shim.
#![feature(rustc_attrs)]

pub trait T {
    fn method(&self);
    fn generic<U>(&self) where Self: Sized {}
}

pub trait U: T {
    fn other(&self) {}
}

pub struct S;

#[rustc_dump_vtable]
impl T for S {
    #[track_caller]
    fn method(&self) {}
}

#[rustc_dump_vtable]
type DynU = dyn U;

#[rustc_dump_vtable]
type DynSend = dyn Send;

#[rustc_dump_vtable]
type DynIter = dyn Iterator<Item = u8>;
