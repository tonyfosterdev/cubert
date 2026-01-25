import { describe, it, expect } from 'vitest';
import { MOVEMENT_PROFILES } from '../src/brains/ThoughtBrain';

describe('MOVEMENT_PROFILES', () => {
  describe('safe profile', () => {
    it('maintains 5-block buffer from hazards', () => {
      expect(MOVEMENT_PROFILES.safe.hazards.bufferDistance).toBe(5);
    });

    it('scans 32 blocks for hazards', () => {
      expect(MOVEMENT_PROFILES.safe.hazards.scanRadius).toBe(32);
    });

    it('scans up to 10000 hazard blocks', () => {
      expect(MOVEMENT_PROFILES.safe.hazards.scanCount).toBe(10000);
    });

    it('avoids lava, fire, cactus, magma', () => {
      expect(MOVEMENT_PROFILES.safe.hazards.blocksToAvoid).toEqual(
        expect.arrayContaining(['lava', 'flowing_lava', 'fire', 'cactus', 'magma_block'])
      );
    });

    it('does not sprint', () => {
      expect(MOVEMENT_PROFILES.safe.locomotion.allowSprinting).toBe(false);
    });
  });

  describe('unsafe profile', () => {
    it('has no hazard buffer', () => {
      expect(MOVEMENT_PROFILES.unsafe.hazards.bufferDistance).toBe(0);
    });

    it('does not scan for hazards', () => {
      expect(MOVEMENT_PROFILES.unsafe.hazards.scanRadius).toBe(0);
      expect(MOVEMENT_PROFILES.unsafe.hazards.scanCount).toBe(0);
    });

    it('treats lava as traversable', () => {
      expect(MOVEMENT_PROFILES.unsafe.liquids.treatAsAir).toContain('lava');
      expect(MOVEMENT_PROFILES.unsafe.liquids.treatAsAir).toContain('flowing_lava');
    });

    it('has no blocks to avoid', () => {
      expect(MOVEMENT_PROFILES.unsafe.hazards.blocksToAvoid).toHaveLength(0);
    });
  });
});
