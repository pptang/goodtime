const Consts = {};

Consts.REGION_SIZE = 1024000;  // Uint8 * 1024000 = 1MB
Consts.NUMBER_REGIONS = 256;

Consts.REGION_EDEN = 11
Consts.REGION_SURVIVOR = 12;
Consts.REGION_TENURED = 13;
Consts.REGION_HUMOGOUS = 14;
Consts.REGION_HEAD_SIZE = 5;    // 1 kind + 4 counter.

Consts.MONO_INT32 = 1;
Consts.MONO_ADDRESS = 11; 
Consts.MONO_FLOAT64 = 2;
Consts.MONO_ARRAY_S8 = 3;
Consts.MONO_CHUNK_S8 = 31;
Consts.MONO_STRING_S8 = 4;
Consts.MONO_OBJECT_S8 = 5;
Consts.MONO_NAMED_PROPERTY_S8 = 6;   // (addressToStringMono, addressToMono) * 8
Consts.MONO_CHUNK_SIZE = 8;  // 8 elements per chunk.

module.exports = {
    Consts
}