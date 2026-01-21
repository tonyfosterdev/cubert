/**
 * ThoughtBrain - Brain implementation that processes thoughts via LLM.
 *
 * Converts chat messages to thoughts, interprets via LLM, and executes tool calls.
 * Designed for semi-autonomous operation where user sends plain English commands.
 */

import { v4 as uuidv4 } from 'uuid';
import { SensorData, Action, ActionEvent } from '../types';
import { Thought, ChatMessage, createChatThought } from '../thought';
import { LLMInterpreter, ToolCall, LLMConfig } from '../llm';

export interface ThoughtBrainConfig {
  llm: LLMConfig;
}

export class ThoughtBrain {
  private interpreter: LLMInterpreter;
  private sensors: SensorData = {} as SensorData;
  private currentAction: { actionId: string; type: string } | null = null;
  private thoughtQueue: Thought[] = [];
  private isProcessing = false;
  private pendingActions: Action[] = [];

  constructor(config: ThoughtBrainConfig) {
    this.interpreter = new LLMInterpreter(config.llm);
  }

  async onConnect(initialData: SensorData): Promise<Action[]> {
    console.log('[ThoughtBrain] Connected');
    this.sensors = initialData;
    this.currentAction = null;
    this.thoughtQueue = [];
    this.pendingActions = [];

    // Say hello on connect
    return [this.createSpeakAction('Ready to help!')];
  }

  async onSensorUpdate(data: SensorData): Promise<Action[]> {
    this.sensors = data;

    // Process any queued thoughts if not currently processing
    if (!this.isProcessing && this.thoughtQueue.length > 0) {
      return this.processNextThought();
    }

    return [];
  }

  async onActionComplete(event: ActionEvent): Promise<Action[]> {
    console.log(`[ThoughtBrain] Action complete: ${event.actionId} -> ${event.result}`);

    if (this.currentAction && event.actionId === this.currentAction.actionId) {
      this.currentAction = null;
    }

    // Process next thought if queue is not empty
    if (!this.isProcessing && this.thoughtQueue.length > 0) {
      return this.processNextThought();
    }

    return [];
  }

  async onChatMessage(chat: ChatMessage): Promise<Action[]> {
    console.log(`[ThoughtBrain] Chat from ${chat.sender}: "${chat.message}"`);

    const thought = createChatThought(chat);
    this.thoughtQueue.push(thought);

    // Process immediately if not currently processing
    if (!this.isProcessing) {
      return this.processNextThought();
    }

    return [];
  }

  private async processNextThought(): Promise<Action[]> {
    if (this.thoughtQueue.length === 0) {
      return [];
    }

    this.isProcessing = true;
    const thought = this.thoughtQueue.shift()!;

    try {
      const toolCalls = await this.interpreter.interpret(thought, this.sensors);
      const actions = this.convertToolCallsToActions(toolCalls);

      this.isProcessing = false;
      return actions;
    } catch (error) {
      console.error('[ThoughtBrain] Error processing thought:', error);
      this.isProcessing = false;
      return [this.createSpeakAction('Sorry, something went wrong.')];
    }
  }

  private convertToolCallsToActions(toolCalls: ToolCall[]): Action[] {
    const actions: Action[] = [];

    for (const call of toolCalls) {
      const action = this.toolCallToAction(call);
      if (action) {
        actions.push(action);
      }
    }

    return actions;
  }

  private toolCallToAction(call: ToolCall): Action | null {
    switch (call.tool) {
      case 'speak':
        return this.createSpeakAction(call.args.message);

      case 'move_to':
        return this.createMoveToAction(call.args.target);

      case 'mine_block':
        return this.createMineBlockAction(call.args.target);

      case 'deposit_items':
        return this.createDepositAction(call.args.items);

      case 'stop':
        // For now, just acknowledge - full interrupt handling in later commit
        return this.createSpeakAction('Stopping.');

      case 'wait':
        return this.createIdleAction(call.args.duration_ms || 1000);

      default:
        console.warn(`[ThoughtBrain] Unknown tool: ${call.tool}`);
        return null;
    }
  }

  private createSpeakAction(message: string): Action {
    const action: Action = {
      actionId: uuidv4(),
      timestamp: Date.now().toString(),
      type: 'ACTION_TYPE_SPEAK',
      speak: { message },
    };
    this.currentAction = { actionId: action.actionId, type: action.type };
    return action;
  }

  private createMoveToAction(target: string): Action | null {
    const position = this.resolveTarget(target);
    if (!position) {
      console.warn(`[ThoughtBrain] Could not resolve target: ${target}`);
      return this.createSpeakAction(`I can't find ${target}.`);
    }

    const action: Action = {
      actionId: uuidv4(),
      timestamp: Date.now().toString(),
      type: 'ACTION_TYPE_MOVE_TO',
      moveTo: {
        x: position.x,
        y: position.y,
        z: position.z,
        range: 2,
        sprint: false,
      },
    };
    this.currentAction = { actionId: action.actionId, type: action.type };
    return action;
  }

  private createMineBlockAction(target: string): Action | null {
    const position = this.resolveMineTarget(target);
    if (!position) {
      console.warn(`[ThoughtBrain] Could not resolve mine target: ${target}`);
      return this.createSpeakAction(`I can't find any ${target} to mine.`);
    }

    const action: Action = {
      actionId: uuidv4(),
      timestamp: Date.now().toString(),
      type: 'ACTION_TYPE_MINE_BLOCK',
      mineBlock: {
        x: position.x,
        y: position.y,
        z: position.z,
      },
    };
    this.currentAction = { actionId: action.actionId, type: action.type };
    return action;
  }

  private createDepositAction(items?: string[]): Action | null {
    const chest = this.sensors.nearbyBlocks?.chestBlocks?.[0];
    if (!chest) {
      return this.createSpeakAction("I don't see any chests nearby.");
    }

    const action: Action = {
      actionId: uuidv4(),
      timestamp: Date.now().toString(),
      type: 'ACTION_TYPE_DEPOSIT_ITEMS',
      depositItems: {
        chestX: chest.x,
        chestY: chest.y,
        chestZ: chest.z,
        itemNames: items || [],
      },
    };
    this.currentAction = { actionId: action.actionId, type: action.type };
    return action;
  }

  private createIdleAction(durationMs: number): Action {
    const action: Action = {
      actionId: uuidv4(),
      timestamp: Date.now().toString(),
      type: 'ACTION_TYPE_IDLE',
      idle: { durationMs },
    };
    this.currentAction = { actionId: action.actionId, type: action.type };
    return action;
  }

  private resolveTarget(target: string): { x: number; y: number; z: number } | null {
    // Handle coordinate format "x,y,z"
    if (target.includes(',')) {
      const [x, y, z] = target.split(',').map(Number);
      if (!isNaN(x) && !isNaN(y) && !isNaN(z)) {
        return { x, y, z };
      }
    }

    // Handle named targets
    switch (target.toLowerCase()) {
      case 'gold':
      case 'gold_ore':
      case 'nearest_gold': {
        const gold = this.sensors.nearbyBlocks?.goldBlocks?.[0];
        return gold ? { x: gold.x, y: gold.y, z: gold.z } : null;
      }

      case 'chest': {
        const chest = this.sensors.nearbyBlocks?.chestBlocks?.[0];
        return chest ? { x: chest.x, y: chest.y, z: chest.z } : null;
      }

      case 'player':
        // For now, we don't have player position from sensors
        // This will be resolved in ToolResolver (Commit 3)
        console.warn('[ThoughtBrain] Player target not yet implemented');
        return null;

      default:
        return null;
    }
  }

  private resolveMineTarget(target: string): { x: number; y: number; z: number } | null {
    // Handle coordinate format "x,y,z"
    if (target.includes(',')) {
      const [x, y, z] = target.split(',').map(Number);
      if (!isNaN(x) && !isNaN(y) && !isNaN(z)) {
        return { x, y, z };
      }
    }

    // Handle named targets
    switch (target.toLowerCase()) {
      case 'gold':
      case 'gold_ore':
      case 'nearest_gold': {
        const gold = this.sensors.nearbyBlocks?.goldBlocks?.[0];
        return gold ? { x: gold.x, y: gold.y, z: gold.z } : null;
      }

      default:
        return null;
    }
  }

  reset(): void {
    this.sensors = {} as SensorData;
    this.currentAction = null;
    this.thoughtQueue = [];
    this.isProcessing = false;
    this.pendingActions = [];
    console.log('[ThoughtBrain] Reset');
  }
}
