import * as THREE from 'three';
import type { AgentState } from '../../simulation/types';
import type { ProceduralTextures } from './textures';

export interface Agent3DRecord {
  agentId: string;
  root: THREE.Group;
  bodyGroup: THREE.Group;
  leftLeg: THREE.Mesh;
  rightLeg: THREE.Mesh;
  leftArm: THREE.Mesh;
  rightArm: THREE.Mesh;
  selectionRing: THREE.Mesh;
  lensRing: THREE.Mesh;
  lensRingMat: THREE.MeshBasicMaterial;
  thinkingHalo: THREE.Mesh;
  hitProxy: THREE.Mesh;
  visualX: number;
  visualZ: number;
  visualYaw: number;
  walkPhase: number;
}

export interface Agents3DManager {
  group: THREE.Group;
  records: Map<string, Agent3DRecord>;
  hitProxies: THREE.Mesh[];
  syncAndAnimate: (
    agents: readonly AgentState[],
    selectedAgentId: string,
    delta: number,
    elapsed: number,
    lensAgents?: Record<string, { colorHex: string; intensity: number }>,
  ) => void;
  getAgentHeadWorldPos: (agentId: string, out: THREE.Vector3) => boolean;
  dispose: () => void;
}

function facingToYaw(facing: AgentState['facing']): number {
  switch (facing) {
    case 'down':
      return 0;
    case 'up':
      return Math.PI;
    case 'right':
      return Math.PI / 2;
    case 'left':
      return -Math.PI / 2;
  }
}

function dampAngle(current: number, target: number, lambda: number, dt: number): number {
  let diff = ((target - current + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return current + diff * (1 - Math.exp(-lambda * dt));
}

/**
 * Scalable articulated 3D low-poly resident manager.
 * Shares all base geometries and pools materials by color hex so 18 to 100+ citizens
 * render cleanly at 60fps with minimal draw/memory overhead.
 */
export function createAgents3DManager(textures: ProceduralTextures): Agents3DManager {
  const group = new THREE.Group();
  const records = new Map<string, Agent3DRecord>();
  const hitProxies: THREE.Mesh[] = [];

  // Shared geometries across all agents (only allocated once!)
  const sharedGeos = {
    shadow: new THREE.PlaneGeometry(0.76, 0.76),
    ring: new THREE.RingGeometry(0.42, 0.56, 20),
    lensRing: new THREE.RingGeometry(0.58, 0.76, 20),
    leg: new THREE.BoxGeometry(0.14, 0.34, 0.14),
    torso: new THREE.CylinderGeometry(0.18, 0.22, 0.44, 8),
    apron: new THREE.BoxGeometry(0.24, 0.3, 0.06),
    scarf: new THREE.TorusGeometry(0.15, 0.045, 6, 12),
    arm: new THREE.BoxGeometry(0.11, 0.32, 0.11),
    head: new THREE.IcosahedronGeometry(0.19, 1),
    hair: new THREE.SphereGeometry(0.205, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.62),
    hatBrim: new THREE.CylinderGeometry(0.27, 0.27, 0.04, 10),
    hatCrown: new THREE.CylinderGeometry(0.16, 0.19, 0.16, 10),
    beret: new THREE.SphereGeometry(0.22, 10, 6),
    glasses: new THREE.BoxGeometry(0.24, 0.06, 0.06),
    halo: new THREE.OctahedronGeometry(0.14, 0),
    hitProxy: new THREE.CylinderGeometry(0.42, 0.42, 1.35, 8),
  };
  // Offset leg & arm pivots to hip / shoulder so swinging rotations pivot naturally
  sharedGeos.leg.translate(0, -0.17, 0);
  sharedGeos.arm.translate(0, -0.14, 0);
  sharedGeos.shadow.rotateX(-Math.PI / 2);
  sharedGeos.ring.rotateX(-Math.PI / 2);
  sharedGeos.lensRing.rotateX(-Math.PI / 2);

  // Pooled materials by color key
  const matPool = new Map<string, THREE.MeshStandardMaterial>();
  const getColorMat = (hexStr: string, roughness = 0.72, metalness = 0.04) => {
    const key = `${hexStr}_${roughness}_${metalness}`;
    let m = matPool.get(key);
    if (!m) {
      m = new THREE.MeshStandardMaterial({
        color: new THREE.Color(hexStr || '#64748B'),
        roughness,
        metalness,
      });
      matPool.set(key, m);
    }
    return m;
  };

  const shadowMat = new THREE.MeshBasicMaterial({
    map: textures.contactShadow,
    transparent: true,
    depthWrite: false,
    opacity: 0.72,
  });
  const selectionRingMat = new THREE.MeshBasicMaterial({
    color: 0x10b981,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.92,
  });
  const thinkingHaloMat = new THREE.MeshStandardMaterial({
    color: 0xfbbf24,
    emissive: 0xf59e0b,
    emissiveIntensity: 0.9,
    roughness: 0.22,
  });
  const invisibleMat = new THREE.MeshBasicMaterial({ visible: false });

  function createAgentRecord(agent: AgentState): Agent3DRecord {
    const root = new THREE.Group();
    const startX = agent.x + 0.5;
    const startZ = agent.y + 0.5;
    root.position.set(startX, 0.1, startZ);

    // Ground contact shadow
    const shadow = new THREE.Mesh(sharedGeos.shadow, shadowMat);
    shadow.position.y = 0.015;
    root.add(shadow);

    // Selection ring (shown only when selected)
    const selectionRing = new THREE.Mesh(sharedGeos.ring, selectionRingMat);
    selectionRing.position.y = 0.03;
    selectionRing.visible = false;
    root.add(selectionRing);

    // Map Lens halo ring (tinted per active spatial lens)
    const lensRingMat = new THREE.MeshBasicMaterial({
      color: 0x10b981,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.78,
      depthWrite: false,
    });
    const lensRing = new THREE.Mesh(sharedGeos.lensRing, lensRingMat);
    lensRing.position.y = 0.038;
    lensRing.visible = false;
    root.add(lensRing);

    // Articulated figurine body group (rotates toward facing direction)
    const bodyGroup = new THREE.Group();
    root.add(bodyGroup);

    const pantsMat = getColorMat(agent.appearance.pants, 0.82);
    const shirtMat = getColorMat(agent.appearance.shirt, 0.72);
    const skinMat = getColorMat(agent.appearance.skin, 0.65);
    const hairMat = getColorMat(agent.appearance.hair, 0.85);

    const leftLeg = new THREE.Mesh(sharedGeos.leg, pantsMat);
    leftLeg.position.set(-0.09, 0.34, 0);
    leftLeg.castShadow = true;

    const rightLeg = new THREE.Mesh(sharedGeos.leg, pantsMat);
    rightLeg.position.set(0.09, 0.34, 0);
    rightLeg.castShadow = true;

    const torso = new THREE.Mesh(sharedGeos.torso, shirtMat);
    torso.position.y = 0.54;
    torso.castShadow = true;
    torso.receiveShadow = true;

    const leftArm = new THREE.Mesh(sharedGeos.arm, shirtMat);
    leftArm.position.set(-0.24, 0.71, 0);
    leftArm.castShadow = true;

    const rightArm = new THREE.Mesh(sharedGeos.arm, shirtMat);
    rightArm.position.set(0.24, 0.71, 0);
    rightArm.castShadow = true;

    const head = new THREE.Mesh(sharedGeos.head, skinMat);
    head.position.y = 0.94;
    head.castShadow = true;

    const hair = new THREE.Mesh(sharedGeos.hair, hairMat);
    hair.position.set(0, 0.97, -0.02);
    hair.castShadow = true;

    bodyGroup.add(leftLeg, rightLeg, torso, leftArm, rightArm, head, hair);

    // Character accessories (apron, scarf, hat, beret, glasses)
    if (agent.appearance.accessory === 'apron') {
      const apron = new THREE.Mesh(sharedGeos.apron, getColorMat('#FAF8F4', 0.88));
      apron.position.set(0, 0.5, 0.19);
      bodyGroup.add(apron);
    } else if (agent.appearance.accessory === 'scarf') {
      const scarf = new THREE.Mesh(sharedGeos.scarf, getColorMat('#E05A3A', 0.82));
      scarf.rotation.x = Math.PI / 2;
      scarf.position.y = 0.76;
      bodyGroup.add(scarf);
    } else if (agent.appearance.accessory === 'hat') {
      const hatMat = getColorMat('#334155', 0.75);
      const brim = new THREE.Mesh(sharedGeos.hatBrim, hatMat);
      brim.position.y = 1.12;
      const crown = new THREE.Mesh(sharedGeos.hatCrown, hatMat);
      crown.position.y = 1.21;
      bodyGroup.add(brim, crown);
    } else if (agent.appearance.accessory === 'beret') {
      const beret = new THREE.Mesh(sharedGeos.beret, getColorMat('#6B21A8', 0.8));
      beret.scale.set(1, 0.42, 1);
      beret.position.set(0.03, 1.14, 0);
      beret.rotation.z = -0.15;
      bodyGroup.add(beret);
    } else if (agent.appearance.accessory === 'glasses') {
      const gl = new THREE.Mesh(sharedGeos.glasses, getColorMat('#1E293B', 0.25, 0.6));
      gl.position.set(0, 0.95, 0.17);
      bodyGroup.add(gl);
    }

    // Subtle floating golden octahedron when actively running LLM cognition
    const thinkingHalo = new THREE.Mesh(sharedGeos.halo, thinkingHaloMat);
    thinkingHalo.position.y = 1.48;
    thinkingHalo.visible = false;
    root.add(thinkingHalo);

    // Invisible simplified raycast target for crisp clicking
    const hitProxy = new THREE.Mesh(sharedGeos.hitProxy, invisibleMat);
    hitProxy.position.y = 0.68;
    hitProxy.userData = { agentId: agent.id };
    root.add(hitProxy);
    hitProxies.push(hitProxy);

    group.add(root);

    return {
      agentId: agent.id,
      root,
      bodyGroup,
      leftLeg,
      rightLeg,
      leftArm,
      rightArm,
      selectionRing,
      lensRing,
      lensRingMat,
      thinkingHalo,
      hitProxy,
      visualX: startX,
      visualZ: startZ,
      visualYaw: facingToYaw(agent.facing),
      walkPhase: (agent.id.charCodeAt(0) % 7) * 0.9,
    };
  }

  function removeStaleRecords(activeIds: Set<string>) {
    for (const [id, rec] of records.entries()) {
      if (!activeIds.has(id)) {
        group.remove(rec.root);
        rec.lensRingMat.dispose();
        const idx = hitProxies.indexOf(rec.hitProxy);
        if (idx >= 0) hitProxies.splice(idx, 1);
        records.delete(id);
      }
    }
  }

  const _lensColor = new THREE.Color();

  return {
    group,
    records,
    hitProxies,
    syncAndAnimate: (agents, selectedAgentId, delta, elapsed, lensAgents) => {
      const dt = Math.min(delta, 0.1);
      const activeIds = new Set<string>();

      for (const agent of agents) {
        activeIds.add(agent.id);
        let rec = records.get(agent.id);
        if (!rec) {
          rec = createAgentRecord(agent);
          records.set(agent.id, rec);
        }

        const targetX = agent.x + 0.5;
        const targetZ = agent.y + 0.5;
        const dx = targetX - rec.visualX;
        const dz = targetZ - rec.visualZ;
        const distSq = dx * dx + dz * dz;

        // Teleport smoothly if jumped far (e.g. time jump or reset), otherwise silkily damp
        if (distSq > 36) {
          rec.visualX = targetX;
          rec.visualZ = targetZ;
        } else {
          rec.visualX = THREE.MathUtils.damp(rec.visualX, targetX, 11, dt);
          rec.visualZ = THREE.MathUtils.damp(rec.visualZ, targetZ, 11, dt);
        }

        const isMoving = agent.path.length > 0 || distSq > 0.0025;
        const targetYaw =
          distSq > 0.004 ? Math.atan2(dx, dz) : facingToYaw(agent.facing);
        rec.visualYaw = dampAngle(rec.visualYaw, targetYaw, 10, dt);

        // Ground height slightly raised indoors (floor slab at 0.16) vs sidewalk (0.10)
        const baseY = agent.currentLocationId ? 0.16 : 0.1;
        rec.root.position.set(rec.visualX, baseY, rec.visualZ);
        rec.bodyGroup.rotation.y = rec.visualYaw;

        if (isMoving) {
          rec.walkPhase += dt * 11.5;
          const swing = Math.sin(rec.walkPhase) * 0.65;
          const bounce = Math.abs(Math.cos(rec.walkPhase)) * 0.08;
          rec.bodyGroup.position.y = bounce;
          rec.leftLeg.rotation.x = swing;
          rec.rightLeg.rotation.x = -swing;
          rec.leftArm.rotation.x = -swing * 0.8;
          rec.rightArm.rotation.x = swing * 0.8;
        } else {
          // Calm subtle breathing idle
          rec.bodyGroup.position.y = Math.sin(elapsed * 2.2 + rec.walkPhase) * 0.015;
          rec.leftLeg.rotation.x = THREE.MathUtils.damp(rec.leftLeg.rotation.x, 0, 10, dt);
          rec.rightLeg.rotation.x = THREE.MathUtils.damp(rec.rightLeg.rotation.x, 0, 10, dt);
          rec.leftArm.rotation.x = THREE.MathUtils.damp(rec.leftArm.rotation.x, 0, 10, dt);
          rec.rightArm.rotation.x = THREE.MathUtils.damp(rec.rightArm.rotation.x, 0, 10, dt);
        }

        const isSelected = agent.id === selectedAgentId;
        rec.selectionRing.visible = isSelected;
        if (isSelected) {
          const pulse = 1 + Math.sin(elapsed * 4) * 0.08;
          rec.selectionRing.scale.set(pulse, pulse, 1);
        }

        const lensStyle = lensAgents?.[agent.id];
        if (lensStyle) {
          _lensColor.set(lensStyle.colorHex);
          rec.lensRingMat.color.copy(_lensColor);
          rec.lensRingMat.opacity = Math.min(0.92, Math.max(0.28, lensStyle.intensity * 0.9));
          rec.lensRing.visible = true;
        } else {
          rec.lensRing.visible = false;
        }

        rec.thinkingHalo.visible = Boolean(agent.isThinking);
        if (agent.isThinking) {
          rec.thinkingHalo.rotation.y = elapsed * 2.8;
          rec.thinkingHalo.position.y = 1.48 + Math.sin(elapsed * 5) * 0.08;
        }
      }

      if (records.size !== activeIds.size) {
        removeStaleRecords(activeIds);
      }
    },
    getAgentHeadWorldPos: (agentId, out) => {
      const rec = records.get(agentId);
      if (!rec) return false;
      out.set(rec.visualX, rec.root.position.y + 1.42, rec.visualZ);
      return true;
    },
    dispose: () => {
      for (const rec of records.values()) rec.lensRingMat.dispose();
      for (const g of Object.values(sharedGeos)) g.dispose();
      for (const m of matPool.values()) m.dispose();
      shadowMat.dispose();
      selectionRingMat.dispose();
      thinkingHaloMat.dispose();
      invisibleMat.dispose();
    },
  };
}
