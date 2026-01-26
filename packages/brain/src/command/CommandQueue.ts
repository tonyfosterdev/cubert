/**
 * CommandQueue - FIFO queue for commands derived from LLM tool calls.
 *
 * Enables multi-step execution: "mine gold" becomes:
 * 1. speak("Mining the gold!")
 * 2. move_to(gold position)
 * 3. mine_block(gold position)
 *
 * Each command is executed in order, waiting for completion before next.
 */

import { Action } from '../types';
import { logger } from '../logger';

export interface Command {
  id: string;
  action: Action;
  description: string;
}

export class CommandQueue {
  private queue: Command[] = [];
  private currentCommand: Command | null = null;

  /**
   * Add commands to the queue.
   */
  enqueue(...commands: Command[]): void {
    this.queue.push(...commands);
    logger.debug({ count: commands.length, queueLength: this.queue.length }, 'Commands enqueued');
  }

  /**
   * Get the next command to execute.
   * Returns null if queue is empty or a command is in progress.
   */
  dequeue(): Command | null {
    if (this.currentCommand !== null) {
      // Command in progress, wait for completion
      return null;
    }

    if (this.queue.length === 0) {
      return null;
    }

    this.currentCommand = this.queue.shift()!;
    logger.info({ command: this.currentCommand.description }, 'Executing command');
    return this.currentCommand;
  }

  /**
   * Mark the current command as complete.
   */
  complete(actionId: string): boolean {
    if (this.currentCommand && this.currentCommand.action.actionId === actionId) {
      logger.debug({ command: this.currentCommand.description }, 'Command completed');
      this.currentCommand = null;
      return true;
    }
    return false;
  }

  /**
   * Clear all pending commands.
   */
  clear(): void {
    const count = this.queue.length;
    this.queue = [];
    logger.debug({ cleared: count }, 'Cleared pending commands');
  }

  /**
   * Clear all commands including current.
   */
  clearAll(): void {
    this.clear();
    if (this.currentCommand) {
      logger.debug({ command: this.currentCommand.description }, 'Cancelled current command');
      this.currentCommand = null;
    }
  }

  /**
   * Check if there are commands waiting.
   */
  hasPending(): boolean {
    return this.queue.length > 0;
  }

  /**
   * Check if a command is currently executing.
   */
  hasInProgress(): boolean {
    return this.currentCommand !== null;
  }

  /**
   * Get the current command in progress.
   */
  getCurrentCommand(): Command | null {
    return this.currentCommand;
  }

  /**
   * Get queue length.
   */
  length(): number {
    return this.queue.length;
  }

  /**
   * Get the current action ID if one is in progress.
   */
  getCurrentActionId(): string | null {
    return this.currentCommand?.action.actionId ?? null;
  }
}
