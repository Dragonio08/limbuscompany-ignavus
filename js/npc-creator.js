// NPC creator: a separate flow from the player character creator.
// No skills, no Signature Color. Max HP/SP/Speed are chosen directly, the
// panic type is free-form, the inventory can hold any number of items, and
// E.G.O is off unless the DM turns it on.

if (!window.client) {
  console.error(
    "Supabase client is missing. Make sure js/supabase-client.js is loaded before js/npc-creator.js."
  );
}
var client = window.client;

// ---- Auth guard: only a Dungeon Master can create an NPC ----
client.auth.getSession().then(async ({ data }) => {
  if (!data.session) {
    window.location.href = "login.html";
    return;
  }
  const { data: profile } = await client
    .from("profiles")
    .select("is_dm")
    .eq("id", data.session.user.id)
    .maybeSingle();
  if (!profile || !profile.is_dm) {
    window.location.href = "characters.html";
  }
});

// ---- Stats: no limit, with a non-blocking warning ----

const DESCRIPTORS = {
  1: "Atrocious",
  2: "Underwhelming",
  3: "Capable",
  4: "Skilled",
  5: "Prodigy",
  6: "Master",
  7: "Godlike",
};

// For the warning only: what a player could normally build.
const PLAYER_TOTAL_POINTS = 7;
const PLAYER_STAT_CAP = 5;

const STAT_NAMES = ["fortitude", "prudence", "temperance", "justice"];
const stats = { fortitude: 1, prudence: 1, temperance: 1, justice: 1 };
let pointsRemaining = PLAYER_TOTAL_POINTS;

const pointsRemainingEl = document.getElementById("points-remaining");
const statsWarningEl = document.getElementById("stats-warning");

function updateStatsWarning() {
  const overStatCap = STAT_NAMES.some((s) => stats[s] > PLAYER_STAT_CAP);
  const overBudget = pointsRemaining < 0;
  statsWarningEl.textContent =
    overStatCap || overBudget
      ? "⚠ This is more than a player could normally build (max 5 per stat, 7 points total). That's fine for an NPC."
      : "";
}

function updateStatUI(stat) {
  document.getElementById(`stat-value-${stat}`).textContent = stats[stat];
  document.getElementById(`stat-descriptor-${stat}`).textContent =
    DESCRIPTORS[Math.min(stats[stat], 7)];
  pointsRemainingEl.textContent = pointsRemaining;

  document.querySelectorAll(`.stat-btn[data-stat="${stat}"]`).forEach((btn) => {
    if (btn.dataset.action === "dec") {
      btn.disabled = stats[stat] <= 1;
    }
  });
}

function refreshStats() {
  STAT_NAMES.forEach(updateStatUI);
  updateStatsWarning();
}

document.querySelectorAll(".stat-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const stat = btn.dataset.stat;
    if (btn.dataset.action === "inc") {
      stats[stat] += 1;
      pointsRemaining -= 1;
    } else if (stats[stat] > 1) {
      stats[stat] -= 1;
      pointsRemaining += 1;
    }
    refreshStats();
  });
});

refreshStats();

// ---- E.G.O toggle ----

let egoEnabled = false;
const egoToggle = document.getElementById("npc-ego-toggle");

egoToggle.addEventListener("click", () => {
  egoEnabled = !egoEnabled;
  egoToggle.textContent = egoEnabled ? "E.G.O: Enabled" : "E.G.O: Disabled";
  egoToggle.setAttribute("aria-pressed", egoEnabled ? "true" : "false");
  egoToggle.classList.toggle("is-on", egoEnabled);
});

// ---- Inventory builder: any number of items ----

const GRID_SIZE = 6;
const itemShapeEl = document.getElementById("npc-item-shape");
const itemTypeEl = document.getElementById("npc-item-type");
const itemNameEl = document.getElementById("npc-item-name");
const itemStatusEl = document.getElementById("npc-item-status");
const itemTileCountEl = document.getElementById("npc-item-tile-count");
const itemsListEl = document.getElementById("npc-items-list");
const itemsCountEl = document.getElementById("npc-items-count");

const selectedCells = new Set(); // "r,c" for the item currently being shaped
const addedItems = []; // { id, name, type, shape (normalized) }

function updateTileCount() {
  itemTileCountEl.textContent = `Tiles: ${selectedCells.size}`;
}

function buildShapeGrid() {
  for (let r = 0; r < GRID_SIZE; r++) {
    for (let c = 0; c < GRID_SIZE; c++) {
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "shape-cell";
      cell.setAttribute("aria-label", `Row ${r + 1}, column ${c + 1}`);
      cell.addEventListener("click", () => {
        const key = `${r},${c}`;
        if (selectedCells.has(key)) {
          selectedCells.delete(key);
          cell.classList.remove("selected");
        } else {
          selectedCells.add(key);
          cell.classList.add("selected");
        }
        updateTileCount();
      });
      itemShapeEl.appendChild(cell);
    }
  }
}

function clearShapeSelection() {
  selectedCells.clear();
  itemShapeEl.querySelectorAll(".shape-cell.selected").forEach((el) => el.classList.remove("selected"));
  updateTileCount();
}

function setToCells(set) {
  return Array.from(set).map((key) => key.split(",").map(Number));
}

function isConnected(cells) {
  if (cells.length === 0) return false;
  const key = ([r, c]) => `${r},${c}`;
  const set = new Set(cells.map(key));
  const visited = new Set([key(cells[0])]);
  const stack = [cells[0]];

  while (stack.length) {
    const [r, c] = stack.pop();
    for (const n of [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]]) {
      const k = key(n);
      if (set.has(k) && !visited.has(k)) {
        visited.add(k);
        stack.push(n);
      }
    }
  }

  return visited.size === cells.length;
}

function normalizeShape(cells) {
  const minR = Math.min(...cells.map((c) => c[0]));
  const minC = Math.min(...cells.map((c) => c[1]));
  return cells.map(([r, c]) => [r - minR, c - minC]);
}

// Greedy top-left first-fit packing of any number of items into the grid.
// Returns the items with an added `origin`, or null if they don't all fit.
function packItems(items) {
  const occupied = new Set();
  const placed = [];

  for (const item of items) {
    let success = false;
    for (let r0 = 0; r0 < GRID_SIZE && !success; r0++) {
      for (let c0 = 0; c0 < GRID_SIZE && !success; c0++) {
        const translated = item.shape.map(([dr, dc]) => [r0 + dr, c0 + dc]);
        const fits = translated.every(
          ([r, c]) => r >= 0 && r < GRID_SIZE && c >= 0 && c < GRID_SIZE && !occupied.has(`${r},${c}`)
        );
        if (fits) {
          translated.forEach(([r, c]) => occupied.add(`${r},${c}`));
          placed.push({ ...item, origin: { row: r0, col: c0 } });
          success = true;
        }
      }
    }
    if (!success) return null;
  }

  return placed;
}

function renderAddedItems() {
  itemsCountEl.textContent = `(${addedItems.length})`;
  itemsListEl.innerHTML = "";

  if (addedItems.length === 0) {
    const empty = document.createElement("p");
    empty.className = "ego-empty";
    empty.textContent = "No items yet. An NPC with no items is fine too.";
    itemsListEl.appendChild(empty);
    return;
  }

  addedItems.forEach((item, index) => {
    const row = document.createElement("div");
    row.className = `container-content-chip inventory-item-${item.type}`;

    const label = document.createElement("span");
    label.textContent = `${item.name} (${item.type}, ${item.shape.length} tiles)`;

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "small-btn";
    removeBtn.textContent = "Remove";
    removeBtn.addEventListener("click", () => {
      addedItems.splice(index, 1);
      renderAddedItems();
    });

    row.appendChild(label);
    row.appendChild(removeBtn);
    itemsListEl.appendChild(row);
  });
}

document.getElementById("npc-item-add").addEventListener("click", () => {
  itemStatusEl.textContent = "";

  const name = itemNameEl.value.trim();
  const type = itemTypeEl.value;
  const cells = setToCells(selectedCells);

  if (!name) {
    itemStatusEl.textContent = "Name the item.";
    return;
  }
  if (cells.length === 0) {
    itemStatusEl.textContent = "Click cells to shape the item.";
    return;
  }
  if (!isConnected(cells)) {
    itemStatusEl.textContent = "The shape must be a single connected block.";
    return;
  }

  const candidate = { id: crypto.randomUUID(), name, type, shape: normalizeShape(cells) };
  if (!packItems([...addedItems, candidate])) {
    itemStatusEl.textContent = "There's no room left in the 6×6 grid for that item.";
    return;
  }

  addedItems.push(candidate);
  itemNameEl.value = "";
  clearShapeSelection();
  renderAddedItems();
});

buildShapeGrid();
updateTileCount();
renderAddedItems();

// ---- Submit ----

const form = document.getElementById("creator-form");
const errorEl = document.getElementById("creator-error");
const submitButton = document.getElementById("creator-submit");

function readPositiveInt(id, fallback, min) {
  const parsed = parseInt(document.getElementById(id).value, 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.max(min, parsed);
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  errorEl.textContent = "";

  const name = document.getElementById("npc-name").value.trim();
  const quote = document.getElementById("npc-quote").value.trim();
  const district = document.getElementById("npc-district").value;
  const story = document.getElementById("npc-story").value.trim();
  const panicName = document.getElementById("npc-panic-name").value.trim();
  const panicDescription = document.getElementById("npc-panic-description").value.trim();

  if (!name || !district) {
    errorEl.textContent = "Fill in the NPC's name and district.";
    return;
  }

  const placed = packItems(addedItems);
  if (!placed) {
    errorEl.textContent = "The items don't all fit in the 6×6 grid.";
    return;
  }

  submitButton.disabled = true;

  const { data: sessionData } = await client.auth.getSession();
  if (!sessionData.session) {
    window.location.href = "login.html";
    return;
  }

  const inventory = placed.map((item) => ({
    id: item.id,
    name: item.name,
    type: item.type,
    cells: item.shape,
    origin: item.origin,
    description: "",
    money: item.type === "container" ? 0 : undefined,
  }));

  const { data: inserted, error } = await client
    .from("characters")
    .insert({
      owner_id: sessionData.session.user.id,
      name,
      district,
      quote,
      fortitude: stats.fortitude,
      prudence: stats.prudence,
      temperance: stats.temperance,
      justice: stats.justice,
      skill_picks: {},
      inventory,
      story,
      is_npc: true,
      max_hp: readPositiveInt("npc-max-hp", 100, 1),
      max_sp: readPositiveInt("npc-max-sp", 10, 1),
      speed_override: readPositiveInt("npc-speed", 3, 0),
      custom_panic_name: panicName,
      custom_panic_description: panicDescription,
      ego_enabled: egoEnabled,
    })
    .select()
    .single();

  if (error) {
    errorEl.textContent = "Could not save NPC: " + error.message;
    submitButton.disabled = false;
    return;
  }

  window.location.href = `character-sheet.html?id=${inserted.id}`;
});
