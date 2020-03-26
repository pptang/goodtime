// function require(method) {
//   switch (method) {
//     case 'add': 
//       return function(a, b) {
//         return a + b;
//       };
//     default:
//       return function(a, b) {
//         return a - b;
//       }
//   }
// }

var add = require('add');

function main() {
  var result = 123;
  return add(result, 3);
  // return add;
};
console.log(main());
