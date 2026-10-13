// Visibility paths that do not resolve to a module (E0433 `FailedToResolve` through `report_vis_error`).
#![crate_type = "lib"]
mod outer {
    pub struct S;
    pub(in crate::outer::missing) struct A;
    pub(in crate::outer::S) struct C;
}
