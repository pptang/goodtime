
const { Consts } = require('./consts');
 

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

// @public
function WrappedAddress(mono) {
    this.mono = mono;
}

// @public
WrappedAddress.prototype.read = function() {
    return this.mono.region.readInt32(this.mono.valueFrom);
}

// @public
WrappedAddress.prototype.write = function(hostInt32) {
    return this.mono.region.writeInt32(this.mono.valueFrom, hostInt32);
}

// Which region it belongs to.
WrappedAddress.prototype.belongsTo = function() {
    return this.mono.region.beginFrom;
}

// @public
function WrappedInt32(mono) {
    this.mono = mono;
}

// @public
WrappedInt32.prototype.read = function() {
    return this.mono.region.readInt32(this.mono.valueFrom);
}

// @public
WrappedInt32.prototype.write = function(hostInt32) {
    return this.mono.region.writeInt32(this.mono.valueFrom, hostInt32);
}

// @public
function WrappedFloat64(mono) {
    this.mono = mono;
}

// @public
WrappedFloat64.prototype.read = function() {
    return this.mono.region.readFloat64(this.mono.valueFrom);
}

// @public
WrappedFloat64.prototype.write = function(hostFloat64) {
    return this.mono.region.writeFloat64(this.mono.valueFrom, hostFloat64);
}

function WrappedChunk(mono) {
    this.mono = mono;
    // [ valueFrom ] == 1 byte chunk length.
    // [ valueFrom + 1]  == first element's address
    this.elementsFrom = this.mono.valueFrom + 1;
    this.atChunkLength = this.mono.valueFrom;
    this.atToNext = this.mono.endAt - 3;
}

WrappedChunk.prototype.readChunkLength = function() {
    return this.mono.region.readUint8(this.atChunkLength); 
}

WrappedChunk.prototype.writeChunkLength = function(length) {
    return this.mono.region.writeUint8(this.atChunkLength, length)
}

// Append a new element into the chunk.
// Write address so it will become a pointer.
// 
// Let's say this chunk's first slot is at region address 11: 
// region address: 11 + 0 * 4  - [ 32bits pointer ]
//                 11 + 1 * 4  - [ 32bits pointer ]
//                  ...
WrappedChunk.prototype.chunkAppend = function(wrapped) {
    if (this.isChunkFull()) { return false; }
    const currentLength = this.readChunkLength();

    this.mono.region.writeAddress(
        this.addressFromIndex(currentLength),
        wrapped.mono.heapAddress()
    )
    this.writeChunkLength(currentLength + 1);
}

// Not from wrapped but just an address.
WrappedChunk.prototype.chunkAppendAddress = function(address) {
    if (this.isChunkFull()) { return false; }
    const currentLength = this.readChunkLength();

    this.mono.region.writeAddress(
        this.addressFromIndex(currentLength),
        address
    );
    this.writeChunkLength(currentLength + 1);
}

WrappedChunk.prototype.chunkUpdateAddress = function(index, address) {
    const currentLength = this.readChunkLength();
    if (index < 0 || index >= currentLength) {
        return false;
    }

    this.mono.region.writeAddress(
        this.addressFromIndex(index),
        address
    );
}

WrappedChunk.prototype.chunkIndex = function(idxChunk) {
    const monoAt = this.addressFromIndex(idxChunk);

    // Get heap address stored in the chunk, at a region local address.
    const monoAddress = this.mono.region.readAddress(monoAt);

    // Get element from the heap via heap address.
    const fetched = this.mono.region.heap.fetchMono(monoAddress);
    return new Wrapped(fetched);
}

// Read all addresses in one chunk.
WrappedChunk.prototype.traverseChunkAddresses = function(icb) {
    console.log('>>>> >>>> readChunkLength: ', this.readChunkLength());
    for (let i = 0, localAddress;
         i < this.readChunkLength(); i ++)
    {
        localAddress = this.addressFromIndex(i);
    console.log('>>>>> traverseChunkAddresses', i, localAddress);
        icb(i, this.mono.region.readAddress(localAddress));
    } 
}


// Debugging function.
// Return a `{ localAddress: heapAddress }` object
WrappedChunk.prototype.chunkToHost = function() {
    const result = {};
    this.traverseChunkAddresses((i, address) => {
        localAddress = this.addressFromIndex(i);
        result[localAddress] =
            this.mono.region.readAddress(localAddress);
    });

    return result;
}

WrappedChunk.prototype.setChunkNext = function(heapAddress) {
    this.mono.region.writeAddress(this.atToNext, heapAddress);
}

WrappedChunk.prototype.fetchNextChunk = function() {
    // from latest [-3, -2, -1, -0] is the address of the next chunk.
    const nextChunkAddress = this.mono.region.readAddress(this.atToNext);
    if (0 === nextChunkAddress) {  // not connected to next chunk yet.
        return false;
    }
    const nextChunkMono = this.mono.region.heap.fetchMono(nextChunkAddress);
    return new WrappedChunk(nextChunkMono);
}

WrappedChunk.prototype.isChunkFull = function(wrapped) {
    const length = this.readChunkLength();
    if (length + 1 > Consts.MONO_CHUNK_SIZE) {
        return true;
    }
    return false;
}

// Region local address from index.
WrappedChunk.prototype.addressFromIndex = function(idx) {
    return this.elementsFrom + idx * 4;
}

// Dynamic typed array.
// So it can only contain addresses of monos, actually.
// And since we have all data structures in immutable,
// operations will all allocate a new array while re-addressing old elements.
//
// @public
function WrappedArray(mono) {
    this.mono = mono;
    // First 4 bytes are length.
    // Then 1 byte for chunk length (init chunk is connected with array mono header)
    this.elementsFrom = this.mono.valueFrom + 5;
    this.atLength = this.mono.valueFrom;            // [ 1 - 4 ] is array length, here: [1]
    this.atChunkLength = this.mono.valueFrom + 4;   // [ 5 ] is default chunk length, here: [5]
    this.atToNext = this.mono.endAt - 3;            // [-3 - -0] is address (pointer) to next chunk
}


// @public
WrappedArray.prototype.index = function(idx) {
    const length = this.readLength();
    if (idx >= length || idx < 0) {
        throw new Error("Index out of range: " + idx + ' vs. ' + length);
    }
    let [_, latestChunk] = this.findChunk(idx);
    if (latestChunk === false) {
        throw new Error("Cannot find target chunk");
    }
    const idxChunk = idx % 8;
    return latestChunk.chunkIndex(idxChunk);
}

// @public
WrappedArray.prototype.append = function(wrapped) {
    const length = this.readLength();
    let [latestValidChunk, latestChunk] = this.findChunk(length); // [ length ] is the lastest empty slot to append.

    // array[length] to append at the next chunk is not yet there.
    // Like, now it tries to append at array[8] == chunk#1, while array[0 - 7] is at chunk#0
    // array[15] OK if one connected; array[16]
    if (latestChunk === false || latestChunk.isChunkFull()) {
        // allocate a new chunk (may trigger GC)
        const newChunk = this.mono.region.heap.allocator.chunk();

        // If it is just full then latestValidChunk == latestChunk.
        latestValidChunk.setChunkNext(newChunk.mono.heapAddress());
        latestChunk = newChunk;
    }
    latestChunk.chunkAppend(wrapped);
    this.writeLength(length + 1);
}

// Clone addresses in each chunk to new array.
// The underlying `chunkIndex` and `chunkAppend` will
// fetch the mono, wrap it, return without dispatching,
// then get its heap address to store.
//
// Some overhead could be avoidable if we directly access
// and copy the address without wrapping.
//
// @public
WrappedArray.prototype.clone = function(from, to) {
    const newArray = this.mono.region.heap.allocator.array();
    for (let i = 0; i < this.length(); i ++) {
        newArray.append(this.index(i));
    }
    return newArray;
}

// @public
WrappedArray.prototype.cloneFromTo = function(from, to) {
    const currentLength = this.readLength();
    if (from < 0 || from >= currentLength) {
        throw new Error("Invalid clone from: ", from, to);
    }
    if (to < from || to >= currentLength) {
        throw new Error("Invalid clone to: ", to, to);
    }
    const newArray = this.mono.region.heap.allocator.array();
    for (let i = from; i <= to; i ++) {
        newArray.append(this.index(i));
    }
    return newArray;
}

// Slow, expensive but we have no time for clever methods.
// TODO: should have better method.
WrappedArray.prototype.concat = function(second) {
    const newArray = this.mono.region.heap.allocator.array();
    for (let i = 0; i < this.readLength(); i ++) {
        newArray.append(this.index(i));
    }
    for (let i = 0; i < second.readLength(); i ++) {
        newArray.append(second.index(i));
    }
    return newArray;
}

// @public
WrappedArray.prototype.length = function() {
    return this.readLength();
}

WrappedArray.prototype.readLength = function() {
    // NOTE: since we used Uint8 array, default should be 0,
    // so the new array will have 0 length as we want.
    return this.mono.region.readUint32(this.atLength);
}

WrappedArray.prototype.writeLength = function(length) {
    this.mono.region.writeUint32(this.atLength, length);
}

// Chunk funtions here is for the default chunk allocated along with the Array.

WrappedArray.prototype.readChunkLength = function() {
   return WrappedChunk.prototype.readChunkLength.apply(this, []);
}

WrappedArray.prototype.writeChunkLength = function(length) {
    return WrappedChunk.prototype.writeChunkLength.apply(this, [length]);
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

WrappedArray.prototype.chunkAppendAddress = function(address) {
    return WrappedChunk.prototype.chunkAppendAddress.apply(this, [address]);
}

WrappedArray.prototype.chunkUpdateAddress = function(index, address) {
    return WrappedChunk.prototype.chunkUpdateAddress.apply(this, [index, address]);
}

WrappedArray.prototype.chunkToHost = function() {
    return WrappedChunk.prototype.chunkToHost.apply(this, []);
}

WrappedArray.prototype.setChunkNext = function(heapAddress) {
    return WrappedChunk.prototype.setChunkNext.apply(this, [heapAddress]);
}

WrappedArray.prototype.addressFromIndex = function(idx) {
    return WrappedChunk.prototype.addressFromIndex.apply(this, [idx]);
}

WrappedArray.prototype.traverseChunkAddresses = function(icb) {
    return WrappedChunk.prototype.traverseChunkAddresses.apply(this, [icb]);
}

WrappedArray.prototype.fetchNextChunk = function() {
    return WrappedChunk.prototype.fetchNextChunk.apply(this, []);
}

// Given index, give chunk it should be in.
WrappedArray.prototype.findChunk = function(idx) {
    const targetChunkId = (idx/Consts.MONO_CHUNK_SIZE>>0);
    let targetChunk;
    if (0 === targetChunkId) {  // this array base + default chunk.
        targetChunk = this;
    } else {
        let validChunk = this
        let fetchedChunk = this;
        for (let chunkId = 0; chunkId < targetChunkId; chunkId ++) {
            fetchedChunk = validChunk.fetchNextChunk();
            if (false === fetchedChunk) {
                return [validChunk, false];
            }
            validChunk = fetchedChunk;

        }
        targetChunk = fetchedChunk;
    }
    return [targetChunk, targetChunk];
}

WrappedArray.prototype.traverseChunks = function(cb) {
    const latestChunkId = ((this.length() - 1)/Consts.MONO_CHUNK_SIZE>>0);

    if (0 === latestChunkId) {  // this array base + default chunk.
        cb(this);
    } else {
        let validChunk = this
        let fetchedChunk = this;
        for (let chunkId = 0; chunkId < latestChunkId; chunkId ++) {
            fetchedChunk = validChunk.fetchNextChunk()
            if (false === fetchedChunk) {
                return; // latest chunk will has invalid next chunk.
            }
            cb(validChunk);
            validChunk = fetchedChunk;
        }
    }
}


WrappedArray.prototype.lastestChunk = function() {
    const [_, latestChunk] = this.findChunk(this.length() - 1);
    if (!lastChunk) {
        throw new Error("Index wrong to find latestChunk");
    }
    return latestChunk;
}


function Wrapped(mono) {
    this.mono = mono;
}

// TODO: return Monad to encapsulate operations.

// From generic Wrapped to like WrappedFloat64, according to the mono kind.
Wrapped.prototype.dispatch = function() {
    switch (this.mono.kind) {
        case Consts.MONO_INT32:
            return new WrappedInt32(this.mono);
        case Consts.MONO_ADDRESS:
            return this;    // TODO
        case Consts.MONO_FLOAT64:
            return new WrappedFloat64(this.mono);
        case Consts.MONO_ARRAY_S8:
            return new WrappedArray(this.mono);
        case Consts.MONO_STRING_S8:
            return this;    // TODO
        case Consts.MONO_OBJECT_S8:
            return this;    // TODO
        case Consts.MONO_NAMED_PROPERTY_S8:
            return this;    // TODO
        default:
            throw new Error("Wrong Mono kind: " + this.mono.kind)
    }
}

Wrapped.prototype.read = function() {
    return null;
}

module.exports = {
    Wrapped,
    WrappedArray,
    WrappedChunk,
    WrappedFloat64,
    WrappedAddress,
    WrappedInt32,
    WrappedObject
}