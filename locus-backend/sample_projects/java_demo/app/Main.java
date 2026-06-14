package app;

import shapes.Circle;
import shapes.Drawable;
import java.util.ArrayList;
import java.util.List;

/** Entry point: builds shapes and draws them. */
public class Main {
    private List<Drawable> items = new ArrayList<>();

    public static void main(String[] args) {
        Main app = new Main();
        app.run();
    }

    /** Build and draw a couple of circles. */
    public void run() {
        Circle small = new Circle(1.0);
        Circle large = new Circle(4.0);
        items.add(small);
        items.add(large);
        small.draw();
        large.draw();
    }
}
