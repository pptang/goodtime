// Heap will have regions.
// When a new thing needs to be allocated,
// Allocator will try to re-use regions it keeps.
// If there is no enough empty regions, it will ask Heap for more.
// Heap may trigger a minor GC before it gives a new region out.
// If minor GC is not enough, a full GC will be triggered.
// The worst case is memory leaks and no region available anymore.
// Then the Heap will throw a OOM (program crashed)

const REGION_SIZE = 1024000;  // Uint8 * 1024000 = 1MB
const NUMBER_REGIONS = 256;

const REGION_EDEN = 11;
const REGION_SURVIVOR = 12;
const REGION_TENURED = 13;
const REGION_HUMOGOUS = 14;

const MONO_INT32 = 1;
const MONO_ADDRESS = 11; 
const MONO_FLOAT64 = 2;
const MONO_ARRAY_S8 = 3;
const MONO_CHUNK_S8 = 31;
const MONO_STRING_S8 = 4;
const MONO_OBJECT_S8 = 5;
const MONO_NAMED_PROPERTY_S8 = 6;   // (addressToStringMono, addressToMono) * 8

const MONO_CHUNK_SIZE = 8;  // 8 elements per chunk.

function Heap() {

    // We need this 'root' to prevent an unreferenced typed array gone.
    // This is because we don't control the real memory.
    this.__rootedContents = [ new Uint8Array(REGION_SIZE) ];
    for (let i = 0; i < NUMBER_REGIONS; i ++) {
        this.__rootedContents.push(new Uint8Array(REGION_SIZE));
    }
    this.__contentCounter = 0;
    this.allocator = new Allocator(this, this.createRegion());
}

Heap.prototype.createRegion = function() {
    const content = this.__rootedContents[this.__contentCounter];
    const beginFrom = this.__contentCounter * REGION_SIZE;
    return new Region(this, beginFrom, REGION_SIZE, content);
}

Heap.prototype.fetchMono = function(address) {
    const regionIndex = (address / REGION_SIZE >>0);
    if (regionIndex > NUMBER_REGIONS) {
        throw new Error("Address out of Region range: " + address);
    }
    const content = this.__rootedContents[regionIndex];
    const contentIndex = address % REGION_SIZE;     // index inside the region.

    const beginFrom = regionIndex * REGION_SIZE;
    const region = new Region(this, beginFrom, REGION_SIZE, content);

    const monoKind = content[contentIndex];  // 1 byte header uint8 can be read directly.
    console.log("fetch mono: ", address, regionIndex, contentIndex, beginFrom, monoKind);
    const mono = new Mono(region, monoKind, contentIndex);  // beginFrom of Mono is inside the region.
    return mono;
}

Heap.prototype.allocator = function() {
    return this.allocator;
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
        this.kind = REGION_EDEN;
        this.writeKind(REGION_EDEN);
    } else {
        this.kind = kind;
    }
}

Region.prototype.writeKind = function(kind) {
    switch (kind) {
        case REGION_EDEN:
        case REGION_SURVIVOR:
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
        console.log("read counter: ", counter, this.counter)
        this.writeCounter()
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
    console.log("before create mono, counter: ", this.counter);
    const increase = Mono.prototype.sizeFromKind(kind);
    if (!this.capable(increase)) {
        console.log("Region OOM for bytes: ", increase);
        return false;
    }
    const mono = new Mono(this, kind, this.counter);
    console.log('mono created: ', kind, '[ ', mono.beginFrom, ' : ', mono.endAt, ' ]');
    mono.writeHeader();
    console.log('counter: ', this.counter, ' -> ', this.counter + increase);
    this.counter += increase;
    return mono;
}

// Traverse all monos. One by one call the callback
Region.prototype.traverse = function(cb) {
    for(let beginFrom = 5; beginFrom < this.counter;) {    // [0 - 3] is the counter [4] is kind.
        console.log('try to traverse mono at: ', beginFrom)
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
        case MONO_INT32:
        case MONO_ADDRESS:
            return 5;    // 1 + 4 (header: 1 byte + int32)
        case MONO_FLOAT64:
            return 9;   // 1 + 8
        case MONO_ARRAY_S8:
            return 42;   // 1 + 4 + 1 + 4 * 8 + 4 (header + array length + init chunk length + 8 slots + address to next)
        case MONO_CHUNK_S8:
            return 38;    // 1 + 1 + 4 * 8 + 4 (header + chunk length + 8 slots + address to next)
        case MONO_STRING_S8:
            return 69;   // 1 + 8 * 8 + 4 (header + 8 slots + address to next)
        case MONO_OBJECT_S8:
            return 73;   // 1 + 8 * 8  + 4 + 4 (header + 8 slots + address to name/address dict + address to next)
        case MONO_NAMED_PROPERTY_S8:
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

// Allocate a new Mono on the heap and return its Wrapped* (dispatched)
Allocator.prototype.allocateFromHostValue = function(hostValue) {
    // TODO.
}

Allocator.prototype.array = function() {
    return this.allocate(MONO_ARRAY_S8, WrappedArray);
}

Allocator.prototype.chunk = function() {
    return this.allocate(MONO_CHUNK_S8, WrappedChunk);
}

Allocator.prototype.float64 = function() {
    return this.allocate(MONO_FLOAT64, WrappedFloat64);
}

Allocator.prototype.int32 = function() {
    return this.allocate(MONO_INT32, WrappedInt32);
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
    console.log("allocated: ", wrapped.constructor.name, " at: # ", wrapped.mono.heapAddress());
    return wrapped;
}


function WrappedObject(mono) {
    this.mono = mono;
}

// Int and Float can be directly written to the slots.
WrappedObject.prototype.write = function(propertyName, hostValue) {
    
}

// Otherwise, it is a thing already on the heap.
WrappedObject.prototype.attach = function(propertyName, mono) {

}

WrappedObject.prototype.detach = function(propertyName) {

}

function WrappedInt32(mono) {
    this.mono = mono;
}

WrappedInt32.prototype.read = function() {
    return this.mono.region.readInt32(this.mono.valueFrom);
}

WrappedInt32.prototype.write = function(hostFloat64) {
    return this.mono.region.writeInt32(this.mono.valueFrom, hostFloat64);
}

function WrappedFloat64(mono) {
    this.mono = mono;
}

WrappedFloat64.prototype.read = function() {
    return this.mono.region.readFloat64(this.mono.valueFrom);
}

WrappedFloat64.prototype.write = function(hostFloat64) {
    return this.mono.region.writeFloat64(this.mono.valueFrom, hostFloat64);
}

function WrappedChunk(mono) {
    this.mono = mono;
    this.elementsFrom = this.mono.valueFrom + 1;
    this.atToNext = this.mono.endAt - 3;
}

WrappedChunk.prototype.readChunkLength = function() {
    return this.mono.region.readUint8(this.mono.valueFrom); 
}

WrappedChunk.prototype.writeChunkLength = function(length) {
    return this.mono.region.writeUint8(this.mono.valueFrom, length); 
}

// Append a new element into the chunk.
WrappedChunk.prototype.chunkAppend = function(wrapped) {
    if (this.isChunkFull()) { return false; }
    const currentLength = this.readChunkLength();
    // At [ valueFrom + length ] = last empty slot.
    // Write so it will become a pointer.
    this.mono.region.writeAddress(
        this.mono.valueFrom + currentLength,
        wrapped.mono.heapAddress()
    )
    this.writeChunkLength(currentLength + 1);
}

WrappedChunk.prototype.chunkIndex = function(idxChunk) {
    const monoAt = this.elementsFrom + idxChunk;

    // Get heap address stored in the chunk, at a region local address.
    const monoAddress = this.mono.region.readAddress(monoAt);
    // Get element from the heap via heap address.
    const fetched = this.mono.region.heap.fetchMono(monoAddress);
    return new Wrapped(mono);
}

WrappedChunk.prototype.setChunkNext = function(heapAddress) {
    this.mono.region.writeAddress(this.atToNext, heapAddress);
}

WrappedChunk.prototype.isChunkFull = function(wrapped) {
    const length = this.readChunkLength();
    if (length + 1 > MONO_CHUNK_SIZE) {
        return true;
    }
    return false;
}

// Dynamic typed array.
// So it can only contain addresses of monos, actually.
// And since we have all data structures in immutable,
// operations will all allocate a new array while re-addressing old elements.
function WrappedArray(mono) {
    this.mono = mono;
    // First 4 bytes are length.
    // Then 1 byte for chunk length (init chunk is connected with array mono header)
    this.elementsFrom = this.mono.valueFrom + 5;
    this.atLength = this.mono.valueFrom;            // [ 1 - 4 ] is array length, here: [1]
    this.atChunkLength = this.mono.valueFrom + 4;   // [ 5 ] is default chunk length, here: [5]
    this.atToNext = this.mono.endAt - 3;            // [-3 - -0] is address (pointer) to next chunk
}

WrappedArray.prototype.readLength = function() {
    // NOTE: since we used Uint8 array, default should be 0,
    // so the new array will have 0 length as we want.
    return this.mono.region.readUint32(this.mono.valueFrom);
}

WrappedArray.prototype.writeLength = function(length) {
    this.mono.region.writeUint32(this.mono.valueFrom, length);
}

// Chunk funtions here is for the default chunk allocated along with the Array.

WrappedArray.prototype.readChunkLength = function() {
   return WrappedChunk.prototype.readChunkLength.apply(this, []);
}

WrappedArray.prototype.writeChunkLength = function(length) {
    return WrappedChunk.prototype.writeChunkLength.apply(this, [this.atChunkLength, length]);
}

WrappedArray.prototype.chunkIndex = function(idxChunk) {
    return WrappedChunk.prototype.chunkIndex.apply(this, [idxChunk]);
}

WrappedArray.prototype.isChunkFull = function() {
    return WrappedChunk.prototype.isChunkFull.apply(this, []);
}

WrappedArray.prototype.chunkAppend = function(wrapped) {
    return WrappedChunk.prototype.chunkAppend.apply(this, [wrapped]);
} 

WrappedArray.prototype.setChunkNext = function(heapAddress) {
    return WrappedChunk.prototype.setChunkNext.apply(this, [heapAddress]);
}

WrappedArray.prototype.index = function(idx) {
    const length = this.readLength();
    if (idx >= length || idx < 0) {
        throw new Error("Index out of range: ", idx, 0, header.length)
    }
    const chunk = this.findChunk(idx);
    const idxChunk = idx % 8;
    return chunk.chunkIndex(idxChunk);
}

WrappedArray.prototype.fetchNextChunk = function() {
    // from latest [-3, -2, -1, -0] is the address of the next chunk.
    const nextChunkAddress = this.mono.region.readAddress(this.atToNext);
    if (0 === nextChunkAddress) {  // not connected to next chunk yet.
        return false;
    }
    console.log("try to fetch next chunk at: #", nextChunkAddress);
    const nextChunkMono = this.mono.region.heap.fetchMono(nextChunkAddress);
    return new WrappedChunk(nextChunkMono);
}

// Given index, give chunk it should be in.
WrappedArray.prototype.findChunk = function(idx) {
    const targetChunkId = (idx/MONO_CHUNK_SIZE>>0);
    let targetChunk;
    if (0 === targetChunkId) {  // this array base + default chunk.
        targetChunk = this;
    } else {
        let validChunk = this
        let fetchedChunk = this;
        for (let chunkId = 0; chunkId < targetChunkId; chunkId ++) {
            fetchedChunk = validChunk.fetchNextChunk()
            if (false === fetchedChunk) {
                return [validChunk, false];
            }
            validChunk = fetchedChunk;
        }
        targetChunk = fetchedChunk;
    }
    return [targetChunk, targetChunk];
}

WrappedArray.prototype.append = function(wrapped) {
    const length = this.readLength();
    let [latestValidChunk, latestChunk] = this.findChunk(length); // [ length ] is the lastest empty slot to append.

    console.log(
        "(append) at chunk: ",
        this.mono.heapAddress(),
        " found chunk: # ",
        ( latestChunk ) ? latestChunk.mono.heapAddress() : false,
        " for array length: ",
        length
    );

    // array[length] to append at the next chunk is not yet there.
    // Like, now it tries to append at array[8] == chunk#1, while array[0 - 7] is at chunk#0
    // array[15] OK if one connected; array[16]
    if (latestChunk === false || latestChunk.isChunkFull()) {
        // allocate a new chunk (may trigger GC)
        const newChunk = this.mono.region.heap.allocator.chunk();

        // If it is just full then latestValidChunk == latestChunk.
        latestValidChunk.setChunkNext(newChunk.mono.heapAddress());
        console.log(
            "append new chunk address: #",
            newChunk.mono.heapAddress(),
            " at: ",
            latestValidChunk.atToNext,
            "of: # ",
            latestValidChunk.mono.heapAddress()
        );
        latestChunk = newChunk;
    }
    latestChunk.chunkAppend(wrapped);
    this.writeLength(length + 1);
}

function Wrapped(mono) {
    this.mono = mono;
}


// TODO: return Monad to encapsulate operations.

// From generic Wrapped to like WrappedFloat64, according to the mono kind.
Wrapped.prototype.dispatch = function() {
    switch (this.mono.kind) {
        case MONO_INT32:
            return new WrappedInt32(this.mono);
        case MONO_ADDRESS:
            return this;    // TODO
        case MONO_FLOAT64:
            return new WrappedFloat64(this.mono);
        case MONO_ARRAY_S8:
            return new WrappedArray(this.mono);
        case MONO_STRING_S8:
            return this;    // TODO
        case MONO_OBJECT_S8:
            return this;    // TODO
        case MONO_NAMED_PROPERTY_S8:
            return this;    // TODO
        default:
            throw new Error("Wrong Mono kind: " + this.mono.kind)
    }
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
        newMono = testRegion.createMono(MONO_FLOAT64);
        newWrapped = new WrappedFloat64(newMono);
        newWrapped.write(hostFloat64)
        console.log("float64: host value: ", hostFloat64, " read after write: ", newWrapped.read());
    }
    console.log("----");

    for (let i = 0, newMono, hostInt32; i < 4; i ++) {
        hostInt32 = i * -1;
        newMono = testRegion.createMono(MONO_INT32);
        newWrapped = new WrappedInt32(newMono);
        newWrapped.write(hostInt32)
        console.log("int32: host value: ", hostInt32, " read after write: ", newWrapped.read());
    }
    console.log("----");

    for (let i = 0, newMono, heapAddress, fetchedMono; i < 4; i ++) {
        hostInt32 = i * -1;
        newMono = testRegion.createMono(MONO_INT32);
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

    const testRegion = heap.createRegion();
    for (let i = 0, newWrappedFloat64, newWrappedInt32, hostInt32, hostFloat64; i < 6; i ++) {
        hostFloat64 = i + 0.91;
        hostInt32 = i - 1;

        newWrappedFloat64 = heap.allocator.float64();
        newWrappedFloat64.write(hostFloat64);

        newWrappedInt32 = heap.allocator.int32();
        newWrappedInt32.write(hostInt32);

        console.log("[test array] float64: host value: ", hostFloat64, " read after write: ", newWrappedFloat64.read());
        console.log("[test array] int32: host value: ", hostInt32, " read after write: ", newWrappedInt32.read());

        wrappedArray.append(newWrappedFloat64);
        wrappedArray.append(newWrappedInt32);

        console.log("[test array] array appended float and int", wrappedArray.readLength(), i);
    }

    console.log("----");

    for (let i = 0; i < 12; i ++) {
        console.log("[test array] try to index array element: ", i);
        const wrapped = wrappedArray.index(i);
        const dispatched = wrapped.dispatch();
        console.log("[test array] result after dispatching: ", (dispatched.read) ? dispatched.read() : nul);
    }

}

testArray();