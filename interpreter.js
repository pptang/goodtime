const acorn = require('acorn');

const executeProgram = require('./stack-worker');

function interpreter(javascriptStr) {
  const ast = acorn.parse(javascriptStr);
  executeProgram(ast);
}

const ast = acorn.parse();

module.exports = interpreter;
