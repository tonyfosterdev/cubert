# Manual Test Scenarios for Semi-Autonomous Bot

This document describes 5 manual test scenarios to run through the docker stack with the **real LLM**. Used to validate behavior, iterate on prompts, and catch issues.

**Purpose:** After making changes, run a scenario to verify the system works end-to-end.

---

## Setup

### Start the Stack
```bash
# Set API key
export ANTHROPIC_API_KEY=your-key

# Start with semi-autonomous scenario
SCENARIO=semi-autonomous docker compose up --build
```

### Monitor Logs
```bash
# Brain logs (LLM calls, tool resolution, command queue)
docker compose logs -f brain

# Body logs (action execution, chat messages)
docker compose logs -f body

# All logs
docker compose logs -f
```

### Metrics Dashboard
- Grafana: http://localhost:3000
- Prometheus: http://localhost:9090
- Key metrics:
  - `cubert_llm_calls_total` - LLM API calls
  - `cubert_llm_latency_seconds` - Response time
  - `cubert_command_queue_length` - Queue depth

### Connect to Minecraft
- Join `localhost:25565` with any Minecraft client
- Bot username: `cubert` (or configured BOT_USERNAME)

---

## Scenario 1: Basic Greeting

**Tests:** Chat listener → LLM interpretation → speak action

**Steps:**
1. In Minecraft chat, type: `hello`
2. Observe brain logs for LLM call
3. Observe bot response in chat

**Expected behavior:**
- Bot responds with a greeting (e.g., "Hello! How can I help?")
- Single `speak` tool call in logs
- LLM latency metric recorded

**Log patterns to look for:**
```
[ThoughtBrain] Received chat: hello from <YourName>
[LLM] Calling Claude...
[LLM] Tool calls: [{ tool: 'speak', args: { message: '...' } }]
[ThoughtBrain] Queuing command: speak
```

**What could go wrong:**
- No response → Check ANTHROPIC_API_KEY, check brain logs for errors
- Wrong response → Prompt needs adjustment

---

## Scenario 2: Come Here (Player Tracking)

**Tests:** Player sensor → target resolution → movement

**Steps:**
1. Stand somewhere visible to the bot
2. In chat, type: `come here` or `come to me`
3. Watch the bot move toward you

**Expected behavior:**
- Bot says something like "On my way!"
- Bot pathfinds to your position
- Bot stops near you

**Log patterns to look for:**
```
[ToolResolver] Resolving target 'player' → { x: 100, y: 64, z: 200 }
[ThoughtBrain] Queuing command: move_to
[Body] Starting movement to (100, 64, 200)
[Body] ActionEvent: MOVE_TO SUCCESS
```

**What could go wrong:**
- "I can't find you" → PlayerSensor not detecting you (check distance config)
- Bot doesn't move → Check pathfinder, obstacles
- Bot goes wrong direction → Check coordinate resolution

---

## Scenario 3: Mine Gold (Multi-Step)

**Tests:** Multi-step command queue, sequential execution

**Setup:** Ensure gold ore is spawned nearby (scenario runner should do this)

**Steps:**
1. Stand near visible gold ore
2. In chat, type: `mine that gold` or `get the gold`
3. Watch the bot:
   - Acknowledge the command
   - Move to the gold
   - Mine the block
4. Check inventory increased

**Expected behavior:**
- Bot says "Mining gold!" or similar
- Bot moves to gold ore location
- Bot mines the block
- Gold appears in bot inventory

**Log patterns to look for:**
```
[LLM] Tool calls: [speak, move_to, mine_block]
[ThoughtBrain] Queuing 3 commands
[CommandQueue] Executing: speak
[CommandQueue] Executing: move_to
[CommandQueue] Executing: mine_block
```

**Metrics to check:**
- `cubert_commands_queued_total{tool="move_to"}` incremented
- `cubert_command_queue_length` goes 3 → 2 → 1 → 0

**What could go wrong:**
- "I can't find gold" → No gold in sensor range (increase search radius or spawn gold closer)
- Bot stops after speak → ActionEvent not received, check body logs
- Bot mines wrong block → Coordinate resolution issue

---

## Scenario 4: Stop Mid-Action

**Tests:** Interrupt handling, queue clearing

**Steps:**
1. Give a long command: `mine that gold` (bot starts moving)
2. While bot is moving, type: `stop`
3. Bot should halt immediately

**Expected behavior:**
- Bot says "Stopping!" or similar
- Current movement cancels
- Remaining commands (mine_block) cleared from queue

**Log patterns to look for:**
```
[ThoughtBrain] Stop command received, interrupt=true
[CommandQueue] Clearing queue (had 2 pending)
[ThoughtBrain] Cancelling action: <action-id>
[Body] ActionEvent: MOVE_TO CANCELLED
```

**What could go wrong:**
- Bot doesn't stop → Cancel action not sent, check handleStopCommand()
- Bot continues mining after stop → Queue not cleared properly

---

## Scenario 5: Deposit Items

**Tests:** Chest interaction, inventory management

**Setup:**
- Ensure bot has items in inventory (run Scenario 3 first)
- Ensure chest is nearby and visible

**Steps:**
1. In chat, type: `deposit items` or `put stuff in the chest`
2. Watch the bot:
   - Move to chest
   - Open chest
   - Deposit items

**Expected behavior:**
- Bot acknowledges command
- Bot moves to nearest chest
- Bot deposits inventory items
- Bot inventory decreases

**Log patterns to look for:**
```
[ToolResolver] Resolving target 'chest' → { x: 50, y: 64, z: 50 }
[ThoughtBrain] Queuing: speak, move_to, deposit_items
[Body] Depositing items to chest at (50, 64, 50)
[Body] ActionEvent: DEPOSIT_ITEMS SUCCESS
```

**What could go wrong:**
- "I can't find a chest" → No chest in sensor range
- Deposit fails → Chest full, or pathfinding can't reach it
- Wrong items deposited → Check deposit_items action payload

---

## Quick Reference

| Scenario | Chat Command | Expected Actions |
|----------|--------------|------------------|
| 1. Greeting | `hello` | speak |
| 2. Come Here | `come here` | speak → move_to |
| 3. Mine Gold | `mine that gold` | speak → move_to → mine_block |
| 4. Stop | `stop` | speak → cancel |
| 5. Deposit | `deposit items` | speak → move_to → deposit_items |

---

## Troubleshooting

### No LLM response
```bash
# Check API key is set
docker compose exec brain env | grep ANTHROPIC

# Check brain logs for errors
docker compose logs brain | grep -i error
```

### Bot not moving
```bash
# Check body logs for pathfinder issues
docker compose logs body | grep -i path

# Check if action was received
docker compose logs body | grep -i "action"
```

### Metrics not showing
```bash
# Check Prometheus targets
curl http://localhost:9090/api/v1/targets

# Check brain metrics endpoint
curl http://localhost:9092/metrics
```

---

## After Each Scenario

1. Check logs for errors or unexpected behavior
2. Note any prompt improvements needed
3. Verify metrics incremented correctly
4. Reset if needed: `docker compose restart body brain`
