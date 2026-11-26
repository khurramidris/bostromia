import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createInitialWorldState } from './engine';
import { makeIdAllocator } from './ids';
import {
  issueBilateralLoan,
  launchMicroVenture,
  stepHousingAndHouseholds,
  stepMicroVentures,
} from './contractsAndLife';
import {
  advanceAgentProject,
  applyDailyEconomicRollover,
  executeConsumeItemAction,
  executePurchaseAction,
  executeWorkShiftTick,
  findNearestOpenFoodVenue,
  getCalendarInfo,
  isBusinessOpen,
} from './worldEconomy';

describe('Phase A & B — Calendar, Micro-Economy & Multi-Day Projects', () => {
  it('computes real 7-day calendar weekdays, weekends, and paydays accurately', () => {
    const day1 = getCalendarInfo(9 * 60); // Day 1 -> Mon
    assert.equal(day1.day, 1);
    assert.equal(day1.weekdayShort, 'Mon');
    assert.equal(day1.isWeekend, false);
    assert.equal(day1.isPayday, false);

    const day5 = getCalendarInfo(4 * 1440 + 10 * 60); // Day 5 -> Fri (payday)
    assert.equal(day5.day, 5);
    assert.equal(day5.weekdayShort, 'Fri');
    assert.equal(day5.isWeekend, false);
    assert.equal(day5.isPayday, true);

    const day6 = getCalendarInfo(5 * 1440 + 11 * 60); // Day 6 -> Sat (weekend)
    assert.equal(day6.day, 6);
    assert.equal(day6.weekdayShort, 'Sat');
    assert.equal(day6.isWeekend, true);
  });

  it('enforces business operating hours and dynamic open food venue lookup', () => {
    const world = createInitialWorldState();
    const cafe = world.businesses?.hobbs_cafe;
    assert.ok(cafe, 'Hobbs Cafe business should be seeded');

    // 9:00 AM -> open
    assert.equal(isBusinessOpen(cafe, getCalendarInfo(9 * 60)), true);
    // 2:00 AM -> closed
    assert.equal(isBusinessOpen(cafe, getCalendarInfo(2 * 60)), false);

    const agent = world.agents[0];
    const openAtNoon = findNearestOpenFoodVenue({ ...world, simMinutes: 12 * 60 }, agent);
    assert.equal(openAtNoon.isHome, false, 'Should find an open stocked food venue at noon');

    const at2Am = findNearestOpenFoodVenue({ ...world, simMinutes: 2 * 60 }, agent);
    assert.equal(at2Am.isHome, true, 'At 2:00 AM all retail food venues are closed so agent falls back to home');
  });

  it('executes real purchases transferring wallet cash to business treasury and decrementing stock', () => {
    const world = createInitialWorldState();
    const alloc = makeIdAllocator(world.idSeq ?? 1);
    const buyer = world.agents.find((a) => a.id === 'maria')!;
    const cafe = world.businesses!.hobbs_cafe!;
    const initialWallet = buyer.wallet ?? 0;
    const initialCafeTreasury = cafe.treasury;
    const initialMealStock = cafe.stock.meal?.quantity ?? 0;
    const mealPrice = cafe.stock.meal?.price ?? 11;

    const { world: nextWorld, ok, transaction } = executePurchaseAction(
      world,
      buyer.id,
      cafe.locationId,
      'meal',
      true,
      alloc.next,
    );
    assert.equal(ok, true);
    assert.equal(transaction?.amount, mealPrice);

    const updatedBuyer = nextWorld.agents.find((a) => a.id === buyer.id)!;
    const updatedCafe = nextWorld.businesses!.hobbs_cafe!;
    assert.equal(updatedBuyer.wallet, Math.round((initialWallet - mealPrice) * 100) / 100);
    assert.ok(updatedCafe.treasury > initialCafeTreasury, 'Business treasury should increase after net sales');
    assert.equal(updatedCafe.stock.meal?.quantity, initialMealStock - 1);
    assert.ok((nextWorld.stats.economicTransactions ?? 0) >= 1);
    assert.ok((nextWorld.stats.totalTradeVolume ?? 0) >= mealPrice);
  });

  it('pays hourly wages during work shifts and triggers supply-chain restocking when stock is low', () => {
    let world = createInitialWorldState();
    const alloc = makeIdAllocator(world.idSeq ?? 1);
    const isabella = world.agents.find((a) => a.id === 'isabella')!;
    const cafe = world.businesses!.hobbs_cafe!;
    const beforeWallet = isabella.wallet ?? 0;

    // Place Isabella at Hobbs Cafe and drain cafe pastry stock to trigger wholesale restock from Oakridge Bakery
    world = {
      ...world,
      agents: world.agents.map((a) =>
        a.id === 'isabella' ? { ...a, currentLocationId: 'hobbs_cafe' } : a,
      ),
      businesses: {
        ...world.businesses!,
        hobbs_cafe: {
          ...cafe,
          stock: {
            ...cafe.stock,
            pastry: { ...cafe.stock.pastry!, quantity: 0 },
          },
        },
      },
    };

    const { world: nextWorld, earned } = executeWorkShiftTick(world, isabella.id, 1, alloc.next);
    const afterIsabella = nextWorld.agents.find((a) => a.id === isabella.id)!;
    const afterCafe = nextWorld.businesses!.hobbs_cafe!;

    assert.ok(earned > 0 && (afterIsabella.wallet ?? 0) > beforeWallet, 'Employee should earn wages for work shift');
    assert.ok(
      (afterCafe.stock.pastry?.quantity ?? 0) > 0,
      'Low pastry stock should be restocked via upstream bakery supply chain',
    );
  });

  it('applies daily economic rollover (upkeep + municipal tax) and household grocery consumption', () => {
    const world = createInitialWorldState();
    const alloc = makeIdAllocator(world.idSeq ?? 1);
    const beforeTreasury = world.townTreasury ?? 0;
    const rolled = applyDailyEconomicRollover(world, 2, alloc.next);
    assert.equal(rolled.agents[0].lastUpkeepDay, 2);
    assert.ok((rolled.townTreasury ?? 0) > beforeTreasury, 'Municipal upkeep share should fund town treasury');

    // Test home item consumption
    const resident = rolled.agents[0];
    const withGroceries = {
      ...rolled,
      agents: rolled.agents.map((a) =>
        a.id === resident.id
          ? {
              ...a,
              drives: { ...a.drives, hunger: 25 },
              goods: { ...(a.goods ?? {}), groceries: 2 },
            }
          : a,
      ),
    };
    const { world: ateWorld, consumed } = executeConsumeItemAction(
      withGroceries,
      resident.id,
      'groceries',
    );
    assert.equal(consumed, 'groceries');
    const updatedRes = ateWorld.agents.find((a) => a.id === resident.id)!;
    assert.equal(updatedRes.goods?.groceries, 1);
    assert.ok(updatedRes.drives.hunger > 25, 'Consuming groceries should restore hunger drive');
  });

  it('advances multi-day resident projects and marks completion with milestone memory', () => {
    let world = createInitialWorldState();
    const alloc = makeIdAllocator(world.idSeq ?? 1);
    const agent = world.agents.find((a) => (a.projects?.length ?? 0) > 0)!;
    const proj = agent.projects![0];

    let completedProjectTitle: string | undefined;
    for (let i = 0; i < 6; i++) {
      const res = advanceAgentProject(world, agent.id, 20, alloc.next);
      world = res.world;
      if (res.completedProject) {
        completedProjectTitle = res.completedProject.title;
        break;
      }
    }

    assert.equal(completedProjectTitle, proj.title, 'Project should complete once progress reaches 100%');
    const finalAgent = world.agents.find((a) => a.id === agent.id)!;
    const finalProj = finalAgent.projects!.find((p) => p.id === proj.id)!;
    assert.equal(finalProj.status, 'completed');
    assert.equal(finalProj.progress, 100);
    assert.ok(
      finalAgent.memories.some((m) => m.description.includes(proj.title)),
      'Project completion should record a high-importance milestone memory',
    );
  });

  it('prevents non-employee business siphoning, $0-treasury self-pay, respects leadership taxRatePct, and conserves money across upkeep, rent & venture restock', () => {
    const alloc = makeIdAllocator(100);
    let world = createInitialWorldState();

    // 1. Non-employee (Maria) working inside Hobbs Cafe must NOT drain Hobbs Cafe treasury or alter its stock
    const cafeBefore = world.businesses!.hobbs_cafe!;
    const mariaAtCafe = {
      ...world,
      agents: world.agents.map((a) =>
        a.id === 'maria' ? { ...a, currentLocationId: 'hobbs_cafe', wallet: 100 } : a,
      ),
    };
    const nonEmpWork = executeWorkShiftTick(mariaAtCafe, 'maria', 1, alloc.next);
    const cafeAfterNonEmp = nonEmpWork.world.businesses!.hobbs_cafe!;
    assert.equal(cafeAfterNonEmp.treasury, cafeBefore.treasury, 'Non-employee must not siphon business treasury');
    assert.deepEqual(cafeAfterNonEmp.stock, cafeBefore.stock, 'Non-employee must not manufacture business stock');

    // 2. Owner self-pay at $0 business treasury must pay $0 (no cash conjuring)
    const brokeCafeWorld = {
      ...world,
      agents: world.agents.map((a) =>
        a.id === 'isabella' ? { ...a, currentLocationId: 'hobbs_cafe', wallet: 100 } : a,
      ),
      businesses: {
        ...world.businesses!,
        hobbs_cafe: { ...cafeBefore, treasury: 0 },
      },
    };
    const brokeSelfPay = executeWorkShiftTick(brokeCafeWorld, 'isabella', 1, alloc.next);
    assert.equal(brokeSelfPay.earned, 0, 'Owner cannot draw pay from an empty $0 treasury');
    assert.equal(brokeSelfPay.world.agents.find((a) => a.id === 'isabella')!.wallet, 100);

    // 3. Leadership taxRatePct dynamically controls sales tax
    const lowTaxWorld = {
      ...world,
      leadership: { ...world.leadership!, taxRatePct: 5 },
    };
    const highTaxWorld = {
      ...world,
      leadership: { ...world.leadership!, taxRatePct: 20 },
    };
    const buyLow = executePurchaseAction(lowTaxWorld, 'maria', 'hobbs_cafe', 'meal', true, alloc.next);
    const buyHigh = executePurchaseAction(highTaxWorld, 'maria', 'hobbs_cafe', 'meal', true, alloc.next);
    const lowTaxCollected = (buyLow.world.townTreasury ?? 0) - (lowTaxWorld.townTreasury ?? 0);
    const highTaxCollected = (buyHigh.world.townTreasury ?? 0) - (highTaxWorld.townTreasury ?? 0);
    assert.ok(highTaxCollected > lowTaxCollected, `Expected 20% tax (${highTaxCollected}) > 5% tax (${lowTaxCollected})`);

    // 4. Total money conservation across daily upkeep rollover, Day-3 housing rent, and micro-venture restock
    const totalMoney = (w: typeof world) => {
      const wallets = w.agents.reduce((s, a) => s + (a.wallet ?? 0), 0);
      const bizTreasuries = Object.values(w.businesses ?? {}).reduce((s, b) => s + b.treasury, 0);
      return Number((wallets + bizTreasuries + (w.townTreasury ?? 0)).toFixed(2));
    };

    const startTotal = totalMoney(world);
    const afterUpkeep = applyDailyEconomicRollover(world, 2, alloc.next);
    assert.ok(
      Math.abs(totalMoney(afterUpkeep) - startTotal) <= 0.02,
      `Upkeep rollover must conserve money (${startTotal} -> ${totalMoney(afterUpkeep)})`,
    );

    const afterRent = stepHousingAndHouseholds(afterUpkeep, 3, alloc.next).world;
    assert.ok(
      Math.abs(totalMoney(afterRent) - startTotal) <= 0.02,
      `Housing rent rollover must conserve money (${startTotal} -> ${totalMoney(afterRent)})`,
    );

    // Launch a micro-venture, drain stock to 1, and trigger restock
    const flushFounder = {
      ...afterRent,
      agents: afterRent.agents.map((a) => (a.id === 'rajiv' ? { ...a, wallet: 300 } : a)),
    };
    const launched = launchMicroVenture(flushFounder, 'rajiv', alloc.next, 'Conservation Test Stand');
    assert.equal(launched.ok, true);
    const lowStockWorld = {
      ...launched.world,
      ventures: launched.world.ventures!.map((v) => ({ ...v, stock: 1 })),
    };
    const beforeRestockTotal = totalMoney(lowStockWorld);
    const afterRestock = stepMicroVentures(lowStockWorld, alloc.next);
    assert.ok(
      Math.abs(totalMoney(afterRestock) - beforeRestockTotal) <= 0.02,
      `Micro-venture restock must conserve money (${beforeRestockTotal} -> ${totalMoney(afterRestock)})`,
    );
  });
});
