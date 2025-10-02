import { ActionNode } from '../behavior-nodes.js';
import {
  getLightLevel,
  getTerrainHeight,
  findNearbyEntities,
  findResourceNodes,
} from './environment-query.js';

const resolveContextPosition = (context) => {
  if (!context) {
    return { x: 0, y: 0, z: 0 };
  }
  if (context.entity?.root?.position) {
    const { x = 0, y = 0, z = 0 } = context.entity.root.position;
    return { x, y, z };
  }
  if (context.entity?.position) {
    const { x = 0, y = 0, z = 0 } = context.entity.position;
    return { x, y, z };
  }
  if (context.position) {
    const { x = 0, y = 0, z = 0 } = context.position;
    return { x, y, z };
  }
  return { x: 0, y: 0, z: 0 };
};

const recordOutcome = (context, key, value) => {
  if (!context) {
    return;
  }
  if (context.memory instanceof Map) {
    context.memory.set(key, value);
    return;
  }
  context.memory ??= {};
  context.memory[key] = value;
};

export function createSeekSunlightBehavior(scheduler, options = {}) {
  if (!scheduler) {
    throw new Error('createSeekSunlightBehavior requires an AmbientTaskScheduler instance.');
  }
  const lightThreshold = Number.isFinite(options.lightThreshold)
    ? Number(options.lightThreshold)
    : 0.65;

  return new ActionNode('ambient-seek-sunlight', {
    onUpdate: (_delta, context) => {
      const lightLevel = getLightLevel(context);
      recordOutcome(context, 'ambient:lastLightLevel', lightLevel);
      if (lightLevel >= lightThreshold) {
        return { status: 'satisfied', light: lightLevel };
      }

      const handle = scheduler.requestTask(context, { include: ['explore', 'wander'] });
      if (!handle) {
        return { status: 'waiting', reason: 'no-task', light: lightLevel };
      }

      const result = handle.execute?.(context) ?? {};
      if (result?.success === false) {
        handle.fail(result.reason ?? 'blocked');
        recordOutcome(context, 'ambient:lastSeekSunlightResult', {
          success: false,
          reason: result.reason ?? 'blocked',
          light: lightLevel,
        });
        return { status: 'blocked', reason: result.reason ?? 'blocked', light: lightLevel };
      }

      handle.succeed(result);
      recordOutcome(context, 'ambient:lastSeekSunlightResult', {
        success: true,
        task: handle.name,
        light: lightLevel,
      });
      return { status: 'seeking', task: handle.name, light: lightLevel };
    },
  });
}

export function createGatherResourcesBehavior(scheduler, options = {}) {
  if (!scheduler) {
    throw new Error('createGatherResourcesBehavior requires an AmbientTaskScheduler instance.');
  }
  const radius = Number.isFinite(options.radius) ? Math.max(1, Number(options.radius)) : 48;
  const types = options.types ?? null;

  return new ActionNode('ambient-gather-resources', {
    onUpdate: (_delta, context) => {
      const origin = resolveContextPosition(context);
      const nodes = findResourceNodes(context, origin, { radius, types, limit: 5 });
      if (nodes.length === 0) {
        recordOutcome(context, 'ambient:lastGatherResult', {
          status: 'idle',
          reason: 'no-resources',
        });
        return { status: 'idle', reason: 'no-resources' };
      }

      const targetNode = nodes[0];
      const targetSurface = getTerrainHeight(context, targetNode.position);
      const normalizedResource = {
        ...targetNode,
        position: {
          ...targetNode.position,
          ...(Number.isFinite(targetSurface) ? { y: targetSurface } : {}),
        },
      };
      const handle = scheduler.requestTask(context, { include: ['wander', 'explore'] });
      if (!handle) {
        recordOutcome(context, 'ambient:lastGatherResult', {
          status: 'waiting',
          resource: normalizedResource,
        });
        return { status: 'waiting', resource: normalizedResource };
      }

      const augmentedContext = {
        ...context,
        targetResource: normalizedResource,
      };
      const result = handle.execute?.(augmentedContext) ?? {};
      if (result?.success === false) {
        handle.fail(result.reason ?? 'unreachable');
        recordOutcome(context, 'ambient:lastGatherResult', {
          status: 'failed',
          resource: normalizedResource,
          reason: result.reason ?? 'unreachable',
        });
        return {
          status: 'failed',
          resource: normalizedResource,
          reason: result.reason ?? 'unreachable',
        };
      }

      handle.succeed({ ...result, resource: normalizedResource });
      recordOutcome(context, 'ambient:lastGatherResult', {
        status: 'gathering',
        task: handle.name,
        resource: normalizedResource,
      });
      return { status: 'gathering', task: handle.name, resource: normalizedResource };
    },
  });
}

export function createIdleChatterBehavior(scheduler, options = {}) {
  if (!scheduler) {
    throw new Error('createIdleChatterBehavior requires an AmbientTaskScheduler instance.');
  }
  const radius = Number.isFinite(options.radius) ? Math.max(1, Number(options.radius)) : 18;

  return new ActionNode('ambient-idle-chatter', {
    onUpdate: (_delta, context) => {
      const origin = resolveContextPosition(context);
      const allies = findNearbyEntities(context, origin, {
        radius,
        limit: 5,
        filter: options.filter,
      });
      if (allies.length === 0) {
        recordOutcome(context, 'ambient:lastChatterResult', { status: 'quiet' });
        return { status: 'quiet' };
      }

      const partner = allies[0].entity ?? allies[0];
      const handle = scheduler.requestTask(context, { include: ['socialize'] });
      if (!handle) {
        recordOutcome(context, 'ambient:lastChatterResult', {
          status: 'ready',
          partner,
        });
        return { status: 'ready', partner };
      }

      const augmentedContext = {
        ...context,
        socialPartner: partner,
      };
      const result = handle.execute?.(augmentedContext) ?? {};
      if (result?.success === false) {
        handle.fail(result.reason ?? 'rejected');
        recordOutcome(context, 'ambient:lastChatterResult', {
          status: 'rejected',
          partner,
          reason: result.reason ?? 'rejected',
        });
        return { status: 'rejected', partner, reason: result.reason ?? 'rejected' };
      }

      handle.succeed({ ...result, partner });
      recordOutcome(context, 'ambient:lastChatterResult', {
        status: 'chatting',
        task: handle.name,
        partner,
      });
      return { status: 'chatting', task: handle.name, partner };
    },
  });
}

export function createAmbientBehaviorSuite(scheduler, options = {}) {
  return {
    seekSunlight: createSeekSunlightBehavior(scheduler, options.seekSunlight),
    gatherResources: createGatherResourcesBehavior(scheduler, options.gatherResources),
    idleChatter: createIdleChatterBehavior(scheduler, options.idleChatter),
  };
}

export default {
  createSeekSunlightBehavior,
  createGatherResourcesBehavior,
  createIdleChatterBehavior,
  createAmbientBehaviorSuite,
};
