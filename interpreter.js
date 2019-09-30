const acorn = require('acorn');

const StackWorker = require('./stack-worker');

function interpreter(javascriptStr) {
  const ast = acorn.parse(javascriptStr);
  const stackWorker = new StackWorker(ast);
  stackWorker.executeProgram();
}

const ast = acorn.parse();

module.exports = interpreter;
