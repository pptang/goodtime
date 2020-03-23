package heap

import (
	"bytes"
	"encoding/binary"
	"errors"
	"fmt"
)

// Heap has have regions.
// When a new thing needs to be allocated,
// Allocator will try to re-use regions it keeps.
// If there is no enough empty regions, it will ask Heap for more.
// Heap may trigger a minor GC before it gives a new region out.
// If minor GC is not enough, a full GC will be triggered.
// The worst case is memory leaks and no region available anymore.
// Then the Heap will throw a OOM (program crashed)

const REGION_SIZE = 1024000 // Uint8 * 1024000 = 1MB
const NUMBER_REGIONS = 256

const REGION_EDEN = 11
const REGION_SURVIVOR = 12
const REGION_TENURED = 13
const REGION_HUMOGOUS = 14

const MONO_INT32 = 1
const MONO_ADDRESS = 11
const MONO_FLOAT64 = 2
const MONO_ARRAY_S8 = 3
const MONO_CHUNK_S8 = 31
const MONO_STRING_S8 = 4
const MONO_OBJECT_S8 = 5
const MONO_NAMED_PROPERTY_S8 = 6 // (addressToStringMono, addressToMono) * 8

const MONO_CHUNK_SIZE = 8 // 8 elements per chunk.

type Heap struct {
	content        [][]byte
	contentCounter uint64
}

// Regions are now fixed as 1MB by a const REGION_SIZE.
// Each region contains byte array with length
// Our GC only cares about regions, and it keeps their information in a preserved area
type Region struct {
	// Ref back to the heap
	heap *Heap

	// How large this region is
	size uint32

	// At the heap, the address the first meaningful byte of this region
	beginFrom uint64

	// At the heap, the address the last meaningful byte of this region
	endAt uint64

	// The byte array for storing things.
	// Other fields are meta info and helpers.
	content []byte

	// Read how many Slot/byte has been used.
	// At any time `content[counter]` is the last byte has NOT been occupied.
	counter uint64

	// Flag of what kind of this region is.
	// Like, an Eden, or a humogous region.
	kind int64
}

// Mono is a thing composes of bytes, correspond to one thing the guest language
// want to store on the heap, with a header records its length (how many bytes it equals to), kind, etc.
//
// Mono kinds are defined at the head part of this file.
// For example, `MONO_FLOAT64` means the guest language want to store a float64 on the heap,
// while `MONO_ARRAY_S8` means a array on the heap, which has fixed size 8, thus can contain 8 pointers inside.
//
// Some Monos have pointer addresses to other Monos. GC may change it if the
// target is moved.
//
// Address could cross regions. Regions have boundary by their
// `beginFrom` and `endAt` properties, so to have a address over the boundary
// meaning a cross-region reference.
//
// Pointer address to another mono must point to Mono's header, namely the first meaningful byte for this Mono.
//
// For address and offset fields in a mono:
//
// Heap address  [ #81| #82| #83| #84| #85| ...|...]
// Region:       [ #0 | #1 | #2 | #3 | #4 | ...]
// Mono:                   [ #0 | #1 | #2 ]
//
// --> Mono.beginFrom = 83
// --> Mono.endAt = 85
// --> Mono.beginOffset = 2
// --> Mono.endOffset = 4
//
type Mono struct {
	region *Region

	// 1 byte flag
	kind byte

	// **Heap addresses** where this Mono begins from and ends at.
	beginFrom uint64
	endAt     uint64

	// beginFrom +  1 byte; where to start to read the value.
	valueFrom uint64

	// **region offsets**: how many bytes far from the beginning of the regions.
	beginOffset uint32
	endOffset   uint32
}

// Our "memory" the where whole guest language lives in.
func NewHeap() *Heap {
	// Pre-allocated all regions.
	content := make([][]byte, 0)
	for i := 0; i < NUMBER_REGIONS; i++ {
		content = append(content, make([]byte, REGION_SIZE))
	}
	return &Heap{
		content:        content,
		contentCounter: 0,
	}
}

// On the heap, form a Region from a content block.
//
// Region vs. Content block on the heap:
// Content is just a bunch of memory, so we cannot use Region's methods
// until we form/create a Region for it. Then the Region will know
// how to read/write to its content memory.
//
func (heap *Heap) RegionFromContent(beginFrom uint64, size uint32, content []byte) *Region {
	region := &Region{
		heap:      heap,
		size:      size,
		beginFrom: beginFrom,
		endAt:     beginFrom + REGION_SIZE - 1,

		// To link the content already allocated.
		content: content,

		// Default kind is Eden.
		kind: 0,
	}

	// Since it is formed from a content, we read region data stored in the content block.
	region.ReadKind()
	region.ReadCounter()
	return region
}

// On the heap, create a totally new Region with the last unoccupied content block.
func (heap *Heap) NewRegion() *Region {
	// The last unoccupied content block.
	content := heap.content[heap.contentCounter]
	beginFrom := heap.contentCounter * REGION_SIZE
	return &Region{
		heap:      heap,
		size:      REGION_SIZE,
		beginFrom: beginFrom,
		endAt:     beginFrom + REGION_SIZE - 1,

		// To link the content already allocated.
		content: content,

		// Default kind is Eden.
		kind: 0,
	}
}

// All these read/write functions' `at` is the offset inside the region (from 0 to 1MB).
// Heap address need to be translated before being used here (by `address - region.beginFrom`)

// And all these write is for host value, while read is also to host value.
// By default reads and writes are in LittleEdian.

// Why there are so many names of type like Uint8, Uint32, etc., is because although
// we can determinate the host language type (Go's uint8, uint32, etc.),
// we need to provide the language implmenetation direct methods correspond to
// guest types. So for example, `ReadUint8` means guest language implementation's `uint8`,
// not really for Go's.

func (region *Region) ReadUint8(at uint32) (uint8, error) {
	if at > region.size || at < 0 {
		return 0, errors.New(fmt.Sprintf("Read from address out of range: %#v", at))
	}

	// 1 byte = 1 unit8.
	return region.content[at], nil
}

func (region *Region) ReadUint32(at uint32) (uint32, error) {
	if at > region.size || at < 0 {
		return 0, errors.New(fmt.Sprintf("Read from address out of range: %#v", at))
	}

	// Read from the `at`.
	return binary.LittleEndian.Uint32(region.content[at:]), nil
}

func (region *Region) ReadInt8(at uint32) (int8, error) {
	if at > region.size || at < 0 {
		return 0, errors.New(fmt.Sprintf("Read from address out of range: %#v", at))
	}

	return int8(region.content[at]), nil
}

func (region *Region) ReadInt32(at uint32) (int32, error) {
	if at > region.size || at < 0 {
		return 0, errors.New(fmt.Sprintf("Read from address out of range: %#v", at))
	}

	// Read from the `at`.
	return int32(binary.LittleEndian.Uint32(region.content[at:])), nil
}

func (region *Region) ReadFloat32(at uint32) (float32, error) {
	if at > region.size || at+4 > region.size || at < 0 {
		return 0, errors.New(fmt.Sprintf("Read from address out of range: %#v", at))
	}

	// Read from the `at` then convert to Float32
	var result float32
	buf := bytes.NewReader(region.content[at:])
	err := binary.Read(buf, binary.LittleEndian, &result)
	if err != nil {
		return 0, err
	}
	return result, err
}

func (region *Region) ReadFloat64(at uint32) (float64, error) {
	if at > region.size || at+8 > region.size || at < 0 {
		return 0, errors.New(fmt.Sprintf("Read from address out of range: %#v", at))
	}

	// Read from the `at` then convert to Float64
	var result float64
	buf := bytes.NewReader(region.content[at:])
	err := binary.Read(buf, binary.LittleEndian, &result)
	if err != nil {
		return 0, err
	}
	return result, err
}

func (region *Region) WriteUint8(at uint32, i uint8) error {
	if at+1 > region.size || at < 0 {
		return errors.New(fmt.Sprintf("Write at address out of range: %#v", at))
	}

	// 1 byte = 1 unit8.
	region.content[at] = byte(i)
	return nil
}

func (region *Region) WriteUint32(at uint32, i uint32) error {
	if at+4 > region.size || at < 0 {
		return errors.New(fmt.Sprintf("Write at address out of range: %#v", at))
	}

	bytes.NewBuffer(region.content[at:])
	err := binary.Write(bytes.NewBuffer(region.content[at:]), binary.LittleEndian, i)
	if err != nil {
		return err
	}
	return nil
}

func (region *Region) WriteAddress(at uint32, address uint32) error {
	return region.WriteUint32(at, address)
}

func (region *Region) WriteInt8(at uint32, i int8) error {
	if at+1 > region.size || at < 0 {
		return errors.New(fmt.Sprintf("Write at address out of range: %#v", at))
	}

	// 1 byte = 1 unit8.
	region.content[at] = byte(i)
	return nil
}

func (region *Region) WriteInt32(at uint32, i int32) error {
	if at+4 > region.size || at < 0 {
		return errors.New(fmt.Sprintf("Write at address out of range: %#v", at))
	}

	bytes.NewBuffer(region.content[at:])
	err := binary.Write(bytes.NewBuffer(region.content[at:]), binary.LittleEndian, i)
	if err != nil {
		return err
	}
	return nil
}

func (region *Region) WriteFloat32(at uint32, f float32) error {
	if at+4 > region.size || at < 0 {
		return errors.New(fmt.Sprintf("Write at address out of range: %#v", at))
	}

	bytes.NewBuffer(region.content[at:])
	err := binary.Write(bytes.NewBuffer(region.content[at:]), binary.LittleEndian, f)
	if err != nil {
		return err
	}
	return nil
}

func (region *Region) WriteFloat64(at uint32, f float64) error {
	if at+8 > region.size || at < 0 {
		return errors.New(fmt.Sprintf("Write at address out of range: %#v", at))
	}

	bytes.NewBuffer(region.content[at:])
	err := binary.Write(bytes.NewBuffer(region.content[at:]), binary.LittleEndian, f)
	if err != nil {
		return err
	}
	return nil
}

func (region *Region) NewMono(kind byte, beginFrom uint64) (*Mono, error) {

	monoSize, err := monoSizeFromKind(kind)
	if err != nil {
		return nil, err
	}

	return &Mono{
		region:    region,
		kind:      kind,
		beginFrom: beginFrom,
		endAt:     beginFrom + monoSize,
		valueFrom: beginFrom,
	}, nil
}

func monoSizeFromKind(kind byte) (uint64, error) {
	switch kind {
	case MONO_INT32:
	case MONO_ADDRESS:
		// 1 + 4 (header: 1 byte + int32)
		return 5, nil
	case MONO_FLOAT64:
		// 1 + 8
		return 9, nil
	case MONO_ARRAY_S8:
		// 1 + 4 + 1 + 4 * 8 + 4 (header + array length + init chunk length + 8 slots + address to next)
		return 42, nil
	case MONO_CHUNK_S8:
		// 1 + 1 + 4 * 8 + 4 (header + chunk length + 8 slots + address to next)
		return 38, nil
	case MONO_STRING_S8:
		// 1 + 8 * 8 + 4 (header + 8 slots + address to next)
		return 69, nil
	case MONO_OBJECT_S8:
		// 1 + 8 * 8  + 4 + 4 (header + 8 slots + address to name/address dict + address to next)
		return 73, nil
	case MONO_NAMED_PROPERTY_S8:
		// 1 + (4 + 4) * 8 + 4 (header + address pairs + address to next)
		return 73, nil
	default:
		return 0, errors.New(fmt.Sprintf("Wrong Mono kind: #%v", kind))
	}
}

// Write header information onto region content.
// REMEMBER TO CALL THIS for any newly created Mono.
func (mono *Mono) WriteHeader() error {
	return mono.region.WriteUint8(mono.beginFrom, mono.kind)
}

// Fetch a mono from the heap by address, not from a region by an offset.
func (heap *Heap) FetchMono(address uint64) (*Mono, error) {
	regionIndex := (address / REGION_SIZE >> 0)
	if regionIndex > NUMBER_REGIONS {
		return nil, errors.New(fmt.Sprintf("Address out of Region range: #%v", address))
	}

	// Find the headless content block.
	//
	// Content is just bunch of memory and thus we cannot use Region's methods
	// before we form/create the Region for it.
	content := heap.content[regionIndex]
	contentIndex := address % REGION_SIZE // index inside the region.

	// From the target content, form the Region, so we can use its methods.
	beginFrom := regionIndex * REGION_SIZE
	region := NewRegion(heap, beginFrom, REGION_SIZE, content)

	monoKind := content[contentIndex]              // 1 byte header uint8 can be read directly.
	return NewMono(region, monoKind, contentIndex) // beginFrom of Mono is inside the region
}
