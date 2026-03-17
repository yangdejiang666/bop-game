import { Blob } from './Blob';

export class Food extends Blob {
    constructor(x: number, y: number) {
        const radius = Math.random() * 5 + 5; // 5-10
        // Vibrant colors for food
        const colors = ['#e74c3c', '#e67e22', '#f1c40f', '#2ecc71', '#9b59b6', '#1abc9c'];
        const color = colors[Math.floor(Math.random() * colors.length)];
        super(x, y, radius, color);
    }
}
