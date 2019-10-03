const acorn = require('acorn');

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

const getVariableValueFromScopeChain = (variableName, currentVariableMap) => {
  let result = currentVariableMap.get(variableName);
  // console.log('current map:\n', currentVariableMap);
  // console.log('variable name: \n', variableName);
  // console.log('result:\n', result);
  if (!result && currentVariableMap.get('outer') !== null) {
    result = getVariableValueFromScopeChain(
      variableName,
      currentVariableMap.get('outer'),
    );
  }
  return result;
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
    if (!ast) {
      throw Error("AST Tree doesn't exist!");
    }
    console.log('Current AST:\n', ast, '\n');
    const localVariableMap = new Map([['outer', outerLexicalEnv]]);
    // If any parameter is passed to the program, we should initialize them in the variable map
    if (ast.params && args) {
      ast.params.forEach((identifier, index) => {
        localVariableMap.set(identifier.name, args[index]);
      });
    }

    const handleExpression = node => {
      console.log(`Handle ${node.type} at line: ${node.start}\n`);
      switch (node.type) {
        case 'Literal':
          console.log(`Value: ${node.value}\n`);
          // TODO: what if node.value is not a number?
          return node.value;
        case 'BinaryExpression':
          console.log(`Operator: '${node.operator}'\n`);
          return applyOperator(
            node.operator,
            handleExpression(node.left),
            handleExpression(node.right),
          );
        case 'Identifier':
          console.log(`Identifier Name: ${node.name}\n`);
          return (
            getVariableValueFromScopeChain(node.name, localVariableMap) ||
            node.name
          );
        case 'ArrowFunctionExpression':
          // Currently, we return root ast node of arrow function and store in the variable map.
          return node;
        case 'CallExpression':
          return handleCallExpression(node.callee, node.arguments);
        case 'ObjectExpression':
          console.log('Create a new Object.\n');
          return node.properties.reduce(
            (acc, property) =>
              Object.assign({}, acc, {
                [property.key.name]: property.value,
              }),
            {},
          );
        case 'ArrayExpression':
          console.log('Current Array:', node.elements, '\n');
          // TODO: Find a better to handle array expression;
          break;
        // case 'MemberExpression':
        // Question: How to pass ArrowFunction AST descriptor to host machine array.map? (how to execute the statement inside?)
        // if (node.object.type === 'ArrayExpression') {
        //   throw Error('Array is not supported yet.');
        // const objField = Array.from(node.object.elements)[propertyName];
        // console.log('objField', objField);
        // console.log('args:', callExpressionArgs);
        // return typeof objField === 'function'
        //   ? objField(i => i + 1)
        //   : objField;
        // } else {
        //   const objName = handleExpression(node.object);
        //   console.log(`Object '${objName}'`);
        //   const propertyName = handleExpression(node.property);
        //   const objField = global[objName][propertyName];
        //   return typeof objField === 'function'
        //     ? objField(handleExpression(callExpressionArgs))
        //     : objField;
        // }
      }
    };

    const handleCallExpression = (callee, callArgs) => {
      console.log('[Callee]:', callee);
      console.log('[Args]:', callArgs);
      switch (callee.type) {
        case 'MemberExpression':
          const objName = handleExpression(callee.object);
          console.log(`Object '${objName}'`);
          const propertyName = handleExpression(callee.property);
          const objField = global[objName][propertyName];
          return typeof objField === 'function'
            ? objField(...callArgs.map(handleExpression))
            : objField;
        case 'Identifier':
          return this.executeProgram(
            handleExpression(callee),
            callArgs.map(handleExpression),
            localVariableMap,
          );
      }
    };

    // Execute all statements in the same lexical scope
    let statements = ast.body;
    // TODO: Bad smell here.
    if (ast.type === 'ArrowFunctionExpression') {
      statements = ast.body.body;
    }
    let returnValue;
    statements.forEach(node => {
      console.log(`Handle ${node.type}\n`);
      switch (node.type) {
        case 'VariableDeclaration':
          console.log(`Declare a ${node.kind} variable.\n`);
          node.declarations.forEach(variableDeclarator => {
            // TODO:
            // 1. consider the use case of array
            // 2. consider the difference between local and global variable
            const evaluatedValue = handleExpression(variableDeclarator.init);
            // Question: do we need to check existence of id?
            localVariableMap.set(variableDeclarator.id.name, evaluatedValue);
            console.log(
              'Variable Map stored new pairs,\n',
              '[Key]:',
              variableDeclarator.id.name,
              '\n',
              '[Value]:',
              evaluatedValue,
              '\n',
            );
          });
          break;
        case 'ExpressionStatement':
          return handleExpression(node.expression);
        case 'BlockStatement':
          break;
        case 'ReturnStatement':
          returnValue = handleExpression(node.argument);
          break;
        // TODO: Handle other types of statment (if/else, for loop...)
      }
    });
    return returnValue;
  }
}

module.exports = Interpreter;
