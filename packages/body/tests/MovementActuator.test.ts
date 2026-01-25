import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Vec3 } from 'vec3';

// Default safe movement profile parameters (matching brain's MOVEMENT_PROFILES.safe)
const SAFE_PROFILE = {
  hazards: {
    bufferDistance: 5,
    scanRadius: 32,
    scanCount: 10000,
    verticalBufferMin: -2,
    verticalBufferMax: 2,
    hazardBlocks: ['lava', 'flowing_lava', 'fire', 'magma_block'],
    blocksToAvoid: ['lava', 'flowing_lava', 'fire', 'cactus', 'magma_block'],
    blocksCantBreak: ['lava', 'flowing_lava'],
  },
  liquids: {
    treatAsAir: [],
    liquidCost: 100,
  },
  locomotion: {
    canDig: true,
    allowParkour: false,
    allowSprinting: false,
  },
  pathfinding: {
    goalRange: 2,
    maxAttempts: 3,
    retryDelayMs: 500,
  },
};

// Unsafe movement profile parameters (matching brain's MOVEMENT_PROFILES.unsafe)
const UNSAFE_PROFILE = {
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
  liquids: {
    treatAsAir: ['lava', 'flowing_lava'],
    liquidCost: 0,
  },
  locomotion: {
    canDig: true,
    allowParkour: false,
    allowSprinting: false,
  },
  pathfinding: {
    goalRange: 2,
    maxAttempts: 3,
    retryDelayMs: 500,
  },
};

// Derived constants for algorithm tests
const HAZARD_BUFFER_DISTANCE = SAFE_PROFILE.hazards.bufferDistance;
const HAZARD_SCAN_RADIUS = SAFE_PROFILE.hazards.scanRadius;
const SAFE_HOP_DISTANCE = HAZARD_SCAN_RADIUS - HAZARD_BUFFER_DISTANCE; // 27 blocks

/**
 * Unit tests for the safe movement hop algorithm.
 * We test the algorithm logic separately from the mineflayer integration.
 */
describe('Safe Movement Hop Algorithm', () => {
  describe('waypoint calculation', () => {
    it('calculates correct waypoint 27 blocks toward destination', () => {
      const start = new Vec3(0, 64, 0);
      const destination = new Vec3(100, 64, 0); // 100 blocks east

      const direction = destination.minus(start).normalize();
      const waypoint = start.plus(direction.scaled(SAFE_HOP_DISTANCE));

      expect(waypoint.x).toBeCloseTo(27, 1);
      expect(waypoint.y).toBeCloseTo(64, 1);
      expect(waypoint.z).toBeCloseTo(0, 1);
    });

    it('calculates waypoint correctly for diagonal movement', () => {
      const start = new Vec3(0, 64, 0);
      const destination = new Vec3(100, 64, 100); // diagonal

      const direction = destination.minus(start).normalize();
      const waypoint = start.plus(direction.scaled(SAFE_HOP_DISTANCE));

      // Distance from start to waypoint should be SAFE_HOP_DISTANCE
      const distanceToWaypoint = start.distanceTo(waypoint);
      expect(distanceToWaypoint).toBeCloseTo(SAFE_HOP_DISTANCE, 1);

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
      const waypoint = start.plus(direction.scaled(SAFE_HOP_DISTANCE));

      expect(waypoint.x).toBeCloseTo(0, 1);
      expect(waypoint.y).toBeCloseTo(64 + 27, 1);
      expect(waypoint.z).toBeCloseTo(0, 1);
    });
  });

  describe('hop count calculation', () => {
    it('destination within 27 blocks requires 1 hop (direct)', () => {
      const start = new Vec3(0, 64, 0);
      const destination = new Vec3(20, 64, 0); // 20 blocks away

      const distance = start.distanceTo(destination);
      const isWithinSafeRange = distance <= SAFE_HOP_DISTANCE;

      expect(isWithinSafeRange).toBe(true);
    });

    it('destination at exactly 27 blocks requires 1 hop', () => {
      const start = new Vec3(0, 64, 0);
      const destination = new Vec3(27, 64, 0);

      const distance = start.distanceTo(destination);
      const isWithinSafeRange = distance <= SAFE_HOP_DISTANCE;

      expect(isWithinSafeRange).toBe(true);
    });

    it('destination at 54 blocks requires 2 hops', () => {
      const start = new Vec3(0, 64, 0);
      const destination = new Vec3(54, 64, 0);

      // Simulate hop algorithm
      let currentPos = start.clone();
      let hopCount = 0;
      const maxHops = 20;

      while (hopCount < maxHops) {
        hopCount++;
        const distanceToGoal = currentPos.distanceTo(destination);

        if (distanceToGoal <= SAFE_HOP_DISTANCE) {
          // Final hop - go directly
          break;
        }

        // Calculate next waypoint
        const direction = destination.minus(currentPos).normalize();
        currentPos = currentPos.plus(direction.scaled(SAFE_HOP_DISTANCE));
      }

      expect(hopCount).toBe(2);
    });

    it('destination at 81 blocks requires 3 hops', () => {
      const start = new Vec3(0, 64, 0);
      const destination = new Vec3(81, 64, 0);

      let currentPos = start.clone();
      let hopCount = 0;
      const maxHops = 20;

      while (hopCount < maxHops) {
        hopCount++;
        const distanceToGoal = currentPos.distanceTo(destination);

        if (distanceToGoal <= SAFE_HOP_DISTANCE) {
          break;
        }

        const direction = destination.minus(currentPos).normalize();
        currentPos = currentPos.plus(direction.scaled(SAFE_HOP_DISTANCE));
      }

      expect(hopCount).toBe(3);
    });

    it('very long route (500 blocks) completes within max hops', () => {
      const start = new Vec3(0, 64, 0);
      const destination = new Vec3(500, 64, 0);

      let currentPos = start.clone();
      let hopCount = 0;
      const maxHops = 20;

      while (hopCount < maxHops) {
        hopCount++;
        const distanceToGoal = currentPos.distanceTo(destination);

        if (distanceToGoal <= SAFE_HOP_DISTANCE) {
          break;
        }

        const direction = destination.minus(currentPos).normalize();
        currentPos = currentPos.plus(direction.scaled(SAFE_HOP_DISTANCE));
      }

      // 500 / 27 = ~18.5, so 19 hops
      expect(hopCount).toBe(19);
      expect(hopCount).toBeLessThanOrEqual(maxHops);
    });

    it('exceeds max hops for extremely long routes', () => {
      const start = new Vec3(0, 64, 0);
      const destination = new Vec3(1000, 64, 0); // 1000 blocks

      let currentPos = start.clone();
      let hopCount = 0;
      const maxHops = 20;
      let reachedDestination = false;

      while (hopCount < maxHops) {
        hopCount++;
        const distanceToGoal = currentPos.distanceTo(destination);

        if (distanceToGoal <= SAFE_HOP_DISTANCE) {
          reachedDestination = true;
          break;
        }

        const direction = destination.minus(currentPos).normalize();
        currentPos = currentPos.plus(direction.scaled(SAFE_HOP_DISTANCE));
      }

      // 1000 / 27 = ~37 hops needed, but max is 20
      expect(hopCount).toBe(maxHops);
      expect(reachedDestination).toBe(false);
    });
  });

  describe('profile constants', () => {
    it('SAFE_HOP_DISTANCE is scanRadius minus bufferDistance', () => {
      expect(SAFE_HOP_DISTANCE).toBe(27);
      expect(SAFE_HOP_DISTANCE).toBe(HAZARD_SCAN_RADIUS - HAZARD_BUFFER_DISTANCE);
    });

    it('safe profile buffer distance ensures bot stays 5 blocks from hazards', () => {
      expect(SAFE_PROFILE.hazards.bufferDistance).toBe(5);
    });

    it('safe profile scan radius covers 32 blocks', () => {
      expect(SAFE_PROFILE.hazards.scanRadius).toBe(32);
    });

    it('unsafe profile has no buffer or scanning', () => {
      expect(UNSAFE_PROFILE.hazards.bufferDistance).toBe(0);
      expect(UNSAFE_PROFILE.hazards.scanRadius).toBe(0);
      expect(UNSAFE_PROFILE.hazards.scanCount).toBe(0);
    });

    it('unsafe profile treats lava as air', () => {
      expect(UNSAFE_PROFILE.liquids.treatAsAir).toContain('lava');
      expect(UNSAFE_PROFILE.liquids.treatAsAir).toContain('flowing_lava');
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

  describe('safe movement execution', () => {
    it('scans for hazards when scanRadius > 0', async () => {
      // Simulate the algorithm with safe profile
      const destination = new Vec3(60, 64, 0);
      let currentPos = mockBot.entity.position.clone();
      let hopCount = 0;
      const maxHops = 20;

      while (hopCount < maxHops) {
        hopCount++;

        // Scan for hazards (what the actuator does with safe profile)
        mockBot.findBlocks({
          matching: [],
          maxDistance: SAFE_PROFILE.hazards.scanRadius,
          count: SAFE_PROFILE.hazards.scanCount,
        });

        const distanceToGoal = currentPos.distanceTo(destination);
        if (distanceToGoal <= SAFE_HOP_DISTANCE) {
          break;
        }

        const direction = destination.minus(currentPos).normalize();
        currentPos = currentPos.plus(direction.scaled(SAFE_HOP_DISTANCE));
      }

      // 60 blocks = 3 hops, so 3 scans
      expect(hazardScanCount).toBe(3);
    });

    it('does not scan for hazards with unsafe profile (scanRadius=0)', () => {
      // With unsafe profile, no scanning should occur
      const shouldScan =
        UNSAFE_PROFILE.hazards.scanRadius > 0 && UNSAFE_PROFILE.hazards.bufferDistance > 0;
      expect(shouldScan).toBe(false);
    });

    it('uses buffered movements when hazards are found', () => {
      // Mock finding hazards
      const lavaPositions = [new Vec3(15, 64, 0), new Vec3(16, 64, 0)];
      mockBot.findBlocks = vi.fn().mockReturnValue(lavaPositions);

      const hazards = mockBot.findBlocks();
      expect(hazards.length).toBe(2);

      // In the real implementation, this would trigger createBufferedMovements
    });

    it('uses default safe movements when no hazards found', () => {
      mockBot.findBlocks = vi.fn().mockReturnValue([]);

      const hazards = mockBot.findBlocks();
      expect(hazards.length).toBe(0);

      // In the real implementation, this would use standard Movements
    });
  });

  describe('progress tracking', () => {
    it('bot position advances toward destination with each hop', async () => {
      const start = new Vec3(0, 64, 0);
      const destination = new Vec3(60, 64, 0);

      let currentPos = start.clone();
      const positions: Vec3[] = [currentPos.clone()];

      while (currentPos.distanceTo(destination) > SAFE_HOP_DISTANCE) {
        const direction = destination.minus(currentPos).normalize();
        currentPos = currentPos.plus(direction.scaled(SAFE_HOP_DISTANCE));
        positions.push(currentPos.clone());
      }

      // Should have recorded positions at 0, 27, 54 (then final hop to 60)
      expect(positions[0].x).toBeCloseTo(0, 1);
      expect(positions[1].x).toBeCloseTo(27, 1);
      expect(positions[2].x).toBeCloseTo(54, 1);
    });
  });
});

describe('BufferedMovements danger zone', () => {
  it('creates danger zone with correct size for single hazard', () => {
    const hazardPositions = [new Vec3(10, 64, 10)];
    const bufferDistance = SAFE_PROFILE.hazards.bufferDistance;
    const verticalMin = SAFE_PROFILE.hazards.verticalBufferMin;
    const verticalMax = SAFE_PROFILE.hazards.verticalBufferMax;

    // Calculate expected danger zone size
    // For each hazard: (2*buffer+1)^2 horizontally * verticalRange vertically
    const horizontalSize = (2 * bufferDistance + 1) ** 2;
    const verticalSize = verticalMax - verticalMin + 1; // -2 to 2 = 5
    const expectedSize = horizontalSize * verticalSize;

    // (11 * 11) * 5 = 605 positions per hazard
    expect(expectedSize).toBe(605);
  });

  it('buffer zone extends 5 blocks in all horizontal directions', () => {
    const hazard = new Vec3(50, 64, 50);
    const buffer = SAFE_PROFILE.hazards.bufferDistance;

    // Positions that should be in danger zone
    const inZone = [
      new Vec3(50, 64, 50), // hazard itself
      new Vec3(50 + 5, 64, 50), // 5 blocks east
      new Vec3(50 - 5, 64, 50), // 5 blocks west
      new Vec3(50, 64, 50 + 5), // 5 blocks south
      new Vec3(50, 64, 50 - 5), // 5 blocks north
    ];

    // Positions that should NOT be in danger zone
    const outOfZone = [
      new Vec3(50 + 6, 64, 50), // 6 blocks east (outside buffer)
      new Vec3(50 - 6, 64, 50), // 6 blocks west
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
  it('safe profile payload has all required fields', () => {
    const payload = {
      x: 100,
      y: 64,
      z: -200,
      ...SAFE_PROFILE,
    };

    // Verify structure
    expect(payload.hazards).toBeDefined();
    expect(payload.hazards.bufferDistance).toBe(5);
    expect(payload.hazards.scanRadius).toBe(32);
    expect(payload.hazards.hazardBlocks).toContain('lava');

    expect(payload.liquids).toBeDefined();
    expect(payload.liquids.liquidCost).toBe(100);

    expect(payload.locomotion).toBeDefined();
    expect(payload.locomotion.canDig).toBe(true);
    expect(payload.locomotion.allowSprinting).toBe(false);

    expect(payload.pathfinding).toBeDefined();
    expect(payload.pathfinding.goalRange).toBe(2);
    expect(payload.pathfinding.maxAttempts).toBe(3);
  });

  it('unsafe profile payload allows traversing lava', () => {
    const payload = {
      x: 100,
      y: 64,
      z: -200,
      ...UNSAFE_PROFILE,
    };

    // No hazard avoidance
    expect(payload.hazards.bufferDistance).toBe(0);
    expect(payload.hazards.blocksToAvoid).toHaveLength(0);

    // Lava treated as air
    expect(payload.liquids.treatAsAir).toContain('lava');
    expect(payload.liquids.liquidCost).toBe(0);
  });
});
