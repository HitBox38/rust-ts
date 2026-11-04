// lane mono-partition: `-Clink-dead-code`: the Eager strategy, `GloballyShared { may_conflict: true }` and no internalizing.
#![crate_type = "lib"]

fn unused_private() {}

#[inline]
pub fn inlined_unused() {}

pub struct WithDrop;

impl Drop for WithDrop {
    fn drop(&mut self) {}
}

mod inner {
    pub fn used() -> u32 {
        1
    }
    fn unused() {}
}

pub fn caller() -> u32 {
    inner::used()
}
