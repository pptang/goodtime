const applyOperator = (operator, leftOperand, rightOperand) => {
  switch (operator) {
    case '+':
      return leftOperand + rightOperand;
    case '-':
      return leftOperand - rightOperand;
    case '*':
      return leftOperand * rightOperand;
    case '/':
      return leftOperand / rightOperand;
    case '==':
      // Question: Should I change to use boolean values here?
      return leftOperand == rightOperand ? 1 : 0;
    case '>':
      return leftOperand > rightOperand ? 1 : 0;
    case '<':
      return leftOperand < rightOperand ? 1 : 0;
    case '&&':
      return leftOperand && rightOperand;
  }
  throw Error(`Unknown operator: ${operator}`);
};

// Question: How to validate the correctness of stack machine?
class StackWorker {
  constructor(ast) {
    this.ast = ast;
    this.globalVariableMap = new Map();
    // Contains array of StackNode
    this.stackMachine = [];
  }

  executeProgram() {
    this.ast.body.forEach(node => {
      switch (node.type) {
        case 'VariableDeclaration':
          node.declarations.forEach(variableDeclarator => {
            // TODO:
            // 1. consider the use case of array
            // 2. consider the difference between local and global variable
            const evaluatedValue = this.handleExpression(
              variableDeclarator.init,
              this.globalVariableMap,
            );
            // Question: do we need to check existence of id?
            this.globalVariableMap.set(
              variableDeclarator.id.name,
              evaluatedValue,
            );
          });
          break;
        // TODO: Handle other types of statment (function call, if/else, for loop...)
      }
    });
  }

  handleStatement(node) {
    console.log(`Handle statement ${node.type} at line: ${node.start}`);
  }

  handleExpression(node, variableMap) {
    console.log(`Handle expression ${node.type} at line: ${node.start}`);
    switch (node.type) {
      case 'Literal':
        // TODO: what if node.value is not a number?
        return node.value;
      case 'BinaryExpression':
        return applyOperator(
          node.operator,
          this.handleExpression(node.left),
          this.handleExpression(node.right),
        );
      case 'Identifier':
        return variableMap.get(node.name);
      case 'ArrowFunctionExpression':
        // Question: What's the better way to store arrow function expression?
        return node;
    }
  }
}

module.exports = StackWorker;
