# GoodTime

**Good Time** is a hosted, forkable online language runtime. Now is still under development.
It implements mechanisms of the programming language engine such as **Interpreting**, **Garbage Collector**, **Just-in-Time**...so on and so forth.
Besides, it'll also include some embedded modules, utility functions to deal with things other than language itself can do.

## Draft Note

(Our assumption of this project is that the language will be a subset of JavaScripts and have functional programming styles.)

1. Start the project and decide the runtime.
2. Use existing AST parser.
3. Write AST worker module (traverse AST), call stack machine handler.
4. While dealing with AST node, some may involve Stack handler, others may use Heap Handler.
5. Stack machine handler module (For now, we go AST way instead of Bytecode way) -> Start with dummy handler (just print the info of push and pop)(or let’s say a Debug info handler)
6. Debug info Handler module which can be attached to any worker in order to visualize what’s happening inside that worker.
7. Heap module which imports GC module (or calling it memory module)
8. Initializer module (GC, Stack, JIT warmup), which is an entry point and will be triggered when the runtime starts.
9. JIT module -> when executing the same block (and the input arguments are the same -> how to make sure if it’s the same?), we don’t evaluate again but get the value from stored somewhere.
10. (Optional) lazy evaluation.

Flow: Read File (with JS code) -> Parse to AST -> Interpreting, GC, JIT spontaneously
