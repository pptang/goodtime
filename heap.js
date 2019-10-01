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

const REGION_EDEN = 1;
const REGION_SURVIVOR = 2;
const REGION_TENURED = 3;
const REGION_HUMOGOUS = 4;

const MONO_INT32 = 1;
const MONO_ADDRESS = 1;  // the same as INT32.
const MONO_FLOAT64 = 2;  // the largest unit for single slot (8 bytes)
const MONO_ARRAY_S8 = 3;
const MONO_STRING_S8 = 4;
const MONO_OBJECT_S8 = 5;
const MONO_NAMED_PROPERTY_S8 = 6;   // (addressToStringMono, addressToMono) * 8

function Heap() {

    // We need this 'root' to prevent an unreferenced typed array gone.
    // This is because we don't control the real memory.
    this.__rootedContents = [ new Uint8Array(REGION_SIZE) ];
    for (let i = 0; i < NUMBER_REGIONS; i ++) {
        this.__rootedContents.push(new Uint8Array(REGION_SIZE));
    }
    this.__contentCounter = 0;
}

Heap.prototype.createRegion = function() {
    const content = this.__rootedContents[this.__contentCounter];
    const beginFrom = this.__contentCounter * REGION_SIZE;
    return new Region(REGION_EDEN, beginFrom, REGION_SIZE, content);
}

// Regions are now fixed as 1MB by a const.
// Each region contains Uint8Array with length 
// GC only cares about regions, and it keeps their information in a preserved area 
// (since we implement in JS runtime, they're stick to v8's native heap as object properties).
function Region(kind, beginFrom, size, content) {
    this.kind = kind;
    this.beginFrom = beginFrom;
    this.size = size;
    this.endAt = beginFrom + size - 1;  // index
    this.content = content;
    // Read how many Slot/byte (Uint8) has been used.
    // at any time content[counter] = the last byte has NOT been occupied.
    this.counter = 0;
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

// Read the first 4 slots (32bit) to get the counter;
Region.prototype.readCounter = function() {
    let counter = this.readUint32(0);
    if (0 === counter) { // new region
        this.counter = 4;
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
        throw new Error("OOM: " + kind);
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
    for(let beginFrom = 4; beginFrom < this.counter;) {    // [0 - 3] is the counter.
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
            return 69;   // 1 + 8 * 8 + 4 (header + 8 slots + address to next)
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

function Allocator(region) {
    this.region = region;
}

// Allocate an object:
// 1. A new Mono is created from a Region and occupies 8 slots with type MONO_OBJECT8.
// 2. A WrappedObject is returned
// 3. If user attach more than 7 properties via WrappedObject#attach,
//    the underlying Mono will create another Mono::MONO_OBJECT8 and point to it to put new properties,
//    at the last 4 bytes.
Allocator.prototype.object = function() {
    const mono = this.region.createMono(MONO_OBJECT_S8);
    
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

function test() {
    const heap = new Heap();
    const testRegion = heap.createRegion();

    console.log("head 4 bytes:",
        testRegion.readUint8(0),
        testRegion.readUint8(1),
        testRegion.readUint8(2),
        testRegion.readUint8(3)
    );

    for (let i = 0, newMono, hostFloat64; i < 4; i ++) {
        hostFloat64 = i + 0.91;
        newMono = testRegion.createMono(MONO_FLOAT64);
        newWrapped = new WrappedFloat64(newMono);
        newWrapped.write(hostFloat64)
        console.log("float64: host value: ", hostFloat64, " read after write: ", newWrapped.read());
    }

    for (let i = 0, newMono, hostInt32; i < 4; i ++) {
        hostInt32 = i * -1;
        newMono = testRegion.createMono(MONO_INT32);
        newWrapped = new WrappedInt32(newMono);
        newWrapped.write(hostInt32)
        console.log("int32: host value: ", hostInt32, " read after write: ", newWrapped.read());
    }

    console.log("region usage: ", testRegion.counter);

    testRegion.traverse((mono) => {
        console.log('traverse mono: ', mono.kind, '[ ', mono.beginFrom, ' - ' , mono.endAt, ' ]');
    })
}

test();