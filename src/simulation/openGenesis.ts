/**
 * Phase 4 ("Open Genesis" Trial) — Universal Domain-Agnostic Society Primitives
 * & Constrained Conservation Arbiter.
 *
 * Instead of hardcoding every social institution forever, agents compose generic:
 * - EmergentOrganizations (free-text charter, roles, dues, conserved pooled treasury)
 * - EmergentNorms (free-text shared social rules, adoption/challenge & sanctions)
 * - CustomAssets (agent-authored publications, vouchers, services traded with cash)
 * - AtomicWorldOps compiled from arbitrary `open_action` intents and enforced by
 *   strict physical, spatial, and double-entry monetary conservation invariants.
 *
 * Pure TypeScript: no React, no fetch, no Date.now(), no Math.random().
 */

import { attachAssociativeLinks } from './cognitiveDepth';
import { compactMemories, createMemoryNode, formatSimTime } from './memory';
import { applyEmotionalAppraisal, updateSocialEdge } from './psychology';
import { postPublicNotice } from './socialFabric';
import {
  DEFAULT_MEMORY_CAP,
  type AgentState,
  type ArbitratedActionRecord,
  type AtomicWorldOp,
  type ChronicleEvent,
  type CustomAsset,
  type EconomicTransaction,
  type EmergentNorm,
  type EmergentOrganization,
  type WorldState,
} from './types';

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function addLinkedMemory(
  agent: AgentState,
  node: ReturnType<typeof createMemoryNode>,
  simMinutes: number,
  allocId: (prefix: string) => string,
) {
  const { linkedNode, updatedExisting } = attachAssociativeLinks(node, agent.memories);
  return compactMemories(
    [linkedNode, ...updatedExisting],
    DEFAULT_MEMORY_CAP,
    simMinutes,
    allocId,
  );
}

/**
 * Constrained Conservation Arbiter: executes ONE atomic kernel op on behalf of `actorId`,
 * rejecting anything that violates conservation laws, solvency floors, or identity rules.
 */
export function executeAtomicOp(
  world: WorldState,
  actorId: string,
  op: AtomicWorldOp,
  allocId: (prefix: string) => string,
): { world: WorldState; ok: boolean; summary: string } {
  const actor = world.agents.find((a) => a.id === actorId);
  if (!actor) return { world, ok: false, summary: 'Unknown actor' };
  const day = formatSimTime(world.simMinutes).day;

  switch (op.op) {
    case 'transfer_cash': {
      if (op.fromId !== actorId || op.toId === actorId) {
        return { world, ok: false, summary: 'Unauthorized or self cash transfer blocked' };
      }
      if (!Number.isFinite(op.amount) || op.amount <= 0) {
        return { world, ok: false, summary: 'Transfer amount must be positive' };
      }
      const recipient = world.agents.find((a) => a.id === op.toId);
      if (!recipient) return { world, ok: false, summary: 'Unknown recipient' };
      const amount = roundMoney(clamp(Math.round(op.amount), 1, 250));
      const senderWallet = actor.wallet ?? 0;
      if (!Number.isFinite(amount) || senderWallet < amount + 10) {
        return { world, ok: false, summary: `Insufficient spare funds for $${amount} transfer` };
      }
      const note = op.note.trim().slice(0, 140) || `Open pact payment to ${recipient.name}`;
      const tx: EconomicTransaction = {
        id: allocId('tx_open'),
        simMinutes: world.simMinutes,
        kind: 'transfer',
        fromId: actor.id,
        toId: recipient.id,
        amount,
        note,
      };
      return {
        ok: true,
        summary: `Transferred $${amount} to ${recipient.name}`,
        world: {
          ...world,
          agents: world.agents.map((ag) => {
            if (ag.id === actor.id) {
              return { ...ag, wallet: roundMoney((ag.wallet ?? 0) - amount) };
            }
            if (ag.id === recipient.id) {
              return { ...ag, wallet: roundMoney((ag.wallet ?? 0) + amount) };
            }
            return ag;
          }),
          transactions: [tx, ...(world.transactions ?? [])].slice(0, 140),
          stats: {
            ...world.stats,
            economicTransactions: (world.stats.economicTransactions ?? 0) + 1,
            totalTradeVolume: roundMoney((world.stats.totalTradeVolume ?? 0) + amount),
          },
        },
      };
    }

    case 'create_org': {
      const existingActive = (world.organizations ?? []).filter((o) => o.active);
      if (existingActive.length >= 10) {
        return { world, ok: false, summary: 'Organization capacity (10 active) reached' };
      }
      const name = op.name.trim().slice(0, 80);
      const charter = op.charter.trim().slice(0, 220);
      if (!name || !charter) {
        return { world, ok: false, summary: 'Organization requires a name and charter' };
      }
      const dup = existingActive.some((o) => o.name.toLowerCase() === name.toLowerCase());
      if (dup) return { world, ok: false, summary: `Organization "${name}" already exists` };

      const contrib = roundMoney(clamp(Math.round(op.initialContribution ?? 0), 0, 150));
      const actorWallet = actor.wallet ?? 0;
      if (contrib > 0 && actorWallet < contrib + 20) {
        return {
          world,
          ok: false,
          summary: `${actor.name} lacks spare liquidity for $${contrib} startup pool`,
        };
      }
      const dues = roundMoney(clamp(Math.round(op.duesAmount ?? 0), 0, 40));
      const hq =
        op.headquartersLocationId &&
        world.locations.some((l) => l.id === op.headquartersLocationId)
          ? op.headquartersLocationId
          : actor.currentLocationId ?? undefined;

      const org: EmergentOrganization = {
        id: allocId('org'),
        name,
        charter,
        founderId: actor.id,
        leaderId: actor.id,
        memberRoles: { [actor.id]: op.roleTitle?.trim().slice(0, 40) || 'Founder' },
        treasury: contrib,
        duesAmount: dues,
        rules: op.rule?.trim() ? [op.rule.trim().slice(0, 160)] : [],
        ...(hq ? { headquartersLocationId: hq } : {}),
        createdDay: day,
        active: true,
      };

      return {
        ok: true,
        summary: `Founded "${name}"${contrib > 0 ? ` ($${contrib} pooled)` : ''}`,
        world: {
          ...world,
          agents:
            contrib > 0
              ? world.agents.map((ag) =>
                  ag.id === actor.id
                    ? { ...ag, wallet: roundMoney((ag.wallet ?? 0) - contrib) }
                    : ag,
                )
              : world.agents,
          organizations: [org, ...(world.organizations ?? [])].slice(0, 20),
          stats: {
            ...world.stats,
            orgsFounded: (world.stats.orgsFounded ?? 0) + 1,
          },
        },
      };
    }

    case 'join_org': {
      const orgs = world.organizations ?? [];
      const idx = orgs.findIndex((o) => o.id === op.orgId && o.active);
      if (idx < 0) return { world, ok: false, summary: 'Active organization not found' };
      const org = orgs[idx];
      if (org.memberRoles[actor.id]) {
        return { world, ok: false, summary: `${actor.name} is already a member of ${org.name}` };
      }
      const contrib = roundMoney(clamp(Math.round(op.contribution ?? 0), 0, 150));
      if (contrib > 0 && (actor.wallet ?? 0) < contrib + 15) {
        return { world, ok: false, summary: `Insufficient funds for $${contrib} joining dues` };
      }
      const nextOrg: EmergentOrganization = {
        ...org,
        treasury: roundMoney(org.treasury + contrib),
        memberRoles: {
          ...org.memberRoles,
          [actor.id]: op.roleTitle?.trim().slice(0, 40) || 'Member',
        },
      };
      return {
        ok: true,
        summary: `Joined "${org.name}" as ${nextOrg.memberRoles[actor.id]}`,
        world: {
          ...world,
          agents:
            contrib > 0
              ? world.agents.map((ag) =>
                  ag.id === actor.id
                    ? { ...ag, wallet: roundMoney((ag.wallet ?? 0) - contrib) }
                    : ag,
                )
              : world.agents,
          organizations: orgs.map((o, i) => (i === idx ? nextOrg : o)),
        },
      };
    }

    case 'org_contribute': {
      if (!Number.isFinite(op.amount) || op.amount <= 0) {
        return { world, ok: false, summary: 'Contribution amount must be positive' };
      }
      const orgs = world.organizations ?? [];
      const idx = orgs.findIndex((o) => o.id === op.orgId && o.active);
      if (idx < 0) return { world, ok: false, summary: 'Active organization not found' };
      const amount = roundMoney(clamp(Math.round(op.amount), 1, 150));
      if ((actor.wallet ?? 0) < amount + 15) {
        return { world, ok: false, summary: `Insufficient spare cash to contribute $${amount}` };
      }
      const org = orgs[idx];
      const nextOrg: EmergentOrganization = {
        ...org,
        treasury: roundMoney(org.treasury + amount),
        memberRoles: org.memberRoles[actor.id]
          ? org.memberRoles
          : { ...org.memberRoles, [actor.id]: 'Contributor' },
      };
      return {
        ok: true,
        summary: `Contributed $${amount} to "${org.name}"`,
        world: {
          ...world,
          agents: world.agents.map((ag) =>
            ag.id === actor.id ? { ...ag, wallet: roundMoney((ag.wallet ?? 0) - amount) } : ag,
          ),
          organizations: orgs.map((o, i) => (i === idx ? nextOrg : o)),
        },
      };
    }

    case 'org_payout': {
      if (!Number.isFinite(op.amount) || op.amount <= 0) {
        return { world, ok: false, summary: 'Payout amount must be positive' };
      }
      const orgs = world.organizations ?? [];
      const idx = orgs.findIndex((o) => o.id === op.orgId && o.active);
      if (idx < 0) return { world, ok: false, summary: 'Active organization not found' };
      const org = orgs[idx];
      if (!org.memberRoles[actor.id] && org.leaderId !== actor.id) {
        return { world, ok: false, summary: 'Non-members cannot authorize organization payouts' };
      }
      const recipient = world.agents.find((a) => a.id === op.toAgentId);
      if (!recipient) return { world, ok: false, summary: 'Unknown payout recipient' };
      const amount = roundMoney(clamp(Math.round(op.amount), 1, 250));
      if (org.treasury < amount) {
        return { world, ok: false, summary: `"${org.name}" treasury ($${org.treasury}) cannot cover $${amount}` };
      }
      const nextOrg: EmergentOrganization = {
        ...org,
        treasury: roundMoney(org.treasury - amount),
      };
      return {
        ok: true,
        summary: `"${org.name}" disbursed $${amount} to ${recipient.name} (${op.reason.slice(0, 60)})`,
        world: {
          ...world,
          agents: world.agents.map((ag) =>
            ag.id === recipient.id
              ? { ...ag, wallet: roundMoney((ag.wallet ?? 0) + amount) }
              : ag,
          ),
          organizations: orgs.map((o, i) => (i === idx ? nextOrg : o)),
        },
      };
    }

    case 'propose_norm': {
      const existingActive = (world.emergentNorms ?? []).filter((n) => n.active);
      if (existingActive.length >= 16) {
        return { world, ok: false, summary: 'Active emergent norm limit (16) reached' };
      }
      const statement = op.statement.trim().slice(0, 180);
      if (statement.length < 8) {
        return { world, ok: false, summary: 'Norm statement too short' };
      }
      if (existingActive.some((n) => n.statement.toLowerCase() === statement.toLowerCase())) {
        return { world, ok: false, summary: 'Equivalent emergent norm already exists' };
      }
      const norm: EmergentNorm = {
        id: allocId('enrm'),
        statement,
        originAgentId: actor.id,
        originName: actor.name,
        adopterIds: [actor.id],
        challengerIds: [],
        strength: 55,
        sanctionsCount: 0,
        createdDay: day,
        active: true,
      };
      return {
        ok: true,
        summary: `Proposed norm: "${statement}"`,
        world: {
          ...world,
          emergentNorms: [norm, ...(world.emergentNorms ?? [])].slice(0, 24),
          stats: {
            ...world.stats,
            emergentNormsCreated: (world.stats.emergentNormsCreated ?? 0) + 1,
          },
        },
      };
    }

    case 'adopt_or_challenge_norm': {
      const norms = world.emergentNorms ?? [];
      const idx = norms.findIndex((n) => n.id === op.normId && n.active);
      if (idx < 0) return { world, ok: false, summary: 'Emergent norm not found' };
      const norm = norms[idx];
      const nextAdopters = op.adopt
        ? Array.from(new Set([...norm.adopterIds, actor.id]))
        : norm.adopterIds.filter((id) => id !== actor.id);
      const nextChallengers = !op.adopt
        ? Array.from(new Set([...norm.challengerIds, actor.id]))
        : norm.challengerIds.filter((id) => id !== actor.id);
      const nextNorm: EmergentNorm = {
        ...norm,
        adopterIds: nextAdopters,
        challengerIds: nextChallengers,
        strength: clamp(norm.strength + (op.adopt ? 5 : -5), 5, 100),
      };
      return {
        ok: true,
        summary: `${op.adopt ? 'Adopted' : 'Challenged'} norm "${norm.statement.slice(0, 60)}"`,
        world: {
          ...world,
          emergentNorms: norms.map((n, i) => (i === idx ? nextNorm : n)),
        },
      };
    }

    case 'sanction_norm': {
      if (op.targetAgentId === actor.id) {
        return { world, ok: false, summary: 'Cannot sanction yourself' };
      }
      const target = world.agents.find((a) => a.id === op.targetAgentId);
      const norms = world.emergentNorms ?? [];
      const idx = norms.findIndex((n) => n.id === op.normId && n.active);
      if (!target || idx < 0) {
        return { world, ok: false, summary: 'Unknown target or norm for sanction' };
      }
      const norm = norms[idx];
      const nextNorm: EmergentNorm = {
        ...norm,
        sanctionsCount: norm.sanctionsCount + 1,
        strength: clamp(norm.strength + 3, 5, 100),
      };
      return {
        ok: true,
        summary: `Socially sanctioned ${target.name} under "${norm.statement.slice(0, 50)}"`,
        world: {
          ...world,
          agents: world.agents.map((ag) => {
            if (ag.id === actor.id) {
              const prevEdge = ag.socialGraph[target.id];
              return {
                ...ag,
                socialGraph: {
                  ...ag.socialGraph,
                  [target.id]: updateSocialEdge(prevEdge, {
                    targetId: target.id,
                    roleLabel: prevEdge?.roleLabel ?? 'Neighbor',
                    deltaTrust: -8,
                    deltaAffection: -5,
                    deltaFamiliarity: 2,
                    inferredGoal: op.reason.slice(0, 120),
                    simMinutes: world.simMinutes,
                  }),
                },
              };
            }
            if (ag.id === target.id) {
              return {
                ...ag,
                reputation: clamp((ag.reputation ?? 55) - 4, -100, 100),
                mood: applyEmotionalAppraisal(ag.mood, ag.drives, -0.1, 0.08),
              };
            }
            return ag;
          }),
          emergentNorms: norms.map((n, i) => (i === idx ? nextNorm : n)),
        },
      };
    }

    case 'create_asset': {
      const existingAssets = world.customAssets ?? [];
      if (existingAssets.length >= 40) {
        return { world, ok: false, summary: 'Custom asset registry cap (40) reached' };
      }
      const name = op.name.trim().slice(0, 80);
      if (!name) return { world, ok: false, summary: 'Custom asset needs a name' };
      const unitValue = roundMoney(clamp(Math.round(op.unitValue), 1, 100));
      const quantity = clamp(Math.round(op.quantity ?? 1), 1, 20);
      const asset: CustomAsset = {
        id: allocId('ast'),
        name,
        description: op.description.trim().slice(0, 180) || name,
        creatorId: actor.id,
        ownerId: actor.id,
        unitValue,
        quantity,
        ...(op.organizationId ? { organizationId: op.organizationId } : {}),
        createdDay: day,
      };
      return {
        ok: true,
        summary: `Created custom asset "${name}" (qty ${quantity}, $${unitValue})`,
        world: {
          ...world,
          customAssets: [asset, ...existingAssets].slice(0, 40),
        },
      };
    }

    case 'trade_asset': {
      if (!Number.isFinite(op.price) || op.price <= 0) {
        return { world, ok: false, summary: 'Asset trade price must be positive' };
      }
      const assets = world.customAssets ?? [];
      const aIdx = assets.findIndex((a) => a.id === op.assetId && a.quantity > 0);
      if (aIdx < 0) return { world, ok: false, summary: 'Custom asset unavailable' };
      const asset = assets[aIdx];
      if (op.buyerId === asset.ownerId) {
        return { world, ok: false, summary: 'Buyer already owns this asset' };
      }
      const buyer = world.agents.find((a) => a.id === op.buyerId);
      const seller = world.agents.find((a) => a.id === asset.ownerId);
      if (!buyer || !seller) return { world, ok: false, summary: 'Invalid buyer or seller' };
      const price = roundMoney(clamp(Math.round(op.price), 1, 200));
      if ((buyer.wallet ?? 0) < price + 5) {
        return { world, ok: false, summary: `${buyer.name} lacks $${price} for "${asset.name}"` };
      }

      let nextAssets = [...assets];
      if (asset.quantity > 1) {
        nextAssets[aIdx] = { ...asset, quantity: asset.quantity - 1 };
        nextAssets = [
          {
            ...asset,
            id: allocId('ast'),
            ownerId: buyer.id,
            quantity: 1,
          },
          ...nextAssets,
        ].slice(0, 40);
      } else {
        nextAssets[aIdx] = { ...asset, ownerId: buyer.id };
      }

      const tx: EconomicTransaction = {
        id: allocId('tx_ast'),
        simMinutes: world.simMinutes,
        kind: 'purchase',
        fromId: buyer.id,
        toId: seller.id,
        amount: price,
        note: `Custom asset trade: "${asset.name}" ($${price})`,
      };

      return {
        ok: true,
        summary: `Traded "${asset.name}" to ${buyer.name} for $${price}`,
        world: {
          ...world,
          agents: world.agents.map((ag) => {
            if (ag.id === buyer.id) {
              return { ...ag, wallet: roundMoney((ag.wallet ?? 0) - price) };
            }
            if (ag.id === seller.id) {
              return { ...ag, wallet: roundMoney((ag.wallet ?? 0) + price) };
            }
            return ag;
          }),
          customAssets: nextAssets,
          transactions: [tx, ...(world.transactions ?? [])].slice(0, 140),
          stats: {
            ...world.stats,
            customAssetsTraded: (world.stats.customAssetsTraded ?? 0) + 1,
            economicTransactions: (world.stats.economicTransactions ?? 0) + 1,
            totalTradeVolume: roundMoney((world.stats.totalTradeVolume ?? 0) + price),
          },
        },
      };
    }

    case 'publish_record': {
      const nextW = postPublicNotice(
        world,
        {
          authorId: actor.id,
          authorName: actor.name,
          category: 'news',
          title: op.title.trim().slice(0, 110) || `${actor.name.split(' ')[0]}'s Public Statement`,
          body: op.body.trim().slice(0, 340) || op.title.trim().slice(0, 200),
          locationId: op.locationId ?? actor.currentLocationId ?? 'town_hall',
          createMeme: false,
        },
        allocId,
      );
      return {
        ok: true,
        summary: `Published record: "${op.title.trim().slice(0, 70)}"`,
        world: nextW,
      };
    }

    case 'shift_relation': {
      if (op.targetAgentId === actor.id) {
        return { world, ok: false, summary: 'Cannot shift relation with self' };
      }
      const target = world.agents.find((a) => a.id === op.targetAgentId);
      if (!target) return { world, ok: false, summary: 'Unknown relation target' };
      const dT = clamp(Math.round(op.deltaTrust), -16, 16);
      const dA = clamp(Math.round(op.deltaAffection), -16, 16);
      return {
        ok: true,
        summary: `Updated stance toward ${target.name} (trust ${dT >= 0 ? `+${dT}` : dT})`,
        world: {
          ...world,
          agents: world.agents.map((ag) => {
            if (ag.id !== actor.id) return ag;
            const prev = ag.socialGraph[target.id];
            return {
              ...ag,
              socialGraph: {
                ...ag.socialGraph,
                [target.id]: updateSocialEdge(prev, {
                  targetId: target.id,
                  roleLabel: prev?.roleLabel ?? 'Neighbor',
                  deltaTrust: dT,
                  deltaAffection: dA,
                  deltaFamiliarity: 3,
                  inferredGoal: op.reason.slice(0, 120),
                  simMinutes: world.simMinutes,
                }),
              },
            };
          }),
        },
      };
    }
  }
}

/**
 * Deterministic offline compiler for arbitrary natural-language `open_action` intents
 * (used in headless tests, `$0` dev runs, or when the server arbiter is unavailable).
 */
export function compileOfflineOpenAction(
  world: WorldState,
  actorId: string,
  intentText: string,
): AtomicWorldOp[] {
  const actor = world.agents.find((a) => a.id === actorId);
  if (!actor) return [];
  const low = intentText.toLowerCase();
  const firstName = actor.name.split(' ')[0];

  if (/\b(found|start|establish|organize|union|guild|fund|society|club|newspaper|coop|cooperative|bank|credit)\b/.test(low)) {
    const existing = (world.organizations ?? []).find(
      (o) => o.active && !o.memberRoles[actor.id],
    );
    if ((world.organizations?.length ?? 0) >= 6 && existing) {
      return [{ op: 'join_org', orgId: existing.id, roleTitle: 'Member', contribution: 5 }];
    }
    const labelMatch = /(?:called|named)\s+"?([A-Za-z0-9 '&-]+)"?/i.exec(intentText);
    const orgName = labelMatch?.[1]?.trim() || `${firstName}'s Town Circle`;
    const contribution = (actor.wallet ?? 0) >= 85 ? 20 : 0;
    return [
      {
        op: 'create_org',
        name: orgName,
        charter: intentText.trim().slice(0, 180),
        roleTitle: 'Organizer',
        initialContribution: contribution,
        duesAmount: 3,
        headquartersLocationId: actor.currentLocationId ?? 'town_hall',
      },
    ];
  }

  if (/\b(norm|custom|rule|standard|ethos|pledge)\b/.test(low)) {
    return [
      {
        op: 'propose_norm',
        statement: intentText.trim().slice(0, 170),
      },
    ];
  }

  if (/\b(issue|voucher|edition|publish|gazette|pamphlet|lesson|ticket|asset|service)\b/.test(low)) {
    return [
      {
        op: 'create_asset',
        name: `${firstName}'s Community Edition`,
        description: intentText.trim().slice(0, 160),
        unitValue: 6,
        quantity: 3,
      },
    ];
  }

  const activeNorm = (world.emergentNorms ?? []).find(
    (n) => n.active && !n.adopterIds.includes(actor.id),
  );
  if (activeNorm) {
    return [{ op: 'adopt_or_challenge_norm', normId: activeNorm.id, adopt: true }];
  }

  return [
    {
      op: 'publish_record',
      title: `${firstName}'s Initiative`,
      body: intentText.trim().slice(0, 220),
      locationId: actor.currentLocationId ?? 'town_hall',
    },
  ];
}

export function applyArbitratedOpenAction(
  world: WorldState,
  actorId: string,
  intentText: string,
  ops: readonly AtomicWorldOp[],
  allocId: (prefix: string) => string,
  narrative?: string,
): { world: WorldState; record?: ArbitratedActionRecord; appliedCount: number } {
  const actor = world.agents.find((a) => a.id === actorId);
  if (!actor) return { world, appliedCount: 0 };

  let working = world;
  const summaries: string[] = [];
  let appliedCount = 0;
  let rejectedOpsCount = 0;

  for (const op of ops.slice(0, 4)) {
    const res = executeAtomicOp(working, actorId, op, allocId);
    working = res.world;
    if (res.ok) {
      appliedCount += 1;
      summaries.push(res.summary);
    } else {
      rejectedOpsCount += 1;
    }
  }

  if (appliedCount === 0 && summaries.length === 0) {
    return { world: working, appliedCount: 0 };
  }

  const finalNarrative =
    narrative?.trim().slice(0, 220) ||
    summaries.join('; ') ||
    intentText.trim().slice(0, 180);

  const record: ArbitratedActionRecord = {
    id: allocId('arb'),
    simMinutes: world.simMinutes,
    actorId: actor.id,
    actorName: actor.name,
    intent: intentText.trim().slice(0, 200),
    narrative: finalNarrative,
    appliedOpsCount: appliedCount,
    rejectedOpsCount,
    summaries,
  };

  const mem = createMemoryNode({
    id: allocId(`mem_gen_${actor.id}`),
    createdAt: world.simMinutes,
    type: 'observation',
    source: 'genesis',
    description: `${actor.name} carried out an autonomous initiative: ${finalNarrative}`,
    importance: 7,
  });

  const chr: ChronicleEvent = {
    id: allocId('chr_gen'),
    simMinutes: world.simMinutes,
    type: 'civic',
    title: `${actor.name}: ${summaries[0] ?? 'Open initiative'}`,
    detail: finalNarrative,
    agentIds: [actor.id],
    locationName:
      working.locations.find((l) => l.id === actor.currentLocationId)?.name ?? 'Smallville',
  };

  return {
    appliedCount,
    record,
    world: {
      ...working,
      agents: working.agents.map((ag) =>
        ag.id === actor.id
          ? {
              ...ag,
              memories: addLinkedMemory(ag, mem, working.simMinutes, allocId),
            }
          : ag,
      ),
      arbitratedActions: [record, ...(working.arbitratedActions ?? [])].slice(0, 40),
      chronicle: [chr, ...working.chronicle].slice(0, 140),
      stats: {
        ...working.stats,
        openActionsArbitrated: (working.stats.openActionsArbitrated ?? 0) + 1,
      },
    },
  };
}

/**
 * Daily Open Genesis evolution: collects voluntary/agreed membership dues into org pools
 * (strictly conserving money) and spreads active EmergentNorms through trusted social ties.
 */
export function stepEmergentOrganizationsAndNorms(
  world: WorldState,
  currentDay: number,
  allocId: (prefix: string) => string,
): WorldState {
  let working = world;

  // 1. Collect daily dues strictly from solvent org members into org.treasury
  const orgs = working.organizations ?? [];
  if (orgs.length > 0) {
    let nextAgents = [...working.agents];
    const nextOrgs = orgs.map((org) => {
      if (!org.active || org.duesAmount <= 0 || currentDay <= org.createdDay) return org;
      let collected = 0;
      const dues = org.duesAmount;
      nextAgents = nextAgents.map((ag) => {
        if (!org.memberRoles[ag.id]) return ag;
        if ((ag.wallet ?? 0) < dues + 35) return ag;
        collected = roundMoney(collected + dues);
        return { ...ag, wallet: roundMoney((ag.wallet ?? 0) - dues) };
      });
      return collected > 0
        ? { ...org, treasury: roundMoney(org.treasury + collected) }
        : org;
    });
    working = { ...working, agents: nextAgents, organizations: nextOrgs };
  }

  // 2. Organic diffusion / challenge of active EmergentNorms across social trust ties
  const norms = working.emergentNorms ?? [];
  if (norms.length > 0) {
    const nextNorms = norms.map((norm) => {
      if (!norm.active) return norm;
      const adopterSet = new Set(norm.adopterIds);
      const challengerSet = new Set(norm.challengerIds);
      let deltaStrength = 0;
      let added = 0;
      for (const ag of working.agents) {
        if (added >= 2) break;
        if (adopterSet.has(ag.id) || challengerSet.has(ag.id)) continue;
        const originTrust = ag.socialGraph[norm.originAgentId]?.trust ?? 45;
        const stub = ag.temperament?.stubbornness ?? 0.55;
        if (originTrust >= 62) {
          adopterSet.add(ag.id);
          deltaStrength += 2;
          added += 1;
        } else if (originTrust < 30 && stub >= 0.7) {
          challengerSet.add(ag.id);
          deltaStrength -= 2;
          added += 1;
        }
      }
      return added > 0
        ? {
            ...norm,
            adopterIds: Array.from(adopterSet),
            challengerIds: Array.from(challengerSet),
            strength: clamp(norm.strength + deltaStrength, 5, 100),
          }
        : norm;
    });
    working = { ...working, emergentNorms: nextNorms };
  }

  return working;
}

export function applyDailyOpenGenesisRollover(
  world: WorldState,
  currentDay: number,
  allocId: (prefix: string) => string,
): WorldState {
  return stepEmergentOrganizationsAndNorms(world, currentDay, allocId);
}
