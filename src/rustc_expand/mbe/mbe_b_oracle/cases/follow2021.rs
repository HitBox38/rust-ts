//@ edition: 2021
macro_rules! p1 { ($p:pat | $q:pat) => {} }
macro_rules! p2 { ($($p:pat)|+) => {} }
macro_rules! p3 { ($p:pat_param | $q:pat) => {} }
