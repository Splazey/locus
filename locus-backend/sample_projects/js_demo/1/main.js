const { buildReport } = require('./report');

function main() {
  const line = buildReport(3);
  console.log(line);
}

main();
