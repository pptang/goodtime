const fs = require('fs');
const acorn = require('acorn');
const walk = require('acorn-walk');

const testFilePath = __dirname + '/test-file.js';

// Walk through the AST parsed from test file
walk.simple(acorn.parse(fs.readFileSync(testFilePath).toString()), {
  ArrowFunctionExpression(node) {
    console.log(`Found ${node.type} node`);
  },
});
