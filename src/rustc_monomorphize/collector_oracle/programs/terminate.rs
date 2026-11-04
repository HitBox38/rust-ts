//@ edition: 2021
// `UnwindTerminate` and `UnwindAction::Terminate`: `extern "C"` cannot unwind, and drops during unwinding abort.
#![crate_type = "lib"]
pub struct D;
impl Drop for D { fn drop(&mut self) {} }
#[inline(never)] fn may_panic() { panic!("x") }
pub extern "C" fn no_unwind() { may_panic() }
pub fn cleanup() { let _d = D; may_panic(); }
pub fn nounwind_drop(d: D) -> D { may_panic(); d }
