export class Vector {
    public x: number;
    public y: number;

    constructor(x: number, y: number) {
        this.x = x;
        this.y = y;
    }

    add(v: Vector): Vector {
        return new Vector(this.x + v.x, this.y + v.y);
    }

    sub(v: Vector): Vector {
        return new Vector(this.x - v.x, this.y - v.y);
    }

    mult(n: number): Vector {
        return new Vector(this.x * n, this.y * n);
    }

    div(n: number): Vector {
        return new Vector(this.x / n, this.y / n);
    }

    mag(): number {
        return Math.sqrt(this.x * this.x + this.y * this.y);
    }

    normalize(): Vector {
        const m = this.mag();
        return m === 0 ? new Vector(0, 0) : this.div(m);
    }

    dot(v: Vector): number {
        return this.x * v.x + this.y * v.y;
    }

    limit(max: number): Vector {
        if (this.mag() > max) {
            return this.normalize().mult(max);
        }
        return this;
    }

    dist(v: Vector): Vector {
        return this.sub(v);
    }

    static get zero(): Vector {
        return new Vector(0, 0);
    }
}
