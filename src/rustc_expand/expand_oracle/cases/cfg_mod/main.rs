#[cfg(false)]
mod missing;
#[cfg_attr(true, path = "other.rs")]
mod foo;
mod gone;
mod kept;
fn main() {}
