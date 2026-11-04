//@ edition: 2021
// Lazy strategy: `pub async fn` also monomorphizes its coroutine, private and generic ones do not.
#![crate_type = "lib"]
pub async fn public() { inner().await }
async fn inner() {}
pub async fn generic<T>(_: T) {}
pub struct S;
impl S { pub async fn method(&self) {} }
