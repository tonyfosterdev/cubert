import { Bot } from 'mineflayer';

export interface ChatMessage {
  timestamp: number;
  sender: string;
  message: string;
}

export type ChatHandler = (msg: ChatMessage) => void;

/**
 * Listens to Minecraft chat messages and forwards them to a handler.
 * Filters out messages from the bot itself to avoid infinite loops.
 */
export class ChatListener {
  private bot: Bot;
  private onChat: ChatHandler;

  constructor(bot: Bot, onChat: ChatHandler) {
    this.bot = bot;
    this.onChat = onChat;
    this.setupListener();
  }

  private setupListener(): void {
    this.bot.on('chat', (username: string, message: string) => {
      // Ignore messages from the bot itself
      if (username === this.bot.username) {
        return;
      }

      console.log(`[CHAT] ${username}: ${message}`);

      this.onChat({
        timestamp: Date.now(),
        sender: username,
        message: message,
      });
    });
  }
}
