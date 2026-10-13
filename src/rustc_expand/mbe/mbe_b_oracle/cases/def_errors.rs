macro_rules! empty {}
macro_rules! no_arrow { () {} }
macro_rules! no_rhs { () => }
macro_rules! rhs_tok { () => x }
macro_rules! lhs_tok { x => {} }
macro_rules! no_sep { () => {} () => {} }
macro_rules! trailing_sep { () => {}; }
macro_rules! empty_seq { ($()*) => {} }
macro_rules! empty_seq2 { ($($v:vis)*) => {} }
macro_rules! vis_opt { ($($v:vis)?) => {} }
macro_rules! doc_seq { ($(
    /// doc
    /// more
)*) => {} }
macro_rules! unsafe_bang { unsafe () => {} }
macro_rules! only_unsafe { unsafe }
macro_rules! nested_empty { ([$($(a)*)*]) => {} }
macro_rules! ok_after { ($x:ident) => { $x } }
macro_rules! sep_seq { ($($x:ident),*) => {} }
macro_rules! two_errs { ($e:expr $f:expr) => {}; ($t:ty $u:ty) => {} }
