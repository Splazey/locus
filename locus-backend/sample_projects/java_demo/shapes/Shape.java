package shapes;

/** Base class for all shapes. */
public abstract class Shape implements Drawable {
    protected String name;
    private boolean visible = true;

    public Shape(String name) {
        this.name = name;
    }

    /** Compute the area of this shape. */
    public abstract double area();

    /** Describe the shape. */
    public String describe() {
        return name + ": area=" + area();
    }

    public void draw() {
        System.out.println(describe());
    }
}
