const acorn = require('acorn');

const executeProgram = require('./stack-worker');

// It may seem strange to do this mapping (I meant: from JS -> AST, but map AST operator back to execute in JS).
// The weirdness results from using JS as runtime for our own convenience,
// but imagine if we use some low level language runtime, this piece of code will be modified to map to its instruction set.
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

// Use JavaScript to simulate how JS Engine interpretes
// For V8 engine, it'll first compile the AST to Bytecode and interprete after,
// while our experiment will interprete AST directly.
class Interpreter {
  constructor(javascriptStr) {
    this.ast = acorn.parse(javascriptStr);
    // Simulate lexical environment for scope chain and the global environment is the outmost one.
    this.globalVariableMap = new Map([['outer', null]]);
  }

  interprete() {
    this.executeProgram(this.ast, null, this.globalVariableMap);
  }

  // A Program can not only be the main entry point,
  // but also can be a function or a meaningful block (be more accurate later...)
  // and it represents a lexical scope.
  executeProgram(ast, args, outerLexicalEnv) {
    console.log('Current AST:\n', ast);

    const localVariableMap = new Map([['outer', outerLexicalEnv]]);
    // If any parameter is passed to the program, we should initialize them in the variable map
    if (ast.params && args) {
      ast.params.forEach((identifier, index) => {
        localVariableMap.set(identifier.name, args[index]);
      });
    }

    const handleExpression = node => {
      console.log(`Handle ${node.type} at line: ${node.start}`);
      switch (node.type) {
        case 'Literal':
          console.log(`Value: ${node.value}`);
          // TODO: what if node.value is not a number?
          return node.value;
        case 'BinaryExpression':
          console.log(`Operator: '${node.operator}'`);
          return applyOperator(
            node.operator,
            handleExpression(node.left),
            handleExpression(node.right),
          );
        case 'Identifier':
          console.log(`Identifier Name: ${node.name}`);
          return localVariableMap.get(node.name);
        case 'ArrowFunctionExpression':
          // Currently, we return root ast node of arrow function and store in the variable map.
          return node;
        case 'CallExpression':
          console.log(`Callee: ${node.callee}`);
          return executeProgram(
            handleExpression(node.callee),
            node.arguments,
            localVariableMap,
          );
        case 'MemberExpression':
          // How to handle embedded method like ArrayExpression?
          break;
      }
    };

    // Execute all statements in the same lexical scope
    let statements = ast.body;
    // TODO: Bad smell here.
    if (ast.type === 'ArrowFunctionExpression') {
      statements = ast.body.body;
    }
    statements.forEach(node => {
      switch (node.type) {
        case 'VariableDeclaration':
          node.declarations.forEach(variableDeclarator => {
            // TODO:
            // 1. consider the use case of array
            // 2. consider the difference between local and global variable
            const evaluatedValue = handleExpression(variableDeclarator.init);
            // Question: do we need to check existence of id?
            localVariableMap.set(variableDeclarator.id.name, evaluatedValue);
          });
          break;
        case 'ExpressionStatement':
          return handleExpression(node.expression);
        case 'BlockStatement':
          break;
        case 'ReturnStatement':
          return handleExpression(node.argument);
        // TODO: Handle other types of statment (if/else, for loop...)
      }
    });
  }
}

module.exports = Interpreter;
