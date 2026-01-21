/**
 * LLMInterpreter - Converts thoughts to tool calls via Claude API.
 *
 * Takes a thought (e.g., chat message) and sensor context,
 * returns an array of tool calls (commands) to execute.
 */

import Anthropic from '@anthropic-ai/sdk';
import { SensorData } from '../types';
import { Thought } from '../thought';

export interface ToolCall {
  tool: string;
  args: Record<string, any>;
}

export interface LLMConfig {
  model: string;
  maxTokens: number;
}

// Tool definitions for Claude
const TOOLS: Anthropic.Tool[] = [
  {
    name: 'speak',
    description: 'Say a message in Minecraft chat. Use this to respond to the player.',
    input_schema: {
      type: 'object' as const,
      properties: {
        message: {
          type: 'string',
          description: 'The message to say in chat',
        },
      },
      required: ['message'],
    },
  },
  {
    name: 'move_to',
    description: 'Move to a target location. Can be player, gold, chest, or specific coordinates.',
    input_schema: {
      type: 'object' as const,
      properties: {
        target: {
          type: 'string',
          description: 'Target: "player", "gold", "chest", or coordinates like "100,64,200"',
        },
      },
      required: ['target'],
    },
  },
  {
    name: 'mine_block',
    description: 'Mine a block at a target location.',
    input_schema: {
      type: 'object' as const,
      properties: {
        target: {
          type: 'string',
          description: 'Target: "nearest_gold" or coordinates like "100,64,200"',
        },
      },
      required: ['target'],
    },
  },
  {
    name: 'deposit_items',
    description: 'Deposit items into a nearby chest.',
    input_schema: {
      type: 'object' as const,
      properties: {
        items: {
          type: 'array',
          items: { type: 'string' },
          description: 'Item names to deposit. Empty array means all items.',
        },
      },
      required: [],
    },
  },
  {
    name: 'stop',
    description: 'Stop current action and clear command queue.',
    input_schema: {
      type: 'object' as const,
      properties: {
        interrupt: {
          type: 'boolean',
          description: 'If true, immediately cancel current action',
        },
      },
      required: [],
    },
  },
  {
    name: 'wait',
    description: 'Wait for a specified duration.',
    input_schema: {
      type: 'object' as const,
      properties: {
        duration_ms: {
          type: 'number',
          description: 'Duration to wait in milliseconds',
        },
      },
      required: ['duration_ms'],
    },
  },
];

export class LLMInterpreter {
  private client: Anthropic;
  private config: LLMConfig;

  constructor(config: LLMConfig) {
    this.client = new Anthropic();
    this.config = config;
  }

  async interpret(thought: Thought, sensors: SensorData): Promise<ToolCall[]> {
    const systemPrompt = this.buildSystemPrompt(sensors);
    const userMessage = this.buildUserMessage(thought);

    console.log(`[LLM] Interpreting thought: "${thought.content}"`);

    try {
      const response = await this.client.messages.create({
        model: this.config.model,
        max_tokens: this.config.maxTokens,
        system: systemPrompt,
        tools: TOOLS,
        messages: [{ role: 'user', content: userMessage }],
      });

      return this.extractToolCalls(response);
    } catch (error) {
      console.error('[LLM] Error calling Claude:', error);
      // Return a speak action to indicate error
      return [{ tool: 'speak', args: { message: "Sorry, I couldn't process that request." } }];
    }
  }

  private buildSystemPrompt(sensors: SensorData): string {
    const pos = sensors.position;
    const gold = sensors.nearbyBlocks?.goldBlocks || [];
    const chests = sensors.nearbyBlocks?.chestBlocks || [];
    const players = sensors.nearbyPlayers || [];
    const inventory = sensors.inventory?.slots || [];

    const goldItems = inventory.filter(s =>
      ['gold_ore', 'deepslate_gold_ore', 'raw_gold'].includes(s.itemName)
    );
    const goldCount = goldItems.reduce((sum, s) => sum + s.count, 0);

    return `You are a helpful Minecraft bot. Convert player commands to tool calls.

## Current State
Position: (${Math.floor(pos?.x || 0)}, ${Math.floor(pos?.y || 0)}, ${Math.floor(pos?.z || 0)})
Health: ${sensors.health?.health || 20}/20
Gold in inventory: ${goldCount}
Nearby gold blocks: ${gold.length > 0 ? gold.map(g => `(${g.x},${g.y},${g.z})`).join(', ') : 'none'}
Nearby chests: ${chests.length > 0 ? chests.map(c => `(${c.x},${c.y},${c.z})`).join(', ') : 'none'}
Nearby players: ${players.length > 0 ? players.map(p => `${p.username} at (${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)})`).join(', ') : 'none'}

## Instructions
- Always acknowledge commands with a brief speak first
- Be concise in chat messages (Minecraft has character limits)
- For greetings, just respond with speak

## Command Patterns
- "come here" / "come to me" → speak + move_to(player)
- "mine gold" / "mine that gold" → speak + move_to(gold) + mine_block(nearest_gold)
- "deposit" / "put items in chest" → speak + move_to(chest) + deposit_items
- "stop" → speak + stop(interrupt: true)
- If unsure what the player wants, ask for clarification via speak`;
  }

  private buildUserMessage(thought: Thought): string {
    const sender = thought.metadata.sender || 'Unknown';
    return `Player "${sender}" said: "${thought.content}"`;
  }

  private extractToolCalls(response: Anthropic.Message): ToolCall[] {
    const toolCalls: ToolCall[] = [];

    for (const block of response.content) {
      if (block.type === 'tool_use') {
        toolCalls.push({
          tool: block.name,
          args: block.input as Record<string, any>,
        });
      }
    }

    console.log(`[LLM] Extracted ${toolCalls.length} tool call(s):`, toolCalls.map(t => t.tool));
    return toolCalls;
  }
}
