import { Bot } from 'mineflayer';
import { goals } from 'mineflayer-pathfinder';
import { BaseActuator } from './BaseActuator';

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
    console.log(`[MOVE] Starting move from (${botPos.x.toFixed(1)}, ${botPos.y.toFixed(1)}, ${botPos.z.toFixed(1)}) to (${x}, ${y}, ${z}) range=${range} sprint=${sprint} ignoreDanger=${ignoreDanger}`);

    const goal = new goals.GoalNear(x, y, z, range);

    // Swap to unsafe movements if ignoreDanger is set
    let originalMovements: any = null;
    if (ignoreDanger) {
      originalMovements = (this.bot as any).pathfinder.movements;
      (this.bot as any).pathfinder.setMovements(this.createUnsafeMovements());
      console.log('[MOVE] Using UNSAFE movements (ignoring danger)');
    }

    if (sprint) {
      this.bot.setControlState('sprint', true);
    }

    // Retry logic for mineflayer-pathfinder flakiness.
    // The pathfinder intermittently fails with "Path was stopped before it could
    // be completed" even for simple straight-line paths. This appears to be a
    // timing issue where chunk data or physics haven't fully stabilized.
    // Retrying with delays between attempts resolves this reliably.
    // See: https://stackoverflow.com/questions/79084385/mineflayer-pathfinder-the-bot-doesnt-want-to-go
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
      if (originalMovements) {
        (this.bot as any).pathfinder.setMovements(originalMovements);
        console.log('[MOVE] Restored safe movements');
      }
      if (sprint) {
        this.bot.setControlState('sprint', false);
      }
    }
  }

  private createUnsafeMovements(): any {
    const { Movements } = require('mineflayer-pathfinder');
    const movements = new Movements(this.bot);
    movements.canDig = true;
    movements.allowParkour = true;
    movements.allowSprinting = true;
    movements.blocksToAvoid.clear(); // Don't avoid lava/fire/cactus/magma
    return movements;
  }

  cancel(): void {
    (this.bot as any).pathfinder.stop();
    super.cancel();
  }
}
