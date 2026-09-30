// Uses the shared client created in js/supabase-client.js (loaded first).
if (!window.client) {
  console.error(
    "Supabase client is missing. Make sure js/supabase-client.js is loaded before js/character-sheet.js."
  );
}
var client = window.client;

const DESCRIPTORS = {
  1: "Atrocious",
  2: "Underwhelming",
  3: "Capable",
  4: "Skilled",
  5: "Prodigy",
  6: "Godlike",
};

const CLASSIFICATIONS = [
  "Canard",
  "Urban Myth",
  "Urban Legend",
  "Urban Plague",
  "Urban Nightmare",
  "Star of the City",
  "Impuritas Civitavis",
];

const pageEl = document.getElementById("sheet-page");
const template = document.getElementById("sheet-template");

const params = new URLSearchParams(window.location.search);
const characterId = params.get("id");

let character = null;
let isOwner = false;
let isDm = false;

function showMessage(text) {
  pageEl.innerHTML = "";
  const p = document.createElement("p");
  p.className = "page-note";
  p.textContent = text;
  pageEl.appendChild(p);
}

async function loadCharacter() {
  if (!characterId) {
    showMessage("No character selected.");
    return;
  }

  const { data: sessionData } = await client.auth.getSession();
  if (!sessionData.session) {
    window.location.href = "login.html";
    return;
  }

  const userId = sessionData.session.user.id;

  const { data: profile } = await client
    .from("profiles")
    .select("is_dm")
    .eq("id", userId)
    .maybeSingle();
  isDm = !!(profile && profile.is_dm);

  const { data, error } = await client
    .from("characters")
    .select("*")
    .eq("id", characterId)
    .maybeSingle();

  if (error || !data) {
    showMessage("This character doesn't exist, or you don't have access to it.");
    return;
  }

  character = data;
  isOwner = character.owner_id === userId;

  renderSheet();
}

function renderSheet() {
  pageEl.innerHTML = "";
  pageEl.appendChild(template.content.cloneNode(true));

  document.getElementById("sheet-name").textContent = character.name;
  document.getElementById("sheet-district").textContent =
    `Born in ${character.district}`;

  renderLevelXp();
  renderClassification();
  renderStats();
  renderInventory();
  renderPanicType();

  document.getElementById("sheet-story").value = character.story || "";
  document.getElementById("sheet-notes").value = character.notes || "";

  wireLevelXp();
  wireClassification();
  wireStory();
  wireNotes();
  wireTabs();
  renderEgo();
  wireEgoSlotButton();
  wireVitals();
}

// ---- Level & XP ----

function renderLevelXp() {
  document.getElementById("sheet-level").textContent = character.level;
  document.getElementById("sheet-xp-input").value = character.xp;
  document.getElementById("sheet-xp-bar").style.width = `${character.xp}%`;
  document.getElementById("xp-edit-controls").style.display = isDm ? "flex" : "none";
  renderVitals();
}

function wireLevelXp() {
  const xpInput = document.getElementById("sheet-xp-input");
  const xpStatus = document.getElementById("sheet-xp-status");

  document.getElementById("sheet-xp-save").addEventListener("click", async () => {
    if (!isDm) return;
    let xp = parseInt(xpInput.value, 10);
    if (Number.isNaN(xp)) xp = 0;
    xp = Math.max(0, Math.min(100, xp));

    let level = character.level;
    if (xp >= 100) {
      level += 1;
      xp = 0;
    }

    const { error } = await client
      .from("characters")
      .update({ xp, level })
      .eq("id", character.id);

    if (error) {
      xpStatus.textContent = "Couldn't save: " + error.message;
      return;
    }

    character.xp = xp;
    character.level = level;
    xpStatus.textContent = "Saved.";
    renderLevelXp();
  });
}

// ---- Classification ----

function renderClassification() {
  const ladder = document.getElementById("classification-ladder");
  ladder.innerHTML = "";

  CLASSIFICATIONS.forEach((stage) => {
    const el = document.createElement("span");
    el.className = "classification-stage";
    if (stage === character.classification) {
      el.classList.add("is-current");
    }
    el.textContent = stage;
    ladder.appendChild(el);
  });

  document.getElementById("classification-dm-controls").style.display = isDm
    ? "flex"
    : "none";
}

function wireClassification() {
  if (!isDm) return;

  const statusEl = document.getElementById("classification-status");

  async function setClassification(newStage) {
    const { error } = await client
      .from("characters")
      .update({ classification: newStage })
      .eq("id", character.id);

    if (error) {
      statusEl.textContent = "Couldn't save: " + error.message;
      return;
    }

    character.classification = newStage;
    statusEl.textContent = "Saved.";
    renderClassification();
    wireClassification();
  }

  document.getElementById("classification-forward").addEventListener("click", () => {
    const idx = CLASSIFICATIONS.indexOf(character.classification);
    if (idx < CLASSIFICATIONS.length - 1) {
      setClassification(CLASSIFICATIONS[idx + 1]);
    }
  });

  document.getElementById("classification-back").addEventListener("click", () => {
    const idx = CLASSIFICATIONS.indexOf(character.classification);
    if (idx > 0) {
      setClassification(CLASSIFICATIONS[idx - 1]);
    }
  });
}

// ---- Stats (read-only, fixed at creation) + Skills ----

function skillDescriptorCapped(value) {
  return DESCRIPTORS[Math.min(value, 6)];
}

function renderStats() {
  ARCHETYPES.forEach((archetype) => {
    const value = character[archetype];
    document.getElementById(`sheet-stat-${archetype}`).textContent = value;
    document.getElementById(`sheet-descriptor-${archetype}`).textContent =
      DESCRIPTORS[value];
    renderSkillsReadOnly(archetype, value);
  });
}

function renderSkillsReadOnly(archetype, archetypeValue) {
  const container = document.getElementById(`sheet-skills-${archetype}`);
  container.innerHTML = "";

  const picks = character.skill_picks || {};
  const signature = picks.signature;
  const proficient = picks.proficient || [];

  SKILLS[archetype].forEach((skill) => {
    let value = archetypeValue;
    let tag = "";
    if (signature === skill.key) {
      value += 2;
      tag = " (Signature)";
    } else if (proficient.includes(skill.key)) {
      value += 1;
      tag = " (Proficient)";
    }

    const row = document.createElement("div");
    row.className = "skill-row";

    const info = document.createElement("div");
    info.className = "skill-info";

    const nameLine = document.createElement("div");
    nameLine.className = "skill-name-line";
    nameLine.title = skill.quote;

    const nameSpan = document.createElement("span");
    nameSpan.textContent = skill.name + tag;

    const valueSpan = document.createElement("span");
    valueSpan.className = "skill-value";
    valueSpan.textContent = `${value} · ${skillDescriptorCapped(value)}`;

    nameLine.appendChild(nameSpan);
    nameLine.appendChild(valueSpan);

    const desc = document.createElement("p");
    desc.className = "skill-description";
    desc.textContent = skill.description;

    info.appendChild(nameLine);
    info.appendChild(desc);
    row.appendChild(info);
    container.appendChild(row);
  });
}

// ---- Inventory ----
// Dragging uses Pointer Events (not the HTML5 drag/drop API) so the full
// shape of an item — not just the single cell you grabbed — follows the
// cursor as a ghost, with live valid/invalid highlighting on the grid.

function renderInventory() {
  const grid = document.getElementById("inventory-grid");
  const statusEl = document.getElementById("inventory-status");
  statusEl.textContent = "";
  grid.innerHTML = "";

  const canEdit = isOwner || isDm;
  const cellMap = new Map(); // "r,c" -> item

  (character.inventory || []).forEach((item) => {
    item.cells.forEach(([dr, dc]) => {
      const r = item.origin.row + dr;
      const c = item.origin.col + dc;
      cellMap.set(`${r},${c}`, item);
    });
  });

  for (let r = 0; r < 6; r++) {
    for (let c = 0; c < 6; c++) {
      const key = `${r},${c}`;
      const item = cellMap.get(key);
      const cell = document.createElement("div");
      cell.dataset.row = r;
      cell.dataset.col = c;

      if (item) {
        cell.className = `inventory-item-cell inventory-item-${item.type}`;
        cell.textContent = item.name;

        if (canEdit) {
          cell.classList.add("is-draggable");
          cell.style.touchAction = "none";
          cell.addEventListener("pointerdown", (event) => {
            startItemDrag(event, item, r, c);
          });
        } else {
          cell.addEventListener("click", () => showItemDetail(item));
        }
      } else {
        cell.className = "inventory-cell";
      }

      grid.appendChild(cell);
    }
  }
}

function startItemDrag(event, item, grabRow, grabCol) {
  event.preventDefault();

  const grid = document.getElementById("inventory-grid");
  const rect = grid.getBoundingClientRect();
  const cellSize = rect.width / 6;
  const grabOffset = [grabRow - item.origin.row, grabCol - item.origin.col];

  const maxDr = Math.max(...item.cells.map(([dr]) => dr));
  const maxDc = Math.max(...item.cells.map(([, dc]) => dc));

  const ghost = document.createElement("div");
  ghost.className = "inventory-drag-ghost";
  ghost.style.width = `${(maxDc + 1) * cellSize}px`;
  ghost.style.height = `${(maxDr + 1) * cellSize}px`;

  item.cells.forEach(([dr, dc]) => {
    const sq = document.createElement("div");
    sq.className = `inventory-ghost-cell inventory-item-${item.type}`;
    sq.style.left = `${dc * cellSize}px`;
    sq.style.top = `${dr * cellSize}px`;
    sq.style.width = `${cellSize}px`;
    sq.style.height = `${cellSize}px`;
    ghost.appendChild(sq);
  });

  document.body.appendChild(ghost);

  function positionGhost(clientX, clientY) {
    ghost.style.left = `${clientX - (grabOffset[1] * cellSize + cellSize / 2)}px`;
    ghost.style.top = `${clientY - (grabOffset[0] * cellSize + cellSize / 2)}px`;
  }
  positionGhost(event.clientX, event.clientY);

  const startX = event.clientX;
  const startY = event.clientY;
  let moved = false;
  let lastResult = null;

  function clearHighlights() {
    grid
      .querySelectorAll(".drag-target-valid, .drag-target-invalid")
      .forEach((el) => el.classList.remove("drag-target-valid", "drag-target-invalid"));
  }

  function onPointerMove(moveEvent) {
    const dx = moveEvent.clientX - startX;
    const dy = moveEvent.clientY - startY;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) moved = true;

    positionGhost(moveEvent.clientX, moveEvent.clientY);

    const gridRect = grid.getBoundingClientRect();
    const pointerRow = Math.floor((moveEvent.clientY - gridRect.top) / cellSize);
    const pointerCol = Math.floor((moveEvent.clientX - gridRect.left) / cellSize);
    const originRow = pointerRow - grabOffset[0];
    const originCol = pointerCol - grabOffset[1];

    const translated = item.cells.map(([dr, dc]) => [originRow + dr, originCol + dc]);
    const inBounds = translated.every(([r, c]) => r >= 0 && r < 6 && c >= 0 && c < 6);

    const occupiedByOthers = new Set();
    character.inventory.forEach((otherItem) => {
      if (otherItem.id === item.id) return;
      otherItem.cells.forEach(([dr, dc]) => {
        occupiedByOthers.add(`${otherItem.origin.row + dr},${otherItem.origin.col + dc}`);
      });
    });
    const overlaps = translated.some(([r, c]) => occupiedByOthers.has(`${r},${c}`));
    const valid = inBounds && !overlaps;

    clearHighlights();
    if (inBounds) {
      translated.forEach(([r, c]) => {
        const targetCell = grid.querySelector(`[data-row="${r}"][data-col="${c}"]`);
        if (targetCell) {
          targetCell.classList.add(valid ? "drag-target-valid" : "drag-target-invalid");
        }
      });
    }

    lastResult = { valid, originRow, originCol };
  }

  function onPointerUp() {
    document.removeEventListener("pointermove", onPointerMove);
    document.removeEventListener("pointerup", onPointerUp);
    ghost.remove();
    clearHighlights();

    if (!moved) {
      showItemDetail(item);
      return;
    }

    if (lastResult && lastResult.valid) {
      finalizeMove(item.id, lastResult.originRow, lastResult.originCol);
    }
  }

  document.addEventListener("pointermove", onPointerMove);
  document.addEventListener("pointerup", onPointerUp);
}

async function finalizeMove(itemId, newRow, newCol) {
  const statusEl = document.getElementById("inventory-status");
  const item = character.inventory.find((i) => i.id === itemId);
  if (!item) return;

  const updatedInventory = character.inventory.map((invItem) =>
    invItem.id === item.id
      ? { ...invItem, origin: { row: newRow, col: newCol } }
      : invItem
  );

  const { error } = await client
    .from("characters")
    .update({ inventory: updatedInventory })
    .eq("id", character.id);

  if (error) {
    statusEl.textContent = "Couldn't save: " + error.message;
    return;
  }

  character.inventory = updatedInventory;
  statusEl.textContent = "";
  renderInventory();
}

function showItemDetail(item) {
  const panel = document.getElementById("item-detail-panel");
  panel.style.display = "block";
  document.getElementById("item-detail-name").textContent = item.name;
  document.getElementById("item-detail-type").textContent =
    item.type === "container" ? "Container" : "Weapon";

  const moneyRow = document.getElementById("item-money-row");
  const moneyStatus = document.getElementById("item-money-status");
  moneyStatus.textContent = "";

  if (item.type === "container") {
    moneyRow.style.display = "flex";
    const moneyInput = document.getElementById("item-money-input");
    moneyInput.value = item.money || 0;

    const saveBtn = document.getElementById("item-money-save");
    const newSaveBtn = saveBtn.cloneNode(true); // clear old listeners
    saveBtn.parentNode.replaceChild(newSaveBtn, saveBtn);

    newSaveBtn.addEventListener("click", async () => {
      if (!isOwner && !isDm) return;
      let amount = parseInt(moneyInput.value, 10);
      if (Number.isNaN(amount) || amount < 0) amount = 0;

      const updatedInventory = character.inventory.map((invItem) =>
        invItem.id === item.id ? { ...invItem, money: amount } : invItem
      );

      const { error } = await client
        .from("characters")
        .update({ inventory: updatedInventory })
        .eq("id", character.id);

      if (error) {
        moneyStatus.textContent = "Couldn't save: " + error.message;
        return;
      }

      character.inventory = updatedInventory;
      item.money = amount;
      moneyStatus.textContent = "Saved.";
    });
  } else {
    moneyRow.style.display = "none";
  }

  const descInput = document.getElementById("item-description-input");
  const descStatus = document.getElementById("item-description-status");
  descStatus.textContent = "";
  descInput.value = item.description || "";

  const descSaveBtn = document.getElementById("item-description-save");
  const newDescSaveBtn = descSaveBtn.cloneNode(true); // clear old listeners
  descSaveBtn.parentNode.replaceChild(newDescSaveBtn, descSaveBtn);

  newDescSaveBtn.addEventListener("click", async () => {
    if (!isOwner && !isDm) return;
    const description = descInput.value;

    const updatedInventory = character.inventory.map((invItem) =>
      invItem.id === item.id ? { ...invItem, description } : invItem
    );

    const { error } = await client
      .from("characters")
      .update({ inventory: updatedInventory })
      .eq("id", character.id);

    if (error) {
      descStatus.textContent = "Couldn't save: " + error.message;
      return;
    }

    character.inventory = updatedInventory;
    item.description = description;
    descStatus.textContent = "Saved.";
  });

  renderWeaponSkills(item);
}

// ---- Story & Notes ----

function wireStory() {
  const status = document.getElementById("sheet-story-status");
  document.getElementById("sheet-story-save").addEventListener("click", async () => {
    if (!isOwner && !isDm) return;
    const story = document.getElementById("sheet-story").value;

    const { error } = await client
      .from("characters")
      .update({ story })
      .eq("id", character.id);

    status.textContent = error ? "Couldn't save: " + error.message : "Saved.";
    if (!error) character.story = story;
  });
}

function wireNotes() {
  const status = document.getElementById("sheet-notes-status");
  document.getElementById("sheet-notes-save").addEventListener("click", async () => {
    if (!isOwner && !isDm) return;
    const notes = document.getElementById("sheet-notes").value;

    const { error } = await client
      .from("characters")
      .update({ notes })
      .eq("id", character.id);

    status.textContent = error ? "Couldn't save: " + error.message : "Saved.";
    if (!error) character.notes = notes;
  });
}


// ---- Tabs (Innocence / E.G.O) ----

function wireTabs() {
  const tabs = {
    innocence: {
      btn: document.getElementById("tab-btn-innocence"),
      panel: document.getElementById("tab-innocence"),
    },
    ego: {
      btn: document.getElementById("tab-btn-ego"),
      panel: document.getElementById("tab-ego"),
    },
  };

  function showTab(name) {
    Object.entries(tabs).forEach(([key, { btn, panel }]) => {
      const active = key === name;
      panel.style.display = active ? "block" : "none";
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-selected", active ? "true" : "false");
    });
  }

  tabs.innocence.btn.addEventListener("click", () => showTab("innocence"));
  tabs.ego.btn.addEventListener("click", () => showTab("ego"));
}

// ---- E.G.O ----
// Each character starts with 1 slot (ego_slots). Only a DM can add/remove
// slots. Slot 0 is always the character's own Zayin, built by the owner at
// a fixed 50-point budget. Every other slot can only be filled by the DM,
// freely, with any of the higher E.G.O types (Teth, He, Waw, Aleph).
// egos is a compact array of E.G.O objects; slot i shows egos[i].

let editingEgoIndex = null;

function getEgos() {
  return character.egos || [];
}

function getEgoSlots() {
  return character.ego_slots || 1;
}

function wireEgoSlotButton() {
  const addBtn = document.getElementById("ego-add-slot");
  const removeBtn = document.getElementById("ego-remove-slot");
  addBtn.style.display = isDm ? "inline-block" : "none";
  removeBtn.style.display = isDm ? "inline-block" : "none";
  if (!isDm) return;

  const statusEl = document.getElementById("ego-slot-status");

  async function setSlots(newSlots, doneMessage) {
    const { error } = await client
      .from("characters")
      .update({ ego_slots: newSlots })
      .eq("id", character.id);

    if (error) {
      statusEl.textContent = "Couldn't save: " + error.message;
      return;
    }

    character.ego_slots = newSlots;
    statusEl.textContent = doneMessage;
    renderEgo();
  }

  addBtn.addEventListener("click", () => {
    setSlots(getEgoSlots() + 1, "Slot added.");
  });

  removeBtn.addEventListener("click", () => {
    const newSlots = getEgoSlots() - 1;
    if (newSlots < 1) {
      statusEl.textContent = "A character needs at least 1 slot.";
      return;
    }
    if (newSlots < getEgos().length) {
      statusEl.textContent = "Every slot is in use — remove an E.G.O first.";
      return;
    }
    setSlots(newSlots, "Slot removed.");
  });
}

async function saveEgos(newEgos, statusEl) {
  const { error } = await client
    .from("characters")
    .update({ egos: newEgos })
    .eq("id", character.id);

  if (error) {
    if (statusEl) statusEl.textContent = "Couldn't save: " + error.message;
    return false;
  }

  character.egos = newEgos;
  return true;
}

function renderEgo() {
  const list = document.getElementById("ego-slot-list");
  const summary = document.getElementById("ego-slots-summary");
  const egos = getEgos();
  const slots = getEgoSlots();
  const canEdit = isOwner || isDm;

  summary.textContent = `Slots used: ${egos.length} / ${slots}`;
  list.innerHTML = "";

  for (let i = 0; i < slots; i++) {
    const ego = egos[i];
    const isZayinSlot = i === 0;
    const card = document.createElement("div");
    card.className = "ego-slot";

    const slotLabel = document.createElement("p");
    slotLabel.className = "ego-slot-label";
    slotLabel.textContent = isZayinSlot ? "Slot 1 — Zayin" : `Slot ${i + 1}`;
    card.appendChild(slotLabel);

    const status = document.createElement("span");
    status.className = "save-status";

    // Who may create/edit an E.G.O for this slot:
    //  - slot 0 (Zayin): only the owner builds it themselves.
    //  - other slots: only the DM builds/edits them.
    const canFillThisSlot = isZayinSlot ? isOwner : isDm;
    // Once an E.G.O exists, owner and DM can both edit/remove it.
    const canManageExisting = canEdit;

    if (editingEgoIndex === i && (ego ? canManageExisting : canFillThisSlot)) {
      const editorHost = document.createElement("div");
      card.appendChild(editorHost);
      const openEditor = isZayinSlot ? openZayinEgoEditor : openDmEgoEditor;
      openEditor({
        container: editorHost,
        ego,
        onSave: async (saved) => {
          const list = [...egos];
          list[i] = saved;
          if (await saveEgos(list, status)) {
            editingEgoIndex = null;
            renderEgo();
          }
        },
        onCancel: () => {
          editingEgoIndex = null;
          renderEgo();
        },
        onDelete: async () => {
          const list = [...egos];
          list[i] = undefined;
          // Trim trailing empty slots so the array doesn't grow forever.
          while (list.length && list[list.length - 1] === undefined) list.pop();
          if (await saveEgos(list, status)) {
            editingEgoIndex = null;
            renderEgo();
          }
        },
      });
    } else if (ego) {
      card.appendChild(buildEgoCard(ego));

      if (canManageExisting) {
        const row = document.createElement("div");
        row.className = "save-row";

        const editBtn = document.createElement("button");
        editBtn.type = "button";
        editBtn.className = "small-btn";
        editBtn.textContent = "Edit";
        editBtn.addEventListener("click", () => {
          editingEgoIndex = i;
          renderEgo();
        });

        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "small-btn";
        removeBtn.textContent = "Remove";
        removeBtn.addEventListener("click", async () => {
          const confirmed = window.confirm(
            `Remove the E.G.O "${ego.name}"? This frees up the slot.`
          );
          if (!confirmed) return;
          const list = [...egos];
          list[i] = undefined;
          while (list.length && list[list.length - 1] === undefined) list.pop();
          if (await saveEgos(list, status)) renderEgo();
        });

        row.appendChild(editBtn);
        row.appendChild(removeBtn);
        row.appendChild(status);
        card.appendChild(row);
      }
    } else {
      const empty = document.createElement("p");
      empty.className = "ego-empty";
      if (canFillThisSlot) {
        empty.textContent = "Empty slot";
      } else if (isZayinSlot) {
        empty.textContent = "Waiting for the player to build their starting Zayin E.G.O.";
      } else {
        empty.textContent = "Waiting for the Dungeon Master to grant an E.G.O here.";
      }
      card.appendChild(empty);

      if (canFillThisSlot) {
        const addBtn = document.createElement("button");
        addBtn.type = "button";
        addBtn.className = "small-btn";
        addBtn.textContent = isZayinSlot ? "Create Your Zayin E.G.O +" : "Create E.G.O +";
        addBtn.addEventListener("click", () => {
          editingEgoIndex = i;
          renderEgo();
        });
        card.appendChild(addBtn);
      }
    }

    list.appendChild(card);
  }
}



// ---- Vitals: HP, SP, Speed ----
// Max HP/SP/Speed are calculated from Level and skill values (see
// skills-data.js). Only the *current* HP/SP are stored (null = full),
// and only a DM can change them.

function characterSkillValue(archetype, skillKey) {
  const base = character[archetype];
  const picks = character.skill_picks || {};
  if (picks.signature === skillKey) return base + 2;
  if ((picks.proficient || []).includes(skillKey)) return base + 1;
  return base;
}

function getVitals() {
  const weathering = characterSkillValue("fortitude", "weathering");
  const willToPower = characterSkillValue("temperance", "will_to_power");
  const adaptability = characterSkillValue("fortitude", "adaptability");

  return {
    maxHp: calcMaxHp(weathering, character.level),
    maxSp: calcMaxSp(willToPower, character.level),
    speed: calcSpeed(adaptability),
  };
}

function currentVital(kind) {
  const { maxHp, maxSp } = getVitals();
  const max = kind === "hp" ? maxHp : maxSp;
  const stored = character[`${kind}_current`];
  if (stored === null || stored === undefined) return max;
  return Math.max(0, Math.min(stored, max));
}

function renderVitals() {
  const { maxHp, maxSp, speed } = getVitals();

  [["hp", maxHp], ["sp", maxSp]].forEach(([kind, max]) => {
    const current = currentVital(kind);
    const pct = max > 0 ? (current / max) * 100 : 0;
    document.getElementById(`sheet-${kind}-bar`).style.width = `${pct}%`;
    document.getElementById(`sheet-${kind}-text`).textContent = `${current} / ${max}`;
  });

  document.getElementById("sheet-speed").textContent = speed;
}

function wireVitals() {
  ["hp", "sp"].forEach((kind) => {
    const controls = document.getElementById(`${kind}-dm-controls`);
    controls.style.display = isDm ? "flex" : "none";
    if (!isDm) return;

    const amountInput = document.getElementById(`${kind}-amount`);
    const statusEl = document.getElementById(`${kind}-status`);

    async function change(direction) {
      const amount = parseInt(amountInput.value, 10);
      if (Number.isNaN(amount) || amount < 1) {
        statusEl.textContent = "Enter an amount of 1 or more.";
        return;
      }

      const { maxHp, maxSp } = getVitals();
      const max = kind === "hp" ? maxHp : maxSp;
      const next = Math.max(0, Math.min(max, currentVital(kind) + direction * amount));

      const { error } = await client
        .from("characters")
        .update({ [`${kind}_current`]: next })
        .eq("id", character.id);

      if (error) {
        statusEl.textContent = "Couldn't save: " + error.message;
        return;
      }

      character[`${kind}_current`] = next;
      statusEl.textContent = "";
      renderVitals();
    }

    document.getElementById(`${kind}-hurt`).addEventListener("click", () => change(-1));
    document.getElementById(`${kind}-heal`).addEventListener("click", () => change(1));
  });
}


// ---- Panic type (decided by the signature skill's archetype) ----

function renderPanicType() {
  const nameEl = document.getElementById("panic-name");
  const descEl = document.getElementById("panic-description");

  const signature = (character.skill_picks || {}).signature;
  const archetype = signature ? archetypeOfSkill(signature) : null;
  const panic = archetype ? PANIC_TYPES[archetype] : null;

  if (!panic) {
    nameEl.textContent = "None";
    nameEl.style.color = "";
    descEl.textContent = "This character has no signature skill, so no panic type.";
    return;
  }

  nameEl.textContent = panic.name;
  nameEl.style.color = `var(--stat-${archetype})`;
  descEl.textContent = panic.description;
}


// ---- Weapon skills (shown in the weapon's menu) ----
// Stored inside the weapon's inventory item as `skills`, so no extra
// database column is needed. Rules and card rendering: js/weapon-skills.js.

let currentWeaponId = null;

function getWeaponById(id) {
  return (character.inventory || []).find((i) => i.id === id);
}

function closeSkillEditor() {
  const el = document.getElementById("weapon-skill-editor");
  if (!el) return;
  el.innerHTML = "";
  el.style.display = "none";
}

function renderWeaponSkills(item) {
  const section = document.getElementById("weapon-skills-section");

  if (item.type !== "weapon") {
    section.style.display = "none";
    currentWeaponId = null;
    return;
  }

  currentWeaponId = item.id;
  section.style.display = "block";
  closeSkillEditor();
  document.getElementById("weapon-skill-status").textContent = "";

  const canEdit = isOwner || isDm;
  const oldBtn = document.getElementById("weapon-skill-add");
  const addBtn = oldBtn.cloneNode(true); // clear old listeners
  oldBtn.parentNode.replaceChild(addBtn, oldBtn);
  addBtn.style.display = canEdit ? "inline-block" : "none";
  addBtn.addEventListener("click", () => openWeaponSkillEditor(null));

  renderSkillGrid();
}

function renderSkillGrid() {
  const weapon = getWeaponById(currentWeaponId);
  if (!weapon) return;

  const skills = weapon.skills || [];
  const canEdit = isOwner || isDm;

  document.getElementById("weapon-skills-count").textContent =
    `(${skills.length}/${MAX_SKILLS_PER_WEAPON})`;
  document.getElementById("weapon-skill-add").disabled =
    skills.length >= MAX_SKILLS_PER_WEAPON;

  const grid = document.getElementById("weapon-skill-grid");
  grid.innerHTML = "";

  if (skills.length === 0) {
    const empty = document.createElement("p");
    empty.className = "ego-empty";
    empty.textContent = "No skills yet.";
    grid.appendChild(empty);
    return;
  }

  skills.forEach((rawSkill) => {
    const skill = normalizeSkill(rawSkill);
    const card = buildRuinaCard(skill, {
      onArtClick: canEdit ? () => changeSkillImage(skill.id) : null,
    });
    if (canEdit) {
      card.classList.add("is-clickable");
      card.tabIndex = 0;
      card.setAttribute("role", "button");
      card.setAttribute("aria-label", `Edit skill ${skill.name}`);
      card.addEventListener("click", () => openWeaponSkillEditor(skill));
      card.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openWeaponSkillEditor(skill);
        }
      });
    }
    grid.appendChild(card);
  });
}

async function saveWeaponSkills(weaponId, skills) {
  const statusEl = document.getElementById("weapon-skill-status");
  const updatedInventory = character.inventory.map((invItem) =>
    invItem.id === weaponId ? { ...invItem, skills } : invItem
  );

  const { error } = await client
    .from("characters")
    .update({ inventory: updatedInventory })
    .eq("id", character.id);

  if (error) {
    statusEl.textContent = "Couldn't save: " + error.message;
    return false;
  }

  character.inventory = updatedInventory;
  statusEl.textContent = "Saved.";
  renderSkillGrid();
  return true;
}

// Clicking a card's picture area: choose an image and save it right away.
async function changeSkillImage(skillId) {
  const weapon = getWeaponById(currentWeaponId);
  if (!weapon || !(isOwner || isDm)) return;

  const image = await pickCardImage();
  if (!image) return;

  const list = (getWeaponById(weapon.id).skills || []).map((s) =>
    s.id === skillId ? { ...normalizeSkill(s), image } : s
  );
  await saveWeaponSkills(weapon.id, list);
}

function openWeaponSkillEditor(skill) {
  const weapon = getWeaponById(currentWeaponId);
  if (!weapon || !(isOwner || isDm)) return;
  if (!skill && (weapon.skills || []).length >= MAX_SKILLS_PER_WEAPON) return;

  openSkillEditor({
    container: document.getElementById("weapon-skill-editor"),
    skill,
    weaponTiles: weapon.cells.length,
    onSave: async (saved) => {
      const list = [...(getWeaponById(weapon.id).skills || [])];
      const index = list.findIndex((s) => s.id === saved.id);
      if (index >= 0) {
        list[index] = saved;
      } else {
        list.push(saved);
      }
      if (await saveWeaponSkills(weapon.id, list)) closeSkillEditor();
    },
    onCancel: closeSkillEditor,
    onDelete: async (skillId) => {
      const list = (getWeaponById(weapon.id).skills || []).filter(
        (s) => s.id !== skillId
      );
      if (await saveWeaponSkills(weapon.id, list)) closeSkillEditor();
    },
  });
}

loadCharacter();
