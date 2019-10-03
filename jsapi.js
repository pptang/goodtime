
// Inputs and outputs are wrapped values.
// TODO: need an immutable monad with embedded flow.

function NewArray() {
    const newArray = this.mono.region.heap.allocator.array();
    return newArray;
}

function ArrayPop(wrappedArray) {
    // check length.
    const lastIndex = wrappedArray.length() - 1;
    return [
        ArraySlice(wrappedArray,  0, lastIndex - 1),
        wrappedArray.index(lastIndex).dispatch()
    ];
}

function ArrayShift(wrappedArray) {
    // TODO: check length.
    return [
        ArraySlice(wrappedArray, 1, wrappedArray.length() - 1),
        wrappedArray.index(0).dispatch()
    ];
}

function ArrayConcat(firstWrappedArray, secondWrappedArray) {
    return firstWrappedArray.concat(secondWrappedArray);
}

function ArrayRemove(wrappedArray, idx) {
    const currentLength = wrappedArray.length();
    if (idx < 0 || idx >= currentLength) {
        // TODO: should be a part cannot throw?
        throw new Error("Index out of range: ", idx, ' vs ', currentLength);
    }
    if (idx === 0) {
        return ArrayShift(wrappedArray);
    } else if (idx === currentLength - 1) {
        return ArrayPop(wrappedArray);
    } else {
        const firstPart = ArraySlice(wrappedArray, 0, idx - 1);
        const secondPart = ArraySlice(wrappedArray, idx + 1, currentLength - 1);
        return [ArrayConcat(firstPart, secondPart), wrappedArray.index(idx)];
    }
}

function ArraySlice(wrappedArray, fromInt, toInt) {
    const newArray = wrappedArray.cloneFromTo(fromInt, toInt);
    return newArray;
}

function ArrayIndex(wrappedArray, idx) {
    return wrappedArray.index(idx).dispatch();
}

function ArrayLength(wrappedArray) {
    return wrappedArray.length();
}

function ArrayPush(wrappedArray, wrappedValue) {
    const newArray = wrappedArray.clone();
    newArray.append(wrappedValue);
    return newArray;
}

function testJSAPI() {
    const { Heap } = require('./heap');
    const heap = new Heap();
    let wrappedArray = heap.allocator.array();
    for (let i = 0, newFloat64, newInt32; i < 12; i ++) {
        newInt32 = heap.allocator.int32(i * -1);
        newFloat64 = heap.allocator.float64(i + 1.9);
        wrappedArray.append(newFloat64);
        wrappedArray.append(newInt32);
    }

    const newWrappedArray = ArrayPush(wrappedArray, heap.allocator.int32(-1025));
    const wrappedLatest = ArrayIndex(newWrappedArray, ArrayLength(newWrappedArray) - 1);
    if (wrappedLatest.read() !== -1025) {
        console.dir(wrappedLatest);
        throw new Error('Push test failed: ' + wrappedLatest.read());
    }

    const slice10To21 = ArraySlice(newWrappedArray, 10, 21);   // 21 - 10 + 1 = 12 length
    if (ArrayIndex(slice10To21, 0).read() !== 6.9 ||
        ArrayIndex(slice10To21, 1).read() !== -5  ||
        ArrayIndex(slice10To21, 9).read() !== -9  ||
        ArrayIndex(slice10To21, 10).read() !== 11.9 ||
        ArrayIndex(slice10To21, 11).read() !== -10)
    {
        throw new Error('Slice test failed');
    }

    const [popped, value] = ArrayPop(slice10To21);
    if (ArrayLength(popped) !== 11 || value.read() !== -10 || ArrayLength(slice10To21) !== 12) {
        console.log(ArrayLength(popped), value.read(), ArrayLength(slice10To21));
        throw new Error('Pop test failed: ');
    }

    const concated = ArrayConcat(slice10To21, slice10To21);
    const shouldBeLength = ArrayLength(slice10To21) * 2;
    if (ArrayLength(concated) !== shouldBeLength) {
        throw new Error('Concat test failed');
    }

    const [shifted, shiftedValue] = ArrayShift(concated);
    if (ArrayLength(shifted) !== 21 && shiftedValue.read() !== 6.9) {
        console.log(ArrayLength(shifted), shiftedValue.read());
        throw new Error('Shift test failed');
    }

    const [deleted0] = ArrayRemove(concated, 0);
    if (ArrayLength(deleted0) !== shouldBeLength - 1) {
        throw new Error('Delete 0 test failed: ' + ArrayLength(deleted0) +  ' vs. ' + (shouldBeLength - 1));
    }
    const [deletedLast] = ArrayRemove(concated, shouldBeLength - 1);
    if (ArrayLength(deletedLast) !== shouldBeLength - 1) {
        throw new Error('Delete last test failed: ');
    }
    const [deleted3] = ArrayRemove(concated, 3);
    if (ArrayLength(deleted3) !== shouldBeLength - 1) {
        console.log(ArrayLength(concated), ArrayLength(deleted3));
        throw new Error('Delete #3 failed: ');
    }


}

//testJSAPI();