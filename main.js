const fs = require('fs');

const Interpreter = require('./interpreter');
const { Heap } = require('./heap');

const testFilePath = `${__dirname}/${process.env.FILE || 'test1'}.js`;

// Initialize the Heap, decide Heap size, separate into regions,
// initialize the Allocator, counters and assign the first region to it.
const heap = new Heap();

const interpreter = new Interpreter(
  heap,
  fs.readFileSync(testFilePath).toString(),
);
interpreter.interprete();
