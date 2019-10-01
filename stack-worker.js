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

// Contains array of StackNode
const stackMachine = [];

// Question: How to validate the correctness of stack machine?
function executeProgram(ast, args) {
  console.log('current ast:', ast);
  const variableMap = new Map(
    ast.params && args
      ? ast.params.map((identifier, index) => [identifier.name, args[index]])
      : null,
  );
  const handleExpression = node => {
    switch (node.type) {
      case 'Literal':
        console.log(`Handle ${node.type}:${node.value} at line: ${node.start}`);
        // TODO: what if node.value is not a number?
        return node.value;
      case 'BinaryExpression':
        console.log(
          `Handle ${node.type}:'${node.operator}' at line: ${node.start}`,
        );
        return applyOperator(
          node.operator,
          handleExpression(node.left),
          handleExpression(node.right),
        );
      case 'Identifier':
        console.log(`Handle ${node.type}:${node.name} at line: ${node.start}`);
        return variableMap.get(node.name);
      case 'ArrowFunctionExpression':
        console.log(`Handle ${node.type} at line: ${node.start}`);
        // Question: What's the better way to store arrow function expression?
        // Currently, we return root ast node of arrow function and store in the variable map.
        return node;
      case 'CallExpression':
        console.log(`Handle ${node.type} at line: ${node.start}`);
        return executeProgram(handleExpression(node.callee), node.arguments);
      case 'MemberExpression':
        console.log(`Handle ${node.type} at line: ${node.start}`);
        // How to handle embedded method like ArrayExpression?
        break;
    }
  };
  let statements = ast.body;
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
          const evaluatedValue = handleExpression(
            variableDeclarator.init,
            variableMap,
          );
          // Question: do we need to check existence of id?
          variableMap.set(variableDeclarator.id.name, evaluatedValue);
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

module.exports = executeProgram;
