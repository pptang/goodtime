const mapper = i => {
  return i + 1;
};

const main = () => {
  const result = [].map(mapper);
  return result;
};

main();
