const fs = require('fs');
const Interpreter = require('./interpreter');
const testFilePath = __dirname + '/test-file.js';

const interpreter = new Interpreter(fs.readFileSync(testFilePath).toString());
interpreter.interprete();
