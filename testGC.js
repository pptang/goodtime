
const { Heap } = require('./heap');
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

const testMinorGC = () => {
    const heap = new Heap();

    const testARegion = heap.createRegion();
    const testBRegion = heap.createRegion();

    const newArrayMono = testBRegion.createMono(Consts.MONO_ARRAY_S8);
    const wrappedArray = new WrappedArray(newArrayMono);

    for (let i = 0, newMono, hostFloat64; i < 4; i ++) {
        hostFloat64 = i + 0.91;
        newMono = testARegion.createMono(Consts.MONO_FLOAT64);
        newWrapped = new WrappedFloat64(newMono);
        newWrapped.write(hostFloat64)
        wrappedArray.append(newWrapped);
    }

    for (let i = 0, newMono, hostFloat64; i < 4; i ++) {
        hostInt32 = i + -1;
        newMono = testBRegion.createMono(Consts.MONO_INT32);
        newWrapped = new WrappedInt32(newMono);
        newWrapped.write(hostInt32)
        wrappedArray.append(newWrapped);
    }
    console.log(">>>> array length", wrappedArray.length());

    heap.gc.byKinds.young.lessThan40[testARegion.beginFrom] = testARegion;
    heap.gc.byKinds.young.lessThan60[testBRegion.beginFrom] = testBRegion;

    heap.gc.minorGC();
}

testMinorGC();
