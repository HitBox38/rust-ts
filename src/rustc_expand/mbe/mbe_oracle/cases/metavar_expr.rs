#![feature(macro_metavar_expr)]
macro_rules! cnt {
    ($($($x:ident),*);*) => {
        [${count(x)}, ${count(x, 0)}, ${count(x, 1)}, $( ${count(x)} ${index()} ${len()} ),* , $($( ${index(1)} ${len(1)} ${index()} ${ignore(x)} )*)*]
    };
}
const _: () = cnt!(a, b; c; d, e, f);
macro_rules! bad_count { ($x:ident) => { ${count(x)} } }
const _: () = bad_count!(a);
macro_rules! bad_depth { ($($x:ident)*) => { ${count(x, 3)} } }
const _: () = bad_depth!(a);
macro_rules! bad_index { () => { ${index()} } }
const _: () = bad_index!();
macro_rules! bad_len { ($($x:ident)*) => { $( ${len(2)} )* } }
const _: () = bad_len!(a);
macro_rules! bad_index2 { ($($x:ident)*) => { $( ${index(1)} )* } }
const _: () = bad_index2!(a);
macro_rules! empty_count { ($($x:ident)*) => { ${count(x)} } }
const _: () = empty_count!();
