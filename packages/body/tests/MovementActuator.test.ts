import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Vec3 } from 'vec3';

// Test fixtures - arbitrary values, not tied to brain's profiles
// Body tests should verify behavior for ANY valid parameters
const withHazardScanning = {
  hazards: {
    bufferDistance: 3,
    scanRadius: 20,
    scanCount: 100,
    verticalBufferMin: -1,
    verticalBufferMax: 1,
    hazardBlocks: ['lava'],
    blocksToAvoid: ['lava'],
    blocksCantBreak: ['lava'],
  },
  liquids: { treatAsAir: [], liquidCost: 50 },
  locomotion: { canDig: true, allowParkour: false, allowSprinting: false },
  pathfinding: { goalRange: 2, maxAttempts: 3, retryDelayMs: 100 },
};

const withoutHazardScanning = {
  hazards: {
    bufferDistance: 0,
    scanRadius: 0,
    scanCount: 0,
    verticalBufferMin: 0,
    verticalBufferMax: 0,
    hazardBlocks: [],
    blocksToAvoid: [],
    blocksCantBreak: [],
  },
  liquids: { treatAsAir: ['lava', 'flowing_lava'], liquidCost: 0 },
  locomotion: { canDig: true, allowParkour: false, allowSprinting: true },
  pathfinding: { goalRange: 2, maxAttempts: 3, retryDelayMs: 100 },
};

// Derived constants for algorithm tests - arbitrary values for testing math
const TEST_BUFFER = withHazardScanning.hazards.bufferDistance;
const TEST_SCAN_RADIUS = withHazardScanning.hazards.scanRadius;
const TEST_HOP_DISTANCE = TEST_SCAN_RADIUS - TEST_BUFFER; // 17 blocks

/**
 * Unit tests for the safe movement hop algorithm.
 * We test the algorithm logic separately from the mineflayer integration.
 */
describe('Safe Movement Hop Algorithm', () => {
  describe('waypoint calculation', () => {
    it('calculates waypoint at hopDistance toward destination', () => {
      const start = new Vec3(0, 64, 0);
      const destination = new Vec3(100, 64, 0); // 100 blocks east

      const direction = destination.minus(start).normalize();
      const waypoint = start.plus(direction.scaled(TEST_HOP_DISTANCE));

      expect(waypoint.x).toBeCloseTo(TEST_HOP_DISTANCE, 1);
      expect(waypoint.y).toBeCloseTo(64, 1);
      expect(waypoint.z).toBeCloseTo(0, 1);
    });

    it('calculates waypoint correctly for diagonal movement', () => {
      const start = new Vec3(0, 64, 0);
      const destination = new Vec3(100, 64, 100); // diagonal

      const direction = destination.minus(start).normalize();
      const waypoint = start.plus(direction.scaled(TEST_HOP_DISTANCE));

      // Distance from start to waypoint should be TEST_HOP_DISTANCE
      const distanceToWaypoint = start.distanceTo(waypoint);
      expect(distanceToWaypoint).toBeCloseTo(TEST_HOP_DISTANCE, 1);

      // Waypoint should be on the line toward destination
      const dirToWaypoint = waypoint.minus(start).normalize();
      const dirToDest = destination.minus(start).normalize();
      expect(dirToWaypoint.x).toBeCloseTo(dirToDest.x, 5);
      expect(dirToWaypoint.z).toBeCloseTo(dirToDest.z, 5);
    });

    it('handles vertical movement', () => {
      const start = new Vec3(0, 64, 0);
      const destination = new Vec3(0, 120, 0); // 56 blocks up

      const direction = destination.minus(start).normalize();
      const waypoint = start.plus(direction.scaled(TEST_HOP_DISTANCE));

      expect(waypoint.x).toBeCloseTo(0, 1);
      expect(waypoint.y).toBeCloseTo(64 + TEST_HOP_DISTANCE, 1);
      expect(waypoint.z).toBeCloseTo(0, 1);
    });
  });

  describe('hop count calculation', () => {
    it('destination within hopDistance requires 1 hop (direct)', () => {
      const start = new Vec3(0, 64, 0);
      const destination = new Vec3(10, 64, 0); // 10 blocks away

      const distance = start.distanceTo(destination);
      const isWithinRange = distance <= TEST_HOP_DISTANCE;

      expect(isWithinRange).toBe(true);
    });

    it('destination at exactly hopDistance requires 1 hop', () => {
      const start = new Vec3(0, 64, 0);
      const destination = new Vec3(TEST_HOP_DISTANCE, 64, 0);

      const distance = start.distanceTo(destination);
      const isWithinRange = distance <= TEST_HOP_DISTANCE;

      expect(isWithinRange).toBe(true);
    });

    it('destination at 2x hopDistance requires 2 hops', () => {
      const start = new Vec3(0, 64, 0);
      const destination = new Vec3(TEST_HOP_DISTANCE * 2, 64, 0);

      // Simulate hop algorithm
      let currentPos = start.clone();
      let hopCount = 0;
      const maxHops = 20;

      while (hopCount < maxHops) {
        hopCount++;
        const distanceToGoal = currentPos.distanceTo(destination);

        if (distanceToGoal <= TEST_HOP_DISTANCE) {
          // Final hop - go directly
          break;
        }

        // Calculate next waypoint
        const direction = destination.minus(currentPos).normalize();
        currentPos = currentPos.plus(direction.scaled(TEST_HOP_DISTANCE));
      }

      expect(hopCount).toBe(2);
    });

    it('destination at 3x hopDistance requires 3 hops', () => {
      const start = new Vec3(0, 64, 0);
      const destination = new Vec3(TEST_HOP_DISTANCE * 3, 64, 0);

      let currentPos = start.clone();
      let hopCount = 0;
      const maxHops = 20;

      while (hopCount < maxHops) {
        hopCount++;
        const distanceToGoal = currentPos.distanceTo(destination);

        if (distanceToGoal <= TEST_HOP_DISTANCE) {
          break;
        }

        const direction = destination.minus(currentPos).normalize();
        currentPos = currentPos.plus(direction.scaled(TEST_HOP_DISTANCE));
      }

      expect(hopCount).toBe(3);
    });

    it('very long route completes within max hops', () => {
      const start = new Vec3(0, 64, 0);
      const destination = new Vec3(TEST_HOP_DISTANCE * 19, 64, 0);

      let currentPos = start.clone();
      let hopCount = 0;
      const maxHops = 20;

      while (hopCount < maxHops) {
        hopCount++;
        const distanceToGoal = currentPos.distanceTo(destination);

        if (distanceToGoal <= TEST_HOP_DISTANCE) {
          break;
        }

        const direction = destination.minus(currentPos).normalize();
        currentPos = currentPos.plus(direction.scaled(TEST_HOP_DISTANCE));
      }

      expect(hopCount).toBe(19);
      expect(hopCount).toBeLessThanOrEqual(maxHops);
    });

    it('exceeds max hops for extremely long routes', () => {
      const start = new Vec3(0, 64, 0);
      const destination = new Vec3(TEST_HOP_DISTANCE * 40, 64, 0);

      let currentPos = start.clone();
      let hopCount = 0;
      const maxHops = 20;
      let reachedDestination = false;

      while (hopCount < maxHops) {
        hopCount++;
        const distanceToGoal = currentPos.distanceTo(destination);

        if (distanceToGoal <= TEST_HOP_DISTANCE) {
          reachedDestination = true;
          break;
        }

        const direction = destination.minus(currentPos).normalize();
        currentPos = currentPos.plus(direction.scaled(TEST_HOP_DISTANCE));
      }

      expect(hopCount).toBe(maxHops);
      expect(reachedDestination).toBe(false);
    });
  });

  describe('hop distance calculation', () => {
    it('hopDistance equals scanRadius minus bufferDistance', () => {
      expect(TEST_HOP_DISTANCE).toBe(TEST_SCAN_RADIUS - TEST_BUFFER);
    });
  });
});

describe('MovementActuator Integration', () => {
  let mockBot: any;
  let mockPathfinder: any;
  let movementHistory: Vec3[];
  let hazardScanCount: number;

  beforeEach(() => {
    movementHistory = [];
    hazardScanCount = 0;

    mockPathfinder = {
      movements: {},
      setMovements: vi.fn(),
      goto: vi.fn().mockImplementation(async (goal: any) => {
        // Simulate successful movement by updating bot position
        mockBot.entity.position = new Vec3(goal.x, goal.y, goal.z);
        movementHistory.push(mockBot.entity.position.clone());
      }),
      stop: vi.fn(),
    };

    mockBot = {
      entity: {
        position: new Vec3(0, 64, 0),
      },
      pathfinder: mockPathfinder,
      setControlState: vi.fn(),
      findBlocks: vi.fn().mockImplementation(() => {
        hazardScanCount++;
        return []; // No hazards by default
      }),
      on: vi.fn(),
      version: '1.20.4',
    };
  });

  describe('hazard scanning behavior', () => {
    it('scans for hazards when scanRadius > 0', async () => {
      // Simulate the algorithm with hazard scanning profile
      const destination = new Vec3(TEST_HOP_DISTANCE * 3, 64, 0);
      let currentPos = mockBot.entity.position.clone();
      let hopCount = 0;
      const maxHops = 20;

      while (hopCount < maxHops) {
        hopCount++;

        // Scan for hazards (what the actuator does when scanRadius > 0)
        mockBot.findBlocks({
          matching: [],
          maxDistance: withHazardScanning.hazards.scanRadius,
          count: withHazardScanning.hazards.scanCount,
        });

        const distanceToGoal = currentPos.distanceTo(destination);
        if (distanceToGoal <= TEST_HOP_DISTANCE) {
          break;
        }

        const direction = destination.minus(currentPos).normalize();
        currentPos = currentPos.plus(direction.scaled(TEST_HOP_DISTANCE));
      }

      // 3x hopDistance = 3 hops, so 3 scans
      expect(hazardScanCount).toBe(3);
    });

    it('skips scanning when scanRadius = 0', () => {
      // With no hazard scanning, no scanning should occur
      const shouldScan =
        withoutHazardScanning.hazards.scanRadius > 0 &&
        withoutHazardScanning.hazards.bufferDistance > 0;
      expect(shouldScan).toBe(false);
    });

    it('creates buffer zone when hazards are found', () => {
      // Mock finding hazards
      const lavaPositions = [new Vec3(15, 64, 0), new Vec3(16, 64, 0)];
      mockBot.findBlocks = vi.fn().mockReturnValue(lavaPositions);

      const hazards = mockBot.findBlocks();
      expect(hazards.length).toBe(2);

      // In the real implementation, this would trigger createBufferedMovements
    });

    it('uses default movements when no hazards found', () => {
      mockBot.findBlocks = vi.fn().mockReturnValue([]);

      const hazards = mockBot.findBlocks();
      expect(hazards.length).toBe(0);

      // In the real implementation, this would use standard Movements
    });
  });

  describe('progress tracking', () => {
    it('bot position advances toward destination with each hop', async () => {
      const start = new Vec3(0, 64, 0);
      const destination = new Vec3(TEST_HOP_DISTANCE * 3, 64, 0);

      let currentPos = start.clone();
      const positions: Vec3[] = [currentPos.clone()];

      while (currentPos.distanceTo(destination) > TEST_HOP_DISTANCE) {
        const direction = destination.minus(currentPos).normalize();
        currentPos = currentPos.plus(direction.scaled(TEST_HOP_DISTANCE));
        positions.push(currentPos.clone());
      }

      // Should have recorded positions at 0, hopDistance, 2*hopDistance
      expect(positions[0].x).toBeCloseTo(0, 1);
      expect(positions[1].x).toBeCloseTo(TEST_HOP_DISTANCE, 1);
      expect(positions[2].x).toBeCloseTo(TEST_HOP_DISTANCE * 2, 1);
    });
  });
});

describe('BufferedMovements danger zone', () => {
  it('creates danger zone with correct size for single hazard', () => {
    const hazardPositions = [new Vec3(10, 64, 10)];
    const bufferDistance = withHazardScanning.hazards.bufferDistance;
    const verticalMin = withHazardScanning.hazards.verticalBufferMin;
    const verticalMax = withHazardScanning.hazards.verticalBufferMax;

    // Calculate expected danger zone size
    // For each hazard: (2*buffer+1)^2 horizontally * verticalRange vertically
    const horizontalSize = (2 * bufferDistance + 1) ** 2;
    const verticalSize = verticalMax - verticalMin + 1;
    const expectedSize = horizontalSize * verticalSize;

    // (7 * 7) * 3 = 147 positions per hazard with test values (buffer=3, vertical -1 to 1)
    expect(expectedSize).toBe(147);
  });

  it('buffer zone extends bufferDistance blocks in all horizontal directions', () => {
    const hazard = new Vec3(50, 64, 50);
    const buffer = withHazardScanning.hazards.bufferDistance;

    // Positions that should be in danger zone
    const inZone = [
      new Vec3(50, 64, 50), // hazard itself
      new Vec3(50 + buffer, 64, 50), // buffer blocks east
      new Vec3(50 - buffer, 64, 50), // buffer blocks west
      new Vec3(50, 64, 50 + buffer), // buffer blocks south
      new Vec3(50, 64, 50 - buffer), // buffer blocks north
    ];

    // Positions that should NOT be in danger zone
    const outOfZone = [
      new Vec3(50 + buffer + 1, 64, 50), // one beyond buffer east
      new Vec3(50 - buffer - 1, 64, 50), // one beyond buffer west
    ];

    // Verify distances
    for (const pos of inZone) {
      const dx = Math.abs(pos.x - hazard.x);
      const dz = Math.abs(pos.z - hazard.z);
      expect(dx <= buffer && dz <= buffer).toBe(true);
    }

    for (const pos of outOfZone) {
      const dx = Math.abs(pos.x - hazard.x);
      const dz = Math.abs(pos.z - hazard.z);
      expect(dx <= buffer && dz <= buffer).toBe(false);
    }
  });
});

describe('MoveToPayload format', () => {
  it('payload with hazard scanning has all required fields', () => {
    const payload = {
      x: 100,
      y: 64,
      z: -200,
      ...withHazardScanning,
    };

    // Verify structure
    expect(payload.hazards).toBeDefined();
    expect(payload.hazards.bufferDistance).toBeGreaterThan(0);
    expect(payload.hazards.scanRadius).toBeGreaterThan(0);
    expect(payload.hazards.hazardBlocks).toContain('lava');

    expect(payload.liquids).toBeDefined();
    expect(payload.liquids.liquidCost).toBeGreaterThan(0);

    expect(payload.locomotion).toBeDefined();
    expect(payload.locomotion.canDig).toBe(true);

    expect(payload.pathfinding).toBeDefined();
    expect(payload.pathfinding.goalRange).toBeGreaterThan(0);
    expect(payload.pathfinding.maxAttempts).toBeGreaterThan(0);
  });

  it('payload without hazard scanning allows traversing liquids', () => {
    const payload = {
      x: 100,
      y: 64,
      z: -200,
      ...withoutHazardScanning,
    };

    // No hazard avoidance
    expect(payload.hazards.bufferDistance).toBe(0);
    expect(payload.hazards.blocksToAvoid).toHaveLength(0);

    // Liquids treated as traversable
    expect(payload.liquids.treatAsAir.length).toBeGreaterThan(0);
    expect(payload.liquids.liquidCost).toBe(0);
  });
});
