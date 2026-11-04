//@ edition: 2021
//@ compile-flags: -Clink-dead-code
// MonoItemCollectionStrategy::Eager: ADT drop glue, consts, default impls, private unused fns, closures.
#![crate_type = "lib"]
#![allow(dead_code)]
pub trait Tr { fn a(&self) {} fn b<T>(&self, _: T) {} fn c<'a>(&'a self) {} }
pub struct S;
impl Tr for S {}
struct WithDrop(Vec<u8>);
enum E { A(String), B }
struct Lt<'a>(&'a mut String);
impl<'a> Tr for Lt<'a> {}
struct Gen<T>(T);
impl<T> Tr for Gen<T> {}
const PTR: fn() = unused;
const GENERIC_UNUSED: u32 = 1;
fn unused() { let _c = || 1; }
const fn cf() -> u32 { 1 }
fn lifetimes<'a>(x: &'a u32) -> &'a u32 { x }
fn generic<T>(_: T) {}
async fn af() {}
pub async fn pub_af() {}
