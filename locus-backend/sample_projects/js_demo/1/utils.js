/** Round a number to two decimal places. */
export function round2(value) {
  return Math.round(value * 100) / 100;
}

/** Format a label/value pair. */
export const formatPair = (label, value) => {
  return `${label} = ${round2(value)}`;
};

export const VERSION = '1.0.0';
