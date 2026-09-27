// Uses the shared client created in js/supabase-client.js (loaded first).
if (!window.client) {
  console.error(
    "Supabase client is missing. Make sure js/supabase-client.js is loaded before js/character-creator.js."
  );
}
var client = window.client;

// ---- Auth guard: must be logged in to create a character ----
client.auth.getSession().then(({ data }) => {
  if (!data.session) {
    window.location.href = "login.html";
  }
});

// ---- Stats point-buy ----

const DESCRIPTORS = {
  1: "Atrocious",
  2: "Underwhelming",
  3: "Capable",
  4: "Skilled",
  5: "Prodigy",
  6: "Godlike",
};

const STAT_NAMES = ["fortitude", "prudence", "temperance", "justice"];
const stats = { fortitude: 1, prudence: 1, temperance: 1, justice: 1 };
const TOTAL_POINTS = 5;
let pointsRemaining = TOTAL_POINTS;

const pointsRemainingEl = document.getElementById("points-remaining");

function updateStatUI(stat) {
  document.getElementById(`stat-value-${stat}`).textContent = stats[stat];
  document.getElementById(`stat-descriptor-${stat}`).textContent =
    DESCRIPTORS[stats[stat]];
  pointsRemainingEl.textContent = pointsRemaining;

  document
    .querySelectorAll(`.stat-btn[data-stat="${stat}"]`)
    .forEach((btn) => {
      if (btn.dataset.action === "inc") {
        btn.disabled = pointsRemaining <= 0 || stats[stat] >= 6;
      } else {
        btn.disabled = stats[stat] <= 1;
      }
    });
}

document.querySelectorAll(".stat-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const stat = btn.dataset.stat;
    if (btn.dataset.action === "inc") {
      if (pointsRemaining > 0 && stats[stat] < 6) {
        stats[stat] += 1;
        pointsRemaining -= 1;
      }
    } else {
      if (stats[stat] > 1) {
        stats[stat] -= 1;
        pointsRemaining += 1;
      }
    }
    STAT_NAMES.forEach(updateStatUI);
  });
});

STAT_NAMES.forEach(updateStatUI);

// ---- Shape picker grids ----

function buildShapeGrid(gridEl, selectedSet) {
  for (let r = 0; r < 6; r++) {
    for (let c = 0; c < 6; c++) {
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "shape-cell";
      cell.setAttribute("aria-label", `Row ${r + 1}, column ${c + 1}`);
      cell.addEventListener("click", () => {
        const key = `${r},${c}`;
        if (selectedSet.has(key)) {
          selectedSet.delete(key);
          cell.classList.remove("selected");
        } else {
          selectedSet.add(key);
          cell.classList.add("selected");
        }
      });
      gridEl.appendChild(cell);
    }
  }
}

const containerSelected = new Set();
const weaponSelected = new Set();

buildShapeGrid(document.getElementById("container-shape"), containerSelected);
buildShapeGrid(document.getElementById("weapon-shape"), weaponSelected);

// ---- Shape helpers ----

function setToCells(set) {
  return Array.from(set).map((key) => key.split(",").map(Number));
}

function isConnected(cells) {
  if (cells.length === 0) return false;
  const key = ([r, c]) => `${r},${c}`;
  const set = new Set(cells.map(key));
  const visited = new Set();
  const stack = [cells[0]];
  visited.add(key(cells[0]));

  while (stack.length) {
    const [r, c] = stack.pop();
    const neighbors = [
      [r - 1, c],
      [r + 1, c],
      [r, c - 1],
      [r, c + 1],
    ];
    for (const n of neighbors) {
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

// Greedily packs items (in order) into a 6x6 grid, top-left first fit.
// Returns the items with an added `origin`, or null if they don't fit.
function packItems(items) {
  const occupied = new Set();
  const placed = [];

  for (const item of items) {
    let success = false;
    for (let r0 = 0; r0 < 6 && !success; r0++) {
      for (let c0 = 0; c0 < 6 && !success; c0++) {
        const translated = item.shape.map(([dr, dc]) => [r0 + dr, c0 + dc]);
        const fits = translated.every(
          ([r, c]) => r >= 0 && r < 6 && c >= 0 && c < 6 && !occupied.has(`${r},${c}`)
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

// ---- Submit ----

const form = document.getElementById("creator-form");
const errorEl = document.getElementById("creator-error");
const submitButton = document.getElementById("creator-submit");

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  errorEl.textContent = "";

  const name = document.getElementById("char-name").value.trim();
  const district = document.getElementById("char-district").value;
  const containerName = document.getElementById("container-name").value.trim();
  const weaponName = document.getElementById("weapon-name").value.trim();
  const story = document.getElementById("char-story").value.trim();

  if (!name || !district) {
    errorEl.textContent = "Fill in your name and district.";
    return;
  }

  if (!containerName || !weaponName) {
    errorEl.textContent = "Name your Container and your Weapon.";
    return;
  }

  const containerCells = setToCells(containerSelected);
  const weaponCells = setToCells(weaponSelected);

  if (containerCells.length === 0 || weaponCells.length === 0) {
    errorEl.textContent = "Choose a shape for both your Container and your Weapon.";
    return;
  }

  if (!isConnected(containerCells) || !isConnected(weaponCells)) {
    errorEl.textContent = "Item shapes must be a single connected block of cells.";
    return;
  }

  const placed = packItems([
    { type: "container", name: containerName, shape: normalizeShape(containerCells) },
    { type: "weapon", name: weaponName, shape: normalizeShape(weaponCells) },
  ]);

  if (!placed) {
    errorEl.textContent =
      "Those two items don't both fit in a 6×6 grid. Try smaller shapes.";
    return;
  }

  submitButton.disabled = true;

  const { data: sessionData } = await client.auth.getSession();
  if (!sessionData.session) {
    window.location.href = "login.html";
    return;
  }

  const inventory = placed.map((item) => ({
    id: crypto.randomUUID(),
    name: item.name,
    type: item.type,
    cells: item.shape,
    origin: item.origin,
    money: item.type === "container" ? 0 : undefined,
  }));

  const { data: inserted, error } = await client
    .from("characters")
    .insert({
      owner_id: sessionData.session.user.id,
      name,
      district,
      fortitude: stats.fortitude,
      prudence: stats.prudence,
      temperance: stats.temperance,
      justice: stats.justice,
      inventory,
      story,
    })
    .select()
    .single();

  if (error) {
    errorEl.textContent = "Could not save character: " + error.message;
    submitButton.disabled = false;
    return;
  }

  window.location.href = `character-sheet.html?id=${inserted.id}`;
});
