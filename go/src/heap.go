

// Heap has have regions.
// When a new thing needs to be allocated,
// Allocator will try to re-use regions it keeps.
// If there is no enough empty regions, it will ask Heap for more.
// Heap may trigger a minor GC before it gives a new region out.
// If minor GC is not enough, a full GC will be triggered.
// The worst case is memory leaks and no region available anymore.
// Then the Heap will throw a OOM (program crashed)

const REGION_SIZE = 1024000  // Uint8 * 1024000 = 1MB
const NUMBER_REGIONS = 256

const REGION_EDEN = 11
const REGION_SURVIVOR = 12
const REGION_TENURED = 13
const REGION_HUMOGOUS = 14

const MONO_INT32 = 1
const MONO_ADDRESS = 11
const MONO_FLOAT64 = 2
const MONO_ARRAY_S8 = 3
const MONO_CHUNK_S8 = 31
const MONO_STRING_S8 = 4
const MONO_OBJECT_S8 = 5
const MONO_NAMED_PROPERTY_S8 = 6   // (addressToStringMono, addressToMono) * 8

const MONO_CHUNK_SIZE = 8  // 8 elements per chunk.