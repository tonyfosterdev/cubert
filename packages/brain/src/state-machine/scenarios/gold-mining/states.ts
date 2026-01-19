import { State, StateContext, Action, SensorData, BlockInfo } from '../../State';
import { v4 as uuidv4 } from 'uuid';

function createAction(type: string, payload: Partial<Action>): Action {
  return {
    actionId: uuidv4(),
    timestamp: Date.now().toString(),
    type,
    ...payload,
  };
}

function isNearLava(sensorData: SensorData, maxDistance: number): boolean {
  const lavaBlocks = sensorData.nearbyBlocks?.lavaBlocks || [];
  return lavaBlocks.some((block) => block.distance <= maxDistance);
}

function countGoldInInventory(sensorData: SensorData): number {
  const slots = sensorData.inventory?.slots || [];
  const goldItems = ['gold_ore', 'deepslate_gold_ore', 'raw_gold'];
  return slots
    .filter((slot) => goldItems.includes(slot.itemName))
    .reduce((sum, slot) => sum + slot.count, 0);
}

function isWithinRange(sensorData: SensorData, target: BlockInfo, range: number): boolean {
  const pos = sensorData.position;
  const distance = Math.sqrt(
    Math.pow(pos.x - target.x, 2) +
    Math.pow(pos.y - target.y, 2) +
    Math.pow(pos.z - target.z, 2)
  );
  return distance <= range;
}

// ============================================================================
// IDLE STATE
// ============================================================================

export const IdleState: State = {
  name: 'IDLE',

  onEnter(context: StateContext): Action | null {
    return createAction('ACTION_TYPE_SPEAK', {
      speak: { message: 'Ready for gold mining!' },
    });
  },

  onUpdate(context: StateContext) {
    // Immediately transition to searching
    return { action: null, nextState: 'SEARCHING_GOLD' };
  },
};

// ============================================================================
// SEARCHING GOLD STATE
// ============================================================================

export const SearchingGoldState: State = {
  name: 'SEARCHING_GOLD',

  onEnter(context: StateContext): Action | null {
    console.log(`[${new Date().toISOString()}] Searching for gold...`);
    return createAction('ACTION_TYPE_SPEAK', {
      speak: { message: 'Looking for gold...' },
    });
  },

  onUpdate(context: StateContext) {
    const { sensorData, memory } = context;
    const goldBlocks = sensorData.nearbyBlocks?.goldBlocks || [];

    // Check if inventory is getting full
    const goldCount = countGoldInInventory(sensorData);
    if (goldCount >= 32) {
      return { action: null, nextState: 'SEARCHING_CHEST' };
    }

    if (goldBlocks.length > 0) {
      console.log(`[${new Date().toISOString()}] Found ${goldBlocks.length} gold blocks: ${goldBlocks.map(b => `(${b.x},${b.y},${b.z})`).join(', ')}`);

      // Find gold that's not too close to lava
      const safeGold = goldBlocks.find((block) => {
        const lavaBlocks = sensorData.nearbyBlocks?.lavaBlocks || [];
        const nearbyLava = lavaBlocks.some((lava) => {
          const dist = Math.sqrt(
            Math.pow(block.x - lava.x, 2) +
            Math.pow(block.y - lava.y, 2) +
            Math.pow(block.z - lava.z, 2)
          );
          return dist < 3;
        });
        return !nearbyLava;
      });

      if (safeGold) {
        console.log(`[${new Date().toISOString()}] Targeting gold at (${safeGold.x}, ${safeGold.y}, ${safeGold.z}), distance: ${safeGold.distance.toFixed(1)}`);
        memory.set('targetGold', safeGold);
        return { action: null, nextState: 'MOVING_TO_GOLD' };
      } else {
        console.log(`[${new Date().toISOString()}] All gold blocks too close to lava`);
      }
    }

    // No gold found, keep searching
    return { action: null, nextState: null };
  },
};

// ============================================================================
// MOVING TO GOLD STATE
// ============================================================================

export const MovingToGoldState: State = {
  name: 'MOVING_TO_GOLD',

  onEnter(context: StateContext): Action | null {
    const target = context.memory.get('targetGold') as BlockInfo;
    if (!target) return null;

    // Create action and store its ID so we can track completion
    const action = createAction('ACTION_TYPE_MOVE_TO', {
      moveTo: { x: target.x, y: target.y, z: target.z, range: 3, sprint: false },
    });
    context.memory.set('pendingActionId', action.actionId);
    context.memory.set('moveStarted', true);
    return action;
  },

  onUpdate(context: StateContext) {
    const { sensorData, memory } = context;

    // Check for lava hazard
    if (isNearLava(sensorData, 3)) {
      memory.delete('targetGold');
      memory.delete('pendingActionId');
      memory.delete('moveStarted');
      return {
        action: createAction('ACTION_TYPE_SPEAK', {
          speak: { message: 'Too close to lava! Finding safer gold...' },
        }),
        nextState: 'SEARCHING_GOLD',
      };
    }

    const target = memory.get('targetGold') as BlockInfo;
    const pendingActionId = memory.get('pendingActionId') as string;
    const pathStatus = sensorData.pathStatus;

    // Check action feedback for our specific action
    const feedback = sensorData.actionFeedback;
    if (feedback && pendingActionId && feedback.actionId === pendingActionId) {
      memory.delete('pendingActionId');

      if (feedback.result === 'ACTION_RESULT_SUCCESS') {
        // Movement completed successfully, now mine
        return { action: null, nextState: 'MINING' };
      } else if (feedback.result === 'ACTION_RESULT_FAILED') {
        memory.delete('targetGold');
        memory.delete('moveStarted');
        return { action: null, nextState: 'SEARCHING_GOLD' };
      }
    }

    // If we're close enough and not moving anymore, transition to mining
    if (target && isWithinRange(sensorData, target, 4) && !pathStatus?.isMoving) {
      memory.delete('pendingActionId');
      memory.delete('moveStarted');
      return { action: null, nextState: 'MINING' };
    }

    // Check path status for failures
    if (pathStatus?.state === 'PATH_STATE_FAILED') {
      memory.delete('targetGold');
      memory.delete('pendingActionId');
      memory.delete('moveStarted');
      return { action: null, nextState: 'SEARCHING_GOLD' };
    }

    // Still waiting for movement to complete
    return { action: null, nextState: null };
  },
};

// ============================================================================
// MINING STATE
// ============================================================================

export const MiningState: State = {
  name: 'MINING',

  onEnter(context: StateContext): Action | null {
    context.memory.set('miningStarted', false);
    context.memory.delete('miningActionId');
    context.memory.delete('miningCheckTime');

    return createAction('ACTION_TYPE_SPEAK', {
      speak: { message: 'Mining gold ore!' },
    });
  },

  onUpdate(context: StateContext) {
    const { sensorData, memory } = context;
    const target = memory.get('targetGold') as BlockInfo;

    // Send the mine action on first update
    if (!memory.get('miningStarted')) {
      memory.set('miningStarted', true);
      if (target) {
        const action = createAction('ACTION_TYPE_MINE_BLOCK', {
          mineBlock: { x: target.x, y: target.y, z: target.z },
        });
        memory.set('miningActionId', action.actionId);
        console.log(`[${new Date().toISOString()}] Sending mine action for block at (${target.x}, ${target.y}, ${target.z})`);
        return {
          action,
          nextState: null,
        };
      }
    }

    const miningActionId = memory.get('miningActionId') as string;

    // Check for completion via action feedback for OUR action
    const feedback = sensorData.actionFeedback;
    if (feedback && miningActionId && feedback.actionId === miningActionId) {
      console.log(`[${new Date().toISOString()}] Mining action completed: ${feedback.result}`);
      memory.delete('targetGold');
      memory.delete('miningStarted');
      memory.delete('miningActionId');
      memory.delete('miningCheckTime');
      return { action: null, nextState: 'SEARCHING_GOLD' };
    }

    // Check if actively mining
    if (sensorData.pathStatus?.isMining) {
      // Reset the timeout since we're still mining
      memory.delete('miningCheckTime');
      return { action: null, nextState: null };
    }

    // Not mining - give it time to start or complete
    if (memory.get('miningStarted') && miningActionId) {
      const miningCheckTime = memory.get('miningCheckTime') as number | undefined;
      if (!miningCheckTime) {
        memory.set('miningCheckTime', Date.now());
      } else if (Date.now() - miningCheckTime > 5000) {
        // 5 seconds without mining activity - assume done or failed
        console.log(`[${new Date().toISOString()}] Mining timeout - assuming block mined`);
        memory.delete('targetGold');
        memory.delete('miningStarted');
        memory.delete('miningActionId');
        memory.delete('miningCheckTime');
        return { action: null, nextState: 'SEARCHING_GOLD' };
      }
    }

    return { action: null, nextState: null };
  },
};

// ============================================================================
// SEARCHING CHEST STATE
// ============================================================================

export const SearchingChestState: State = {
  name: 'SEARCHING_CHEST',

  onEnter(context: StateContext): Action | null {
    return createAction('ACTION_TYPE_SPEAK', {
      speak: { message: 'Inventory full! Looking for chest...' },
    });
  },

  onUpdate(context: StateContext) {
    const { sensorData, memory } = context;
    const chestBlocks = sensorData.nearbyBlocks?.chestBlocks || [];

    if (chestBlocks.length > 0) {
      memory.set('targetChest', chestBlocks[0]);
      return { action: null, nextState: 'MOVING_TO_CHEST' };
    }

    return { action: null, nextState: null };
  },
};

// ============================================================================
// MOVING TO CHEST STATE
// ============================================================================

export const MovingToChestState: State = {
  name: 'MOVING_TO_CHEST',

  onEnter(context: StateContext): Action | null {
    const target = context.memory.get('targetChest') as BlockInfo;
    if (!target) return null;

    return createAction('ACTION_TYPE_MOVE_TO', {
      moveTo: { x: target.x, y: target.y, z: target.z, range: 2, sprint: false },
    });
  },

  onUpdate(context: StateContext) {
    const { sensorData, memory } = context;

    // Check if close enough to deposit
    const target = memory.get('targetChest') as BlockInfo;
    if (target && isWithinRange(sensorData, target, 3)) {
      return { action: null, nextState: 'DEPOSITING' };
    }

    // Check action feedback for failures
    const feedback = sensorData.actionFeedback;
    if (feedback?.result === 'ACTION_RESULT_FAILED') {
      memory.delete('targetChest');
      return { action: null, nextState: 'SEARCHING_CHEST' };
    }

    return { action: null, nextState: null };
  },
};

// ============================================================================
// DEPOSITING STATE
// ============================================================================

export const DepositingState: State = {
  name: 'DEPOSITING',

  onEnter(context: StateContext): Action | null {
    const target = context.memory.get('targetChest') as BlockInfo;
    context.memory.set('depositStarted', false);

    return createAction('ACTION_TYPE_SPEAK', {
      speak: { message: 'Depositing gold in chest!' },
    });
  },

  onUpdate(context: StateContext) {
    const { sensorData, memory } = context;
    const target = memory.get('targetChest') as BlockInfo;

    if (!memory.get('depositStarted')) {
      memory.set('depositStarted', true);
      if (target) {
        return {
          action: createAction('ACTION_TYPE_DEPOSIT_ITEMS', {
            depositItems: {
              chestX: target.x,
              chestY: target.y,
              chestZ: target.z,
              itemNames: ['gold_ore', 'deepslate_gold_ore', 'raw_gold'],
            },
          }),
          nextState: null,
        };
      }
    }

    // Check for completion
    const feedback = sensorData.actionFeedback;
    if (feedback) {
      if (feedback.result === 'ACTION_RESULT_SUCCESS' || feedback.result === 'ACTION_RESULT_FAILED') {
        memory.delete('targetChest');
        memory.delete('depositStarted');
        return { action: null, nextState: 'SEARCHING_GOLD' };
      }
    }

    return { action: null, nextState: null };
  },
};
