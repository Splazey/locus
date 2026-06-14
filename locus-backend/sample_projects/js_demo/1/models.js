/** Base class for all shapes. */
export class Shape {
  constructor(name) {
    this.name = name;
    this.visible = true;
  }

  /** Describe the shape. */
  describe() {
    return `${this.name}: area=${this.area()}`;
  }

  area() {
    return 0;
  }
}

/** A circle, defined by its radius. */
export class Circle extends Shape {
  constructor(radius) {
    super('circle');
    this.radius = radius;
  }

  area() {
    return Math.PI * this.radius * this.radius;
  }
}

export const DEFAULT_RADIUS = 1;
