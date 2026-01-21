/**
 * ToolResolver - Resolves abstract tool targets to concrete coordinates.
 *
 * Converts targets like "player", "gold", "chest" to actual x,y,z coordinates
 * using current sensor data.
 */

import { SensorData, PlayerInfo, BlockInfo } from '../types';

export interface Position {
  x: number;
  y: number;
  z: number;
}

export interface ResolvedTarget {
  position: Position | null;
  name?: string;
  error?: string;
}

export class ToolResolver {
  private sensors: SensorData;

  constructor(sensors: SensorData) {
    this.sensors = sensors;
  }

  /**
   * Resolve a movement target to coordinates.
   * Supports: "player", "gold", "chest", coordinates like "100,64,200"
   */
  resolveMovementTarget(target: string): ResolvedTarget {
    // Handle coordinate format "x,y,z"
    if (target.includes(',')) {
      const coords = this.parseCoordinates(target);
      if (coords) {
        return { position: coords };
      }
      return { position: null, error: `Invalid coordinates: ${target}` };
    }

    // Handle named targets
    const normalizedTarget = target.toLowerCase().trim();

    switch (normalizedTarget) {
      case 'player':
      case 'me':
      case 'here': {
        const player = this.getNearestPlayer();
        if (player) {
          return {
            position: { x: Math.floor(player.x), y: Math.floor(player.y), z: Math.floor(player.z) },
            name: player.username,
          };
        }
        return { position: null, error: 'No players nearby' };
      }

      case 'gold':
      case 'gold_ore':
      case 'nearest_gold': {
        const gold = this.getNearestGold();
        if (gold) {
          return {
            position: { x: gold.x, y: gold.y, z: gold.z },
            name: gold.blockName,
          };
        }
        return { position: null, error: 'No gold blocks nearby' };
      }

      case 'chest': {
        const chest = this.getNearestChest();
        if (chest) {
          return {
            position: { x: chest.x, y: chest.y, z: chest.z },
          };
        }
        return { position: null, error: 'No chests nearby' };
      }

      default: {
        // Try to find a player by name
        const playerByName = this.getPlayerByName(normalizedTarget);
        if (playerByName) {
          return {
            position: {
              x: Math.floor(playerByName.x),
              y: Math.floor(playerByName.y),
              z: Math.floor(playerByName.z),
            },
            name: playerByName.username,
          };
        }
        return { position: null, error: `Unknown target: ${target}` };
      }
    }
  }

  /**
   * Resolve a mining target to coordinates.
   * Supports: "nearest_gold", "gold", coordinates like "100,64,200"
   */
  resolveMiningTarget(target: string): ResolvedTarget {
    // Handle coordinate format "x,y,z"
    if (target.includes(',')) {
      const coords = this.parseCoordinates(target);
      if (coords) {
        return { position: coords };
      }
      return { position: null, error: `Invalid coordinates: ${target}` };
    }

    // Handle named targets
    const normalizedTarget = target.toLowerCase().trim();

    switch (normalizedTarget) {
      case 'gold':
      case 'gold_ore':
      case 'nearest_gold': {
        const gold = this.getNearestGold();
        if (gold) {
          return {
            position: { x: gold.x, y: gold.y, z: gold.z },
            name: gold.blockName,
          };
        }
        return { position: null, error: 'No gold blocks nearby' };
      }

      default:
        return { position: null, error: `Unknown mining target: ${target}` };
    }
  }

  private parseCoordinates(target: string): Position | null {
    const parts = target.split(',').map(s => parseFloat(s.trim()));
    if (parts.length >= 3 && parts.every(n => !isNaN(n))) {
      return {
        x: Math.floor(parts[0]),
        y: Math.floor(parts[1]),
        z: Math.floor(parts[2]),
      };
    }
    return null;
  }

  private getNearestPlayer(): PlayerInfo | null {
    const players = this.sensors.nearbyPlayers || [];
    if (players.length === 0) return null;
    return players.reduce((nearest, p) =>
      p.distance < nearest.distance ? p : nearest
    );
  }

  private getPlayerByName(name: string): PlayerInfo | null {
    const players = this.sensors.nearbyPlayers || [];
    return players.find(p =>
      p.username.toLowerCase() === name.toLowerCase()
    ) || null;
  }

  private getNearestGold(): BlockInfo | null {
    const goldBlocks = this.sensors.nearbyBlocks?.goldBlocks || [];
    if (goldBlocks.length === 0) return null;
    return goldBlocks.reduce((nearest, g) =>
      g.distance < nearest.distance ? g : nearest
    );
  }

  private getNearestChest(): BlockInfo | null {
    const chests = this.sensors.nearbyBlocks?.chestBlocks || [];
    if (chests.length === 0) return null;
    return chests.reduce((nearest, c) =>
      c.distance < nearest.distance ? c : nearest
    );
  }
}
