
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

function GC(heap) {
    this.heap = heap;

    this.byKinds = {
        young: {
            lessThan60: {},
            lessThan40: {}
        },
        old: {
            lessThan60: {},
            lessThan40: {} 
        }
    };
}

// Operate on Eden and Survivor regions only.
// NOTE: allocator need to be changed after GC!
// Since regions it holds may be changed as well. 
//
GC.prototype.minorGC = function() {
    const byKind = this.byKinds.young;

    const lessThan60Keys = Object.keys(byKind.lessThan60);
    const lessThan40Keys = Object.keys(byKind.lessThan40);

    for (let i = 0; i < lessThan40Keys.length; i ++) {
        if (i >= lessThan60Keys.length) {
            break;
        }
        let regionLessThan40 = byKind.lessThan40[lessThan40Keys[i]];
        let regionLessThan60 = byKind.lessThan60[lessThan60Keys[i]];
        this.mergeRegions(
            byKind, {}, regionLessThan40, regionLessThan60
        );
    }
}

GC.prototype.mergeRegions = function(byKind, mergedNewBase, lessThan40, lessThan60) {

    // 1. Give a new empty region.
    const newRegion = this.heap.createRegion();
    // 2. Record these 2 regions merge to new region in mergedNewBase
    //
    // There is an offset:
    // new region = [#0 .. #lessThan40.counter - 1, #lessThan40.counter = lessThan60[0] .. lessThan60[end of region] ]
    mergedNewBase[lessThan40.beginFrom] = newRegion.beginFrom;
    mergedNewBase[lessThan60.beginFrom] = newRegion.beginFrom + lessThan40.counter;

    // 3. Copy Monos in lessThan40 one by one,
    //    and rewrite all heapAddress if it holds any pointer.
    //
    // How to change the pointee address:
    //
    // 1. Encounter a pointer, get the heap address
    // 2. From the heap address, get the region
    // 3. From mergedNewBase, check if the pointee is merged by this GC
    // 4. If so, generate a new heap address with the new region
    // 5. Overwrite the old address with newly generated one
    const mergeCallback = (mono) => {
        let pointeeRegion,
            pointeeOffset,
            pointeeHeapAddress,
            wrapped,
            newMono,
            newWrapped,
            newPointeeBase,
            newPointeeHeapAddress;

        switch(mono.kind) {
            case Consts.MONO_ADDRESS:
                wrapped = new WrappedAddress(mono);
                pointeeHeapAddress = wrapped.read();
                pointeeRegion = this.heap.fetchRegion(pointeeHeapAddress);

                // Old:
                // [#3 , [#7 , #8 , #9 ]] -> 7 - 3 = 4, to new:
                // [#11, [#15, #16, #17]] -> 11 + 4 = 15
                pointeeOffset = pointeeHeapAddress - pointeeRegion.beginFrom;

                if (mergedNewBase[pointeeRegion.beginFrom]) {
                    newPointeeBase = mergedNewBase[pointeeRegion.beginFrom];
                    newPointeeHeapAddress = newPointeeBase + pointeeOffset
                }

                // Okay we now create new mono on merged new region.
                newMono = newRegion.createMono(mono.kind);
                // Then copy what the original mono has with new heap address.
                newWrapped = new WrappedAddress(mono);

                // *if* need and already there is a new pointee heap address
                // on the newly merged region.
                //
                // Otherwise, just copy the old heap address to newly mono on the newly merged region. 
                newWrapped.write(newHeapAddress || wrapped.read());
                    
                break;
            case Consts.MONO_ARRAY_S8:
                wrapped = new WrappedArray(mono);
                newMono = newRegion.createMono(mono.kind);
                newWrapped = new WrappedArray(newMono)
            case Consts.MONO_CHUNK_S8:
                wrapped = wrapped || new WrappedChunk(mono);
                newMono = newMono || newRegion.createMono(mono.kind);
                newWrapped = newWrapped || new WrappedChunk(newMono)

                wrapped.traverseChunkAddresses((idx, pointeeHeapAddress) => {
                    pointeeRegion = this.heap.fetchRegion(pointeeHeapAddress);
                    pointeeOffset = pointeeHeapAddress - pointeeRegion.beginFrom;
                    if (mergedNewBase[pointeeRegion.beginFrom]) {
                        newPointeeBase = mergedNewBase[pointeeRegion.beginFrom];
                        newPointeeHeapAddress = newPointeeBase + pointeeOffset;
                    }
                    // *if* need and already there is a new pointee heap address
                    // on the newly merged region.
                    //
                    // Otherwise, just copy the old heap address to newly mono on the newly merged region. 
                    newWrapped.chunkAppendAddress(newPointeeHeapAddress || pointeeHeapAddress);
                    console.log("...debug for read back merged heap address: #",
                        idx, pointeeHeapAddress, ' to: ', newPointeeHeapAddress , ' with ' ,  newWrapped.chunkIndex(idx).dispatch().read()
                    );
                });
                break;

            case Consts.MONO_INT32:
                wrapped = new WrappedInt32(mono);
                newMono = newRegion.createMono(mono.kind);
                newWrapped = new WrappedInt32(newMono);
            case Consts.MONO_FLOAT64:
                wrapped = new WrappedFloat64(mono);
                newMono = newRegion.createMono(mono.kind);
                newWrapped = new WrappedFloat64(newMono);

                newWrapped.write(wrapped.read());
                break;
            default:
                return;
                // Ignore unknown parts.
        }
    }

    lessThan40.traverse(mergeCallback);
    lessThan60.traverse(mergeCallback);
    return newRegion;
}


// A lazy way to maintain usages.
GC.prototype.updateUsage = function(byKind, region) {
    // Assume it has wrote to `this.counter`.
    const ratio = region.counter/REGION_SIZE;
    let category, opposite;
    if (ratio < 0.4) {
        category = byKind.lessThan60;
        opposite = byKind.lessThan40;

    } else {
        category = byKind.lessThan40;
        opposite = byKind.lessThan60;
    }

    if (!category[region.beginFrom]) {
        category[region.beginFrom] = region;
    }

    if (opposite[region.beginFrom]) {
        delete opposite[region.beginFrom];
    }
}

module.exports = {
    GC
}