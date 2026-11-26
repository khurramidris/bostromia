import assert from 'node:assert/strict';
import test from 'node:test';
import { createInitialWorldState } from './engine';
import { makeIdAllocator } from './ids';
import {
  castElectionVote,
  computeGiniCoefficient,
  computeMacroSnapshot,
  finalizeTownElection,
  openTownElection,
  rebalanceMarketPrices,
  runLaborMarketCycle,
  stepHealthAndClinic,
  stepSocialClubs,
} from './institutions';
import { validateWorld } from './validateWorld';

test('Phase D: computeGiniCoefficient & computeMacroSnapshot report accurate macro telemetry', () => {
  assert.equal(computeGiniCoefficient([100, 100, 100, 100]), 0);
  const unequal = computeGiniCoefficient([10, 10, 10, 970]);
  assert.ok(unequal > 0.7 && unequal < 0.76, `Expected high Gini near 0.72, got ${unequal}`);

  const world = createInitialWorldState();
  const snap = computeMacroSnapshot(world);
  assert.equal(snap.populationCount, world.agents.length);
  assert.ok(snap.avgWealth > 0);
  assert.ok(snap.giniIndex >= 0 && snap.giniIndex <= 1);
  assert.ok(snap.employmentRatePct > 0 && snap.employmentRatePct <= 100);
  assert.ok(snap.priceIndex > 0.5 && snap.priceIndex < 2.0);
  assert.equal(snap.sickCount, 0);
});

test('Phase D: rebalanceMarketPrices raises prices under scarcity and respects marketStipend cap', () => {
  const world = createInitialWorldState();
  const cafe = world.businesses?.hobbs_cafe;
  assert.ok(cafe, 'Hobbs Cafe should exist');

  const baseCoffeePrice = cafe.stock.coffee?.price ?? 5;
  const scarceWorld = {
    ...world,
    businesses: {
      ...world.businesses!,
      hobbs_cafe: {
        ...cafe,
        stock: {
          ...cafe.stock,
          coffee: { ...cafe.stock.coffee!, quantity: 0 },
        },
      },
    },
  };

  const rebalanced = rebalanceMarketPrices(scarceWorld);
  const higherPrice = rebalanced.businesses!.hobbs_cafe.stock.coffee!.price;
  assert.ok(higherPrice >= baseCoffeePrice, 'Scarcity should push price up or hold ceiling');

  // With marketStipend active, grocery/produce prices should stay moderated
  const market = world.businesses!.willows_market;
  const stipendWorld = {
    ...world,
    townModifiers: { ...world.townModifiers!, marketStipend: true },
    businesses: {
      ...world.businesses!,
      willows_market: {
        ...market,
        stock: {
          ...market.stock,
          groceries: { ...market.stock.groceries!, quantity: 0, price: 20 },
        },
      },
    },
  };
  const subsidized = rebalanceMarketPrices(stipendWorld);
  const subPrice = subsidized.businesses!.willows_market.stock.groceries!.price;
  assert.ok(subPrice <= 18, `Expected marketStipend to moderate grocery price, got ${subPrice}`);
});

test('Phase D: runLaborMarketCycle hires unemployed residents and trims distressed business payrolls', () => {
  const world = createInitialWorldState();
  const alloc = makeIdAllocator(world.idSeq);

  // Pick a resident and make them unemployed with low cash; make Hobbs Cafe flush with cash
  const targetId = world.agents[world.agents.length - 1].id;
  const setupWorld = {
    ...world,
    agents: world.agents.map((a) =>
      a.id === targetId
        ? { ...a, employerLocationId: undefined, wagePerHour: 0, wallet: 45 }
        : a,
    ),
    businesses: {
      ...world.businesses!,
      hobbs_cafe: {
        ...world.businesses!.hobbs_cafe,
        treasury: 950,
      },
    },
  };

  const hireRes = runLaborMarketCycle(setupWorld, alloc.next);
  const afterHire = hireRes.world;
  const hiredAgent = afterHire.agents.find((a) => a.id === targetId)!;
  assert.ok(hiredAgent.employerLocationId, 'Unemployed low-cash resident should be hired');
  assert.ok((hiredAgent.wagePerHour ?? 0) > 0, 'Hired resident should earn hourly wage');
  assert.ok((afterHire.stats.jobsFilled ?? 0) >= 1);

  // Now simulate severe distress at a business with employees
  const employerId = hiredAgent.employerLocationId!;
  const distressed = {
    ...afterHire,
    businesses: {
      ...afterHire.businesses!,
      [employerId]: {
        ...afterHire.businesses![employerId],
        treasury: 5,
      },
    },
  };
  const layoffRes = runLaborMarketCycle(distressed, alloc.next);
  const afterLayoff = layoffRes.world;
  const postBiz = afterLayoff.businesses![employerId];
  assert.ok(
    postBiz.employeeIds.length < distressed.businesses![employerId].employeeIds.length ||
      postBiz.wagePerHour < distressed.businesses![employerId].wagePerHour,
    'Distressed business should reduce headcount or wage rate',
  );
  assert.equal(validateWorld(afterLayoff).length, 0);
});

test('Phase D: stepHealthAndClinic treats sick patients at Smallville Clinic with communityClinic discount', () => {
  const world = createInitialWorldState();
  const alloc = makeIdAllocator(world.idSeq);
  const patient = world.agents.find((a) => a.id !== 'elena')!;
  const clinicBeforeTreasury = world.businesses!.smallville_clinic.treasury;

  const sickAtClinic = {
    ...world,
    townModifiers: { ...world.townModifiers!, communityClinic: true },
    agents: world.agents.map((a) =>
      a.id === patient.id
        ? {
            ...a,
            currentLocationId: 'smallville_clinic',
            path: [],
            health: 48,
            illness: 'mild_cold' as const,
            wallet: 200,
          }
        : a,
    ),
  };

  const treatRes = stepHealthAndClinic(sickAtClinic, alloc.next);
  const treated = treatRes.world;
  const patientAfter = treated.agents.find((a) => a.id === patient.id)!;
  const clinicAfterTreasury = treated.businesses!.smallville_clinic.treasury;

  assert.equal(patientAfter.illness, 'none', 'Clinic care should cure mild_cold');
  assert.ok((patientAfter.health ?? 0) > 48, 'Clinic care should restore health');
  assert.ok(
    (patientAfter.wallet ?? 0) < 200 && (patientAfter.wallet ?? 0) >= 180,
    `Community clinic discount should charge ~$6-$11 (wallet=${patientAfter.wallet})`,
  );
  assert.ok(
    clinicAfterTreasury > clinicBeforeTreasury,
    'Smallville Clinic treasury should receive treatment fee',
  );
  assert.ok((treated.stats.clinicTreatments ?? 0) >= 1);
});

test('Phase D: Mayoral Election opens, casts ToM-grounded ballots, and inaugurates elected Mayor', () => {
  const world = createInitialWorldState();
  const alloc = makeIdAllocator(world.idSeq);

  const opened = openTownElection(world, alloc.next);
  assert.equal(opened.election?.status, 'voting');
  assert.ok((opened.election?.candidates.length ?? 0) >= 2);

  const voterId = opened.agents[0].id;
  const singleVote = castElectionVote(opened, voterId, alloc.next);
  assert.ok(singleVote.votedForId, 'Voter should pick a candidate');
  assert.ok(singleVote.world.election?.votersCast.includes(voterId));

  const finished = finalizeTownElection(singleVote.world, alloc.next, true);
  assert.equal(finished.election?.status, 'completed');
  assert.ok(finished.leadership?.mayorId, 'Mayor should be inaugurated');
  assert.ok(finished.leadership?.mayorName, 'Mayor name should be set');
  assert.equal(finished.election?.votersCast.length, finished.agents.length);
  assert.ok((finished.stats.electionsCompleted ?? 0) >= 1);
  assert.equal(validateWorld(finished).length, 0);
});

test('Phase D: stepSocialClubs strengthens trust & familiarity during scheduled weekly meetings', () => {
  const world = createInitialWorldState();
  const alloc = makeIdAllocator(world.idSeq);
  const club = world.clubs![0]; // Smallville Civic Forum (Wednesday 18:00, town_hall)
  assert.ok(club.memberIds.length >= 2);

  // Wednesday = weekday 2 (Day 3: simMinutes = 2*1440 + 18*60)
  const meetingSimMin = club.meetingWeekday * 1440 + club.meetingHour * 60;
  const [m1, m2] = club.memberIds;
  const beforeTrust = world.agents.find((a) => a.id === m1)!.socialGraph[m2]?.trust ?? 50;

  const gatheredWorld = {
    ...world,
    simMinutes: meetingSimMin,
    agents: world.agents.map((a) =>
      a.id === m1 || a.id === m2
        ? { ...a, currentLocationId: club.locationId, path: [] }
        : a,
    ),
  };

  const afterClub = stepSocialClubs(gatheredWorld, alloc.next);
  const afterTrust = afterClub.agents.find((a) => a.id === m1)!.socialGraph[m2]?.trust ?? 0;

  assert.ok(
    afterTrust > beforeTrust,
    `Expected club gathering to strengthen trust (${beforeTrust} -> ${afterTrust})`,
  );
  assert.ok((afterClub.stats.clubGatherings ?? 0) >= 1);
});
