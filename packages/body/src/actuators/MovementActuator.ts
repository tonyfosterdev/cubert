import { Bot } from 'mineflayer';
import { goals } from 'mineflayer-pathfinder';
import { BaseActuator } from './BaseActuator';

export interface MoveToPayload {
  x: number;
  y: number;
  z: number;
  range?: number;
  sprint?: boolean;
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

    const { x, y, z, range = 1 } = payload;
    const botPos = this.bot.entity.position;
    console.log(`[MOVE] Starting move from (${botPos.x.toFixed(1)}, ${botPos.y.toFixed(1)}, ${botPos.z.toFixed(1)}) to (${x}, ${y}, ${z}) range=${range}`);

    const goal = new goals.GoalNear(x, y, z, range);

    // Retry logic for mineflayer-pathfinder flakiness.
    // The pathfinder intermittently fails with "Path was stopped before it could
    // be completed" even for simple straight-line paths. This appears to be a
    // timing issue where chunk data or physics haven't fully stabilized.
    // Retrying with delays between attempts resolves this reliably.
    // See: https://stackoverflow.com/questions/79084385/mineflayer-pathfinder-the-bot-doesnt-want-to-go
    const maxAttempts = 3;
    const delayMs = 500;

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
  }

  cancel(): void {
    (this.bot as any).pathfinder.stop();
    super.cancel();
  }
}
