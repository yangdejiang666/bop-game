import { Blob } from '../entities/Blob';

export class Rectangle {
    public x: number;
    public y: number;
    public w: number;
    public h: number;

    constructor(
        x: number,
        y: number,
        w: number,
        h: number
    ) {
        this.x = x;
        this.y = y;
        this.w = w;
        this.h = h;
    }

    contains(point: { position: { x: number; y: number } }): boolean {
        return (
            point.position.x >= this.x - this.w &&
            point.position.x <= this.x + this.w &&
            point.position.y >= this.y - this.h &&
            point.position.y <= this.y + this.h
        );
    }

    intersects(range: Rectangle): boolean {
        return !(
            range.x - range.w > this.x + this.w ||
            range.x + range.w < this.x - this.w ||
            range.y - range.h > this.y + this.h ||
            range.y + range.h < this.y - this.h
        );
    }
}

export class QuadTree {
    private blobs: Blob[] = [];
    private divided: boolean = false;
    private northWest?: QuadTree;
    private northEast?: QuadTree;
    private southWest?: QuadTree;
    private southEast?: QuadTree;
    private level: number;
    private maxLevel: number;
    private boundary: Rectangle;
    private capacity: number;

    constructor(
        boundary: Rectangle,
        capacity: number,
        level: number = 0,
        maxLevel: number = 10
    ) {
        this.boundary = boundary;
        this.capacity = capacity;
        this.level = level;
        this.maxLevel = maxLevel;
    }

    insert(blob: Blob): boolean {
        if (!this.boundary.contains(blob)) {
            return false;
        }

        if (this.blobs.length < this.capacity || this.level >= this.maxLevel) {
            this.blobs.push(blob);
            return true;
        }

        if (!this.divided) {
            this.subdivide();
        }

        // Attempt to insert into children
        if (this.northWest!.insert(blob)) return true;
        if (this.northEast!.insert(blob)) return true;
        if (this.southWest!.insert(blob)) return true;
        if (this.southEast!.insert(blob)) return true;

        // If it doesn't fit into any child (e.g. overlaps boundary), keep it here
        // Note: Our 'contains' checks center point usually, so it should fit one child unless logic is specific.
        // If strict center point check, it always fits one child.
        // If checking bounds, it might not.
        // Based on previous code, Contains checks 'point.position', so it's center point.
        // So it should theoretically always go into a child.
        // But strictly:
        this.blobs.push(blob);
        return true;
    }

    subdivide() {
        const x = this.boundary.x;
        const y = this.boundary.y;
        const w = this.boundary.w / 2;
        const h = this.boundary.h / 2;

        const nextLevel = this.level + 1;

        const nw = new Rectangle(x - w, y - h, w, h);
        this.northWest = new QuadTree(nw, this.capacity, nextLevel, this.maxLevel);
        const ne = new Rectangle(x + w, y - h, w, h);
        this.northEast = new QuadTree(ne, this.capacity, nextLevel, this.maxLevel);
        const sw = new Rectangle(x - w, y + h, w, h);
        this.southWest = new QuadTree(sw, this.capacity, nextLevel, this.maxLevel);
        const se = new Rectangle(x + w, y + h, w, h);
        this.southEast = new QuadTree(se, this.capacity, nextLevel, this.maxLevel);

        this.divided = true;
    }

    query(range: Rectangle, found: Blob[] = []): Blob[] {
        if (!this.boundary.intersects(range)) {
            return found;
        }

        for (const blob of this.blobs) {
            if (range.contains(blob)) {
                found.push(blob);
            }
        }

        if (this.divided) {
            this.northWest!.query(range, found);
            this.northEast!.query(range, found);
            this.southWest!.query(range, found);
            this.southEast!.query(range, found);
        }

        return found;
    }

    clear() {
        this.blobs = [];
        this.divided = false;
        this.northWest = undefined;
        this.northEast = undefined;
        this.southWest = undefined;
        this.southEast = undefined;
    }
}
