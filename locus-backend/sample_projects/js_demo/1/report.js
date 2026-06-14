import { Circle, DEFAULT_RADIUS } from './models';
import { formatPair } from './utils.js';
import * as fs from 'fs';

const path = require('path');

/** Build a report line for a circle of the given radius. */
export function buildReport(radius) {
  const circle = new Circle(radius || DEFAULT_RADIUS);
  return formatPair(circle.name, circle.area());
}

/** Write the report to disk. */
export function saveReport(filename) {
  const line = buildReport(2);
  const target = path.join('out', filename);
  fs.writeFileSync(target, line);
  return target;
}
