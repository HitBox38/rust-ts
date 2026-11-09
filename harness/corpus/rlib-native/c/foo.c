// libfoo.a's foo.o: a global, a static fn and a weak fn (harness/corpus/gen-rlib-native.ts).
int foo_global = 1;
static int foo_static(void) { return 2; }
__attribute__((weak)) int foo_weak(void) { return foo_static(); }
