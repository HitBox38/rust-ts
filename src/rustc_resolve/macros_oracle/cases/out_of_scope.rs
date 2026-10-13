// `OUT_OF_SCOPE_MACRO_CALLS`: a `macro_rules` called from an inert attribute of its own module.
#![doc = in_root!()]
macro_rules! in_root { () => { "" } }
mod m {
    #![doc = in_mod!()]
    macro_rules! in_mod { () => { "" } }
}
