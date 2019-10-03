// Heap will have regions.
// When a new thing needs to be allocated,
// Allocator will try to re-use regions it keeps.
// If there is no enough empty regions, it will ask Heap for more.
// Heap may trigger a minor GC before it gives a new region out.
// If minor GC is not enough, a full GC will be triggered.
// The worst case is memory leaks and no region available anymore.
// Then the Heap will throw a OOM (program crashed)

const { GC } = require('./gc');
const { Consts } = require('./consts');
const {
    Wrapped,
    WrappedArray,
    WrappedChunk,
    WrappedFloat64,
    WrappedArrress,
    WrappedInt32,
    WrappedObject
} = require('./wrappers');

function Heap() {

    // We need this 'root' to prevent an unreferenced typed array gone.
    // This is because we don't control the real memory.
    this.__rootedContents = [ new Uint8Array(Consts.REGION_SIZE) ];
    for (let i = 0; i < Consts.NUMBER_REGIONS; i ++) {
        this.__rootedContents.push(new Uint8Array(Consts.REGION_SIZE));
    }
    this.__contentCounter = 0;
    this.allocator = new Allocator(this, this.createRegion());

    // TODO: Can do some fun subsitutation by config if we have GC factory.
    this.gc = new GC(this);
}

Heap.prototype.createRegion = function() {
    if (this.__contentCounter >= this.__rootedContents.length) {
        throw new Error("OOM: cannot create region anymore.");
    }
    const content = this.__rootedContents[this.__contentCounter];
    const beginFrom = this.__contentCounter * Consts.REGION_SIZE;
    this.__contentCounter += 1;
    return new Region(this, beginFrom, Consts.REGION_SIZE, content);
}

Heap.prototype.fetchMono = function(address) {
    const regionIndex = (address / Consts.REGION_SIZE >>0);
    if (regionIndex > Consts.NUMBER_REGIONS) {
        throw new Error("Address out of Region range: " + address);
    }
    const content = this.__rootedContents[regionIndex];
    const contentIndex = address % Consts.REGION_SIZE;     // index inside the region.

    const beginFrom = regionIndex * Consts.REGION_SIZE;
    const region = new Region(this, beginFrom, Consts.REGION_SIZE, content);

    const monoKind = content[contentIndex];  // 1 byte header uint8 can be read directly.
    const mono = new Mono(region, monoKind, contentIndex);  // beginFrom of Mono is inside the region.
    return mono;
}

Heap.prototype.fetchRegion = function(address) {
    const regionIndex = (address / Consts.REGION_SIZE >>0);
    if (regionIndex > Consts.NUMBER_REGIONS) {
        throw new Error("Address out of Region range: " + address);
    }
    const content = this.__rootedContents[regionIndex];
    const contentIndex = address % Consts.REGION_SIZE;     // index inside the region.

    const beginFrom = regionIndex * Consts.REGION_SIZE;
    const region = new Region(this, beginFrom, Consts.REGION_SIZE, content);
    return region;
}

// Regions are now fixed as 1MB by a const.
// Each region contains Uint8Array with length 
// GC only cares about regions, and it keeps their information in a preserved area 
// (since we implement in JS runtime, they're stick to v8's native heap as object properties).
function Region(heap, beginFrom, size, content) {
    this.heap = heap;
    this.beginFrom = beginFrom;
    this.size = size;
    this.endAt = beginFrom + size - 1;  // index
    this.content = content;
    // Read how many Slot/byte (Uint8) has been used.
    // at any time content[counter] = the last byte has NOT been occupied.
    this.counter = 0;
    this.kind = 0;
    this.readKind();
    this.readCounter(); 
}

// All these read/write functions' `at` is the address/index inside the region (from 0 to 1MB).
// Cross-region address need to be translated before being used here.

// And all these write is for host value,
// while read is also to host value.

Region.prototype.readUint8 = function(at) {
    if (at > this.size || at < 0) {
        throw new Error("Read from address out of range: " + at)
    }
    return this.content[at];
}

Region.prototype.readUint32 = function(at) {
    if (at + 4 > this.size || at < 0) {
        throw new Error("Read from address out of range: " + at)
    }

    const buf = new ArrayBuffer(4);
    const view = new DataView(buf);
    for (let i = 0; i < 4; i ++ ) {
        view.setUint8(i, this.content[i + at])
    }
    const uint32 = view.getUint32(0);
    return uint32;
}

Region.prototype.readInt32 = function(at) {
    if (at + 4 > this.size || at < 0) {
        throw new Error("Read from address out of range: " + at)
    }

    const buf = new ArrayBuffer(4);
    const view = new DataView(buf);
    for (let i = 0; i < 4; i ++ ) {
        view.setUint8(i, this.content[i + at])
    }
    const int32 = view.getInt32(0);
    return int32;
}

Region.prototype.readAddress = function(at) {
    return this.readUint32(at);
}

Region.prototype.readFloat64 = function(at) {
    if (at + 8 > this.size || at < 0) {
        throw new Error("Read from address out of range: " + at)
    }

    const buf = new ArrayBuffer(8);
    const view = new DataView(buf);
    for (let i = 0; i < 8; i ++ ) {
        view.setUint8(i, this.content[i + at])
    }
    const float64 = view.getFloat64(0);
    return float64;
}

Region.prototype.writeUint8 = function(at, byte) {
    if (at + 1 > this.size || at < 0) {
        throw new Error("Write to address out of range: " + at)
    }
    this.content[at] = byte;
}

Region.prototype.writeUint32 = function(at, uint32) {
    if (at + 4 > this.size || at < 0) {
        throw new Error("Write to address out of range: " + at)
    }

    const buf = new ArrayBuffer(4);
    const view = new DataView(buf);
    view.setUint32(0, uint32);
    const temp = new Uint8Array(buf);
    for (let i = 0; i < 4; i ++ ) {
        this.content[at + i] = temp[i];
    }
}

Region.prototype.writeInt32 = function(at, int32) {
    if (at + 4 > this.size || at < 0) {
        throw new Error("Write to address out of range: " + at)
    }

    const buf = new ArrayBuffer(4);
    const view = new DataView(buf);
    view.setInt32(0, int32);
    const temp = new Uint8Array(buf);
    for (let i = 0; i < 4; i ++ ) {
        this.content[at + i] = temp[i];
    }
}

Region.prototype.writeAddress = function(at, address) {
    return this.writeUint32(at, address);
}

Region.prototype.writeFloat64 = function(at, float64) {
    if (at + 8 > this.size || at < 0) {
        throw new Error("Write to address out of range: " + at)
    }

    const buf = new ArrayBuffer(8);
    const view = new DataView(buf);
    view.setFloat64(0, float64);
    const temp = new Uint8Array(buf);
    for (let i = 0; i < 8; i ++ ) {
        this.content[at + i] = temp[i];
    }
}

Region.prototype.newUint8 = function(at, uint8) {
    this.writeUint8(at, uint8);
    this.counter += 1;
}

Region.prototype.newUint32 = function(at, uint32) {
    this.writeUint32(at, uint32);
    this.counter += 4;
}

Region.prototype.newInt32 = function(at, int32) {
    this.writeInt32(at, int32);
    this.counter += 4;
}

Region.prototype.newAddress = function(at, address) {
    this.writeAddress(at, address);
    this.counter += 4;
}

Region.prototype.newFloat64 = function(at, float64) {
    this.writeFloat64(at, float64);
    this.counter += 8;
}

// Read the #4 byte from beginning to get the region kind.
Region.prototype.readKind = function() {
    const kind = this.readUint8(4);
    if (0 === kind) {   // new region; eden.
        this.kind = Consts.REGION_EDEN;
        this.writeKind(Consts.REGION_EDEN);
    } else {
        this.kind = kind;
    }
}

Region.prototype.writeKind = function(kind) {
    switch (kind) {
        case Consts.REGION_EDEN:
        case Consts.REGION_SURVIVOR:
        case REGION_TENURED:
        case REGION_HUMOGOUS:
            this.writeUint8(4, kind);
            break;
        default:
            throw new Error("Unknown kind of the region: " + kind);
    }
}

// Read the first 4 slots (32bit) to get the counter;
Region.prototype.readCounter = function() {
    let counter = this.readUint32(0);
    if (0 === counter) { // new region
        this.counter = 5;   // counter + kind
        this.writeCounter();
    } else {
        this.counter = counter;
    }
}

Region.prototype.writeCounter = function() {
    this.writeUint32(0, this.counter);
}

Region.prototype.capable = function(n = 1) {
    if (this.counter+n > this.size) {
        return false;
    }
    return true;
}

Region.prototype.createMono = function(kind) {
    const increase = Mono.prototype.sizeFromKind(kind);
    if (!this.capable(increase)) {
        console.log("Region OOM for bytes: ", increase);
        return false;
    }
    const mono = new Mono(this, kind, this.counter);
    mono.writeHeader();
    this.counter += increase;
    this.writeCounter();
    return mono;
}

// Traverse all monos. One by one call the callback
Region.prototype.traverse = function(cb) {
    for(let beginFrom = 5; beginFrom < this.counter;) {    // [0 - 3] is the counter [4] is kind.
        kind = this.readUint8(beginFrom);
        if (0 === kind) {
            // End of monos.
            break;
        }
        mono = new Mono(this, kind, beginFrom);
        cb(mono);
        beginFrom = mono.endAt + 1;
    }
}

// Mono is a thing composes of Uint8s with a Header records its
// length (how many Uint8s it equals to), what's its kind, and size, etc.
//
// For kinds with address at the latest 4 bytes, GC may change it if the
// target is moved.
//
// Address could cross regions. Regions have boundary by their
// `beginFrom` and `endAt` properties, so just have a address over the boundary
// meaning a cross-region reference.
//
// Address must point to Mono's header.
function Mono(region, kind, beginFrom) {
    this.region = region;
    this.kind = kind;               // 1 byte
    this.beginFrom = beginFrom;     // Region knew it when read one by one.
    this.valueFrom = beginFrom + 1; // 1 byte for header; skip it
    this.endAt = beginFrom + this.sizeFromKind(kind) - 1; // index so -1
}


// Write header information onto region content.
// REMEMBER TO CALL THIS: for any newly created Mono!
Mono.prototype.writeHeader = function() {
    this.region.writeUint8(this.beginFrom, this.kind);
}

Mono.prototype.sizeFromKind = function(kind) {
    switch (kind) {
        case Consts.MONO_INT32:
        case Consts.MONO_ADDRESS:
            return 5;    // 1 + 4 (header: 1 byte + int32)
        case Consts.MONO_FLOAT64:
            return 9;   // 1 + 8
        case Consts.MONO_ARRAY_S8:
            return 42;   // 1 + 4 + 1 + 4 * 8 + 4 (header + array length + init chunk length + 8 slots + address to next)
        case Consts.MONO_CHUNK_S8:
            return 38;    // 1 + 1 + 4 * 8 + 4 (header + chunk length + 8 slots + address to next)
        case Consts.MONO_STRING_S8:
            return 69;   // 1 + 8 * 8 + 4 (header + 8 slots + address to next)
        case Consts.MONO_OBJECT_S8:
            return 73;   // 1 + 8 * 8  + 4 + 4 (header + 8 slots + address to name/address dict + address to next)
        case Consts.MONO_NAMED_PROPERTY_S8:
            return 73;   // 1 + (4 + 4) * 8 + 4 (header + address pairs + address to next)
        default:
            throw new Error("Wrong Mono kind: " + kind)
    }
}

// Form the heap address of this mono's header.
Mono.prototype.heapAddress = function() {
    const regionOffset = this.beginFrom;
    const heapIndex = this.region.beginFrom;
    return heapIndex + regionOffset;
}

function Allocator(heap, defaultRegion) {
    this.heap = heap;
    this.regions = [ defaultRegion ];
}

// TODO: accept host array and fill it to wrapped one.
Allocator.prototype.array = function() {
    const result = this.allocate(Consts.MONO_ARRAY_S8, WrappedArray);
    return result;
}

Allocator.prototype.chunk = function() {
    return this.allocate(Consts.MONO_CHUNK_S8, WrappedChunk);
}

Allocator.prototype.float64 = function(hostValue) {
    const result = this.allocate(Consts.MONO_FLOAT64, WrappedFloat64);
    if (hostValue) {
        result.write(hostValue);
    }
    return result;
}

Allocator.prototype.int32 = function(hostValue) {
    const result = this.allocate(Consts.MONO_INT32, WrappedInt32);
    if (hostValue) {
        result.write(hostValue);
    }
    return result;
}

Allocator.prototype.allocate = function(monoKind, wrappedConstructor) {
    let targetRegion = this.regions[ this.regions.length - 1 ];
    const size = Mono.prototype.sizeFromKind(monoKind);
    if (!targetRegion.capable(size)) {
        // May trigger GC (TODO)
        targetRegion = this.heap.createRegion();
        this.regions.push(targetRegion);
    }
    const wrapped = new wrappedConstructor(targetRegion.createMono(monoKind));
    return wrapped;
}

Allocator.prototype.latestRegion = function() {
    return this.regions[ this.regions.length - 1 ];
}

function test() {
    const heap = new Heap();
    const testRegion = heap.createRegion();

    console.log("head 4 bytes:",
        testRegion.readUint8(0),
        testRegion.readUint8(1),
        testRegion.readUint8(2),
        testRegion.readUint8(3)
    );
    console.log("----");

    for (let i = 0, newMono, hostFloat64; i < 4; i ++) {
        hostFloat64 = i + 0.91;
        newMono = testRegion.createMono(Consts.MONO_FLOAT64);
        newWrapped = new WrappedFloat64(newMono);
        newWrapped.write(hostFloat64)
        console.log("float64: host value: ", hostFloat64, " read after write: ", newWrapped.read());
    }
    console.log("----");

    for (let i = 0, newMono, hostInt32; i < 4; i ++) {
        hostInt32 = i * -1;
        newMono = testRegion.createMono(Consts.MONO_INT32);
        newWrapped = new WrappedInt32(newMono);
        newWrapped.write(hostInt32)
        console.log("int32: host value: ", hostInt32, " read after write: ", newWrapped.read());
    }
    console.log("----");

    for (let i = 0, newMono, heapAddress, fetchedMono; i < 4; i ++) {
        hostInt32 = i * -1;
        newMono = testRegion.createMono(Consts.MONO_INT32);
        heapAddress = newMono.heapAddress();
        console.log("heap address of: [ ", newMono.beginFrom, " - ", newMono.endAt, " ]: ", heapAddress);
        fetchedMono = heap.fetchMono(heapAddress);
        console.log("create mono at heap: ", heapAddress, " and fetch it back from heap: [ ", fetchedMono.beginFrom, " - ", fetchedMono.endAt, " ]");
    }
    console.log("----");

    console.log("region usage: ", testRegion.counter);

    testRegion.traverse((mono) => {
        console.log('traverse mono: ', mono.kind, '[ ', mono.beginFrom, ' - ' , mono.endAt, ' ]');
    })
}

function testArray() {
    const heap = new Heap();
    const wrappedArray = heap.allocator.array();

    for (let i = 0, newWrappedFloat64, newWrappedInt32, hostInt32, hostFloat64; i < 6; i ++) {
        hostFloat64 = i + 0.91;
        hostInt32 = i - 1;

        newWrappedFloat64 = heap.allocator.float64();
        newWrappedFloat64.write(hostFloat64);

        newWrappedInt32 = heap.allocator.int32();
        newWrappedInt32.write(hostInt32);

        //console.log("[test array] float64: host value: ", hostFloat64, " read after write: ", newWrappedFloat64.read());
        //console.log("[test array] int32: host value: ", hostInt32, " read after write: ", newWrappedInt32.read());

        wrappedArray.append(newWrappedFloat64);
        wrappedArray.append(newWrappedInt32);

        console.log("[test array] array appended float and int", wrappedArray.readLength(), i);

        console.log("[test array] default chunk to host after append: \n ", wrappedArray.chunkToHost());
    }

    for (let i = 0; i < 12; i ++) {
        const wrapped = wrappedArray.index(i);
        const dispatched = wrapped.dispatch();
        console.log("[test array] index at: ", i, " result: " , (dispatched.read) ? dispatched.read() : null);
    }

    const cloned = wrappedArray.clone();
    for (let i = 0, clonedValue, originalValue; i < wrappedArray.length(); i ++) {
        originalValue = wrappedArray.index(i).dispatch();
        clonedValue = cloned.index(i).dispatch();
        
        console.log(
            "[test array] cloned at: ", i,
            " original: ", originalValue.read(),
            " cloned: ", clonedValue.read()
        );
    }
    console.log("========")
}

function example() {
    // (init)
    const heap = new Heap();

    // () => { [0..9].map((i) => i + 1.9) }();
    // EqualTo:
    let wrappedArray = heap.allocator.array();
    for (let i = 0, newFloat64, appended = wrappedArray; i < 10; i ++) {
        newFloat64 = heap.allocator.float64();
        newFloat64.write(i + 1.9);
        wrappedArray.append(newFloat64);
    }
    // result is: wrappedArray
    // ----
}

//testArray();

module.exports = {
    Consts,
    Heap
};