// Encounter combat. Loaded BEFORE map.js; it only uses map.js's globals
// (client, sessionRow, viewerIsDm, currentUserId, ...) when functions are
// actually called, never at load time.
//
// How it fits together:
//  * The combat state lives in game_session.combat (initiative order, whose
//    turn it is, actions left, extra-action request, log). Only a DM can
//    write it.
//  * A DM acts directly (for NPCs, or to skip a turn).
//  * A player's action is inserted into session_actions. The DM's browser
//    receives it, checks it, applies it and updates the combat state.
//
// Rules used (they weren't all specified, so these are the choices made):
//  * Initiative = d20 + Rigour (Rigour's skill level; NPCs use their Justice).
//  * 2 actions per turn.
//  * Move: up to Speed tiles, any direction (diagonals count as 1), onto an
//    empty tile.
//  * Attack: a Weapon Skill on an enemy on an adjacent tile (diagonals count).
//    The skill's Deal damage is subtracted from the target's HP.
//  * Extra action: spends an action and hands control to the DM.

const COMBAT_ACTIONS_PER_TURN = 2;
const COMBAT_LOG_LIMIT = 40;
const COMBAT_ZERO_UUID = "00000000-0000-0000-0000-000000000000";
const EXTRA_DICE = [4, 6, 8, 10, 12, 20, 100];

// Latest players / tokens / characters on the Encounter stage (set by map.js).
let encounterData = { players: [], npcs: [], characters: new Map() };

// UI-only state for this browser.
const combatUi = {
  mode: null, // null | "move" | "attack"
  skillId: "",
  targetKey: "",
  manualDamage: 5,
  sig: null, // changes whenever the combat state does, to reset the UI
  pending: false, // a player action has been sent and we're waiting
  extraKey: null,
  amount: 5, // the Hurt/Heal amount in the Combatants list
};

let combatActionChain = Promise.resolve();

function setEncounterData(players, npcs, characters) {
  encounterData = { players: players || [], npcs: npcs || [], characters };
}

async function refreshEncounterData() {
  const { data: players } = await client.from("session_players").select("*");
  const { data: npcs } = await client.from("session_npcs").select("*");
  const characters = await fetchCharactersCached([
    ...(players || []).map((p) => p.character_id),
    ...(npcs || []).map((n) => n.character_id),
  ]);
  setEncounterData(players, npcs, characters);
}

function activeCombat() {
  const combat = sessionRow && sessionRow.combat;
  return combat && combat.active ? combat : null;
}

function el(id) {
  return document.getElementById(id);
}

// ---------------------------------------------------------------------
// Dice
// ---------------------------------------------------------------------

function randomInt(min, max) {
  const range = max - min + 1;
  const buffer = new Uint32Array(1);
  crypto.getRandomValues(buffer);
  return min + (buffer[0] % range);
}

function rollDie(sides) {
  return randomInt(1, sides);
}

// ---------------------------------------------------------------------
// Tokens and tiles
// ---------------------------------------------------------------------

function collectTokens() {
  const list = [];

  encounterData.players.forEach((p) => {
    if (!p.character_id) return;
    list.push({
      key: `player:${p.user_id}`,
      kind: "player",
      id: p.user_id,
      characterId: p.character_id,
      col: p.tile_col,
      row: p.tile_row,
    });
  });

  encounterData.npcs.forEach((n) => {
    list.push({
      key: `npc:${n.id}`,
      kind: "npc",
      id: n.id,
      characterId: n.character_id,
      col: n.tile_col,
      row: n.tile_row,
    });
  });

  list.forEach((t) => {
    t.character = encounterData.characters.get(t.characterId) || null;
    t.team = t.character && t.character.is_npc ? "npc" : "player";
    t.placed = t.col !== null && t.col !== undefined && t.row !== null && t.row !== undefined;
    t.name = t.character ? t.character.name : "?";
  });

  return list;
}

function tileDistance(a, b) {
  return Math.max(Math.abs(a.col - b.col), Math.abs(a.row - b.row));
}

function tileLabel(col, row) {
  return `(${col + 1}, ${row + 1})`;
}

function withLog(combat, text) {
  const log = [...(combat.log || []), text];
  return { ...combat, log: log.slice(-COMBAT_LOG_LIMIT) };
}

function showCombatToast(text) {
  const stage = el("mode-encounter");
  if (!stage) return;
  const toast = document.createElement("div");
  toast.className = "combat-toast";
  toast.textContent = text;
  stage.appendChild(toast);
  setTimeout(() => toast.remove(), 4500);
}

// ---------------------------------------------------------------------
// Turn flow
// ---------------------------------------------------------------------

// Returns the combat moved on to the next combatant who is still on the
// grid, or null if no one is left.
function advanceTurn(combat, aliveKeys) {
  const count = combat.order.length;
  let index = combat.turnIndex;
  let round = combat.round;

  for (let i = 0; i < count; i++) {
    index += 1;
    if (index >= count) {
      index = 0;
      round += 1;
    }
    if (aliveKeys.has(combat.order[index].key)) {
      return {
        ...combat,
        turnIndex: index,
        round,
        actionsLeft: COMBAT_ACTIONS_PER_TURN,
        extra: null,
      };
    }
  }
  return null;
}

function placedKeys() {
  return new Set(collectTokens().filter((t) => t.placed).map((t) => t.key));
}

// Moves to the next turn, or ends combat if there's no one left.
function advanceOrEnd(combat) {
  const next = advanceTurn(combat, placedKeys());
  if (!next) {
    showCombatToast("Combat ended: no one is left on the grid.");
    return null;
  }
  const actor = next.order[next.turnIndex];
  return withLog(next, `Round ${next.round}: ${actor.name}'s turn.`);
}

async function commitCombat(newCombat) {
  sessionRow = { ...sessionRow, combat: newCombat };
  renderCombatUI();
  const { error } = await client.from("game_session").update({ combat: newCombat }).eq("id", 1);
  if (error) showCombatToast("Couldn't save combat: " + error.message);
}

// ---------------------------------------------------------------------
// Begin / end combat (DM)
// ---------------------------------------------------------------------

async function beginCombat() {
  if (!viewerIsDm) return;

  await refreshEncounterData();
  const tokens = collectTokens().filter((t) => t.placed && t.character);

  if (tokens.length < 2) {
    showCombatToast("Place at least two characters on the grid before beginning combat.");
    return;
  }

  const entries = tokens.map((t) => {
    const d20 = rollDie(20);
    const mod = rigourOf(t.character);
    return {
      key: t.key,
      kind: t.kind,
      id: t.id,
      characterId: t.characterId,
      name: t.name,
      team: t.team,
      d20,
      mod,
      total: d20 + mod,
    };
  });

  // Highest initiative first. Ties: higher Rigour, then higher roll, then name.
  entries.sort(
    (a, b) => b.total - a.total || b.mod - a.mod || b.d20 - a.d20 || a.name.localeCompare(b.name)
  );

  let combat = {
    active: true,
    round: 1,
    turnIndex: 0,
    actionsLeft: COMBAT_ACTIONS_PER_TURN,
    extra: null,
    order: entries,
    log: [],
  };

  combat = withLog(
    combat,
    "Combat begins. Initiative: " +
      entries.map((e) => `${e.name} ${e.total} (d20 ${e.d20} + Rigour ${e.mod})`).join(", ") +
      "."
  );
  combat = withLog(combat, `Round 1: ${entries[0].name}'s turn.`);

  await client.from("session_actions").delete().neq("id", COMBAT_ZERO_UUID);
  await commitCombat(combat);
}

async function endCombat() {
  if (!viewerIsDm) return;
  if (!window.confirm("End combat?")) return;
  await client.from("session_actions").delete().neq("id", COMBAT_ZERO_UUID);
  await commitCombat(null);
}

// ---------------------------------------------------------------------
// Actions: move / attack / extra / end turn
// ---------------------------------------------------------------------

function fail(reason) {
  return { ok: false, reason };
}

async function fetchFreshCharacter(id) {
  const { data } = await client.from("characters").select("*").eq("id", id).maybeSingle();
  return data || null;
}

function weaponSkillsOf(character) {
  const found = [];
  ((character && character.inventory) || []).forEach((item) => {
    if (item.type !== "weapon") return;
    (item.skills || []).forEach((raw) => {
      found.push({ skill: normalizeSkill(raw), weaponName: item.name });
    });
  });
  return found;
}

function skillDamage(skill) {
  return skill.attributes
    .filter((attr) => attr.type === "deal")
    .reduce((sum, attr) => sum + attributeAmount(attr), 0);
}

async function doMove(me, tokens, payload) {
  const col = payload.col;
  const row = payload.row;
  const cols = sessionRow.encounter_cols || 10;
  const rows = sessionRow.encounter_rows || 8;

  if (!Number.isInteger(col) || !Number.isInteger(row) || col < 0 || row < 0 || col >= cols || row >= rows) {
    return fail("That tile isn't on the grid.");
  }

  const speed = computeVitals(me.character).speed;
  const distance = tileDistance({ col: me.col, row: me.row }, { col, row });

  if (distance < 1) return fail("They're already on that tile.");
  if (distance > speed) return fail(`${tileLabel(col, row)} is ${distance} tiles away, but Speed is ${speed}.`);
  if (tokens.some((t) => t.placed && t.key !== me.key && t.col === col && t.row === row)) {
    return fail("That tile is occupied.");
  }

  const table = me.kind === "player" ? "session_players" : "session_npcs";
  const idColumn = me.kind === "player" ? "user_id" : "id";
  const { error } = await client
    .from(table)
    .update({ tile_col: col, tile_row: row })
    .eq(idColumn, me.id);
  if (error) return fail("Couldn't move: " + error.message);

  return {
    ok: true,
    text: `${me.name} moves from ${tileLabel(me.col, me.row)} to ${tileLabel(col, row)} (${distance} of ${speed} tiles).`,
  };
}

async function doAttack(me, tokens, payload, fromDm) {
  const target = tokens.find((t) => t.key === payload.targetKey);
  if (!target || !target.placed) return fail("That target isn't on the grid.");
  if (target.team === me.team) return fail("That isn't an enemy.");
  if (tileDistance({ col: me.col, row: me.row }, { col: target.col, row: target.row }) !== 1) {
    return fail("The target isn't on an adjacent tile.");
  }

  const actor = await fetchFreshCharacter(me.characterId);
  const victim = await fetchFreshCharacter(target.characterId);
  if (!actor || !victim) return fail("Couldn't load the characters.");

  let label;
  let damage;
  let effectsText = "";

  const owned = weaponSkillsOf(actor).find((entry) => entry.skill.id === payload.skillId);

  if (owned) {
    const skill = owned.skill;
    damage = skillDamage(skill);
    effectsText = skill.attributes.map((attr) => describeAttribute(attr, skill.damageType)).join(", ");
    label = `${skill.name} (${owned.weaponName})`;
  } else if (fromDm && Number.isFinite(payload.manualDamage)) {
    damage = Math.max(0, Math.floor(payload.manualDamage));
    label = "a basic attack";
    effectsText = `${damage} damage`;
  } else {
    return fail("That weapon skill wasn't found.");
  }

  let hpText = "";
  if (damage > 0) {
    const vitals = computeVitals(victim);
    const before = currentVitalValue(victim, "hp", vitals.maxHp);
    const after = Math.max(0, before - damage);
    const { error } = await client.from("characters").update({ hp_current: after }).eq("id", victim.id);
    if (error) return fail("Couldn't apply damage: " + error.message);
    hpText = ` ${target.name}: ${before} -> ${after} HP${after === 0 ? " (down)" : ""}.`;
  }

  return {
    ok: true,
    text: `${me.name} uses ${label} on ${target.name}: ${effectsText || "no effect"}.${hpText}`,
  };
}

// Runs one action for `actor` against the current combat state.
async function runAction(combat, actor, type, payload, opts) {
  const fromDm = !!(opts && opts.fromDm);

  if (type === "end") {
    const ended = advanceOrEnd(withLog(combat, `${actor.name} ends their turn.`));
    await commitCombat(ended);
    return;
  }

  const refuse = async (reason) => {
    if (fromDm) {
      showCombatToast(reason);
    } else {
      await commitCombat(withLog(combat, `${actor.name}'s action failed: ${reason}`));
    }
  };

  if (combat.actionsLeft <= 0) return refuse("no actions left.");
  if (combat.extra) return refuse("an extra action is still being resolved.");

  const tokens = collectTokens();
  const me = tokens.find((t) => t.key === actor.key);
  if (!me || !me.placed || !me.character) return refuse(`${actor.name} isn't on the grid.`);

  let result;
  if (type === "move") result = await doMove(me, tokens, payload);
  else if (type === "attack") result = await doAttack(me, tokens, payload, fromDm);
  else if (type === "extra") {
    result = { ok: true, text: `${actor.name} uses an Extra Action and asks the DM what to do.`, extra: true };
  } else result = fail("Unknown action.");

  if (!result.ok) return refuse(result.reason);

  let next = withLog({ ...combat, actionsLeft: combat.actionsLeft - 1 }, result.text);

  if (result.extra) {
    next = { ...next, extra: { id: crypto.randomUUID(), actorKey: actor.key, actorName: actor.name } };
  } else if (next.actionsLeft <= 0) {
    await refreshEncounterData();
    next = advanceOrEnd(next);
  }

  await commitCombat(next);
  if (typeof refreshCombatants === "function") refreshCombatants();
}

// ---- A player's request, arriving at the DM's browser ----

function enqueueAction(row) {
  if (!viewerIsDm) return;
  combatActionChain = combatActionChain
    .then(() => processActionRow(row))
    .catch((err) => console.error("Combat action failed:", err));
}

async function processActionRow(row) {
  try {
    const combat = activeCombat();
    if (!combat) return;

    const actor = combat.order[combat.turnIndex];
    if (!actor || actor.key !== `player:${row.user_id}`) return; // not their turn

    await refreshEncounterData();
    await runAction(combat, actor, row.type, row.payload || {}, { fromDm: false });
  } finally {
    await client.from("session_actions").delete().eq("id", row.id);
  }
}

// ---- Sending an action from this browser ----

function submitAction(type, payload) {
  const combat = activeCombat();
  if (!combat) return Promise.resolve();

  // A DM acts directly.
  if (viewerIsDm) {
    combatActionChain = combatActionChain
      .then(async () => {
        const fresh = activeCombat();
        if (!fresh) return;
        await refreshEncounterData();
        await runAction(fresh, fresh.order[fresh.turnIndex], type, payload || {}, { fromDm: true });
      })
      .catch((err) => console.error("Combat action failed:", err));
    return combatActionChain;
  }

  // A player asks the DM's browser to do it.
  combatUi.pending = true;
  renderCombatUI();

  return client
    .from("session_actions")
    .insert({ user_id: currentUserId, type, payload: payload || {} })
    .then(({ error }) => {
      if (error) {
        combatUi.pending = false;
        showCombatToast("Couldn't send that action: " + error.message);
        renderCombatUI();
        return;
      }
      setTimeout(() => {
        if (combatUi.pending) {
          combatUi.pending = false;
          renderCombatUI();
        }
      }, 6000);
    });
}

// ---- Extra action (DM resolves it) ----

async function rollExtra(count, sides, modifier, label) {
  const combat = activeCombat();
  if (!combat || !combat.extra) return;

  const rolls = [];
  for (let i = 0; i < count; i++) rolls.push(rollDie(sides));
  const sum = rolls.reduce((a, b) => a + b, 0);
  const total = sum + modifier;

  const modText = modifier === 0 ? "" : ` ${modifier > 0 ? "+" : "-"} ${Math.abs(modifier)}`;
  const labelText = label ? ` (${label})` : "";
  const text =
    `${combat.extra.actorName}'s extra action: ${count}d${sides}${modText}${labelText} ` +
    `-> [${rolls.join(", ")}]${modText} = ${total}.`;

  showCombatToast(text);
  await commitCombat(withLog(combat, text));
}

async function finishExtra() {
  const combat = activeCombat();
  if (!combat || !combat.extra) return;

  let next = { ...combat, extra: null };
  if (next.actionsLeft <= 0) {
    await refreshEncounterData();
    next = advanceOrEnd(next);
  }
  await commitCombat(next);
}

// ---------------------------------------------------------------------
// Combatants list in the DM menu (edit HP / SP of anyone)
// ---------------------------------------------------------------------

let combatantsToken = 0;

async function refreshCombatants() {
  const host = el("encounter-combatants");
  if (!host || !viewerIsDm) return;

  const myToken = ++combatantsToken;
  const tokens = collectTokens().filter((t) => t.character);
  const fresh = await fetchCharactersByIds(tokens.map((t) => t.characterId));
  if (myToken !== combatantsToken) return;

  host.innerHTML = "";

  const heading = document.createElement("p");
  heading.className = "session-menu-heading display";
  heading.textContent = "Combatants";
  host.appendChild(heading);

  const amountRow = document.createElement("div");
  amountRow.className = "combatant-amount";
  const amountLabel = document.createElement("label");
  amountLabel.textContent = "Amount";
  const amountInput = document.createElement("input");
  amountInput.type = "number";
  amountInput.min = "1";
  amountInput.value = combatUi.amount;
  amountInput.addEventListener("input", () => {
    const parsed = parseInt(amountInput.value, 10);
    combatUi.amount = Number.isNaN(parsed) || parsed < 1 ? 1 : parsed;
  });
  amountRow.appendChild(amountLabel);
  amountRow.appendChild(amountInput);
  host.appendChild(amountRow);

  if (tokens.length === 0) {
    const empty = document.createElement("p");
    empty.className = "ego-empty";
    empty.textContent = "No one is in the encounter yet.";
    host.appendChild(empty);
    return;
  }

  tokens.forEach((t) => {
    const character = fresh.get(t.characterId);
    if (!character) return;
    const vitals = computeVitals(character);

    const row = document.createElement("div");
    row.className = "combatant-row";

    const name = document.createElement("p");
    name.className = "combatant-name display";
    name.textContent = character.name + (character.is_npc ? " (NPC)" : "");
    row.appendChild(name);

    [
      ["hp", "HP", vitals.maxHp],
      ["sp", "SP", vitals.maxSp],
    ].forEach(([kind, label, max]) => {
      const line = document.createElement("div");
      line.className = "combatant-vital";

      const text = document.createElement("span");
      text.textContent = `${label} ${currentVitalValue(character, kind, max)}/${max}`;

      const hurt = document.createElement("button");
      hurt.type = "button";
      hurt.className = "small-btn";
      hurt.textContent = "-";
      hurt.setAttribute("aria-label", `Hurt ${character.name} ${label}`);
      hurt.addEventListener("click", () => changeVital(character, kind, max, -1));

      const heal = document.createElement("button");
      heal.type = "button";
      heal.className = "small-btn";
      heal.textContent = "+";
      heal.setAttribute("aria-label", `Heal ${character.name} ${label}`);
      heal.addEventListener("click", () => changeVital(character, kind, max, 1));

      line.appendChild(text);
      line.appendChild(hurt);
      line.appendChild(heal);
      row.appendChild(line);
    });

    host.appendChild(row);
  });
}

async function changeVital(character, kind, max, direction) {
  const amount = Math.max(1, parseInt(combatUi.amount, 10) || 1);
  const current = currentVitalValue(character, kind, max);
  const next = Math.max(0, Math.min(max, current + direction * amount));

  const { error } = await client
    .from("characters")
    .update({ [`${kind}_current`]: next })
    .eq("id", character.id);

  if (error) {
    showCombatToast("Couldn't save: " + error.message);
    return;
  }
  refreshCombatants();
}

// ---------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------

function hideCombatUi() {
  ["combat-order", "combat-actions", "combat-extra", "combat-begin-btn"].forEach((id) => {
    const node = el(id);
    if (node) node.style.display = "none";
  });
  const combatants = el("encounter-combatants");
  if (combatants) combatants.style.display = "none";
  clearReachable();
  markActiveToken(null);
}

function clearReachable() {
  const grid = el("encounter-grid");
  if (!grid) return;
  grid.querySelectorAll(".is-reachable").forEach((cell) => cell.classList.remove("is-reachable"));
  grid.onclick = null;
}

function markActiveToken(activeKey) {
  if (typeof encState === "undefined" || !encState.tokens) return;
  encState.tokens.forEach((node, key) => node.classList.toggle("is-active-turn", key === activeKey));
}

function renderCombatUi_beginButton(combat) {
  const button = el("combat-begin-btn");
  if (!viewerIsDm) {
    button.style.display = "none";
    return;
  }
  button.style.display = "block";
  button.textContent = combat ? "End Combat" : "Begin Combat";
  button.onclick = combat ? endCombat : beginCombat;
}

function renderCombatUi_order(combat) {
  const panel = el("combat-order");
  if (!combat) {
    panel.style.display = "none";
    return;
  }

  panel.style.display = "block";
  panel.innerHTML = "";

  const title = document.createElement("p");
  title.className = "combat-order-title display";
  title.textContent = `Initiative - Round ${combat.round}`;
  panel.appendChild(title);

  const note = document.createElement("p");
  note.className = "combat-order-note";
  note.textContent = "Each roll is a d20 plus the character's Rigour added on top.";
  panel.appendChild(note);

  const list = document.createElement("ol");
  list.className = "combat-order-list";
  combat.order.forEach((entry, index) => {
    const item = document.createElement("li");
    item.className =
      "combat-order-item" +
      (index === combat.turnIndex ? " is-current" : "") +
      (entry.team === "npc" ? " is-npc" : "");

    const name = document.createElement("span");
    name.className = "combat-order-name";
    name.textContent = entry.name;

    const total = document.createElement("span");
    total.className = "combat-order-total display";
    total.textContent = entry.total;

    const roll = document.createElement("span");
    roll.className = "combat-order-roll";
    roll.textContent = `d20 ${entry.d20} + Rigour ${entry.mod}`;

    item.appendChild(name);
    item.appendChild(total);
    item.appendChild(roll);
    list.appendChild(item);
  });
  panel.appendChild(list);

  const logTitle = document.createElement("p");
  logTitle.className = "combat-order-title display";
  logTitle.textContent = "Log";
  panel.appendChild(logTitle);

  const log = document.createElement("div");
  log.className = "combat-log";
  (combat.log || []).slice(-10).forEach((line) => {
    const p = document.createElement("p");
    p.textContent = line;
    log.appendChild(p);
  });
  panel.appendChild(log);
  log.scrollTop = log.scrollHeight;
}

function renderReachable(me, tokens, active) {
  clearReachable();
  const grid = el("encounter-grid");
  if (!grid || !active || !me || !me.character) return;

  const speed = computeVitals(me.character).speed;
  const occupied = new Set(
    tokens.filter((t) => t.placed && t.key !== me.key).map((t) => `${t.col},${t.row}`)
  );

  grid.querySelectorAll(".encounter-cell").forEach((cell) => {
    const col = Number(cell.dataset.col);
    const row = Number(cell.dataset.row);
    const distance = tileDistance({ col: me.col, row: me.row }, { col, row });
    if (distance >= 1 && distance <= speed && !occupied.has(`${col},${row}`)) {
      cell.classList.add("is-reachable");
    }
  });

  grid.onclick = (event) => {
    const cell = event.target.closest(".encounter-cell");
    if (!cell || !cell.classList.contains("is-reachable")) return;
    submitAction("move", { col: Number(cell.dataset.col), row: Number(cell.dataset.row) });
  };
}

function actionButton(label, onClick, disabled) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "small-btn";
  button.textContent = label;
  button.disabled = !!disabled;
  button.addEventListener("click", onClick);
  return button;
}

function buildAttackPanel(me, tokens, canSubmit) {
  const panel = document.createElement("div");
  panel.className = "combat-attack-panel";

  const owned = weaponSkillsOf(me.character);
  const targets = tokens.filter(
    (t) =>
      t.placed &&
      t.team !== me.team &&
      tileDistance({ col: me.col, row: me.row }, { col: t.col, row: t.row }) === 1
  );

  const skillSelect = document.createElement("select");
  skillSelect.setAttribute("aria-label", "Weapon skill");
  owned.forEach(({ skill, weaponName }) => {
    const opt = document.createElement("option");
    opt.value = skill.id;
    const damage = skillDamage(skill);
    opt.textContent = `${skill.name} (${weaponName}) - Will ${skill.cost}${damage ? `, ${damage} dmg` : ""}`;
    skillSelect.appendChild(opt);
  });
  if (viewerIsDm) {
    const manual = document.createElement("option");
    manual.value = "";
    manual.textContent = "Basic attack (set damage)";
    skillSelect.appendChild(manual);
  }
  skillSelect.value = combatUi.skillId;
  if (!skillSelect.value && skillSelect.options.length) skillSelect.selectedIndex = 0;
  skillSelect.addEventListener("change", () => {
    combatUi.skillId = skillSelect.value;
    renderCombatUI();
  });

  const targetSelect = document.createElement("select");
  targetSelect.setAttribute("aria-label", "Target");
  targets.forEach((t) => {
    const opt = document.createElement("option");
    opt.value = t.key;
    opt.textContent = `${t.name} ${tileLabel(t.col, t.row)}`;
    targetSelect.appendChild(opt);
  });
  targetSelect.value = combatUi.targetKey;
  if (!targetSelect.value && targetSelect.options.length) targetSelect.selectedIndex = 0;
  targetSelect.addEventListener("change", () => {
    combatUi.targetKey = targetSelect.value;
  });

  if (owned.length === 0 && !viewerIsDm) {
    const none = document.createElement("p");
    none.className = "combat-hint";
    none.textContent = "No weapon skills yet. Add some from your character sheet.";
    panel.appendChild(none);
    return panel;
  }
  if (targets.length === 0) {
    const none = document.createElement("p");
    none.className = "combat-hint";
    none.textContent = "No enemy on an adjacent tile.";
    panel.appendChild(none);
    return panel;
  }

  panel.appendChild(skillSelect);
  panel.appendChild(targetSelect);

  let damageInput = null;
  if (viewerIsDm && skillSelect.value === "") {
    damageInput = document.createElement("input");
    damageInput.type = "number";
    damageInput.min = "0";
    damageInput.value = combatUi.manualDamage;
    damageInput.setAttribute("aria-label", "Damage");
    damageInput.addEventListener("input", () => {
      const parsed = parseInt(damageInput.value, 10);
      combatUi.manualDamage = Number.isNaN(parsed) ? 0 : parsed;
    });
    panel.appendChild(damageInput);
  }

  panel.appendChild(
    actionButton(
      "Attack",
      () => {
        submitAction("attack", {
          skillId: skillSelect.value,
          targetKey: targetSelect.value,
          manualDamage: damageInput ? combatUi.manualDamage : undefined,
        });
      },
      !canSubmit
    )
  );

  return panel;
}

function renderCombatUi_actions(combat, tokens) {
  const bar = el("combat-actions");
  bar.style.display = "block";
  bar.classList.toggle("is-dm", viewerIsDm);
  bar.innerHTML = "";

  const actor = combat.order[combat.turnIndex];
  const me = tokens.find((t) => t.key === actor.key);
  const mine = actor.key === `player:${currentUserId}`;
  const canAct = mine || (viewerIsDm && actor.kind === "npc");
  const usable = canAct && !combat.extra && combat.actionsLeft > 0 && !combatUi.pending;

  const header = document.createElement("p");
  header.className = "combat-actions-title display";
  header.textContent = `${actor.name}'s turn - ${combat.actionsLeft} of ${COMBAT_ACTIONS_PER_TURN} actions left`;
  bar.appendChild(header);

  if (combat.extra) {
    const wait = document.createElement("p");
    wait.className = "combat-hint";
    wait.textContent = `${combat.extra.actorName} used an Extra Action. The DM decides what happens.`;
    bar.appendChild(wait);
  } else if (!canAct) {
    const wait = document.createElement("p");
    wait.className = "combat-hint";
    wait.textContent = viewerIsDm
      ? `Waiting for ${actor.name}. You can skip their turn below.`
      : `Waiting for ${actor.name}...`;
    bar.appendChild(wait);
  }

  const row = document.createElement("div");
  row.className = "save-row combat-actions-row";

  if (canAct && !combat.extra) {
    const moveBtn = actionButton(
      combatUi.mode === "move" ? "Move (choose a tile)" : "Move",
      () => {
        combatUi.mode = combatUi.mode === "move" ? null : "move";
        renderCombatUI();
      },
      !usable
    );
    const attackBtn = actionButton(
      combatUi.mode === "attack" ? "Attack (close)" : "Attack",
      async () => {
        if (combatUi.mode === "attack") {
          combatUi.mode = null;
        } else {
          combatUi.mode = "attack";
          // Pick up any skills added since the page loaded.
          const fresh = await fetchFreshCharacter(actor.characterId);
          if (fresh) characterCache.set(fresh.id, fresh);
          await refreshEncounterData();
        }
        renderCombatUI();
      },
      !usable
    );
    const extraBtn = actionButton(
      "Extra Action",
      () => {
        if (
          window.confirm(
            "Spend an action on an Extra Action? Tell the DM what you want to do (on your call) - they'll decide what to roll."
          )
        ) {
          combatUi.mode = null;
          submitAction("extra", {});
        }
      },
      !usable
    );
    row.appendChild(moveBtn);
    row.appendChild(attackBtn);
    row.appendChild(extraBtn);
  }

  if ((canAct || viewerIsDm) && !combat.extra) {
    row.appendChild(
      actionButton(
        viewerIsDm && !canAct ? "Skip Turn" : "End Turn",
        () => {
          combatUi.mode = null;
          submitAction("end", {});
        },
        combatUi.pending
      )
    );
  }

  bar.appendChild(row);

  if (usable && combatUi.mode === "move") {
    const hint = document.createElement("p");
    hint.className = "combat-hint";
    hint.textContent = `Click a highlighted tile. Speed ${me && me.character ? computeVitals(me.character).speed : "?"}, any direction.`;
    bar.appendChild(hint);
  }

  if (usable && combatUi.mode === "attack" && me && me.character) {
    bar.appendChild(buildAttackPanel(me, tokens, usable));
  }

  renderReachable(me, tokens, usable && combatUi.mode === "move");
}

function renderExtraResolver(combat) {
  const box = el("combat-extra");

  if (!viewerIsDm || !combat || !combat.extra) {
    box.style.display = "none";
    box.innerHTML = "";
    combatUi.extraKey = null;
    return;
  }

  box.style.display = "block";
  if (combatUi.extraKey === combat.extra.id) return; // keep what the DM already typed
  combatUi.extraKey = combat.extra.id;
  box.innerHTML = "";

  const title = document.createElement("p");
  title.className = "combat-actions-title display";
  title.textContent = `Extra Action - ${combat.extra.actorName}`;
  box.appendChild(title);

  const note = document.createElement("p");
  note.className = "combat-hint";
  note.textContent =
    "Choose the dice and the modifier added to the roll. The result is shown to everyone. Edit HP/SP afterwards in the menu under Combatants.";
  box.appendChild(note);

  const row = document.createElement("div");
  row.className = "combat-dice-row";

  const count = document.createElement("input");
  count.type = "number";
  count.min = "1";
  count.max = "20";
  count.value = "1";
  count.setAttribute("aria-label", "Number of dice");

  const sides = document.createElement("select");
  sides.setAttribute("aria-label", "Die");
  EXTRA_DICE.forEach((n) => {
    const opt = document.createElement("option");
    opt.value = n;
    opt.textContent = `d${n}`;
    sides.appendChild(opt);
  });
  sides.value = "20";

  const plus = document.createElement("span");
  plus.textContent = "+";

  const modifier = document.createElement("input");
  modifier.type = "number";
  modifier.value = "0";
  modifier.setAttribute("aria-label", "Modifier added to the roll");

  row.appendChild(count);
  row.appendChild(sides);
  row.appendChild(plus);
  row.appendChild(modifier);
  box.appendChild(row);

  const label = document.createElement("input");
  label.type = "text";
  label.maxLength = 40;
  label.placeholder = "Modifier is from... (optional)";
  box.appendChild(label);

  const buttons = document.createElement("div");
  buttons.className = "save-row";
  buttons.appendChild(
    actionButton("Roll", () => {
      const n = Math.max(1, Math.min(20, parseInt(count.value, 10) || 1));
      const mod = parseInt(modifier.value, 10) || 0;
      rollExtra(n, parseInt(sides.value, 10), mod, label.value.trim());
    })
  );
  buttons.appendChild(actionButton("Done", finishExtra));
  box.appendChild(buttons);
}

// Called by map.js after every Encounter render (and to hide it elsewhere).
function renderCombatUI() {
  if (!el("combat-order")) return; // session view not built yet

  const inEncounter = sessionRow && sessionRow.status === "active" && sessionRow.mode === "encounter";
  if (!inEncounter) {
    hideCombatUi();
    return;
  }

  const combat = activeCombat();
  const tokens = collectTokens();

  // Whenever the combat state changes, drop any half-finished UI choice.
  const sig = combat
    ? `${combat.round}:${combat.turnIndex}:${combat.actionsLeft}:${combat.extra ? combat.extra.id : ""}:${(combat.log || []).length}`
    : null;
  if (sig !== combatUi.sig) {
    combatUi.sig = sig;
    combatUi.mode = null;
    combatUi.pending = false;
  }

  renderCombatUi_beginButton(combat);
  renderCombatUi_order(combat);

  if (combat) {
    renderCombatUi_actions(combat, tokens);
    markActiveToken(combat.order[combat.turnIndex].key);
  } else {
    el("combat-actions").style.display = "none";
    clearReachable();
    markActiveToken(null);
  }

  renderExtraResolver(combat);

  const combatants = el("encounter-combatants");
  if (combatants) {
    combatants.style.display = viewerIsDm ? "flex" : "none";
    if (viewerIsDm && sessionMenuOpen) refreshCombatants();
  }
}
