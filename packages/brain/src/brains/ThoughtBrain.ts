/**
 * ThoughtBrain - Brain implementation that processes thoughts via LLM.
 *
 * Converts chat messages to thoughts, interprets via LLM, and executes tool calls.
 * Designed for semi-autonomous operation where user sends plain English commands.
 */

import { v4 as uuidv4 } from 'uuid';
import { SensorData, Action, ActionEvent } from '../types';
import { Thought, ChatMessage, createChatThought } from '../thought';
import { LLMInterpreter, ToolCall, LLMConfig, ToolResolver } from '../llm';
import { CommandQueue, Command } from '../command';
import { thoughtsProcessedTotal, commandsQueuedTotal, commandQueueLength } from '../metrics';

export interface ThoughtBrainConfig {
  llm: LLMConfig;
}

export class ThoughtBrain {
  private interpreter: LLMInterpreter;
  private sensors: SensorData = {} as SensorData;
  private commandQueue: CommandQueue = new CommandQueue();
  private thoughtQueue: Thought[] = [];
  private isProcessing = false;

  constructor(config: ThoughtBrainConfig) {
    this.interpreter = new LLMInterpreter(config.llm);
  }

  async onConnect(initialData: SensorData): Promise<Action[]> {
    console.log('[ThoughtBrain] Connected');
    this.sensors = initialData;
    this.commandQueue.clearAll();
    this.thoughtQueue = [];
    this.isProcessing = false;

    // Say hello on connect
    const action = this.createSpeakAction('Ready to help!');
    return [action];
  }

  async onSensorUpdate(data: SensorData): Promise<Action[]> {
    this.sensors = data;

    // Try to execute next command if nothing is in progress
    const nextAction = this.tryExecuteNextCommand();
    if (nextAction) {
      return [nextAction];
    }

    // Process any queued thoughts if not currently processing
    if (!this.isProcessing && this.thoughtQueue.length > 0 && !this.commandQueue.hasInProgress()) {
      return this.processNextThought();
    }

    return [];
  }

  async onActionComplete(event: ActionEvent): Promise<Action[]> {
    console.log(`[ThoughtBrain] Action complete: ${event.actionId} -> ${event.result}`);

    // Mark command as complete
    this.commandQueue.complete(event.actionId);

    // Try to execute next command
    const nextAction = this.tryExecuteNextCommand();
    if (nextAction) {
      return [nextAction];
    }

    // Process next thought if queue is not empty
    if (!this.isProcessing && this.thoughtQueue.length > 0 && !this.commandQueue.hasInProgress()) {
      return this.processNextThought();
    }

    return [];
  }

  private tryExecuteNextCommand(): Action | null {
    const command = this.commandQueue.dequeue();
    if (command) {
      // Update queue length metric
      commandQueueLength.set(this.commandQueue.length());
      return command.action;
    }
    return null;
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

    // Track thought processing
    thoughtsProcessedTotal.inc({ source: thought.source });

    try {
      const toolCalls = await this.interpreter.interpret(thought, this.sensors);
      const commands = this.convertToolCallsToCommands(toolCalls);

      // Track commands queued
      for (const cmd of commands) {
        const toolName = cmd.description.split(':')[0].toLowerCase().replace('say', 'speak');
        commandsQueuedTotal.inc({ tool: toolName });
      }

      // Check if we have a pending cancel action (from stop command)
      const actions: Action[] = [];
      if (this.pendingCancelAction) {
        actions.push(this.pendingCancelAction);
        this.pendingCancelAction = null;
      }

      // Queue all commands
      if (commands.length > 0) {
        this.commandQueue.enqueue(...commands);
      }

      // Update queue length metric
      commandQueueLength.set(this.commandQueue.length());

      this.isProcessing = false;

      // Execute first command immediately
      const firstAction = this.tryExecuteNextCommand();
      if (firstAction) {
        actions.push(firstAction);
      }

      return actions;
    } catch (error) {
      console.error('[ThoughtBrain] Error processing thought:', error);
      this.isProcessing = false;
      return [this.createSpeakAction('Sorry, something went wrong.')];
    }
  }

  private convertToolCallsToCommands(toolCalls: ToolCall[]): Command[] {
    const commands: Command[] = [];

    for (const call of toolCalls) {
      // Handle stop specially - it clears the queue immediately
      if (call.tool === 'stop') {
        this.handleStopCommand(call.args.interrupt);
        // Add speak acknowledgment
        const speakAction = this.createSpeakAction('Stopping.');
        commands.push({
          id: speakAction.actionId,
          action: speakAction,
          description: 'Say: "Stopping."',
        });
        continue;
      }

      const command = this.toolCallToCommand(call);
      if (command) {
        commands.push(command);
      }
    }

    return commands;
  }

  private handleStopCommand(interrupt?: boolean): void {
    console.log('[ThoughtBrain] Stop command received');

    // Clear all pending commands
    this.commandQueue.clear();

    // If interrupt is true and there's a current action, we should cancel it
    // The cancel action will be handled by the body
    if (interrupt && this.commandQueue.hasInProgress()) {
      const currentActionId = this.commandQueue.getCurrentActionId();
      if (currentActionId) {
        console.log(`[ThoughtBrain] Cancelling current action: ${currentActionId}`);
        // Create a cancel action - this will be emitted immediately
        this.pendingCancelAction = this.createCancelAction(currentActionId);
      }
      this.commandQueue.clearAll();
    }
  }

  private pendingCancelAction: Action | null = null;

  private toolCallToCommand(call: ToolCall): Command | null {
    const action = this.toolCallToAction(call);
    if (!action) return null;

    return {
      id: action.actionId,
      action,
      description: this.getCommandDescription(call),
    };
  }

  private getCommandDescription(call: ToolCall): string {
    switch (call.tool) {
      case 'speak':
        return `Say: "${call.args.message}"`;
      case 'move_to':
        return `Move to: ${call.args.target}`;
      case 'mine_block':
        return `Mine: ${call.args.target}`;
      case 'deposit_items':
        return `Deposit items`;
      case 'stop':
        return `Stop`;
      case 'wait':
        return `Wait ${call.args.duration_ms}ms`;
      default:
        return `Unknown: ${call.tool}`;
    }
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
        // Handled specially in convertToolCallsToCommands
        return null;

      case 'wait':
        return this.createIdleAction(call.args.duration_ms || 1000);

      default:
        console.warn(`[ThoughtBrain] Unknown tool: ${call.tool}`);
        return null;
    }
  }

  private createSpeakAction(message: string): Action {
    return {
      actionId: uuidv4(),
      timestamp: Date.now().toString(),
      type: 'ACTION_TYPE_SPEAK',
      speak: { message },
    };
  }

  private createMoveToAction(target: string): Action | null {
    const position = this.resolveTarget(target);
    if (!position) {
      console.warn(`[ThoughtBrain] Could not resolve target: ${target}`);
      return this.createSpeakAction(`I can't find ${target}.`);
    }

    return {
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
  }

  private createMineBlockAction(target: string): Action | null {
    const position = this.resolveMineTarget(target);
    if (!position) {
      console.warn(`[ThoughtBrain] Could not resolve mine target: ${target}`);
      return this.createSpeakAction(`I can't find any ${target} to mine.`);
    }

    return {
      actionId: uuidv4(),
      timestamp: Date.now().toString(),
      type: 'ACTION_TYPE_MINE_BLOCK',
      mineBlock: {
        x: position.x,
        y: position.y,
        z: position.z,
      },
    };
  }

  private createDepositAction(items?: string[]): Action | null {
    const chest = this.sensors.nearbyBlocks?.chestBlocks?.[0];
    if (!chest) {
      return this.createSpeakAction("I don't see any chests nearby.");
    }

    return {
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
  }

  private createIdleAction(durationMs: number): Action {
    return {
      actionId: uuidv4(),
      timestamp: Date.now().toString(),
      type: 'ACTION_TYPE_IDLE',
      idle: { durationMs },
    };
  }

  private createCancelAction(targetActionId: string): Action {
    return {
      actionId: uuidv4(),
      timestamp: Date.now().toString(),
      type: 'ACTION_TYPE_CANCEL',
      cancel: { targetActionId },
    };
  }

  private resolveTarget(target: string): { x: number; y: number; z: number; name?: string } | null {
    const resolver = new ToolResolver(this.sensors);
    const result = resolver.resolveMovementTarget(target);

    if (result.position) {
      return { ...result.position, name: result.name };
    }

    if (result.error) {
      console.warn(`[ThoughtBrain] ${result.error}`);
    }
    return null;
  }

  private resolveMineTarget(target: string): { x: number; y: number; z: number } | null {
    const resolver = new ToolResolver(this.sensors);
    const result = resolver.resolveMiningTarget(target);

    if (result.position) {
      return result.position;
    }

    if (result.error) {
      console.warn(`[ThoughtBrain] ${result.error}`);
    }
    return null;
  }

  reset(): void {
    this.sensors = {} as SensorData;
    this.commandQueue.clearAll();
    this.thoughtQueue = [];
    this.isProcessing = false;
    this.pendingCancelAction = null;
    console.log('[ThoughtBrain] Reset');
  }

  /**
   * Get the current command queue for inspection.
   */
  getCommandQueue(): CommandQueue {
    return this.commandQueue;
  }
}
