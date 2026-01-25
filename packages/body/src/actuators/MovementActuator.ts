import { Bot } from 'mineflayer';
import { goals, Movements } from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';
import { BaseActuator } from './BaseActuator';

/**
 * Custom Movements class that creates a buffer zone around hazards.
 * Positions within bufferDistance of hazards are treated as dangerous.
 */
class BufferedMovements extends Movements {
  private dangerZone: Set<string> = new Set();

  /**
   * Add all positions within bufferDistance of hazard positions to the danger zone.
   */
  setDangerZone(
    hazardPositions: Vec3[],
    bufferDistance: number,
    verticalMin: number,
    verticalMax: number
  ): void {
    this.dangerZone.clear();

    for (const hazard of hazardPositions) {
      // Add all positions within buffer distance to danger zone
      for (let dx = -bufferDistance; dx <= bufferDistance; dx++) {
        for (let dy = verticalMin; dy <= verticalMax; dy++) {
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
   * Check if a position is in the danger zone (near hazards).
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

export interface HazardConfig {
  bufferDistance: number;
  scanRadius: number;
  scanCount: number;
  verticalBufferMin: number;
  verticalBufferMax: number;
  hazardBlocks: string[];
  blocksToAvoid: string[];
  blocksCantBreak: string[];
}

export interface LiquidConfig {
  treatAsAir: string[];
  liquidCost: number;
}

export interface LocomotionConfig {
  canDig: boolean;
  allowParkour: boolean;
  allowSprinting: boolean;
}

export interface PathfindingConfig {
  goalRange: number;
  maxAttempts: number;
  retryDelayMs: number;
}

export interface MoveToPayload {
  x: number;
  y: number;
  z: number;
  hazards: HazardConfig;
  liquids: LiquidConfig;
  locomotion: LocomotionConfig;
  pathfinding: PathfindingConfig;
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

    const { x, y, z, hazards, liquids, locomotion, pathfinding } = payload;
    const botPos = this.bot.entity.position;
    console.log(
      `[MOVE] Starting move from (${botPos.x.toFixed(1)}, ${botPos.y.toFixed(1)}, ${botPos.z.toFixed(1)}) to (${x}, ${y}, ${z})`
    );
    console.log(`[MOVE] Config: buffer=${hazards.bufferDistance}, scanRadius=${hazards.scanRadius}, sprint=${locomotion.allowSprinting}`);

    // Store original movements to restore later
    const originalMovements = (this.bot as any).pathfinder.movements;

    // Create movements based on payload parameters
    const movements = this.createMovements(payload);
    (this.bot as any).pathfinder.setMovements(movements);

    const goal = new goals.GoalNear(x, y, z, pathfinding.goalRange);

    // Set sprint state from payload
    this.bot.setControlState('sprint', locomotion.allowSprinting);

    try {
      for (let attempt = 1; attempt <= pathfinding.maxAttempts; attempt++) {
        try {
          await new Promise((resolve) => setTimeout(resolve, pathfinding.retryDelayMs));
          await (this.bot as any).pathfinder.goto(goal);
          console.log(`[MOVE] Reached goal (${x}, ${y}, ${z})`);
          if (this.currentActionId === actionId) {
            this.complete(actionId, true);
          }
          return;
        } catch (err: any) {
          console.log(`[MOVE] Attempt ${attempt}/${pathfinding.maxAttempts} failed: ${err.message}`);
          if (attempt === pathfinding.maxAttempts) {
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
   * Create movements configured by payload parameters.
   */
  private createMovements(payload: MoveToPayload): Movements {
    const { hazards, liquids, locomotion } = payload;
    const mcData = require('minecraft-data')(this.bot.version);

    // Determine if we need buffered movements (scan for hazards)
    const needsBuffer = hazards.scanRadius > 0 && hazards.bufferDistance > 0;

    let movements: Movements;

    if (needsBuffer) {
      // Scan for hazards and create buffered movements
      const hazardPositions = this.scanForHazards(hazards);
      if (hazardPositions.length > 0) {
        console.log(
          `[MOVE] Found ${hazardPositions.length} hazard blocks, maintaining ${hazards.bufferDistance}-block buffer`
        );
        const bufferedMovements = new BufferedMovements(this.bot);
        bufferedMovements.setDangerZone(
          hazardPositions,
          hazards.bufferDistance,
          hazards.verticalBufferMin,
          hazards.verticalBufferMax
        );
        movements = bufferedMovements;
      } else {
        movements = new Movements(this.bot);
      }
    } else {
      movements = new Movements(this.bot);
    }

    // Apply locomotion settings
    movements.canDig = locomotion.canDig;
    movements.allowParkour = locomotion.allowParkour;
    movements.allowSprinting = locomotion.allowSprinting;

    // Apply blocks to avoid
    for (const blockName of hazards.blocksToAvoid) {
      const blockId = mcData.blocksByName[blockName]?.id;
      if (blockId !== undefined) {
        movements.blocksToAvoid.add(blockId);
      }
    }

    // Apply blocks can't break
    for (const blockName of hazards.blocksCantBreak) {
      const blockId = mcData.blocksByName[blockName]?.id;
      if (blockId !== undefined) {
        movements.blocksCantBreak.add(blockId);
      }
    }

    // Apply liquid settings
    (movements as any).liquidCost = liquids.liquidCost;
    for (const blockName of liquids.treatAsAir) {
      const blockId = mcData.blocksByName[blockName]?.id;
      if (blockId !== undefined) {
        (movements as any).liquids.delete(blockId);
      }
    }

    return movements;
  }

  /**
   * Scan for hazardous blocks within radius of the bot.
   */
  private scanForHazards(hazards: HazardConfig): Vec3[] {
    if (hazards.scanRadius === 0 || hazards.scanCount === 0) {
      return [];
    }

    const mcData = require('minecraft-data')(this.bot.version);

    const hazardBlockIds = hazards.hazardBlocks
      .map((name) => mcData.blocksByName[name]?.id)
      .filter((id): id is number => id !== undefined);

    if (hazardBlockIds.length === 0) return [];

    const positions = this.bot.findBlocks({
      matching: hazardBlockIds,
      maxDistance: hazards.scanRadius,
      count: hazards.scanCount,
    });

    return positions;
  }

  cancel(): void {
    (this.bot as any).pathfinder.stop();
    super.cancel();
  }
}
