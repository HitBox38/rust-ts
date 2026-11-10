// rust-ts FFI edge for proc-macro host dylibs (not an upstream mirror; see proc_macro_host.ts).
//
// Compiled at load time by bun:ffi's embedded TinyCC (`cc`). Bun's FFI has no struct-by-value arguments or
// returns, so every `#[repr(C)]` value of library/proc_macro/src/bridge (`Buffer` buffer.rs:8, `Closure`
// closure.rs:8, `BridgeConfig` mod.rs:120, `Client` client.rs:221) crosses here: TS passes and receives them
// through pointers, the C side makes the by-value calls with the platform's C ABI.
//
// No system headers: TinyCC inside Bun has no SDK include path. The libc / libdl functions below are resolved
// from the running process.

typedef unsigned long rts_size_t;
typedef unsigned char rts_u8;

void *malloc(rts_size_t size);
void *realloc(void *p, rts_size_t size);
void free(void *p);
void abort(void);
void *dlopen(const char *path, int flags);
void *dlsym(void *handle, const char *symbol);
char *dlerror(void);

// library/proc_macro/src/bridge/buffer.rs:8
typedef struct Buffer Buffer;
struct Buffer {
  rts_u8 *data;
  rts_size_t len;
  rts_size_t capacity;
  Buffer (*reserve)(Buffer, rts_size_t);
  void (*drop)(Buffer);
};

// library/proc_macro/src/bridge/closure.rs:8
typedef struct {
  Buffer (*call)(void *env, Buffer arg);
  void *env;
} Closure;

// library/proc_macro/src/bridge/mod.rs:120
typedef struct {
  Buffer input;
  Closure dispatch;
  _Bool force_show_panics;
} BridgeConfig;

// library/proc_macro/src/bridge/client.rs:221 (`Client { run }`)
typedef Buffer (*RunFn)(BridgeConfig);

// ---- buffers owned by the server (the port) ----
//
// The server's `Buffer::from(Vec<u8>)` (buffer.rs:103): `reserve` follows `Vec::<u8>::reserve`
// (RawVec `grow_amortized`: max(2 * capacity, len + additional, 8)), `drop` frees the allocation. A capacity-0
// buffer has a dangling non-null `data`, as `Vec::new()` does.

static Buffer rts_reserve(Buffer b, rts_size_t additional) {
  if (b.capacity - b.len < additional) {
    rts_size_t required = b.len + additional;
    rts_size_t cap;
    rts_u8 *data;
    if (required < b.len) abort(); // "capacity overflow" (cannot unwind out of an extern "C" fn)
    cap = b.capacity * 2;
    if (cap < required) cap = required;
    if (cap < 8) cap = 8;
    data = b.capacity != 0 ? (rts_u8 *)realloc(b.data, cap) : (rts_u8 *)malloc(cap);
    if (data == 0) abort(); // handle_alloc_error
    b.data = data;
    b.capacity = cap;
  }
  return b;
}

static void rts_drop(Buffer b) {
  if (b.capacity != 0) free(b.data);
}

/// A server buffer of `capacity` bytes (uninitialised), `len` 0.
void rts_buffer_with_capacity(rts_size_t capacity, Buffer *out) {
  out->data = (rts_u8 *)1;
  out->len = 0;
  out->capacity = 0;
  out->reserve = rts_reserve;
  out->drop = rts_drop;
  if (capacity != 0) *out = rts_reserve(*out, capacity);
}

// ---- calls through a buffer's own fn pointers (whoever allocated it) ----

void rts_buffer_reserve(Buffer *b, rts_size_t additional, Buffer *out) {
  *out = b->reserve(*b, additional);
}

void rts_buffer_drop(Buffer *b) {
  b->drop(*b);
}

// ---- the server's dispatch `Closure` ----
//
// `call` is this function for every closure the port hands to a client; `env` identifies the TS closure. The
// JS callback reads `*io` (the request buffer), runs the TS dispatcher and writes the response buffer back.

static void (*rts_js_dispatch)(void *env, Buffer *io);

void rts_set_dispatch(void *f) {
  rts_js_dispatch = (void (*)(void *, Buffer *))f;
}

static Buffer rts_dispatch_call(void *env, Buffer arg) {
  Buffer io = arg;
  rts_js_dispatch(env, &io);
  return io;
}

// ---- `(client.run)(BridgeConfig { input, dispatch, force_show_panics })` ----

void rts_run(void *run, Buffer *input, void *env, int force_show_panics, Buffer *out) {
  BridgeConfig config;
  config.input = *input;
  config.dispatch.call = rts_dispatch_call;
  config.dispatch.env = env;
  config.force_show_panics = force_show_panics != 0;
  *out = ((RunFn)run)(config);
}

// ---- the cross-thread strategy's client thread (library/proc_macro/src/bridge/server.rs:192) ----
//
// The closure `MaybeCrossThread::run_bridge_and_client` hands to `thread::spawn`:
//
//     move || {
//         let mut dispatch = |b: Buffer| -> Buffer {
//             client.send(b);
//             client.recv().expect("server died while client waiting for reply")
//         };
//         run_client(BridgeConfig { input, dispatch: (&mut dispatch).into(), force_show_panics })
//     }
//
// It runs on a pthread made by src/std/thread.c, so it calls no JS. `client` is the client end of the
// `MessagePipe<Buffer>`: two channels of src/std/thread.c (passed in as raw pointers), reached through that unit's
// function pointers (`rts_chan_fns`), since the two TinyCC units are not linked together.

typedef int (*rts_chan_send_fn)(void *chan, const Buffer *msg);
typedef int (*rts_chan_recv_fn)(void *chan, Buffer *out);
typedef void (*rts_chan_drop_fn)(void *chan);

typedef struct {
  // captured by the closure
  void *run;
  Buffer input;
  int force_show_panics;
  void *tx; // client.tx: SyncSender<Buffer>
  void *rx; // client.rx: Receiver<Buffer>
  // src/std/thread.c's channel functions
  rts_chan_send_fn send;
  rts_chan_recv_fn recv;
  rts_chan_drop_fn drop_sender;
  rts_chan_drop_fn drop_receiver;
  // the closure's return value, read after `join`
  Buffer out;
} ClientThread;

// The `dispatch` closure, as `Closure::call` (closure.rs) calls it.
static Buffer rts_pipe_dispatch(void *env, Buffer b) {
  ClientThread *t = (ClientThread *)env;
  Buffer r;
  // `client.send(b)` = `self.tx.send(value).unwrap()`. A panic here (or in the `expect` below) would unwind out of
  // the `extern "C"` `Closure::call`, which aborts. Neither can happen: the server keeps its end until the client
  // thread is joined.
  if (t->send(t->tx, &b) != 0) abort();
  // `client.recv().expect("server died while client waiting for reply")`
  if (t->recv(t->rx, &r) != 0) abort();
  return r;
}

static void *rts_client_thread_main(void *arg) {
  ClientThread *t = (ClientThread *)arg;
  BridgeConfig config;
  config.input = t->input;
  config.dispatch.call = rts_pipe_dispatch;
  config.dispatch.env = t;
  config.force_show_panics = t->force_show_panics != 0;
  t->out = ((RunFn)t->run)(config);
  // The closure returns: its captured `client` is dropped (fields in order: `tx`, then `rx`). The server's `recv`
  // then sees the disconnect and leaves its loop.
  t->drop_sender(t->tx);
  t->drop_receiver(t->rx);
  return 0;
}

/// The closure's captures; `fns` is `rts_chan_fns`'s output (send, recv, drop_sender, drop_receiver).
ClientThread *rts_client_thread_new(void *run, Buffer *input, int force_show_panics, void *tx, void *rx, void **fns) {
  ClientThread *t = (ClientThread *)malloc(sizeof(ClientThread));
  if (t == 0) abort(); // handle_alloc_error
  t->run = run;
  t->input = *input;
  t->force_show_panics = force_show_panics;
  t->tx = tx;
  t->rx = rx;
  t->send = (rts_chan_send_fn)fns[0];
  t->recv = (rts_chan_recv_fn)fns[1];
  t->drop_sender = (rts_chan_drop_fn)fns[2];
  t->drop_receiver = (rts_chan_drop_fn)fns[3];
  return t;
}

/// The thread's start routine (`extern "C" fn(*mut c_void) -> *mut c_void`).
void *rts_client_thread_start(void) {
  return (void *)rts_client_thread_main;
}

/// After `join`: the closure's return value; frees the captures.
void rts_client_thread_finish(ClientThread *t, Buffer *out) {
  *out = t->out;
  free(t);
}

// ---- libloading::os::unix (dlopen / dlsym / dlerror) ----

void *rts_dlopen(const char *path, int flags) {
  return dlopen(path, flags);
}

/// libloading's `get_impl`: clear `dlerror`, then `dlsym`.
void *rts_dlsym(void *handle, const char *symbol) {
  dlerror();
  return dlsym(handle, symbol);
}

const char *rts_dlerror(void) {
  return dlerror();
}
