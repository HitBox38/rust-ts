//@ edition: 2018
macro_rules! p1 { ($p:pat | $q:pat) => {} }
macro_rules! p2 { ($($p:pat)|+) => {} }
macro_rules! ext_p3 { ($p:pat | $q:pat) => {} }
