import { Bot, BOT_STATES } from '../entities/Bot';
import { Player } from '../entities/Player';
import { Food } from '../entities/Food';
import { Virus } from '../entities/Virus';
import { QuadTree, Rectangle } from '../utils/QuadTree';
import { Vector } from '../utils/Vector';
import { AbilitySystem } from './AbilitySystem';

export class AISystem {
    // Inject AbilitySystem?
    // We can pass it in update(), but it's simpler if main loop passes it 
    // OR we just assume bots have ability to trigger events.
    // Actually, Main.ts calls aiSystem.update without abilitySystem arg currently.
    // We should modify Main to pass abilitySystem or make AISystem accept it.

    // Wait, I can't easily modify Main's call site in a overwrite of this file without modifying main too.
    // But updating Main is fine.

    constructor() { }

    update(
        bots: Bot[],
        player: Player,
        quadTree: QuadTree,
        dt: number,
        worldWidth: number,
        worldHeight: number,
        abilitySystem?: AbilitySystem // Optional for now
    ) {
        const startTime = performance.now();
        const MAX_AI_TIME = 8; // 8ms for AI

        for (const bot of bots) {
            // Safety Break
            if (performance.now() - startTime > MAX_AI_TIME) break;

            if (bot.cells.length === 0) continue;

            bot.reactionTimer -= dt;
            if (bot.reactionTimer <= 0) {
                this.makeDecision(bot, player, quadTree, worldWidth, worldHeight, abilitySystem);
                bot.reactionTimer = 0.05 + Math.random() * 0.1; // Faster reactions (0.05-0.15s)
            }

            if (bot.target) {
                bot.updateVelocity(bot.target);
            }
            bot.update(dt);
        }
    }

    private makeDecision(
        bot: Bot,
        _player: Player,
        quadTree: QuadTree,
        worldWidth: number,
        worldHeight: number,
        abilitySystem?: AbilitySystem
    ) {
        const center = bot.getCenter();
        const botMass = bot.cells.reduce((sum, c) => sum + c.mass, 0);
        const viewDist = 400 + bot.maxRadius * 3; // Wider vision
        const range = new Rectangle(center.x, center.y, viewDist, viewDist);
        const nearby = quadTree.query(range);

        // Categorize threats and opportunities
        const threats: { pos: Vector, mass: number, dist: number }[] = [];
        const prey: { pos: Vector, mass: number, dist: number }[] = [];
        const foods: { pos: Vector, dist: number }[] = [];
        const viruses: { pos: Vector, dist: number }[] = [];

        // Analyze Surroundings
        for (const entity of nearby) {
            if (entity.owner === bot) continue;

            const dist = center.dist(entity.position).mag();

            // Viruses
            if (entity instanceof Virus) {
                // Large bots should avoid viruses
                if (botMass > 500) {
                    viruses.push({ pos: entity.position, dist });
                }
            }
            // Food and EjectedMass
            else if (entity instanceof Food || entity.constructor.name === 'EjectedMass') {
                foods.push({ pos: entity.position, dist });
            }
            // Other players/bots
            else if (entity.owner) {
                const enemyMass = entity.mass;

                // Threat: Enemy is bigger than us (with safety margin)
                if (enemyMass > botMass * 1.15) {
                    threats.push({ pos: entity.position, mass: enemyMass, dist });
                }
                // Prey: We are bigger than enemy (can eat them)
                else if (botMass > enemyMass * 1.15) {
                    prey.push({ pos: entity.position, mass: enemyMass, dist });
                }
            }
        }

        // Sort by distance
        threats.sort((a, b) => a.dist - b.dist);
        prey.sort((a, b) => a.dist - b.dist);
        foods.sort((a, b) => a.dist - b.dist);

        // DECISION MAKING with priority system

        // HIGHEST PRIORITY: Flee from immediate danger
        if (threats.length > 0 && threats[0].dist < 300) {
            bot.state = BOT_STATES.FLEE;

            // Smart flee: Run away from closest threat
            const threat = threats[0];
            const fleeDir = center.sub(threat.pos).normalize();

            // Check if multiple threats - flee from average position
            if (threats.length > 1) {
                let avgThreatX = 0, avgThreatY = 0;
                const nearThreats = threats.filter(t => t.dist < 400);
                nearThreats.forEach(t => {
                    avgThreatX += t.pos.x;
                    avgThreatY += t.pos.y;
                });
                avgThreatX /= nearThreats.length;
                avgThreatY /= nearThreats.length;

                const avgThreatPos = new Vector(avgThreatX, avgThreatY);
                const smartFleeDir = center.sub(avgThreatPos).normalize();
                bot.target = center.add(smartFleeDir.mult(800));
            } else {
                bot.target = center.add(fleeDir.mult(800));
            }

            // Emergency split to escape if very close and big enough
            if (abilitySystem && threat.dist < 150 && botMass > 200 && bot.cells.length < 4) {
                if (Math.random() < 0.3) { // 30% chance
                    abilitySystem.split(bot);
                }
            }
            return;
        }

        // HIGH PRIORITY: Hunt prey if we're big enough
        if (prey.length > 0 && botMass > 100) {
            bot.state = BOT_STATES.HUNT;

            // Target closest prey
            const target = prey[0];
            bot.target = target.pos;

            // Aggressive split-kill if close enough and prey is worth it
            if (abilitySystem && target.dist < 350 && target.mass > 50) {
                // More cells = more aggressive
                const splitChance = bot.cells.length === 1 ? 0.05 : 0.02;
                if (Math.random() < splitChance && bot.cells.length < 8) {
                    abilitySystem.split(bot);
                }
            }
            return;
        }

        // MEDIUM PRIORITY: Eat food (especially if small/hungry)
        if (foods.length > 0) {
            bot.state = BOT_STATES.FEED;

            // If very small, prioritize food over hunting
            if (botMass < 150 || prey.length === 0) {
                // Target closest food cluster
                const targetFood = foods[0];
                bot.target = targetFood.pos;
                return;
            }
        }

        // LOW PRIORITY: Wander
        bot.state = BOT_STATES.WANDER;

        // Move towards center of map if near edges
        const edgeMargin = 500;
        if (center.x < edgeMargin || center.x > worldWidth - edgeMargin ||
            center.y < edgeMargin || center.y > worldHeight - edgeMargin) {
            // Move towards center
            bot.target = new Vector(worldWidth / 2, worldHeight / 2);
        } else {
            // Random wander if no target or reached target
            if (!bot.target || center.dist(bot.target).mag() < 50) {
                const angle = Math.random() * Math.PI * 2;
                const distance = 300 + Math.random() * 400;
                bot.target = new Vector(
                    center.x + Math.cos(angle) * distance,
                    center.y + Math.sin(angle) * distance
                );
            }
        }
    }
}
