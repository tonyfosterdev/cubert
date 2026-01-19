import { describe, it, expect, beforeEach } from 'vitest';
import { TestHarness } from '../harness/TestHarness';
import { createGoldMiningStateMachine } from '../../src/state-machine/scenarios/gold-mining';
import { createSensorData, withGoldBlock, withChestBlock, withInventoryGold } from '../fixtures/sensorData';

describe('ActionEvent', () => {
  let harness: TestHarness;

  beforeEach(() => {
    const sm = createGoldMiningStateMachine();
    harness = new TestHarness(sm);
    // Move from IDLE to SEARCHING_GOLD first
    harness.sendSensorData(createSensorData());
  });

  describe('action ID matching', () => {
    it('matching action ID triggers state transition', () => {
      const sensorData = withGoldBlock(createSensorData(), { x: 5, y: 64, z: 0 });
      harness.sendSensorData(sensorData);

      expect(harness.getCurrentState()).toBe('MOVING_TO_GOLD');

      const moveAction = harness.getActionsByType('ACTION_TYPE_MOVE_TO')[0];
      harness.completeAction(moveAction.actionId, 'SUCCESS');

      expect(harness.getCurrentState()).toBe('MINING');
    });

    it('non-matching action ID is ignored (state unchanged)', () => {
      const sensorData = withGoldBlock(createSensorData(), { x: 5, y: 64, z: 0 });
      harness.sendSensorData(sensorData);

      expect(harness.getCurrentState()).toBe('MOVING_TO_GOLD');

      harness.completeAction('wrong-action-id', 'SUCCESS');

      expect(harness.getCurrentState()).toBe('MOVING_TO_GOLD');
    });
  });

  describe('SUCCESS vs FAILED handling', () => {
    it('SUCCESS result in MOVING_TO_GOLD transitions to MINING', () => {
      const sensorData = withGoldBlock(createSensorData(), { x: 5, y: 64, z: 0 });
      harness.sendSensorData(sensorData);

      const moveAction = harness.getActionsByType('ACTION_TYPE_MOVE_TO')[0];
      harness.completeAction(moveAction.actionId, 'SUCCESS');

      expect(harness.getCurrentState()).toBe('MINING');
    });

    it('FAILED result in MOVING_TO_GOLD returns to SEARCHING_GOLD', () => {
      const sensorData = withGoldBlock(createSensorData(), { x: 5, y: 64, z: 0 });
      harness.sendSensorData(sensorData);

      const moveAction = harness.getActionsByType('ACTION_TYPE_MOVE_TO')[0];
      harness.completeAction(moveAction.actionId, 'FAILED', 'Path blocked');

      expect(harness.getCurrentState()).toBe('SEARCHING_GOLD');
    });

    it('mining completion returns to SEARCHING_GOLD regardless of result', () => {
      const sensorData = withGoldBlock(createSensorData(), { x: 5, y: 64, z: 0 });
      harness.sendSensorData(sensorData);

      const moveAction = harness.getActionsByType('ACTION_TYPE_MOVE_TO')[0];
      harness.completeAction(moveAction.actionId, 'SUCCESS');

      expect(harness.getCurrentState()).toBe('MINING');

      const mineAction = harness.getActionsByType('ACTION_TYPE_MINE_BLOCK')[0];
      harness.completeAction(mineAction.actionId, 'SUCCESS');

      expect(harness.getCurrentState()).toBe('SEARCHING_GOLD');
    });
  });

  describe('memory cleanup', () => {
    it('cleans up pendingActionId after move completion', () => {
      const sensorData = withGoldBlock(createSensorData(), { x: 5, y: 64, z: 0 });
      harness.sendSensorData(sensorData);

      expect(harness.getMemory().has('pendingActionId')).toBe(true);

      const moveAction = harness.getActionsByType('ACTION_TYPE_MOVE_TO')[0];
      harness.completeAction(moveAction.actionId, 'SUCCESS');

      expect(harness.getMemory().has('pendingActionId')).toBe(false);
    });

    it('cleans up miningActionId and targetGold after mining completion', () => {
      const sensorData = withGoldBlock(createSensorData(), { x: 5, y: 64, z: 0 });
      harness.sendSensorData(sensorData);

      const moveAction = harness.getActionsByType('ACTION_TYPE_MOVE_TO')[0];
      harness.completeAction(moveAction.actionId, 'SUCCESS');

      expect(harness.getMemory().has('miningActionId')).toBe(true);
      expect(harness.getMemory().has('targetGold')).toBe(true);

      const mineAction = harness.getActionsByType('ACTION_TYPE_MINE_BLOCK')[0];
      harness.completeAction(mineAction.actionId, 'SUCCESS');

      expect(harness.getMemory().has('miningActionId')).toBe(false);
      expect(harness.getMemory().has('targetGold')).toBe(false);
    });
  });

  describe('chest deposit flow', () => {
    it('MOVING_TO_CHEST SUCCESS transitions to DEPOSITING', () => {
      // Inventory full triggers SEARCHING_CHEST
      let sensorData = withInventoryGold(createSensorData(), 32);
      harness.sendSensorData(sensorData);

      expect(harness.getCurrentState()).toBe('SEARCHING_CHEST');

      // Add chest and update
      sensorData = withChestBlock(sensorData, { x: 3, y: 64, z: 0 });
      harness.sendSensorData(sensorData);

      expect(harness.getCurrentState()).toBe('MOVING_TO_CHEST');

      const moveAction = harness.getActionsByType('ACTION_TYPE_MOVE_TO').slice(-1)[0];
      harness.completeAction(moveAction.actionId, 'SUCCESS');

      expect(harness.getCurrentState()).toBe('DEPOSITING');
    });

    it('DEPOSITING completion returns to SEARCHING_GOLD', () => {
      let sensorData = withInventoryGold(createSensorData(), 32);
      harness.sendSensorData(sensorData);

      sensorData = withChestBlock(sensorData, { x: 3, y: 64, z: 0 });
      harness.sendSensorData(sensorData);

      const moveAction = harness.getActionsByType('ACTION_TYPE_MOVE_TO').slice(-1)[0];
      harness.completeAction(moveAction.actionId, 'SUCCESS');

      expect(harness.getCurrentState()).toBe('DEPOSITING');

      const depositAction = harness.getActionsByType('ACTION_TYPE_DEPOSIT_ITEMS')[0];
      harness.completeAction(depositAction.actionId, 'SUCCESS');

      expect(harness.getCurrentState()).toBe('SEARCHING_GOLD');
    });
  });
});
