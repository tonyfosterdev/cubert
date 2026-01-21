# Implementation Journal: Behavior Tree + Blackboard Architecture

## Session 1 - 2026-01-21

### Work Completed

#### 1. Created Core Behavior Tree Architecture
All files created in `packages/brain/src/behavior-tree/`:

- **Blackboard.ts** (~200 LOC): Central state store with computed properties
  - Wraps SensorData and WorldModel
  - Provides computed properties: `position`, `goldCount`, `isInventoryFull`, `hasPickaxe`, `isNearLava`, `isAtGold`, `nearestSafeGold`, etc.
  - Action tracking: `startAction()`, `completeAction()`, `flushPendingActions()`

- **nodes.ts** (~170 LOC): Base behavior tree node types
  - `Selector`: Try children until one succeeds (OR logic)
  - `Sequence`: Run children in order, fail on first failure (AND logic)
  - `Condition`: Check a predicate
  - `Inverter`: Decorator that inverts result
  - `ActionNode`: Base class for leaf nodes
  - `AlwaysSucceed`: Decorator

- **conditions.ts** (~30 LOC): Reusable predicates
  - `isNearLava`, `hasPendingAction`, `isInventoryFull`, `hasPickaxe`
  - `isAtGold`, `isAtChest`, `hasChestNearby`, `hasKnownGold`, `hasVisibleGold`

- **actions.ts** (~180 LOC): Action leaf nodes
  - `WaitForAction`, `MoveToGold`, `MineBlock`, `MoveToChest`
  - `DepositItems`, `Explore`, `Speak`, `Idle`

- **GoldMiningTree.ts** (~80 LOC): Composes the tree with priority order:
  1. Wait for pending action
  2. Wait for pickaxe (required to mine)
  3. Deposit if inventory full
  4. Mine if at gold
  5. Move to visible gold
  6. Move to known gold (from world model)
  7. Explore

- **index.ts**: Module exports

#### 2. Created BehaviorTreeBrain
`packages/brain/src/brains/BehaviorTreeBrain.ts` (~160 LOC):
- Implements Brain interface
- Wraps behavior tree and blackboard
- Integrates with WorldModel and MapPersistence
- Handles `onConnect`, `onSensorUpdate`, `onActionComplete`

#### 3. Updated Integration Points
- **BrainFactory.ts**: Simplified to only create BehaviorTreeBrain
- **config.ts**: Removed `brainType` and `llm` config (no longer needed)
- **index.ts**: Updated to use BehaviorTreeBrain

#### 4. Deleted Old Code
- `src/state-machine/` directory (StateMachine.ts, State.ts, scenarios/)
- `src/brains/StateMachineBrain.ts`
- `src/brains/LLMBrain.ts`
- `src/llm/` directory

#### 5. Moved Types
- Moved `State.ts` to `src/types.ts` (contains SensorData, Action, ActionEvent, BlockInfo interfaces)
- Updated all imports

### Issues Found & Fixed

#### Issue 1: Bot stuck in MoveToGold loop
**Problem**: Bot kept moving to gold but never mined it.
**Root Cause**: The `WaitForReady` sequence was succeeding when chest wasn't nearby, blocking further tree evaluation.
**Fix**: Changed to only wait for pickaxe (not chest), since bot can mine without chest visible.

#### Issue 2: `isAtGold` threshold
**Problem**: Bot at distance 2.9 from gold but wasn't mining.
**Observation**: The `isAtGold` condition checks `distance <= 4`. At 2.9, this should be true.
**Status**: Fixed by the WaitForReady fix above.

### Current Status

#### Working Behaviors:
- ✅ Bot spawns and detects gold
- ✅ Bot moves to visible gold
- ✅ Bot mines gold when within range
- ✅ Bot explores when no gold visible
- ✅ World model tracks exploration progress
- ✅ World model tracks gold locations

#### Known Issues:
1. **Persistence Issue**: Gold tracker data not persisting correctly between restarts
   - `exploredCells` persists fine
   - `goldTracker` array is empty after restart
   - Likely caused by RESET_WORLD_MODEL=true being set in earlier runs

2. **No LLM Integration**: The Explore action uses grid-based exploration, not LLM
   - This is simpler but less "smart"
   - Could add LLM for exploration decisions if needed

### Learnings

1. **Behavior Tree Design**: Priority-based selector works well for robot control. Each priority is a sequence of conditions + actions.

2. **State Management**: The Blackboard pattern cleanly separates state from behavior logic. Computed properties make conditions simple.

3. **Action Tracking**: Single `currentAction` field is sufficient. No need for multiple action type trackers.

4. **Debugging BT**: Adding debug logging to conditions helps trace which priority is being evaluated.

5. **Docker Hot Reload**: The `npx tsx` command picks up source changes, but need to restart container for them to take effect.

### Next Steps

1. **Fix Persistence**: Ensure gold tracker data persists correctly
   - May need to check if RESET_WORLD_MODEL env var is being passed
   - Verify toJSON/fromJSON cycle for goldTracker

2. **Run Full Scenario**:
   - Start with fresh volumes
   - Let bot explore and mine multiple gold
   - Verify deposit behavior when inventory full
   - Run 2-3 complete cycles

3. **Optional - Add LLM**: If smarter exploration is needed, integrate LLM for:
   - Exploration target selection
   - Decision making when multiple options available

### File Structure After Changes

```
packages/brain/src/
├── behavior-tree/
│   ├── Blackboard.ts      # Central state store
│   ├── nodes.ts           # Base BT node types
│   ├── conditions.ts      # Predicate functions
│   ├── actions.ts         # Action leaf nodes
│   ├── GoldMiningTree.ts  # Tree composition
│   └── index.ts           # Exports
├── brains/
│   └── BehaviorTreeBrain.ts  # Brain implementation
├── core/
│   ├── Brain.ts           # Brain interface
│   └── BrainFactory.ts    # Factory (simplified)
├── world/
│   ├── WorldModel.ts      # World state tracking
│   ├── GridMap.ts         # Cell-based exploration
│   └── KnowledgeTracker.ts # Confidence tracking
├── persistence/
│   └── MapPersistence.ts  # Save/load world model
├── grpc/
│   └── server.ts          # gRPC server
├── types.ts               # Type definitions (moved from state-machine/)
├── config.ts              # Configuration
└── index.ts               # Entry point
```

### LOC Summary
- New code: ~820 LOC (behavior-tree + BehaviorTreeBrain)
- Deleted code: ~775 LOC (state-machine + StateMachineBrain + LLMBrain + llm/)
- Net change: +45 LOC but much better structure and testability

---

## Session 2 - 2026-01-21 (Manual Test Scenarios)

### Work Completed

#### 1. Created Manual Test Scenarios Documentation
`docs/MANUAL-TEST-SCENARIOS.md` (~256 lines):
- Comprehensive guide for running 5 manual test scenarios
- Setup instructions (docker stack, logs, metrics, Minecraft connection)
- Detailed expected behaviors and log patterns for each scenario
- Troubleshooting guide

#### 2. Created Semi-Autonomous Scenario Files
`scenarios/semi-autonomous/`:
- **scenario.json**: Config for LLM-controlled bot scenario
- **setup.mcfunction**: World setup (floor, lava pit, chest, pickaxe)
- **spawn-resources.mcfunction**: Gold ore spawner (30s interval)

#### 3. Updated Docker Compose
`docker-compose.yml`:
- Added `ANTHROPIC_API_KEY: "${ANTHROPIC_API_KEY}"` passthrough to brain service
- Enables LLM calls from within the container

### Test Results

Ran all 5 scenarios via RCON chat simulation:

| Scenario | Command | Expected Tools | Result |
|----------|---------|----------------|--------|
| 1. Greeting | `hello` | speak | **PASS** - "Hello Rcon!" |
| 2. Come Here | `come here` | speak, move_to | **PARTIAL** - No players online |
| 3. Mine Gold | `mine that gold` | speak, move_to, mine_block | **PASS** - Gold mined |
| 4. Stop | `stop` | speak, stop | **PASS** - Queue cleared |
| 5. Deposit | `deposit items` | speak, move_to, deposit_items | **PASS** - 1 raw_gold deposited |

### Key Observations

#### LLM Integration Works Well
- Claude correctly interprets natural language commands
- Multi-tool responses are properly sequenced
- System prompt with sensor context enables situational awareness

#### RCON Testing is Viable
- Minecraft's RCON `say` command triggers chat events
- Username appears as "Rcon" - bot filters its own messages correctly
- No actual Minecraft client needed for basic testing

#### Command Queue Execution
- Commands execute in sequence as expected
- Action completion events properly trigger next command
- Queue length metrics update correctly

#### Pathfinder Quirks
- Move to gold failed once ("Path was stopped before completion")
- Mining still succeeded from intermediate position
- Bot can mine blocks within range even if pathfinding partially fails

### Learnings

1. **Semi-autonomous vs State Machine**: The ThoughtBrain is much simpler - just LLM → tools → actions. No state machine complexity.

2. **Target Resolution**: The ToolResolver pattern works well. Graceful fallback to speak action when target can't be found.

3. **Stop Command**: Works but timing-dependent. LLM processing takes 2-3s, so commands may complete before stop is processed.

4. **Inventory Logging**: The `[INVENTORY]` logs are verbose but useful for tracking gold collection.

### Issues Found

1. **Pathfinder Reliability**: Occasional "Path was stopped" failures. Not critical but could investigate.

2. **Stop Timing**: 1 second delay not enough to catch mid-action. Could add longer-running actions for better stop testing.

3. **No Player Target**: "Come here" can't work without a player. Expected, but scenario 2 can only be fully tested with a Minecraft client.

### Files Changed

```
docs/MANUAL-TEST-SCENARIOS.md           # NEW - test documentation
scenarios/semi-autonomous/scenario.json  # NEW - scenario config
scenarios/semi-autonomous/setup.mcfunction       # NEW - world setup
scenarios/semi-autonomous/spawn-resources.mcfunction  # NEW - gold spawner
docker-compose.yml                       # MODIFIED - API key passthrough
```
