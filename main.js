const fs = require('fs');
const interpreter = require('./interpreter');
const testFilePath = __dirname + '/test-file.js';

interpreter(fs.readFileSync(testFilePath).toString());
