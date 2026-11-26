import { getLocationAt } from './mapData';
import { findNearestWalkableTile, isTileWalkable } from './pathfinding';
import type { ScheduleBlockKind, WorldState } from './types';

const VALID_KINDS = new Set<ScheduleBlockKind>([
  'sleep',
  'meal',
  'work',
  'social',
  'errand',
  'leisure',
  'rest',
  'travel',
]);

export interface WorldValidationIssue {
  category:
    | 'unknown_relationship'
    | 'unknown_social_edge'
    | 'invalid_schedule_object'
    | 'invalid_schedule_block'
    | 'invalid_location'
    | 'object_approach_outside_building'
    | 'door_unwalkable'
    | 'duplicate_memory_id';
  message: string;
  agentId?: string;
  locationId?: string;
  objectId?: string;
}

export function validateWorld(world: WorldState): WorldValidationIssue[] {
  const issues: WorldValidationIssue[] = [];
  const agentIds = new Set(world.agents.map((a) => a.id));
  const locById = new Map(world.locations.map((l) => [l.id, l]));
  const objById = new Map(world.objects.map((o) => [o.id, o]));

  // 1. Check doors are walkable
  for (const loc of world.locations) {
    const tile = world.tiles[loc.doorY]?.[loc.doorX];
    if (!tile || !isTileWalkable(tile)) {
      issues.push({
        category: 'door_unwalkable',
        locationId: loc.id,
        message: `Location "${loc.name}" (${loc.id}) has unwalkable door at (${loc.doorX}, ${loc.doorY}).`,
      });
    }
  }

  // 2. Check object approach tiles lie inside (or on border door of) their owning building
  for (const obj of world.objects) {
    const loc = locById.get(obj.locationId);
    if (!loc) {
      issues.push({
        category: 'invalid_schedule_object',
        objectId: obj.id,
        message: `Object "${obj.name}" (${obj.id}) references unknown location "${obj.locationId}".`,
      });
      continue;
    }
    const approach = findNearestWalkableTile(world.tiles, obj.tileX, obj.tileY + 1);
    const inZone = getLocationAt(world.locations, approach.x, approach.y);
    if (!inZone || inZone.id !== loc.id) {
      issues.push({
        category: 'object_approach_outside_building',
        objectId: obj.id,
        locationId: loc.id,
        message: `Object "${obj.name}" (${obj.id}) approach tile (${approach.x}, ${approach.y}) resolves outside "${loc.name}".`,
      });
    }
  }

  // 3. Check agents: location, relationships, socialGraph, dated schedules, and duplicate memory IDs
  for (const agent of world.agents) {
    if (agent.currentLocationId !== null && !locById.has(agent.currentLocationId)) {
      issues.push({
        category: 'invalid_location',
        agentId: agent.id,
        locationId: agent.currentLocationId,
        message: `Agent "${agent.name}" has unknown currentLocationId "${agent.currentLocationId}".`,
      });
    }

    for (const targetId of Object.keys(agent.relationships)) {
      if (!agentIds.has(targetId)) {
        issues.push({
          category: 'unknown_relationship',
          agentId: agent.id,
          message: `Agent "${agent.name}" relationship points to unknown resident "${targetId}".`,
        });
      }
    }

    for (const targetId of Object.keys(agent.socialGraph)) {
      if (!agentIds.has(targetId)) {
        issues.push({
          category: 'unknown_social_edge',
          agentId: agent.id,
          message: `Agent "${agent.name}" socialGraph edge points to unknown resident "${targetId}".`,
        });
      }
    }

    for (const block of agent.dailySchedule) {
      if (!Number.isInteger(block.day) || block.day < 1) {
        issues.push({
          category: 'invalid_schedule_block',
          agentId: agent.id,
          message: `Agent "${agent.name}" schedule "${block.activity}" has invalid day "${String(block.day)}".`,
        });
      }
      if (!VALID_KINDS.has(block.kind)) {
        issues.push({
          category: 'invalid_schedule_block',
          agentId: agent.id,
          message: `Agent "${agent.name}" schedule "${block.activity}" has invalid kind "${String(block.kind)}".`,
        });
      }
      if (!locById.has(block.locationId)) {
        issues.push({
          category: 'invalid_schedule_block',
          agentId: agent.id,
          locationId: block.locationId,
          message: `Agent "${agent.name}" schedule "${block.activity}" references unknown location "${block.locationId}".`,
        });
      }
      if (!block.objectId) continue;
      const obj = objById.get(block.objectId);
      if (!obj) {
        issues.push({
          category: 'invalid_schedule_object',
          agentId: agent.id,
          objectId: block.objectId,
          message: `Agent "${agent.name}" schedule "${block.activity}" references missing object "${block.objectId}".`,
        });
      } else if (obj.locationId !== block.locationId) {
        issues.push({
          category: 'invalid_schedule_object',
          agentId: agent.id,
          objectId: block.objectId,
          locationId: block.locationId,
          message: `Agent "${agent.name}" schedule "${block.activity}" uses object "${obj.id}" (${obj.locationId}) while block locationId is "${block.locationId}".`,
        });
      }
    }

    const seenMemIds = new Set<string>();
    for (const mem of agent.memories) {
      if (seenMemIds.has(mem.id)) {
        issues.push({
          category: 'duplicate_memory_id',
          agentId: agent.id,
          message: `Agent "${agent.name}" has duplicate memory ID "${mem.id}".`,
        });
      }
      seenMemIds.add(mem.id);
    }
  }

  return issues;
}

