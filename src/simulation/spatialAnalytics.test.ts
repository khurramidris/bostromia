import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialWorldState } from './engine';
import {
  computeBuildingYieldCard,
  computeExplorerPoints,
  computeMapLensOverlay,
  computeResidentPictograms,
  computeTownAdvisors,
  MAP_LENSES,
} from './spatialAnalytics';

test('Map Lenses compute overlays cleanly across all 6 lens modes', () => {
  const world = createInitialWorldState('default');
  const firstAgentId = world.agents[0].id;

  for (const lensDef of MAP_LENSES) {
    const res = computeMapLensOverlay(world, lensDef.id, { focusAgentId: firstAgentId });
    assert.equal(res.lens, lensDef.id);
    assert.ok(res.title.length > 0);
    if (lensDef.id === 'normal') {
      assert.equal(Object.keys(res.agents).length, 0);
      assert.equal(res.arcs.length, 0);
    } else {
      assert.equal(
        Object.keys(res.agents).length,
        world.agents.length,
        `Lens ${lensDef.id} should style every resident`,
      );
      assert.ok(res.legend.length >= 2, `Lens ${lensDef.id} should include legend items`);
    }
  }

  // Trust lens builds arcs when strong/strained edges exist
  const boostedTrustWorld = {
    ...world,
    agents: world.agents.map((ag, idx) =>
      idx === 0
        ? {
            ...ag,
            socialGraph: {
              ...ag.socialGraph,
              [world.agents[1].id]: {
                targetId: world.agents[1].id,
                roleLabel: 'ally',
                inferredGoal: 'help town',
                trust: 82,
                affection: 76,
                familiarity: 70,
                lastUpdatedSimMin: world.simMinutes,
              },
              [world.agents[2].id]: {
                targetId: world.agents[2].id,
                roleLabel: 'rival',
                inferredGoal: 'compete',
                trust: 22,
                affection: 25,
                familiarity: 50,
                lastUpdatedSimMin: world.simMinutes,
              },
            },
          }
        : ag,
    ),
  };
  const trustRes = computeMapLensOverlay(boostedTrustWorld, 'trust', { focusAgentId: firstAgentId });
  assert.ok(trustRes.arcs.length >= 2, 'Trust lens emits arcs for strong and strained relationships');
});

test('Building Yield Card returns Civ-style commercial yields for Hobbs Cafe and civic yields for Town Hall', () => {
  const world = createInitialWorldState('default');

  const cafeCard = computeBuildingYieldCard(world, 'hobbs_cafe');
  assert.ok(cafeCard);
  assert.equal(cafeCard.location.id, 'hobbs_cafe');
  assert.ok(cafeCard.yields.some((y) => y.label === 'Treasury'));
  assert.ok(cafeCard.inventory.length > 0, 'Commercial venue shows stocked inventory');

  const hallCard = computeBuildingYieldCard(world, 'town_hall');
  assert.ok(hallCard);
  assert.equal(hallCard.specialization, 'Civic Hall');
  assert.ok(hallCard.yields.some((y) => y.label === 'Town Treasury'));

  assert.equal(computeBuildingYieldCard(world, 'nonexistent_place'), null);
});

test('18-Resident Pictograms produce full per-resident arrays matching population counts', () => {
  const world = createInitialWorldState('default');
  const rows = computeResidentPictograms(world);
  assert.ok(rows.length >= 3, 'Includes rumor/civic/wealth/wellbeing pictogram rows');
  for (const row of rows) {
    assert.equal(row.cells.length, world.agents.length);
    const legendTotal = row.legend.reduce((s, item) => s + item.count, 0);
    assert.equal(legendTotal, world.agents.length, `Legend counts sum to population in ${row.id}`);
  }
});

test('Town Advisors return 3 zero-LLM deterministic briefs with actionable map focuses', () => {
  const world = createInitialWorldState('default');
  const advisors = computeTownAdvisors(world);
  assert.equal(advisors.length, 3);
  assert.deepEqual(
    advisors.map((a) => a.id),
    ['economy', 'civic', 'social'],
  );
  for (const adv of advisors) {
    assert.ok(adv.headlineMetric.length > 0);
    assert.ok(adv.bullets.length >= 2);
    assert.ok(adv.action.label.length > 0);
  }
});

test('Linked Resident Explorer computes normalized scatter coordinates in [0, 1]', () => {
  const world = createInitialWorldState('default');
  const dataset = computeExplorerPoints(world, 'wallet', 'avgTrust');
  assert.equal(dataset.points.length, world.agents.length);
  for (const pt of dataset.points) {
    assert.ok(pt.xNorm >= 0 && pt.xNorm <= 1);
    assert.ok(pt.yNorm >= 0 && pt.yNorm <= 1);
  }
});
