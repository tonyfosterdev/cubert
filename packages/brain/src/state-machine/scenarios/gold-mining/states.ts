import { State, StateContext, Action, SensorData, BlockInfo, ActionEvent } from '../../State';
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

    const action = createAction('ACTION_TYPE_MOVE_TO', {
      moveTo: { x: target.x, y: target.y, z: target.z, range: 3, sprint: false },
    });
    context.memory.set('pendingActionId', action.actionId);
    console.log(`[${new Date().toISOString()}] Moving to gold at (${target.x}, ${target.y}, ${target.z})`);
    return action;
  },

  onEvent(context: StateContext, event: ActionEvent) {
    const pendingActionId = context.memory.get('pendingActionId') as string;

    if (event.actionId !== pendingActionId) {
      return { action: null, nextState: null };
    }

    // Clear pending action
    context.memory.delete('pendingActionId');

    if (event.result === 'ACTION_RESULT_SUCCESS') {
      console.log(`[${new Date().toISOString()}] Arrived at gold`);
      return { action: null, nextState: 'MINING' };
    } else {
      console.log(`[${new Date().toISOString()}] Failed to reach gold: ${event.errorMessage}`);
      context.memory.delete('targetGold');
      return { action: null, nextState: 'SEARCHING_GOLD' };
    }
  },

  onUpdate(context: StateContext) {
    const { sensorData, memory } = context;

    // Safety check only - lava hazard
    if (isNearLava(sensorData, 3)) {
      memory.delete('targetGold');
      memory.delete('pendingActionId');
      return {
        action: createAction('ACTION_TYPE_SPEAK', {
          speak: { message: 'Too close to lava! Finding safer gold...' },
        }),
        nextState: 'SEARCHING_GOLD',
      };
    }

    // Wait for onEvent to handle completion
    return { action: null, nextState: null };
  },
};

// ============================================================================
// MINING STATE
// ============================================================================

export const MiningState: State = {
  name: 'MINING',

  onEnter(context: StateContext): Action | null {
    const target = context.memory.get('targetGold') as BlockInfo;
    if (!target) {
      console.log(`[${new Date().toISOString()}] No target gold in memory`);
      return null;
    }

    const action = createAction('ACTION_TYPE_MINE_BLOCK', {
      mineBlock: { x: target.x, y: target.y, z: target.z },
    });
    context.memory.set('miningActionId', action.actionId);

    console.log(`[${new Date().toISOString()}] Mining gold at (${target.x}, ${target.y}, ${target.z})`);
    return action;
  },

  onEvent(context: StateContext, event: ActionEvent) {
    const miningActionId = context.memory.get('miningActionId') as string;

    if (event.actionId !== miningActionId) {
      return { action: null, nextState: null };
    }

    console.log(`[${new Date().toISOString()}] Mining complete: ${event.result}`);

    // Clean up and search for more gold
    context.memory.delete('targetGold');
    context.memory.delete('miningActionId');
    return { action: null, nextState: 'SEARCHING_GOLD' };
  },

  onUpdate(context: StateContext) {
    // No polling needed - onEvent handles completion
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

    const action = createAction('ACTION_TYPE_MOVE_TO', {
      moveTo: { x: target.x, y: target.y, z: target.z, range: 2, sprint: false },
    });
    context.memory.set('pendingActionId', action.actionId);
    console.log(`[${new Date().toISOString()}] Moving to chest at (${target.x}, ${target.y}, ${target.z})`);
    return action;
  },

  onEvent(context: StateContext, event: ActionEvent) {
    const pendingActionId = context.memory.get('pendingActionId') as string;

    if (event.actionId !== pendingActionId) {
      return { action: null, nextState: null };
    }

    context.memory.delete('pendingActionId');

    if (event.result === 'ACTION_RESULT_SUCCESS') {
      console.log(`[${new Date().toISOString()}] Arrived at chest`);
      return { action: null, nextState: 'DEPOSITING' };
    } else {
      console.log(`[${new Date().toISOString()}] Failed to reach chest: ${event.errorMessage}`);
      context.memory.delete('targetChest');
      return { action: null, nextState: 'SEARCHING_CHEST' };
    }
  },

  onUpdate(context: StateContext) {
    // Wait for onEvent
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
    if (!target) return null;

    const action = createAction('ACTION_TYPE_DEPOSIT_ITEMS', {
      depositItems: {
        chestX: target.x,
        chestY: target.y,
        chestZ: target.z,
        itemNames: ['gold_ore', 'deepslate_gold_ore', 'raw_gold'],
      },
    });
    context.memory.set('depositActionId', action.actionId);

    console.log(`[${new Date().toISOString()}] Depositing gold in chest`);
    return action;
  },

  onEvent(context: StateContext, event: ActionEvent) {
    const depositActionId = context.memory.get('depositActionId') as string;

    if (event.actionId !== depositActionId) {
      return { action: null, nextState: null };
    }

    console.log(`[${new Date().toISOString()}] Deposit complete: ${event.result}`);

    context.memory.delete('targetChest');
    context.memory.delete('depositActionId');
    return { action: null, nextState: 'SEARCHING_GOLD' };
  },

  onUpdate(context: StateContext) {
    // Wait for onEvent
    return { action: null, nextState: null };
  },
};
