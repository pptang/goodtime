class StackNode {
  constructor(type, value) {
    this.type = type;
    this.value = value;
  }
}

class StackWorker {
  constructor() {
    // Contains array of StackNode
    this.stackMachine = [];
  }

  handleLiteral(node) {
    console.log('Literal Node');
    const stackNode = new StackNode(node.type, node.value);
    this.stackMachine.push(stackNode);
    console.log('Length of stackMachine:', this.stackMachine.length);
  }

  handleArray() {
    console.log('Array Node');
  }
  handleFunction() {
    console.log('Function Node');
  }
}

module.exports = StackWorker;
