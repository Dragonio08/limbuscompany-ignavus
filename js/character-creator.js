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
  6: "Master",
  7: "Godlike",
};

const STAT_NAMES = ["fortitude", "prudence", "temperance", "justice"];
const stats = { fortitude: 1, prudence: 1, temperance: 1, justice: 1 };
const TOTAL_POINTS = 7;
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
        btn.disabled = pointsRemaining <= 0 || stats[stat] >= 5;
      } else {
        btn.disabled = stats[stat] <= 1;
      }
    });
}

document.querySelectorAll(".stat-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const stat = btn.dataset.stat;
    if (btn.dataset.action === "inc") {
      if (pointsRemaining > 0 && stats[stat] < 5) {
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
    renderAllSkills();
  });
});

STAT_NAMES.forEach(updateStatUI);

// ---- Skills (signature / proficient picks) ----

const DESCRIPTOR_CAP = 7;
const skillPicks = { signature: null, proficient: [] };

function skillValue(archetype, skillKey) {
  const base = stats[archetype];
  if (skillPicks.signature === skillKey) return base + 2;
  if (skillPicks.proficient.includes(skillKey)) return base + 1;
  return base;
}

function skillDescriptor(value) {
  return DESCRIPTORS[Math.min(value, DESCRIPTOR_CAP)];
}

function updateSkillPicksStatus() {
  const statusEl = document.getElementById("skill-picks-status");
  const sigLabel = skillPicks.signature
    ? findSkillByKey(skillPicks.signature).name
    : "none chosen";
  statusEl.textContent = `Signature: ${sigLabel} · Proficient: ${skillPicks.proficient.length}/2 chosen`;
}

function findSkillByKey(key) {
  for (const archetype of ARCHETYPES) {
    const found = SKILLS[archetype].find((s) => s.key === key);
    if (found) return found;
  }
  return null;
}

function setSignature(skillKey) {
  skillPicks.proficient = skillPicks.proficient.filter((k) => k !== skillKey);
  skillPicks.signature = skillPicks.signature === skillKey ? null : skillKey;
  renderAllSkills();
}

function toggleProficient(skillKey) {
  if (skillPicks.signature === skillKey) return;
  if (skillPicks.proficient.includes(skillKey)) {
    skillPicks.proficient = skillPicks.proficient.filter((k) => k !== skillKey);
  } else {
    if (skillPicks.proficient.length >= 2) return;
    skillPicks.proficient.push(skillKey);
  }
  renderAllSkills();
}

function renderSkillsForArchetype(archetype) {
  const container = document.getElementById(`skills-list-${archetype}`);
  container.innerHTML = "";

  SKILLS[archetype].forEach((skill) => {
    const value = skillValue(archetype, skill.key);
    const isSignature = skillPicks.signature === skill.key;
    const isProficient = skillPicks.proficient.includes(skill.key);

    const row = document.createElement("div");
    row.className = "skill-row";

    const info = document.createElement("div");
    info.className = "skill-info";

    const nameLine = document.createElement("div");
    nameLine.className = "skill-name-line";

    const nameSpan = document.createElement("span");
    nameSpan.textContent = skill.name;

    const valueSpan = document.createElement("span");
    valueSpan.className = "skill-value";
    valueSpan.textContent = `${value} · ${skillDescriptor(value)}`;

    nameLine.appendChild(nameSpan);
    nameLine.appendChild(valueSpan);

    const quoteLine = document.createElement("p");
    quoteLine.className = "skill-quote";
    quoteLine.style.color = `var(--stat-${archetype})`;
    quoteLine.textContent = skill.quote;

    const desc = document.createElement("p");
    desc.className = "skill-description";
    desc.textContent = skill.description;

    info.appendChild(nameLine);
    info.appendChild(quoteLine);
    info.appendChild(desc);

    const tags = document.createElement("div");
    tags.className = "skill-tags";

    const sigBtn = document.createElement("button");
    sigBtn.type = "button";
    sigBtn.className = "skill-tag-btn" + (isSignature ? " is-signature" : "");
    sigBtn.textContent = "Signature";
    sigBtn.disabled = isProficient;
    sigBtn.addEventListener("click", () => setSignature(skill.key));

    const profBtn = document.createElement("button");
    profBtn.type = "button";
    profBtn.className = "skill-tag-btn" + (isProficient ? " is-proficient" : "");
    profBtn.textContent = "Proficient";
    profBtn.disabled =
      isSignature || (!isProficient && skillPicks.proficient.length >= 2);
    profBtn.addEventListener("click", () => toggleProficient(skill.key));

    tags.appendChild(sigBtn);
    tags.appendChild(profBtn);

    row.appendChild(info);
    row.appendChild(tags);
    container.appendChild(row);
  });
}

// New characters start at level 1, at full HP and SP.
function updateVitalsPreview() {
  const weathering = skillValue("fortitude", "weathering");
  const willToPower = skillValue("temperance", "will_to_power");
  const adaptability = skillValue("fortitude", "adaptability");

  const maxHp = calcMaxHp(weathering, 1);
  const maxSp = calcMaxSp(willToPower, 1);

  document.getElementById("vitals-hp-text").textContent = `${maxHp} / ${maxHp}`;
  document.getElementById("vitals-sp-text").textContent = `${maxSp} / ${maxSp}`;
  document.getElementById("vitals-speed").textContent = calcSpeed(adaptability);
}

function renderAllSkills() {
  ARCHETYPES.forEach(renderSkillsForArchetype);
  updateSkillPicksStatus();
  updateVitalsPreview();
}

renderAllSkills();

// ---- Shape picker grids ----

const MAX_WEAPON_TILES = 3;

// options.maxCells: refuse to select more cells than this.
// options.onChange: called after every change to the selection.
function buildShapeGrid(gridEl, selectedSet, options = {}) {
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
          if (options.maxCells && selectedSet.size >= options.maxCells) {
            if (options.onChange) options.onChange(true);
            return;
          }
          selectedSet.add(key);
          cell.classList.add("selected");
        }
        if (options.onChange) options.onChange(false);
      });
      gridEl.appendChild(cell);
    }
  }
}

const containerSelected = new Set();
const weaponSelected = new Set();

buildShapeGrid(document.getElementById("container-shape"), containerSelected);
function updateWeaponTileCount(hitLimit) {
  const el = document.getElementById("weapon-tile-count");
  el.textContent =
    `Tiles: ${weaponSelected.size} / ${MAX_WEAPON_TILES}` +
    (hitLimit
      ? ` — a starting weapon can be at most ${MAX_WEAPON_TILES} tiles.`
      : "");
}

buildShapeGrid(document.getElementById("weapon-shape"), weaponSelected, {
  maxCells: MAX_WEAPON_TILES,
  onChange: updateWeaponTileCount,
});
updateWeaponTileCount(false);

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

// ---- Signature Color availability ----

const colorInput = document.getElementById("char-color");
const colorStatusEl = document.getElementById("color-status");
let colorCheckToken = 0;
let colorIsAvailable = true;

async function checkColorAvailability() {
  const myToken = ++colorCheckToken;
  const color = colorInput.value;
  colorStatusEl.textContent = "Checking…";

  const { data, error } = await client
    .from("characters")
    .select("id")
    .eq("signature_color", color)
    .limit(1);

  if (myToken !== colorCheckToken) return; // a newer check superseded this one

  if (error) {
    colorStatusEl.textContent = "";
    colorIsAvailable = true; // don't block submission over a failed check
    return;
  }

  if (data && data.length > 0) {
    colorStatusEl.textContent = "Taken by another character.";
    colorStatusEl.classList.add("is-error");
    colorIsAvailable = false;
  } else {
    colorStatusEl.textContent = "Available.";
    colorStatusEl.classList.remove("is-error");
    colorIsAvailable = true;
  }
}

colorInput.addEventListener("input", () => {
  colorStatusEl.classList.remove("is-error");
  colorStatusEl.textContent = "";
});
colorInput.addEventListener("change", checkColorAvailability);
checkColorAvailability();

const form = document.getElementById("creator-form");
const errorEl = document.getElementById("creator-error");
const submitButton = document.getElementById("creator-submit");

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  errorEl.textContent = "";

  const name = document.getElementById("char-name").value.trim();
  const quote = document.getElementById("char-quote").value.trim();
  const district = document.getElementById("char-district").value;
  const signatureColor = colorInput.value;
  const containerName = document.getElementById("container-name").value.trim();
  const weaponName = document.getElementById("weapon-name").value.trim();
  const story = document.getElementById("char-story").value.trim();

  if (!name || !district) {
    errorEl.textContent = "Fill in your name and district.";
    return;
  }

  if (!colorIsAvailable) {
    errorEl.textContent = "Pick a Signature Color that isn't already taken.";
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

  if (weaponCells.length > MAX_WEAPON_TILES) {
    errorEl.textContent = `Your starting weapon can be at most ${MAX_WEAPON_TILES} tiles.`;
    return;
  }

  if (!isConnected(containerCells) || !isConnected(weaponCells)) {
    errorEl.textContent = "Item shapes must be a single connected block of cells.";
    return;
  }

  if (!skillPicks.signature) {
    errorEl.textContent = "Choose 1 signature skill.";
    return;
  }

  if (skillPicks.proficient.length !== 2) {
    errorEl.textContent = "Choose exactly 2 proficient skills.";
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
    description: "",
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
      skill_picks: skillPicks,
      inventory,
      story,
      quote,
      signature_color: signatureColor,
    })
    .select()
    .single();

  if (error) {
    errorEl.textContent =
      error.code === "23505"
        ? "That Signature Color was just taken by another character — pick a different one."
        : "Could not save character: " + error.message;
    submitButton.disabled = false;
    return;
  }

  window.location.href = `character-sheet.html?id=${inserted.id}`;
});
