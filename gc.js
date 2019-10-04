
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

    const newRegions = [];

    // { oldRegion.beginFrom (heap): new beginFrom (heap) }
    const newBases = {};

    for (let i = 0; i < lessThan40Keys.length; i ++) {
        if (i >= lessThan60Keys.length) {
            break;
        }
        let regionLessThan40 = byKind.lessThan40[lessThan40Keys[i]];
        let regionLessThan60 = byKind.lessThan60[lessThan60Keys[i]];

        newRegions.push(this.mergeRegions(
            newBases, regionLessThan40, regionLessThan60
        ));
    }

    for (newRegion of newRegions) {
        this.readdressRegion(newBases, newRegion);
    }
}

// We rewrite addresses only after we clone Monos.
// Therefore all pointee address should be valid to de-reference
GC.prototype.rewriteAddress = function(mono, newBases, newRegion) {
    let pointeeRegionBase,
        pointeeRegion,
        pointeeOffset,
        pointeeHeapAddress,
        wrapped,
        newPointeeBase,
        newPointeeHeapAddress;

    switch(mono.kind) {
        case Consts.MONO_ADDRESS:
            wrapped = new WrappedAddress(mono);
            pointeeHeapAddress = newRegion.heap.heapAddress(wrapped.read());
            pointeeRegionBase = pointeeHeapAddress.regionBase();

            if (!newBases[pointeeRegionBase]) {
                return false;   // Don't know how to rewrite it from GC (not touched)
            }

            newPointeeBase = newBases[pointeeRegionBase];
            newPointeeHeapAddress = pointeeHeapAddress.relocate(newPointeeBase);
            wrapped.write(newPointeeHeapAddress.address);
            break;
        case Consts.MONO_ARRAY_S8:
            wrapped = new WrappedArray(mono);
        case Consts.MONO_CHUNK_S8:
            wrapped = wrapped || new WrappedChunk(mono);

            wrapped.traverseChunkAddresses((idx, pointeeHeapRawAddress) => {
                pointeeHeapAddress = newRegion.heap.heapAddress(pointeeHeapRawAddress);
                pointeeRegionBase = pointeeHeapAddress.regionBase();

                newPointeeBase = newBases[pointeeRegionBase];
                if (!newPointeeBase) {
                    return false;
                }
                newPointeeHeapAddress = pointeeHeapAddress.relocate(newPointeeBase);
                wrapped.chunkUpdateAddress(idx, newPointeeHeapAddress.address);
            });
            break;

        case Consts.MONO_INT32:
        case Consts.MONO_FLOAT64:
        default:
            return;
            // Ignore unknown and no need to relocate parts.
    }
}


// For example, 2 old pointers have addresses = # 5 and #1001:
// #[0 - 4] is 5 bytes of region header on region start from # 0
//
// #[5]     is 1 byte  of the Mono header
// #[1001]  is 1 byte  of the Mono header on the lessThan60 (assume it is 500 max)
//
// Now the whole region is moved to # 101 - # 602. The 2 pointers will be re-written as:
// #[101 - 105] is 5 bytes of new region header, new base = #101
// 
// #[106]       is 1 byte  of the new Mono header from #[5]
// #[1602]      is 1 byte  of the new Mono header on the lessThan60,
//              now with new base + offset by the counter (1001 + 101 + 500)
//
GC.prototype.readdressRegion = function(newBases, newRegion) {
    newRegion.traverse((mono) => {
        this.rewriteAddress(mono, newBases, newRegion);
    });
}

GC.prototype.mergeRegions = function(mergedNewBase, lessThan40, lessThan60) {
    // 1. Give a new empty region.
    const newRegion = this.heap.createRegion();
    
    // 2. Give a region represent the later part of a content.
    // Ex: counter = 42; [0 - 41] stored; [42 - ] is the new start of this region.

    // First, clone all the monos to new content , with local offset.
    lessThan40.contentCloneTo(newRegion.content, Consts.REGION_HEAD_SIZE);
    // (NOTE: header of new region 5 bytes *is* included in the counter)
    lessThan60.contentCloneTo(newRegion.content, lessThan40.counter);

    newRegion.counter = lessThan40.counter + lessThan60.counter - Consts.REGION_HEAD_SIZE;
    newRegion.writeCounter();

    // Second, rewrite all heap addresses in the new region Monos.
    mergedNewBase[lessThan40.beginFrom] = newRegion.beginFrom;
    mergedNewBase[lessThan60.beginFrom] = newRegion.beginFrom + lessThan40.counter;
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