import { Bot } from 'mineflayer';
import { goals, Movements } from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';
import { BaseActuator } from './BaseActuator';

// Buffer distance from hazards like lava during normal movement
// At least 5 blocks buffer (or max possible if less space available)
const HAZARD_BUFFER_DISTANCE = 5;
const HAZARD_SCAN_RADIUS = 32;

/**
 * Custom Movements class that creates a buffer zone around hazards.
 * Positions within HAZARD_BUFFER_DISTANCE of lava are treated as dangerous.
 */
class BufferedMovements extends Movements {
  private dangerZone: Set<string> = new Set();

  /**
   * Add all positions within bufferDistance of hazard positions to the danger zone.
   */
  setDangerZone(hazardPositions: Vec3[], bufferDistance: number): void {
    this.dangerZone.clear();

    for (const hazard of hazardPositions) {
      // Add all positions within buffer distance to danger zone
      for (let dx = -bufferDistance; dx <= bufferDistance; dx++) {
        for (let dy = -2; dy <= 2; dy++) {
          // Vertical range is smaller
          for (let dz = -bufferDistance; dz <= bufferDistance; dz++) {
            const key = `${Math.floor(hazard.x) + dx},${Math.floor(hazard.y) + dy},${Math.floor(hazard.z) + dz}`;
            this.dangerZone.add(key);
          }
        }
      }
    }

    console.log(`[MOVE] Created danger zone with ${this.dangerZone.size} blocked positions`);
  }

  /**
   * Check if a position is in the danger zone (near lava).
   */
  private isInDangerZone(x: number, y: number, z: number): boolean {
    const key = `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`;
    return this.dangerZone.has(key);
  }

  /**
   * Override getBlock to return a "fake" dangerous block for positions in danger zone.
   * This makes the pathfinder think these positions are blocked.
   */
  getBlock(pos: Vec3, dx: number, dy: number, dz: number): any {
    const block = super.getBlock(pos, dx, dy, dz);

    // If this position is in the danger zone, mark it as dangerous
    const checkX = pos.x + dx;
    const checkY = pos.y + dy;
    const checkZ = pos.z + dz;

    if (this.isInDangerZone(checkX, checkY, checkZ)) {
      // Return a modified block that the pathfinder will avoid
      // We mark it as liquid (like lava) so pathfinder won't walk through
      if (block) {
        return {
          ...block,
          liquid: true,
          physical: false,
        };
      }
    }

    return block;
  }
}

export interface MoveToPayload {
  x: number;
  y: number;
  z: number;
  range?: number;
  sprint?: boolean;
  ignoreDanger?: boolean;
}

export class MovementActuator extends BaseActuator {
  constructor(bot: Bot) {
    super(bot);

    this.bot.on('goal_reached', () => {
      if (this.currentActionId) {
        this.complete(this.currentActionId, true);
      }
    });

    this.bot.on('path_reset', (reason: string) => {
      if (this.currentActionId && reason === 'no_path') {
        this.complete(this.currentActionId, false, 'No path found');
      }
    });
  }

  async execute(actionId: string, payload: MoveToPayload): Promise<void> {
    this.currentActionId = actionId;
    this.isExecuting = true;

    const { x, y, z, range = 1, sprint = false, ignoreDanger = false } = payload;
    const botPos = this.bot.entity.position;
    console.log(
      `[MOVE] Starting move from (${botPos.x.toFixed(1)}, ${botPos.y.toFixed(1)}, ${botPos.z.toFixed(1)}) to (${x}, ${y}, ${z}) range=${range} sprint=${sprint} ignoreDanger=${ignoreDanger}`
    );

    // Store original movements to restore later
    const originalMovements = (this.bot as any).pathfinder.movements;

    if (ignoreDanger) {
      // Urgent mode: use unsafe movements that ignore all hazards
      (this.bot as any).pathfinder.setMovements(this.createUnsafeMovements());
      console.log('[MOVE] Using UNSAFE movements (ignoring danger)');
    } else {
      // Safe mode: scan for hazards and create buffered movements
      const hazardPositions = this.scanForHazards();
      if (hazardPositions.length > 0) {
        console.log(
          `[MOVE] Found ${hazardPositions.length} hazard blocks, maintaining ${HAZARD_BUFFER_DISTANCE}-block buffer`
        );
        const bufferedMovements = this.createBufferedMovements(hazardPositions);
        (this.bot as any).pathfinder.setMovements(bufferedMovements);
      }
    }

    const goal = new goals.GoalNear(x, y, z, range);

    // Never sprint - in unsafe mode we want direct paths but walking pace
    // to give the bot more control through hazards
    this.bot.setControlState('sprint', false);

    // Retry logic for mineflayer-pathfinder flakiness.
    const maxAttempts = 3;
    const delayMs = 500;

    try {
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          await (this.bot as any).pathfinder.goto(goal);
          console.log(`[MOVE] Reached goal (${x}, ${y}, ${z})`);
          if (this.currentActionId === actionId) {
            this.complete(actionId, true);
          }
          return;
        } catch (err: any) {
          console.log(`[MOVE] Attempt ${attempt}/${maxAttempts} failed: ${err.message}`);
          if (attempt === maxAttempts) {
            this.complete(actionId, false, err.message);
          }
        }
      }
    } finally {
      // Restore original movements and sprint state
      (this.bot as any).pathfinder.setMovements(originalMovements);
      this.bot.setControlState('sprint', false);
      console.log('[MOVE] Restored original movements');
    }
  }

  /**
   * Create movements with buffer zone around hazards.
   */
  private createBufferedMovements(hazardPositions: Vec3[]): BufferedMovements {
    const movements = new BufferedMovements(this.bot);
    const mcData = require('minecraft-data')(this.bot.version);

    // Safe mode: no parkour or sprinting to ensure buffer is respected
    movements.canDig = true;
    movements.allowParkour = false;
    movements.allowSprinting = false;

    // Add standard hazard blocks to avoid (including flowing variants)
    movements.blocksCantBreak.add(mcData.blocksByName.lava?.id);
    movements.blocksCantBreak.add(mcData.blocksByName.flowing_lava?.id);
    movements.blocksToAvoid.add(mcData.blocksByName.lava?.id);
    movements.blocksToAvoid.add(mcData.blocksByName.flowing_lava?.id);
    movements.blocksToAvoid.add(mcData.blocksByName.fire?.id);
    movements.blocksToAvoid.add(mcData.blocksByName.cactus?.id);
    movements.blocksToAvoid.add(mcData.blocksByName.magma_block?.id);

    // Set up the buffer zone around hazards
    movements.setDangerZone(hazardPositions, HAZARD_BUFFER_DISTANCE);

    return movements;
  }

  private createUnsafeMovements(): Movements {
    const mcData = require('minecraft-data')(this.bot.version);
    const movements = new Movements(this.bot);
    movements.canDig = true;
    movements.allowParkour = false;
    movements.allowSprinting = false; // No sprinting - walk through hazards for better control
    movements.blocksToAvoid.clear(); // Don't avoid lava/fire/cactus/magma

    // Make lava less dangerous in pathfinding calculations
    (movements as any).liquidCost = 0; // No cost penalty for traversing liquids
    (movements as any).liquids.delete(mcData.blocksByName.lava.id); // Treat lava like air
    if (mcData.blocksByName.flowing_lava) {
      (movements as any).liquids.delete(mcData.blocksByName.flowing_lava.id);
    }

    return movements;
  }

  /**
   * Scan for hazardous blocks (lava, flowing lava, fire, magma) within radius of the bot.
   */
  private scanForHazards(): Vec3[] {
    const mcData = require('minecraft-data')(this.bot.version);
    // Include both source and flowing variants of lava
    const hazardBlockNames = ['lava', 'flowing_lava', 'fire', 'magma_block'];

    const hazardBlockIds = hazardBlockNames
      .map((name) => mcData.blocksByName[name]?.id)
      .filter((id): id is number => id !== undefined);

    if (hazardBlockIds.length === 0) return [];

    const positions = this.bot.findBlocks({
      matching: hazardBlockIds,
      maxDistance: HAZARD_SCAN_RADIUS,
      count: 10000,
    });

    return positions;
  }

  cancel(): void {
    (this.bot as any).pathfinder.stop();
    super.cancel();
  }
}
