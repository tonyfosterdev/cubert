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
  nearbyPlayers: PlayerInfo[];
}

export interface PlayerInfo {
  username: string;
  x: number;
  y: number;
  z: number;
  distance: number;
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
  moveTo?: { x: number; y: number; z: number; range: number; sprint: boolean; ignoreDanger?: boolean };
  mineBlock?: { x: number; y: number; z: number };
  depositItems?: { chestX: number; chestY: number; chestZ: number; itemNames: string[] };
  withdrawItems?: { chestX: number; chestY: number; chestZ: number; itemNames: string[]; count: number };
  speak?: { message: string };
  idle?: { durationMs: number };
  cancel?: { targetActionId: string };
}

export interface ActionEvent {
  actionId: string;
  result: string;
  errorMessage?: string;
  eventType: string;
}
