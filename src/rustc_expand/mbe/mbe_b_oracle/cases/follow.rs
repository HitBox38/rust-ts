macro_rules! e1 { ($e:expr $t:tt) => {} }
macro_rules! e2 { ($e:expr; $f:expr, $g:expr => $h:tt) => {} }
macro_rules! s1 { ($s:stmt + ) => {} }
macro_rules! p1 { ($p:pat | $q:pat) => {} }
macro_rules! p2 { ($p:pat_param | $q:pat_param if) => {} }
macro_rules! p3 { ($p:pat in $e:expr) => {} }
macro_rules! t1 { ($t:ty as $u:ty where) => {} }
macro_rules! t2 { ($t:ty $b:block) => {} }
macro_rules! t3 { ($t:ty ( )) => {} }
macro_rules! path1 { ($p:path => $q:path ! ) => {} }
macro_rules! v1 { ($v:vis $i:ident) => {} }
macro_rules! v2 { ($v:vis priv) => {} }
macro_rules! v3 { ($v:vis $t:ty, $w:vis r#priv) => {} }
macro_rules! v4 { ($v:vis $e:expr) => {} }
macro_rules! v5 { ($v:vis & ) => {} }
macro_rules! seq1 { ($($e:expr)*) => {} }
macro_rules! seq2 { ($($e:expr),*) => {} }
macro_rules! seq3 { ($($e:expr),* ; $($f:expr);+ $g:tt) => {} }
macro_rules! seq4 { ($($t:ty)? $(=> $u:ty)+ + ) => {} }
macro_rules! nest { ([$($e:expr)*] { $($($t:tt)*),* }) => {} }
macro_rules! okall { ($i:ident $l:lifetime $lit:literal $m:meta $b:block $it:item $tt:tt $x:ident) => {} }
macro_rules! multi { ($($a:expr)? $($b:ty)? -) => {} }
