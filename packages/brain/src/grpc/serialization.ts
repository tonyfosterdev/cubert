import { SensorData, Action, ActionEvent } from '../types';
import { ChatMessage } from '../thought';

export function deserializeSensorData(msg: any): SensorData {
  return {
    timestamp: msg.timestamp,
    botId: msg.botId,
    position: {
      x: msg.position?.x || 0,
      y: msg.position?.y || 0,
      z: msg.position?.z || 0,
      yaw: msg.position?.yaw || 0,
      pitch: msg.position?.pitch || 0,
      onGround: msg.position?.onGround || false,
    },
    inventory: {
      slots: (msg.inventory?.slots || []).map((s: any) => ({
        slotIndex: s.slotIndex,
        itemName: s.itemName,
        count: s.count,
      })),
      selectedSlot: msg.inventory?.selectedSlot || 0,
    },
    health: {
      health: msg.health?.health || 20,
      food: msg.health?.food || 20,
      saturation: msg.health?.saturation || 5,
      oxygen: msg.health?.oxygen || 20,
    },
    nearbyBlocks: {
      goldBlocks: msg.nearbyBlocks?.goldBlocks || [],
      lavaBlocks: msg.nearbyBlocks?.lavaBlocks || [],
      chestBlocks: msg.nearbyBlocks?.chestBlocks || [],
      hazardBlocks: msg.nearbyBlocks?.hazardBlocks || [],
    },
    pathStatus: {
      state: msg.pathStatus?.state || 'PATH_STATE_IDLE',
      isMoving: msg.pathStatus?.isMoving || false,
      isMining: msg.pathStatus?.isMining || false,
      targetBlock: msg.pathStatus?.targetBlock || null,
    },
    nearbyPlayers: (msg.nearbyPlayers || []).map((p: any) => ({
      username: p.username || '',
      x: p.x || 0,
      y: p.y || 0,
      z: p.z || 0,
      distance: p.distance || 0,
    })),
  };
}

export function deserializeActionEvent(msg: any): ActionEvent {
  return {
    actionId: msg.actionId || msg.action_id,
    result: msg.result,
    errorMessage: msg.errorMessage || msg.error_message,
    eventType: msg.eventType || msg.event_type,
  };
}

export function deserializeChatMessage(msg: any): ChatMessage {
  return {
    timestamp: parseInt(msg.timestamp) || Date.now(),
    sender: msg.sender || 'unknown',
    message: msg.message || '',
  };
}

export function serializeAction(action: Action): any {
  return {
    actionId: action.actionId,
    timestamp: action.timestamp,
    type: action.type,
    moveTo: action.moveTo,
    mineBlock: action.mineBlock,
    depositItems: action.depositItems,
    withdrawItems: action.withdrawItems,
    speak: action.speak,
    idle: action.idle,
    cancel: action.cancel,
  };
}
