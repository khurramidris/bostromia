export const MAX_STRING_LEN = 600;
export const MAX_ARRAY_LEN = 40;
const ID_PATTERN = /^[a-zA-Z0-9_-]{1,80}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value.trim());
}

export function isValidId(value: unknown): value is string {
  return typeof value === 'string' && ID_PATTERN.test(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function checkStr(
  value: unknown,
  field: string,
  required = true,
  maxLen = MAX_STRING_LEN,
): string | null {
  if (value === undefined || value === null) {
    return required ? `Missing required string field "${field}".` : null;
  }
  if (typeof value !== 'string') {
    return `Field "${field}" must be a string.`;
  }
  if (required && value.trim().length === 0) {
    return `Field "${field}" cannot be empty.`;
  }
  if (value.length > maxLen) {
    return `Field "${field}" exceeds ${maxLen} characters.`;
  }
  return null;
}

function checkFiniteNum(value: unknown, field: string, required = true): string | null {
  if (value === undefined || value === null) {
    return required ? `Missing required number field "${field}".` : null;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return `Field "${field}" must be a finite number.`;
  }
  return null;
}

function checkArray(
  value: unknown,
  field: string,
  required = true,
  maxLen = MAX_ARRAY_LEN,
): string | null {
  if (value === undefined || value === null) {
    return required ? `Missing required array field "${field}".` : null;
  }
  if (!Array.isArray(value)) {
    return `Field "${field}" must be an array.`;
  }
  if (value.length > maxLen) {
    return `Field "${field}" cannot contain more than ${maxLen} items.`;
  }
  return null;
}

function validateMemoryItems(
  items: unknown,
  field: string,
  required = true,
  maxLen = MAX_ARRAY_LEN,
): string | null {
  const arrErr = checkArray(items, field, required, maxLen);
  if (arrErr) return arrErr;
  if (!Array.isArray(items)) return null;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!isPlainObject(item)) return `${field}[${i}] must be an object.`;
    if (!isValidId(item.id)) return `${field}[${i}].id has invalid format.`;
    const err =
      checkStr(item.type, `${field}[${i}].type`) ||
      checkStr(item.description, `${field}[${i}].description`) ||
      checkFiniteNum(item.importance, `${field}[${i}].importance`);
    if (err) return err;
  }
  return null;
}

function validateLocationList(items: unknown, field: string, required = false): string | null {
  const arrErr = checkArray(items, field, required);
  if (arrErr) return arrErr;
  if (!Array.isArray(items)) return null;

  for (let i = 0; i < items.length; i++) {
    const loc = items[i];
    if (!isPlainObject(loc)) return `${field}[${i}] must be an object.`;
    if (!isValidId(loc.id)) return `${field}[${i}].id has invalid format.`;
    const err = checkStr(loc.name, `${field}[${i}].name`);
    if (err) return err;
  }
  return null;
}

function validateObjectList(items: unknown, field: string, required = false): string | null {
  const arrErr = checkArray(items, field, required);
  if (arrErr) return arrErr;
  if (!Array.isArray(items)) return null;

  for (let i = 0; i < items.length; i++) {
    const obj = items[i];
    if (!isPlainObject(obj)) return `${field}[${i}] must be an object.`;
    if (!isValidId(obj.id)) return `${field}[${i}].id has invalid format.`;
    if (!isValidId(obj.locationId)) return `${field}[${i}].locationId has invalid format.`;
    const err = checkStr(obj.name, `${field}[${i}].name`);
    if (err) return err;
  }
  return null;
}

export function validateAgentPayload(agent: unknown, label = 'agent'): string | null {
  if (!isPlainObject(agent)) return `${label} must be an object.`;
  if (!isValidId(agent.id)) return `${label}.id has invalid format.`;

  const basicErr =
    checkStr(agent.name, `${label}.name`) ||
    checkFiniteNum(agent.age, `${label}.age`) ||
    checkStr(agent.occupation, `${label}.occupation`) ||
    checkStr(agent.innateSummary, `${label}.innateSummary`) ||
    checkStr(agent.currently, `${label}.currently`, false) ||
    checkStr(agent.currentAction, `${label}.currentAction`, false) ||
    checkStr(agent.currentSubStep, `${label}.currentSubStep`, false) ||
    checkStr(agent.locationName, `${label}.locationName`);
  if (basicErr) return basicErr;

  const traitsErr = checkArray(agent.traits, `${label}.traits`, true);
  if (traitsErr) return traitsErr;
  for (let i = 0; i < (agent.traits as unknown[]).length; i++) {
    const err = checkStr((agent.traits as unknown[])[i], `${label}.traits[${i}]`);
    if (err) return err;
  }

  if (agent.goals !== undefined) {
    const goalsErr = checkArray(agent.goals, `${label}.goals`, false, 12);
    if (goalsErr) return goalsErr;
    for (let i = 0; i < (agent.goals as unknown[]).length; i++) {
      const err = checkStr((agent.goals as unknown[])[i], `${label}.goals[${i}]`);
      if (err) return err;
    }
  }

  if (agent.inventory !== undefined) {
    const invErr = checkArray(agent.inventory, `${label}.inventory`, false);
    if (invErr) return invErr;
    for (let i = 0; i < (agent.inventory as unknown[]).length; i++) {
      const err = checkStr((agent.inventory as unknown[])[i], `${label}.inventory[${i}]`);
      if (err) return err;
    }
  }

  if (agent.wallet !== undefined) {
    const err = checkFiniteNum(agent.wallet, `${label}.wallet`, false);
    if (err) return err;
  }
  if (agent.reputation !== undefined) {
    const err = checkFiniteNum(agent.reputation, `${label}.reputation`, false);
    if (err) return err;
  }
  if (agent.employerName !== undefined) {
    const err = checkStr(agent.employerName, `${label}.employerName`, false, 160);
    if (err) return err;
  }
  if (agent.housingStatus !== undefined) {
    const err = checkStr(agent.housingStatus, `${label}.housingStatus`, false, 30);
    if (err) return err;
  }
  if (agent.careerTier !== undefined) {
    const err = checkStr(agent.careerTier, `${label}.careerTier`, false, 30);
    if (err) return err;
  }
  if (agent.dossier !== undefined) {
    if (!isPlainObject(agent.dossier)) return `${label}.dossier must be an object.`;
    const dErr =
      checkStr(agent.dossier.background, `${label}.dossier.background`, false, 400) ||
      checkStr(agent.dossier.financialPosture, `${label}.dossier.financialPosture`, false, 40) ||
      checkStr(agent.dossier.civicWorldview, `${label}.dossier.civicWorldview`, false, 40) ||
      checkStr(agent.dossier.speechStyle, `${label}.dossier.speechStyle`, false, 240) ||
      checkStr(agent.dossier.privateAgenda, `${label}.dossier.privateAgenda`, false, 260);
    if (dErr) return dErr;
    if (agent.dossier.redLines !== undefined) {
      const rlErr = checkArray(agent.dossier.redLines, `${label}.dossier.redLines`, false, 6);
      if (rlErr) return rlErr;
      for (let i = 0; i < (agent.dossier.redLines as unknown[]).length; i++) {
        const err = checkStr((agent.dossier.redLines as unknown[])[i], `${label}.dossier.redLines[${i}]`, true, 200);
        if (err) return err;
      }
    }
  }
  if (agent.temperament !== undefined) {
    if (!isPlainObject(agent.temperament)) return `${label}.temperament must be an object.`;
    const tErr =
      checkFiniteNum(agent.temperament.stubbornness, `${label}.temperament.stubbornness`, false) ||
      checkFiniteNum(agent.temperament.riskTolerance, `${label}.temperament.riskTolerance`, false) ||
      checkFiniteNum(agent.temperament.ambition, `${label}.temperament.ambition`, false);
    if (tErr) return tErr;
    if (agent.temperament.decoding !== undefined) {
      if (!isPlainObject(agent.temperament.decoding)) {
        return `${label}.temperament.decoding must be an object.`;
      }
      const decErr =
        checkFiniteNum(agent.temperament.decoding.temperature, `${label}.temperament.decoding.temperature`, false) ||
        checkFiniteNum(agent.temperament.decoding.topP, `${label}.temperament.decoding.topP`, false) ||
        checkFiniteNum(agent.temperament.decoding.frequencyPenalty, `${label}.temperament.decoding.frequencyPenalty`, false);
      if (decErr) return decErr;
    }
  }
  if (agent.beliefs !== undefined) {
    const bErr = checkArray(agent.beliefs, `${label}.beliefs`, false, 16);
    if (bErr) return bErr;
    for (let i = 0; i < (agent.beliefs as unknown[]).length; i++) {
      const b = (agent.beliefs as unknown[])[i];
      if (!isPlainObject(b)) return `${label}.beliefs[${i}] must be an object.`;
      const err =
        checkStr(b.subjectId, `${label}.beliefs[${i}].subjectId`, true, 80) ||
        checkStr(b.predicate, `${label}.beliefs[${i}].predicate`, true, 40) ||
        checkStr(b.claim, `${label}.beliefs[${i}].claim`, true, 240) ||
        checkFiniteNum(b.confidence, `${label}.beliefs[${i}].confidence`, false);
      if (err) return err;
    }
  }
  if (agent.projects !== undefined) {
    const projErr = checkArray(agent.projects, `${label}.projects`, false, 10);
    if (projErr) return projErr;
    for (let i = 0; i < (agent.projects as unknown[]).length; i++) {
      const p = (agent.projects as unknown[])[i];
      if (!isPlainObject(p)) return `${label}.projects[${i}] must be an object.`;
      const err =
        checkStr(p.id, `${label}.projects[${i}].id`, true, 80) ||
        checkStr(p.title, `${label}.projects[${i}].title`, true, 160) ||
        checkFiniteNum(p.progress, `${label}.projects[${i}].progress`, true) ||
        checkStr(p.category, `${label}.projects[${i}].category`, false, 40);
      if (err) return err;
    }
  }
  if (agent.goods !== undefined) {
    if (!isPlainObject(agent.goods)) return `${label}.goods must be an object.`;
    for (const [k, v] of Object.entries(agent.goods)) {
      if (!isValidId(k)) return `${label}.goods key "${k}" is invalid.`;
      const err = checkFiniteNum(v, `${label}.goods.${k}`, true);
      if (err) return err;
    }
  }

  if (agent.nearbyObjects !== undefined) {
    const nbErr = checkArray(agent.nearbyObjects, `${label}.nearbyObjects`, false);
    if (nbErr) return nbErr;
    for (let i = 0; i < (agent.nearbyObjects as unknown[]).length; i++) {
      const o = (agent.nearbyObjects as unknown[])[i];
      if (!isPlainObject(o)) return `${label}.nearbyObjects[${i}] must be an object.`;
      const err =
        checkStr(o.name, `${label}.nearbyObjects[${i}].name`) ||
        checkStr(o.state, `${label}.nearbyObjects[${i}].state`) ||
        checkStr(o.persistentNote, `${label}.nearbyObjects[${i}].persistentNote`, false);
      if (err) return err;
    }
  }

  if (agent.drives !== undefined) {
    if (!isPlainObject(agent.drives)) return `${label}.drives must be an object.`;
    for (const k of ['energy', 'hunger', 'social', 'purpose']) {
      const err = checkFiniteNum(agent.drives[k], `${label}.drives.${k}`);
      if (err) return err;
    }
  }

  if (agent.mood !== undefined) {
    if (!isPlainObject(agent.mood)) return `${label}.mood must be an object.`;
    const err =
      checkFiniteNum(agent.mood.valence, `${label}.mood.valence`) ||
      checkFiniteNum(agent.mood.arousal, `${label}.mood.arousal`) ||
      checkStr(agent.mood.label, `${label}.mood.label`);
    if (err) return err;
  }

  if (agent.socialGraph !== undefined) {
    if (!isPlainObject(agent.socialGraph)) return `${label}.socialGraph must be an object.`;
    const entries = Object.entries(agent.socialGraph);
    if (entries.length > MAX_ARRAY_LEN) {
      return `${label}.socialGraph exceeds ${MAX_ARRAY_LEN} entries.`;
    }
    for (const [targetId, edge] of entries) {
      if (!isValidId(targetId)) return `${label}.socialGraph key "${targetId}" is invalid.`;
      if (!isPlainObject(edge)) return `${label}.socialGraph.${targetId} must be an object.`;
      const err =
        checkStr(edge.roleLabel, `${label}.socialGraph.${targetId}.roleLabel`) ||
        checkFiniteNum(edge.trust, `${label}.socialGraph.${targetId}.trust`) ||
        checkFiniteNum(edge.affection, `${label}.socialGraph.${targetId}.affection`) ||
        checkFiniteNum(edge.familiarity, `${label}.socialGraph.${targetId}.familiarity`) ||
        checkStr(edge.inferredGoal, `${label}.socialGraph.${targetId}.inferredGoal`, false);
      if (err) return err;
    }
  }

  if (agent.relationships !== undefined) {
    if (!isPlainObject(agent.relationships)) return `${label}.relationships must be an object.`;
    const relEntries = Object.entries(agent.relationships);
    if (relEntries.length > MAX_ARRAY_LEN) {
      return `${label}.relationships exceeds ${MAX_ARRAY_LEN} entries.`;
    }
    for (const [targetId, relDesc] of relEntries) {
      if (!isValidId(targetId)) return `${label}.relationships key "${targetId}" is invalid.`;
      const err = checkStr(relDesc, `${label}.relationships.${targetId}`);
      if (err) return err;
    }
  }

  if (agent.candidateMemories === undefined && agent.retrievedMemories === undefined) {
    return `${label}.retrievedMemories or ${label}.candidateMemories is required.`;
  }

  const candErr =
    agent.candidateMemories !== undefined
      ? validateMemoryItems(agent.candidateMemories, `${label}.candidateMemories`, true)
      : null;
  if (candErr) return candErr;

  if (agent.retrievedMemories !== undefined) {
    return validateMemoryItems(agent.retrievedMemories, `${label}.retrievedMemories`, true);
  }
  return null;
}

function validateCandidateMemes(items: unknown, field: string): string | null {
  const arrErr = checkArray(items, field, false);
  if (arrErr) return arrErr;
  if (!Array.isArray(items)) return null;

  for (let i = 0; i < items.length; i++) {
    const m = items[i];
    if (!isPlainObject(m)) return `${field}[${i}] must be an object.`;
    if (!isValidId(m.id)) return `${field}[${i}].id has invalid format.`;
    const err = checkStr(m.topic, `${field}[${i}].topic`);
    if (err) return err;
    if (m.knownByIds !== undefined) {
      const kbErr = checkArray(m.knownByIds, `${field}[${i}].knownByIds`, false);
      if (kbErr) return kbErr;
      for (let j = 0; j < (m.knownByIds as unknown[]).length; j++) {
        if (!isValidId((m.knownByIds as unknown[])[j])) {
          return `${field}[${i}].knownByIds[${j}] has invalid format.`;
        }
      }
    }
  }
  return null;
}

export function validateConverseBody(body: unknown): string | null {
  if (!isPlainObject(body)) return 'Request body must be a JSON object.';
  if (body.mode === 'scene' || body.mode === 'group_private') {
    const arrErr = checkArray(body.participants, 'participants', true, 4);
    if (arrErr) return arrErr;
    const participants = body.participants as unknown[];
    if (participants.length < 2) {
      return 'Field "participants" must contain 2 to 4 residents.';
    }
    for (let i = 0; i < participants.length; i++) {
      const pErr = validateAgentPayload(participants[i], `participants[${i}]`);
      if (pErr) return pErr;
    }
    return (
      checkStr(body.simTimeLabel, 'simTimeLabel') ||
      checkStr(body.worldName, 'worldName', false, 120) ||
      checkStr(body.startReason, 'startReason', false) ||
      checkFiniteNum(body.simMinutes, 'simMinutes', false) ||
      validateCandidateMemes(body.candidateMemes, 'candidateMemes') ||
      validateLocationList(body.locations, 'locations', false) ||
      validateObjectList(body.objects, 'objects', false)
    );
  }
  return (
    validateAgentPayload(body.agentA, 'agentA') ||
    validateAgentPayload(body.agentB, 'agentB') ||
    checkStr(body.simTimeLabel, 'simTimeLabel') ||
    checkStr(body.worldName, 'worldName', false, 120) ||
    checkStr(body.startReason, 'startReason', false) ||
    checkFiniteNum(body.simMinutes, 'simMinutes', false) ||
    validateCandidateMemes(body.candidateMemes, 'candidateMemes') ||
    validateLocationList(body.locations, 'locations', false) ||
    validateObjectList(body.objects, 'objects', false)
  );
}

export function validateDecideBody(body: unknown): string | null {
  if (!isPlainObject(body)) return 'Request body must be a JSON object.';
  if (body.openProposals !== undefined) {
    const propErr = checkArray(body.openProposals, 'openProposals', false, 15);
    if (propErr) return propErr;
    for (let i = 0; i < (body.openProposals as unknown[]).length; i++) {
      const p = (body.openProposals as unknown[])[i];
      if (!isPlainObject(p)) return `openProposals[${i}] must be an object.`;
      if (!isValidId(p.id)) return `openProposals[${i}].id has invalid format.`;
      const err =
        checkStr(p.title, `openProposals[${i}].title`, true, 160) ||
        checkStr(p.description, `openProposals[${i}].description`, false, 300);
      if (err) return err;
    }
  }
  if (body.recentNotices !== undefined) {
    const notErr = checkArray(body.recentNotices, 'recentNotices', false, 15);
    if (notErr) return notErr;
    for (let i = 0; i < (body.recentNotices as unknown[]).length; i++) {
      const n = (body.recentNotices as unknown[])[i];
      if (!isPlainObject(n)) return `recentNotices[${i}] must be an object.`;
      const err = checkStr(n.title, `recentNotices[${i}].title`, true, 160);
      if (err) return err;
    }
  }
  if (body.openPetitions !== undefined) {
    const petErr = checkArray(body.openPetitions, 'openPetitions', false, 10);
    if (petErr) return petErr;
    for (let i = 0; i < (body.openPetitions as unknown[]).length; i++) {
      const p = (body.openPetitions as unknown[])[i];
      if (!isPlainObject(p)) return `openPetitions[${i}] must be an object.`;
      if (!isValidId(p.id)) return `openPetitions[${i}].id has invalid format.`;
      const err = checkStr(p.title, `openPetitions[${i}].title`, true, 160);
      if (err) return err;
    }
  }
  if (body.election !== undefined) {
    if (!isPlainObject(body.election)) return 'Field "election" must be an object.';
    const elErr =
      checkStr(body.election.status, 'election.status', true, 30) ||
      checkFiniteNum(body.election.electionDay, 'election.electionDay', false);
    if (elErr) return elErr;
    if (body.election.candidates !== undefined) {
      const candErr = checkArray(body.election.candidates, 'election.candidates', false, 8);
      if (candErr) return candErr;
      for (let i = 0; i < (body.election.candidates as unknown[]).length; i++) {
        const c = (body.election.candidates as unknown[])[i];
        if (!isPlainObject(c)) return `election.candidates[${i}] must be an object.`;
        if (!isValidId(c.agentId)) return `election.candidates[${i}].agentId has invalid format.`;
        const err =
          checkStr(c.name, `election.candidates[${i}].name`, true, 120) ||
          checkStr(c.platform, `election.candidates[${i}].platform`, false, 240);
        if (err) return err;
      }
    }
  }
  if (body.knownPeers !== undefined) {
    const peerErr = checkArray(body.knownPeers, 'knownPeers', false, 12);
    if (peerErr) return peerErr;
    for (let i = 0; i < (body.knownPeers as unknown[]).length; i++) {
      const p = (body.knownPeers as unknown[])[i];
      if (!isPlainObject(p)) return `knownPeers[${i}] must be an object.`;
      if (!isValidId(p.id)) return `knownPeers[${i}].id has invalid format.`;
      const err =
        checkStr(p.name, `knownPeers[${i}].name`, true, 120) ||
        checkFiniteNum(p.trust, `knownPeers[${i}].trust`, false) ||
        checkStr(p.walletBand, `knownPeers[${i}].walletBand`, false, 20);
      if (err) return err;
    }
  }
  if (body.ambitions !== undefined) {
    const ambErr = checkArray(body.ambitions, 'ambitions', false, 8);
    if (ambErr) return ambErr;
    for (let i = 0; i < (body.ambitions as unknown[]).length; i++) {
      const a = (body.ambitions as unknown[])[i];
      if (!isPlainObject(a)) return `ambitions[${i}] must be an object.`;
      const err =
        checkStr(a.title, `ambitions[${i}].title`, true, 160) ||
        checkStr(a.domain, `ambitions[${i}].domain`, false, 30) ||
        checkFiniteNum(a.progress, `ambitions[${i}].progress`, false);
      if (err) return err;
    }
  }
  if (body.commitments !== undefined) {
    const cmtErr = checkArray(body.commitments, 'commitments', false, 10);
    if (cmtErr) return cmtErr;
    for (let i = 0; i < (body.commitments as unknown[]).length; i++) {
      const c = (body.commitments as unknown[])[i];
      if (!isPlainObject(c)) return `commitments[${i}] must be an object.`;
      const err =
        checkStr(c.title, `commitments[${i}].title`, true, 160) ||
        checkStr(c.locationId, `commitments[${i}].locationId`, true, 80);
      if (err) return err;
    }
  }
  if (body.unreadLetters !== undefined) {
    const ltrErr = checkArray(body.unreadLetters, 'unreadLetters', false, 6);
    if (ltrErr) return ltrErr;
    for (let i = 0; i < (body.unreadLetters as unknown[]).length; i++) {
      const l = (body.unreadLetters as unknown[])[i];
      if (!isPlainObject(l)) return `unreadLetters[${i}] must be an object.`;
      if (!isValidId(l.fromAgentId)) return `unreadLetters[${i}].fromAgentId has invalid format.`;
      const err =
        checkStr(l.fromName, `unreadLetters[${i}].fromName`, true, 120) ||
        checkStr(l.subject, `unreadLetters[${i}].subject`, true, 140) ||
        checkStr(l.body, `unreadLetters[${i}].body`, true, 400);
      if (err) return err;
    }
  }
  if (body.openDisputes !== undefined) {
    const dspErr = checkArray(body.openDisputes, 'openDisputes', false, 10);
    if (dspErr) return dspErr;
    for (let i = 0; i < (body.openDisputes as unknown[]).length; i++) {
      const d = (body.openDisputes as unknown[])[i];
      if (!isPlainObject(d)) return `openDisputes[${i}] must be an object.`;
      if (!isValidId(d.id)) return `openDisputes[${i}].id has invalid format.`;
      const err =
        checkStr(d.category, `openDisputes[${i}].category`, true, 40) ||
        checkStr(d.claimSummary, `openDisputes[${i}].claimSummary`, true, 240);
      if (err) return err;
    }
  }
  if (body.coalitions !== undefined) {
    const cErr = checkArray(body.coalitions, 'coalitions', false, 10);
    if (cErr) return cErr;
    for (let i = 0; i < (body.coalitions as unknown[]).length; i++) {
      const c = (body.coalitions as unknown[])[i];
      if (!isPlainObject(c)) return `coalitions[${i}] must be an object.`;
      if (!isValidId(c.id)) return `coalitions[${i}].id has invalid format.`;
      const err =
        checkStr(c.name, `coalitions[${i}].name`, true, 100) ||
        checkStr(c.agenda, `coalitions[${i}].agenda`, true, 40);
      if (err) return err;
    }
  }
  if (body.activeBoycotts !== undefined) {
    const bErr = checkArray(body.activeBoycotts, 'activeBoycotts', false, 10);
    if (bErr) return bErr;
    for (let i = 0; i < (body.activeBoycotts as unknown[]).length; i++) {
      const b = (body.activeBoycotts as unknown[])[i];
      if (!isPlainObject(b)) return `activeBoycotts[${i}] must be an object.`;
      const err =
        checkStr(b.targetBusinessName, `activeBoycotts[${i}].targetBusinessName`, true, 120) ||
        checkStr(b.reason, `activeBoycotts[${i}].reason`, true, 240);
      if (err) return err;
    }
  }
  if (body.activeShocks !== undefined) {
    const sErr = checkArray(body.activeShocks, 'activeShocks', false, 6);
    if (sErr) return sErr;
    for (let i = 0; i < (body.activeShocks as unknown[]).length; i++) {
      const s = (body.activeShocks as unknown[])[i];
      if (!isPlainObject(s)) return `activeShocks[${i}] must be an object.`;
      const err =
        checkStr(s.title, `activeShocks[${i}].title`, true, 120) ||
        checkStr(s.description, `activeShocks[${i}].description`, true, 260);
      if (err) return err;
    }
  }
  if (body.activeRumors !== undefined) {
    const rErr = checkArray(body.activeRumors, 'activeRumors', false, 8);
    if (rErr) return rErr;
    for (let i = 0; i < (body.activeRumors as unknown[]).length; i++) {
      const r = (body.activeRumors as unknown[])[i];
      if (!isPlainObject(r)) return `activeRumors[${i}] must be an object.`;
      if (!isValidId(r.id)) return `activeRumors[${i}].id has invalid format.`;
      const err =
        checkStr(r.claim, `activeRumors[${i}].claim`, true, 260) ||
        checkStr(r.originName, `activeRumors[${i}].originName`, false, 120);
      if (err) return err;
    }
  }
  if (body.culturalNorms !== undefined) {
    const nErr = checkArray(body.culturalNorms, 'culturalNorms', false, 6);
    if (nErr) return nErr;
    for (let i = 0; i < (body.culturalNorms as unknown[]).length; i++) {
      const n = (body.culturalNorms as unknown[])[i];
      if (!isPlainObject(n)) return `culturalNorms[${i}] must be an object.`;
      const err =
        checkStr(n.key, `culturalNorms[${i}].key`, true, 40) ||
        checkStr(n.title, `culturalNorms[${i}].title`, true, 100);
      if (err) return err;
    }
  }
  return (
    validateAgentPayload(body.agent, 'agent') ||
    checkStr(body.simTimeLabel, 'simTimeLabel') ||
    checkStr(body.worldName, 'worldName', false, 120) ||
    checkStr(body.forkReason, 'forkReason', false, 300) ||
    validateLocationList(body.locations, 'locations', true)
  );
}

export function validateReflectQuestionsBody(body: unknown): string | null {
  if (!isPlainObject(body)) return 'Request body must be a JSON object.';
  return (
    validateAgentPayload(body.agent, 'agent') ||
    checkStr(body.simTimeLabel, 'simTimeLabel') ||
    validateMemoryItems(body.recentMemories, 'recentMemories', true, 100)
  );
}

export function validateReflectBody(body: unknown): string | null {
  if (!isPlainObject(body)) return 'Request body must be a JSON object.';
  const baseErr =
    validateAgentPayload(body.agent, 'agent') ||
    checkStr(body.simTimeLabel, 'simTimeLabel');
  if (baseErr) return baseErr;

  if (body.questionEvidenceSets !== undefined) {
    const setsErr = checkArray(body.questionEvidenceSets, 'questionEvidenceSets', true, 5);
    if (setsErr) return setsErr;
    const sets = body.questionEvidenceSets as unknown[];
    for (let i = 0; i < sets.length; i++) {
      const s = sets[i];
      if (!isPlainObject(s)) return `questionEvidenceSets[${i}] must be an object.`;
      const qErr = checkStr(s.question, `questionEvidenceSets[${i}].question`);
      if (qErr) return qErr;
      const mErr = validateMemoryItems(s.memories, `questionEvidenceSets[${i}].memories`, true, 20);
      if (mErr) return mErr;
    }
    return null;
  }

  return validateMemoryItems(body.recentMemories, 'recentMemories', true, 100);
}

export function validatePlanBody(body: unknown): string | null {
  if (!isPlainObject(body)) return 'Request body must be a JSON object.';
  if (body.isMorningPlan !== undefined && typeof body.isMorningPlan !== 'boolean') {
    return 'Field "isMorningPlan" must be a boolean.';
  }
  return (
    validateAgentPayload(body.agent, 'agent') ||
    checkStr(body.simTimeLabel, 'simTimeLabel') ||
    checkFiniteNum(body.currentMinuteOfDay, 'currentMinuteOfDay') ||
    validateLocationList(body.locations, 'locations', true) ||
    validateObjectList(body.objects, 'objects', false)
  );
}

export function validateReactBody(body: unknown): string | null {
  if (!isPlainObject(body)) return 'Request body must be a JSON object.';
  return (
    validateAgentPayload(body.agent, 'agent') ||
    checkStr(body.observation, 'observation') ||
    checkStr(body.simTimeLabel, 'simTimeLabel') ||
    checkStr(body.partnerName, 'partnerName', false) ||
    checkStr(body.partnerAction, 'partnerAction', false) ||
    validateLocationList(body.locations, 'locations', true) ||
    validateObjectList(body.objects, 'objects', false)
  );
}

export function validateStepDetailBody(body: unknown): string | null {
  if (!isPlainObject(body)) return 'Request body must be a JSON object.';
  if (!isPlainObject(body.block)) return 'Field "block" must be an object.';
  return (
    validateAgentPayload(body.agent, 'agent') ||
    checkStr(body.simTimeLabel, 'simTimeLabel') ||
    checkStr(body.block.activity, 'block.activity') ||
    checkStr(body.block.kind, 'block.kind') ||
    checkFiniteNum(body.block.durationMinutes, 'block.durationMinutes')
  );
}

export function validateInterviewBody(body: unknown): string | null {
  if (!isPlainObject(body)) return 'Request body must be a JSON object.';
  return (
    validateAgentPayload(body.agent, 'agent') ||
    checkStr(body.question, 'question') ||
    checkStr(body.simTimeLabel, 'simTimeLabel')
  );
}

export function validateInterviewJudgeBody(body: unknown): string | null {
  if (!isPlainObject(body)) return 'Request body must be a JSON object.';
  return (
    validateAgentPayload(body.agent, 'agent') ||
    checkStr(body.question, 'question') ||
    checkStr(body.answer, 'answer') ||
    checkStr(body.simTimeLabel, 'simTimeLabel', false)
  );
}

export function validateWhisperBody(body: unknown): string | null {
  if (!isPlainObject(body)) return 'Request body must be a JSON object.';
  return (
    validateAgentPayload(body.agent, 'agent') ||
    checkStr(body.thought, 'thought') ||
    checkStr(body.simTimeLabel, 'simTimeLabel') ||
    validateLocationList(body.locations, 'locations', true)
  );
}

export function validateConsolidateBody(body: unknown): string | null {
  if (!isPlainObject(body)) return 'Request body must be a JSON object.';
  return (
    validateAgentPayload(body.agent, 'agent') ||
    checkStr(body.simTimeLabel, 'simTimeLabel') ||
    validateMemoryItems(body.memories, 'memories', true)
  );
}

export function validateEmbedBody(body: unknown): string | null {
  if (!isPlainObject(body)) return 'Request body must be a JSON object.';
  const arrErr = checkArray(body.texts, 'texts', true);
  if (arrErr) return arrErr;
  const texts = body.texts as unknown[];
  if (texts.length === 0) return 'Field "texts" must be non-empty.';
  for (let i = 0; i < texts.length; i++) {
    const err = checkStr(texts[i], `texts[${i}]`);
    if (err) return err;
  }
  return null;
}

export function validateWorldSaveBody(body: unknown): string | null {
  if (!isPlainObject(body)) return 'Request body must be a JSON object.';
  if (!isPlainObject(body.world)) return 'Missing valid world snapshot object.';
  const world = body.world;
  if (!Array.isArray(world.agents) || world.agents.length === 0) {
    return 'world.agents must be a non-empty array.';
  }
  if (!Array.isArray(world.tiles) || !Array.isArray(world.locations)) {
    return 'world must contain tiles and locations arrays.';
  }
  if (typeof world.simMinutes !== 'number' || !Number.isFinite(world.simMinutes)) {
    return 'world.simMinutes must be a finite number.';
  }
  return null;
}
