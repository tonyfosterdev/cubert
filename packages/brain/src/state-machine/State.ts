export interface SensorData {
  timestamp: string;
  botId: string;
  position: {
    x: number;
    y: number;
    z: number;
    yaw: number;
    pitch: number;
    onGround: boolean;
  };
  inventory: {
    slots: Array<{ slotIndex: number; itemName: string; count: number }>;
    selectedSlot: number;
  };
  health: {
    health: number;
    food: number;
    saturation: number;
    oxygen: number;
  };
  nearbyBlocks: {
    goldBlocks: BlockInfo[];
    lavaBlocks: BlockInfo[];
    chestBlocks: BlockInfo[];
    hazardBlocks: BlockInfo[];
  };
  pathStatus: {
    state: string;
    isMoving: boolean;
    isMining: boolean;
    targetBlock: BlockInfo | null;
  };
  actionFeedback: {
    actionId: string;
    result: string;
    errorMessage?: string;
  } | null;
}

export interface BlockInfo {
  x: number;
  y: number;
  z: number;
  blockName: string;
  distance: number;
}

export interface Action {
  actionId: string;
  timestamp: string;
  type: string;
  moveTo?: { x: number; y: number; z: number; range: number; sprint: boolean };
  mineBlock?: { x: number; y: number; z: number };
  depositItems?: { chestX: number; chestY: number; chestZ: number; itemNames: string[] };
  speak?: { message: string };
  idle?: { durationMs: number };
  cancel?: { targetActionId: string };
}

export interface StateContext {
  sensorData: SensorData;
  memory: Map<string, any>;
}

export interface StateResult {
  action: Action | null;
  nextState: string | null;
}

export interface State {
  name: string;
  onEnter?(context: StateContext): Action | null;
  onUpdate(context: StateContext): StateResult;
  onExit?(context: StateContext): void;
}
