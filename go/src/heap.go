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

type address = uint64
type offset = uint32

var ErrorMessageOffsetUnderflow = "Address to offset underflow: %d - %d"
var ErrorMessageOffsetOutOfRange = "Offset out of the range: %d vs. %d"
var ErrorMessageUnknownKind = "Unknown kind: %d"
var ErrorMessageHeapFull = "Heap is full (need GC)"
var ErrorRegionFull = "Region is full: cannot allocate %d bytes"

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
	counter uint32

	// Flag of what kind of this region is.
	// Like, an Eden, or a humogous region.
	kind byte
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
	beginFrom address
	endAt     address

	// beginFrom +  1 byte; where to start to read the value.
	valueFrom address

	// **region offsets**: how many bytes far from the beginning of the regions.
	beginOffset offset
	endOffset   offset
}

type Allocator struct {
	heap    *Heap
	regions []*Region
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
func (heap *Heap) NewRegion() (*Region, error) {
	// The last unoccupied content block.
	content := heap.content[heap.contentCounter]
	beginFrom := heap.contentCounter * REGION_SIZE

	if heap.contentCounter+1 > NUMBER_REGIONS {
		return nil, errors.New(fmt.Sprint(ErrorMessageHeapFull))
	}

	return &Region{
		heap:      heap,
		size:      REGION_SIZE,
		beginFrom: beginFrom,
		endAt:     beginFrom + REGION_SIZE - 1,

		// To link the content already allocated.
		content: content,

		// Default kind is Eden.
		kind: 0,
	}, nil
}

// Fetch a mono from the heap by address, not from a region by an offset.
// The address must point to the header byte of the Mono.
func (heap *Heap) FetchMono(address address) (*Mono, error) {
	// This address is at which content block on the heap.
	contentIndex := (address / REGION_SIZE >> 0)
	if contentIndex > NUMBER_REGIONS {
		return nil, errors.New(fmt.Sprintf("Address out of Region range: #%v", address))
	}

	// Find the headless content block.
	//
	// Content is just bunch of memory and thus we cannot use Region's methods
	// before we form/create the Region for it.
	contentBlock := heap.content[contentIndex]

	// At which region offset the Mono begins from
	monoOffset := offset(address % REGION_SIZE)

	// At which content (ex: #19 begin from #0) * REGION_SIZE = address of the region header.
	regionBeginFrom := contentIndex * REGION_SIZE

	// From the target content, form the Region, so we can use region methods.
	region := heap.RegionFromContent(regionBeginFrom, REGION_SIZE, contentBlock)
	monoKind, err := region.ReadByte(monoOffset)
	if err != nil {
		return nil, err
	}
	return region.NewMono(monoKind, monoOffset)
}

// From heap address to region offset (address - region.beginFrom)
// NOTE: Go doesn't detect underflow! Error is for addresses before the region's beginning.
func (region *Region) offsetFromAddress(address address) (offset, error) {
	offset := offset(address - region.beginFrom)
	if address < region.beginFrom {
		return offset,
			errors.New(fmt.Sprintf(ErrorMessageOffsetUnderflow, address, region.beginFrom))
	}
	return offset, nil
}

// Read the #4 byte from the region beginning to get the region kind.
func (region *Region) ReadKind() error {
	kind, err := region.ReadByte(4)
	if err != nil {
		return err
	}
	if kind == 0 { // new region; mark it as Eden.
		region.kind = REGION_EDEN
		region.WriteKind(REGION_EDEN)
	} else {
		region.kind = kind
	}
	return nil
}

func (region *Region) ReadCounter() error {
	counter, err := region.ReadUint32(0)
	if err != nil {
		return err
	}

	// totally new region; any created region must has its own counter + kind bytes occupied
	if counter == 0 {
		region.counter = 5 // counter + kind
		region.WriteCounter()
	} else {
		region.counter = counter
	}
	return nil
}

// Write the #4 byte for the assigned kind.
func (region *Region) WriteKind(kind byte) error {
	switch kind {
	case REGION_EDEN:
		region.WriteByte(4, kind)
		return nil
	case REGION_SURVIVOR:
		region.WriteByte(4, kind)
		return nil
	case REGION_TENURED:
		region.WriteByte(4, kind)
		return nil
	case REGION_HUMOGOUS:
		region.WriteByte(4, kind)
		return nil
	default:
		return errors.New(fmt.Sprintf(ErrorMessageUnknownKind, kind))
	}
}

// Write the #0 byte for the region kind (uint32, needs 4 bytes)
func (region *Region) WriteCounter() error {
	return region.WriteUint32(0, region.counter)
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

func (region *Region) ReadUint8(at offset) (uint8, error) {
	if at > region.size || at < 0 {
		return 0, errors.New(fmt.Sprintf("Read from address out of range: %#v", at))
	}

	// 1 byte = 1 unit8.
	return region.content[at], nil
}

func (region *Region) ReadByte(at offset) (byte, error) {
	return region.ReadUint8(at)
}

func (region *Region) ReadUint32(at offset) (uint32, error) {
	if at > region.size || at < 0 {
		return 0, errors.New(fmt.Sprintf("Read from address out of range: %#v", at))
	}

	// Read from the `at`.
	return binary.LittleEndian.Uint32(region.content[at:]), nil
}

func (region *Region) ReadUint64(at offset) (uint64, error) {
	if at > region.size || at < 0 {
		return 0, errors.New(fmt.Sprintf("Read from address out of range: %#v", at))
	}

	// Read from the `at`.
	return binary.LittleEndian.Uint64(region.content[at:]), nil
}

func (region *Region) ReadAddress(at offset) (address, error) {
	return region.ReadUint64(at)
}

func (region *Region) ReadInt8(at offset) (int8, error) {
	if at > region.size || at < 0 {
		return 0, errors.New(fmt.Sprintf("Read from address out of range: %#v", at))
	}

	return int8(region.content[at]), nil
}

func (region *Region) ReadInt32(at offset) (int32, error) {
	if at > region.size || at < 0 {
		return 0, errors.New(fmt.Sprintf("Read from address out of range: %#v", at))
	}

	// Read from the `at`.
	return int32(binary.LittleEndian.Uint32(region.content[at:])), nil
}

func (region *Region) ReadFloat32(at offset) (float32, error) {
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

func (region *Region) ReadFloat64(at offset) (float64, error) {
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

func (region *Region) WriteUint8(at offset, i uint8) error {
	if at+1 > region.size || at < 0 {
		return errors.New(fmt.Sprintf("Write at address out of range: %#v", at))
	}

	// 1 byte = 1 unit8.
	region.content[at] = byte(i)
	return nil
}

func (region *Region) WriteByte(at offset, i byte) error {
	// 1 byte = 1 unit8.
	return region.WriteUint8(at, i)
}

func (region *Region) WriteUint32(at offset, i uint32) error {
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

func (region *Region) WriteUint64(at offset, i uint64) error {
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

func (region *Region) WriteAddress(at offset, address address) error {
	return region.WriteUint64(at, address)
}

func (region *Region) WriteInt8(at offset, i int8) error {
	if at+1 > region.size || at < 0 {
		return errors.New(fmt.Sprintf("Write at address out of range: %#v", at))
	}

	// 1 byte = 1 unit8.
	region.content[at] = byte(i)
	return nil
}

func (region *Region) WriteInt32(at offset, i int32) error {
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

func (region *Region) WriteFloat32(at offset, f float32) error {
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

func (region *Region) WriteFloat64(at offset, f float64) error {
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

// New means the used-bytes counter will be increased, while Write won't since
// it may be for updating, not newly create a value in the region.

func (region *Region) NewUint8(at offset, i uint8) error {
	if err := region.WriteUint8(at, i); err != nil {
		return err
	}
	region.counter += 1
	return nil
}

func (region *Region) NewByte(at offset, bt byte) error {
	return region.NewUint8(at, bt)
}

func (region *Region) NewUint32(at offset, i uint32) error {
	if err := region.WriteUint32(at, i); err != nil {
		return err
	}
	region.counter += 4
	return nil
}

func (region *Region) NewUint64(at offset, i uint64) error {
	if err := region.WriteUint64(at, i); err != nil {
		return err
	}
	region.counter += 8
	return nil
}

func (region *Region) NewAddress(at offset, address address) error {
	return region.NewUint64(at, address)
}

func (region *Region) NewInt8(at offset, i int8) error {
	if err := region.WriteInt8(at, i); err != nil {
		return err
	}
	region.counter += 1
	return nil
}

func (region *Region) NewInt32(at offset, i int32) error {
	if err := region.WriteInt32(at, i); err != nil {
		return err
	}
	region.counter += 4
	return nil
}

func (region *Region) NewFloat32(at offset, f float32) error {
	if err := region.WriteFloat32(at, f); err != nil {
		return err
	}
	region.counter += 4
	return nil
}

func (region *Region) NewFloat64(at offset, f float64) error {
	if err := region.WriteFloat64(at, f); err != nil {
		return err
	}
	region.counter += 8
	return nil
}

// If the region is still as empty as here requires.
func (region *Region) capable(n uint32) bool {
	if region.counter+n > region.size {
		return false
	}
	return true
}

func (region *Region) traverse(cb func(*Mono) error) error {
	for beginOffset := uint32(5); beginOffset < region.counter; {
		fmt.Printf("Try to visit mono at: %d", beginOffset) // TODO: real logger.
		kind, err := region.ReadByte(beginOffset)
		if err != nil {
			return err
		}
		if kind == 0 {
			// End of monos. We traverse by jumping among Mono headers,
			// if we got a 0 then this means unoccupied area which has no Mono yet.
			break
		}
		mono, err := region.NewMono(kind, beginOffset)
		if err != nil {
			return err
		}
		err = cb(mono)
		if err != nil {
			return err
		}
		beginOffset = mono.endOffset + 1
	}
	return nil
}

// Form a Mono from the region offset.
// There is no complicated "creation" of Monos, since a mono is just a memory block in the region
// with a header byte. The header is the only important thing to the mono and region.
//
// Therefore, to create a whole new Mono, the allocator just write the header byte at the address.
func (region *Region) NewMono(kind byte, beginOffset offset) (*Mono, error) {
	monoSize, err := monoSizeFromKind(kind)
	if err != nil {
		return nil, err
	}

	var beginFrom address
	if region.beginFrom+uint64(beginOffset) > region.endAt {
		return nil, errors.New(
			fmt.Sprintf(ErrorMessageOffsetOutOfRange,
				region.endAt, region.beginFrom+uint64(beginOffset)))
	} else {
		beginFrom = region.beginFrom + uint64(beginOffset)
	}

	return &Mono{
		region:      region,
		kind:        kind,
		beginOffset: beginOffset,
		endOffset:   beginOffset + monoSize,
		beginFrom:   beginFrom,
		endAt:       beginFrom + uint64(monoSize),
		valueFrom:   beginFrom + 1,
	}, nil
}

func (region *Region) CreateMono(kind byte) (*Mono, error) {
	increase, err := monoSizeFromKind(kind)
	if err != nil {
		return nil, err
	}
	if !region.capable(increase) {
		return nil, errors.New(fmt.Sprintf(ErrorRegionFull, increase))
	}
	// From the last unoccupied byte of the region,
	// new a Mono.
	mono, err := region.NewMono(kind, region.counter)
	if err != nil {
		return nil, err
	}
	err = mono.WriteHeader()
	if err != nil {
		return nil, err
	}

	region.counter = increase
	return mono, nil
}

func monoSizeFromKind(kind byte) (uint32, error) {
	switch kind {
	case MONO_INT32:
		// 1 + 4 (header: 1 byte + int32)
		return 5, nil
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
	return mono.region.WriteByte(mono.beginOffset, mono.kind)
}

func (a *Allocator) Allocate(kind byte, wrappedConstructor func(*Mono) *interface{}) (*interface{}, error) {
	latestRegion := a.latestRegion()
	size, err := monoSizeFromKind(kind)
	if err != nil {
		return nil, err
	}
	// If it is not capable, create a new Region then allocate.
	if !latestRegion.capable(size) {
		latestRegion, err = a.heap.NewRegion()
		if err != nil {
			return nil, err
		}
		a.regions = append(a.regions, latestRegion)
	}
	mono, err := latestRegion.CreateMono(kind)
	if err != nil {
		return nil, err
	}

	wrapped := wrappedConstructor(mono)
	return wrapped, nil
}

func (a *Allocator) latestRegion() *Region {
	return a.regions[len(a.regions)-1]
}

func (a *Allocator) Array() error {
	a.Allocate(MONO_ARRAY_S8) // TODO:
}
