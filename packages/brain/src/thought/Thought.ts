/**
 * Thought - Abstraction for any input that requires brain processing.
 *
 * Currently from chat, future from sensors (e.g., "I see gold nearby!").
 */

export type ThoughtSource = 'chat' | 'sensor' | 'timer';

export interface Thought {
  id: string;
  timestamp: number;
  source: ThoughtSource;
  content: string;
  metadata: {
    sender?: string;
    sensorType?: string;
  };
}

export interface ChatMessage {
  timestamp: number;
  sender: string;
  message: string;
}

let thoughtCounter = 0;

export function createChatThought(chat: ChatMessage): Thought {
  return {
    id: `thought-${++thoughtCounter}`,
    timestamp: chat.timestamp,
    source: 'chat',
    content: chat.message,
    metadata: {
      sender: chat.sender,
    },
  };
}

export function createSensorThought(content: string, sensorType: string): Thought {
  return {
    id: `thought-${++thoughtCounter}`,
    timestamp: Date.now(),
    source: 'sensor',
    content,
    metadata: {
      sensorType,
    },
  };
}
