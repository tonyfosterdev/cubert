# Semi-Autonomous Minecraft Bot Journal

## 2026-01-21 Implementation Complete

### Commits Made

1. **828aade** - Add ChatMessage to proto and Body ChatListener
2. **bc4ec75** - Add ThoughtBrain with LLM interpreter for chat commands
3. **50c5212** - Add player tracking and ToolResolver for movement commands
4. **a4faaaf** - Add CommandQueue for sequential multi-step execution
5. **66c1773** - Improve LLM prompt with command patterns for mining
6. **b505fd9** - Implement stop command with interrupt handling
7. **d43617e** - Add brain metrics for LLM and command queue monitoring

### Files Created/Modified

**Proto:**
- `proto/cubert.proto` - Added ChatMessage, PlayerInfo to BodyMessage

**Body Package:**
- `packages/body/src/chat/ChatListener.ts` - Listens to Minecraft chat
- `packages/body/src/chat/index.ts` - Module exports
- `packages/body/src/sensors/PlayerSensor.ts` - Tracks nearby players
- `packages/body/src/grpc/client.ts` - Added sendChatMessage()
- `packages/body/src/sensors/index.ts` - Added PlayerSensor
- `packages/body/src/config.ts` - Added playerSearchCount

**Brain Package:**
- `packages/brain/src/thought/Thought.ts` - Thought abstraction
- `packages/brain/src/thought/index.ts` - Module exports
- `packages/brain/src/llm/LLMInterpreter.ts` - Claude API integration
- `packages/brain/src/llm/ToolResolver.ts` - Target resolution
- `packages/brain/src/llm/index.ts` - Module exports
- `packages/brain/src/command/CommandQueue.ts` - FIFO command queue
- `packages/brain/src/command/index.ts` - Module exports
- `packages/brain/src/brains/ThoughtBrain.ts` - LLM-based brain
- `packages/brain/src/brains/index.ts` - Module exports
- `packages/brain/src/metrics.ts` - Prometheus metrics
- `packages/brain/src/grpc/server.ts` - Handle ChatMessage, Brain abstraction
- `packages/brain/src/config.ts` - Added LLM config
- `packages/brain/src/index.ts` - Added semi-autonomous scenario
- `packages/brain/src/types.ts` - Added PlayerInfo
- `packages/brain/src/state-machine/State.ts` - Added PlayerInfo

**Infrastructure:**
- `prometheus.yml` - Added brain scrape job

### Key Design Decisions

1. **Thought Abstraction**: All inputs become "Thoughts" (currently chat, future sensors)
2. **CommandQueue**: Multi-step commands execute sequentially, not all at once
3. **ToolResolver**: Resolves abstract targets (player, gold, chest) to coordinates
4. **LLM Tool Schema**: 6 tools (speak, move_to, mine_block, deposit_items, stop, wait)
5. **Brain Abstraction**: Server supports both StateMachine and ThoughtBrain

### How to Use

1. Set environment variables:
   ```bash
   export SCENARIO=semi-autonomous
   export ANTHROPIC_API_KEY=your-key
   ```

2. Start the bot and brain

3. In Minecraft, type commands like:
   - "hello" → Bot greets you
   - "come here" → Bot moves to your position
   - "mine that gold" → Bot moves to gold and mines it
   - "deposit" → Bot deposits items in chest
   - "stop" → Bot stops current action

### Metrics Available

- `cubert_llm_calls_total{status}` - LLM API calls
- `cubert_llm_latency_seconds` - LLM response time
- `cubert_thoughts_processed_total{source}` - Thoughts processed
- `cubert_commands_queued_total{tool}` - Commands by type
- `cubert_command_queue_length` - Current queue depth

### Next Steps (Future)

1. Add sensor-driven thoughts (autonomous exploration)
2. Add safety behaviors (flee from danger)
3. Improve error handling and retry logic
4. Add conversation memory for context
