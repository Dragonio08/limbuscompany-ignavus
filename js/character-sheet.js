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

  document.getElementById("sheet-story").value = character.story || "";
  document.getElementById("sheet-notes").value = character.notes || "";

  wireLevelXp();
  wireClassification();
  wireStory();
  wireNotes();
}

// ---- Level & XP ----

function renderLevelXp() {
  document.getElementById("sheet-level").textContent = character.level;
  document.getElementById("sheet-xp-input").value = character.xp;
  document.getElementById("sheet-xp-bar").style.width = `${character.xp}%`;
  document.getElementById("xp-edit-controls").style.display = isDm ? "flex" : "none";
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

// ---- Stats (read-only, fixed at creation) ----

function renderStats() {
  ["fortitude", "prudence", "temperance", "justice"].forEach((stat) => {
    const value = character[stat];
    document.getElementById(`sheet-stat-${stat}`).textContent = value;
    document.getElementById(`sheet-descriptor-${stat}`).textContent =
      DESCRIPTORS[value];
  });
}

// ---- Inventory ----

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
        cell.draggable = canEdit;
        cell.addEventListener("click", () => showItemDetail(item));

        if (canEdit) {
          cell.addEventListener("dragstart", (event) => {
            event.dataTransfer.setData("text/plain", item.id);
          });
        }
      } else {
        cell.className = "inventory-cell";
      }

      if (canEdit) {
        cell.addEventListener("dragover", (event) => {
          event.preventDefault();
        });

        cell.addEventListener("drop", (event) => {
          event.preventDefault();
          const itemId = event.dataTransfer.getData("text/plain");
          moveItem(itemId, r, c);
        });
      }

      grid.appendChild(cell);
    }
  }
}

async function moveItem(itemId, newRow, newCol) {
  const statusEl = document.getElementById("inventory-status");
  const item = character.inventory.find((i) => i.id === itemId);
  if (!item) return;

  // item.cells holds the shape as offsets relative to origin, so only
  // origin needs to move — the shape itself stays the same.
  const translated = item.cells.map(([dr, dc]) => [newRow + dr, newCol + dc]);

  const inBounds = translated.every(
    ([r, c]) => r >= 0 && r < 6 && c >= 0 && c < 6
  );
  if (!inBounds) {
    statusEl.textContent = "That doesn't fit there.";
    return;
  }

  const occupiedByOthers = new Set();
  character.inventory.forEach((otherItem) => {
    if (otherItem.id === item.id) return;
    otherItem.cells.forEach(([dr, dc]) => {
      const r = otherItem.origin.row + dr;
      const c = otherItem.origin.col + dc;
      occupiedByOthers.add(`${r},${c}`);
    });
  });

  const overlaps = translated.some(([r, c]) => occupiedByOthers.has(`${r},${c}`));
  if (overlaps) {
    statusEl.textContent = "Something's already there.";
    return;
  }

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

loadCharacter();
