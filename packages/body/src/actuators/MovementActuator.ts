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

    const goal = new goals.GoalNear(x, y, z, range);

    try {
      await (this.bot as any).pathfinder.goto(goal);
    } catch (err: any) {
      this.complete(actionId, false, err.message);
    }
  }

  cancel(): void {
    (this.bot as any).pathfinder.stop();
    super.cancel();
  }
}
