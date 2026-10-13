// Visibility path errors (report_vis_error): not an ancestor (E0742), a relative path (2018+).
#![crate_type = "lib"]
mod outer {
    mod inner {}
    pub(in crate::outer::inner) struct A;
    pub(in outer) struct B;
}
