// Heap module uses typed array to simulate what G1GC does.
// We cannot really get benefit from what G1GC achieves,
// but we just simulate its flow.

// We cannot easily have 64bit address since JavaScript has limited safe integer less than that.
// And we don't have unsigned integer either...
// Therefore let's just have address < 2^64.

const MIN_NUMBER_REGIONS = 256      // 256MB if region size = 262144
const MIN_REGION_SIZE_32 = 262144;  // 1MB = how many 32bits
const MAX_ADDRESS = 4294967296;     // 2^32; we can have 16384 regions if it's all by MINs above.
const NUMBER_EDENS = 4;

function Heap(numberRegions, configs) {

    this.regionSize32 = configs.regionSize32 ? configs.regionSize32 : MIN_REGION_SIZE_32;
    this.numberEdens = configs.numberEdens ? configs.numberEdens : NUMBER_EDENS;

    if (numberRegions < this.numberEdens + 1) {
        throw new Error(
            "NUmber of regions (" + numberRegions + ") must larger than num of edens ("+ this.numberEdens +") + 1")
    }
    this.numberRegions = numberRegions;

    this.__rootedContents = [ new Uint32Array(this.regionSize32) ];

    // `regionBook` keeps all beging addresses of regions.
    // It's preserved area will keep alive as long as the program.
    this.regionBook = new Region(0, this.regionSize32, this.__rootedContents[0]);

    // Yes yes they're contingous since we don't have real memory,
    // so there is no reason to find holes in the "memory" at the beginning.
    for (let ieden = 0; ieden < this.numberEdens; ieden += 1) {
        this.regionBook.intaddr(this.regionBook.endAt + ieden);

        // We need this 'root' to prevent an unreferenced typed array gone.
        // This is because we don't control the real memory.
        this.__rootedContents.push(new Uint32Array(this.regionSize32));
    } 

}

// Each region has 32bit * size32; MIN is 1MB.
// The min cell in region could be a pointer (address in 32bit) to the real position.
// `content` is the real place (Uint32Array by `size32`) which may already store somethings.
// And `content[0]` is alreays a 32bit counter of the last element in the region content array.
function Region(beginFrom = 0, size32, content) {

    if (!!(size32) || size32 < MIN_REGION_SIZE_32) {
        throw new Error("Minimum region size is 1MB (262144 * 32 bits) (" + size32+ ")");
    }
    if (beginFrom + size32 > MAX_ADDRESS) {
        throw new Error("Region address overflow. At: " + beginFrom+ ", size:" + size32 + "")
    }

    this.content = content
    this.size = size32;
    this.beginFrom = beginFrom;
    this.endAt = beginFrom + size32;
}

// Each region will use the [0] Uint32 as the index of where the last element is.

// If this returns false, GC should try to clean this region up,
// And then if it is still impossible to use the region,
// heap should try to use another one.
//
// If this returns an index (NOT an address),
// it is the new index can be put something as Int32.
Region.prototype.capable = function(n = 1) {
    if (this.content[0]+n > this.size) {
        return false;
    }
    this.content[0] += 1;
    return this.content[0];
}

// Allocate an int/address
Region.prototype.intaddr = function(intaddr) {
    const at = this.capable();
    if (at === false) {
        return false;
    }
    this.content[at] = intaddr;
    return at;
}

// Allocate a character from JS string.
// Print back from `String.fromCodePoint`
Region.prototype.char = function(c) {
    const at = this.capable();
    if (at === false) {
        return false;
    }
    this.content[at] = c.codePointAt(0)
    return at;
}