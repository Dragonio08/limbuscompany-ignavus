// Weapon skills ("cards"): point rules, card rendering, and the skill editor.
// Loaded before character-sheet.js on the sheet page.

const MAX_SKILLS_PER_WEAPON = 9;
const MAX_WILL_COST = 3;
const DAMAGE_TYPES = ["red", "white", "black", "pale"];
const NEGATIVE_STATUSES = ["Burn", "Bleed", "Rupture", "Tremor"];
const POSITIVE_STATUSES = ["Charge", "Poise"];

// addCost = points it costs just to put the attribute on a card.
//           A freshly added attribute does 0 until you spend more on it.
// perUnit = extra points spent on the attribute for 1 "n", up to softCap
//           points spent; beyond that, perUnitAfterCap points for 1 "n".
// tooltip = explanation shown when hovering the attribute's name.
const ATTRIBUTE_RULES = {
  deal: {
    label: "Deal damage",
    addCost: 5,
    perUnit: 1,
    softCap: 15,
    perUnitAfterCap: 2,
    tooltip:
      "1 point = 1 damage, up to 15 points spent. Past 15, every 2 extra points only adds 1 more damage.",
  },
  block: {
    label: "Block",
    addCost: 6,
    perUnit: 1,
    tooltip: "1 point = 1 Block.",
  },
  inflict: {
    label: "Inflict status",
    addCost: 5,
    perUnit: 2,
    softCap: 13,
    perUnitAfterCap: 3,
    statuses: NEGATIVE_STATUSES,
    tooltip:
      "Every 2 points = 1 stack, up to 13 points spent. Past 13, every 3 extra points only adds 1 more stack.",
  },
  gain: {
    label: "Gain status",
    addCost: 6,
    perUnit: 2,
    softCap: 13,
    perUnitAfterCap: 3,
    statuses: POSITIVE_STATUSES,
    tooltip:
      "Every 2 points = 1 stack, up to 13 points spent. Past 13, every 3 extra points only adds 1 more stack.",
  },
  faint: {
    label: "Gain Faint Feeling",
    addCost: 10,
    perUnit: 5,
    tooltip: "Every 5 points = 1 Faint Feeling.",
  },
};

function capitalizeWord(text) {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "";
}

// ---- Point rules ----

// 10 points at Will cost 0, 20 at 1, 30 at 2, 40 at 3.
function skillBasePoints(cost) {
  return 10 + 10 * cost;
}

// Every tile the weapon fills in the inventory gives 1 extra point
// for every Will the card costs.
function skillTotalPoints(cost, weaponTiles) {
  return skillBasePoints(cost) + weaponTiles * cost;
}

function attributeAmount(attr) {
  if (attr.direct) return attr.amount || 0;

  const rule = ATTRIBUTE_RULES[attr.type];
  const points = attr.points || 0;

  if (!rule.softCap || points <= rule.softCap) {
    return Math.floor(points / rule.perUnit);
  }

  const atCap = Math.floor(rule.softCap / rule.perUnit);
  const beyond = Math.floor((points - rule.softCap) / rule.perUnitAfterCap);
  return atCap + beyond;
}

function skillDealsDamage(skill) {
  return skill.attributes.some((attr) => attr.type === "deal");
}

// Red is free (every damaging card is Red by default). Pale costs half of
// the card's total points, rounded down.
function damageTypeCost(type, totalPoints) {
  if (type === "white") return 6;
  if (type === "black") return 13;
  if (type === "pale") return Math.floor(totalPoints / 2);
  return 0;
}

function skillPointsSpent(skill, totalPoints) {
  const onAttributes = skill.attributes.reduce(
    (sum, attr) => sum + ATTRIBUTE_RULES[attr.type].addCost + attr.points,
    0
  );
  const onType = skillDealsDamage(skill)
    ? damageTypeCost(skill.damageType, totalPoints)
    : 0;
  return onAttributes + onType;
}

function describeAttribute(attr, damageType) {
  const n = attributeAmount(attr);
  switch (attr.type) {
    case "deal":
      return `Deal ${n} ${capitalizeWord(damageType || "red")} damage`;
    case "block":
      return `Block ${n} damage`;
    case "inflict":
      return `Inflict ${n} ${attr.status}`;
    case "gain":
      return `Gain ${n} ${attr.status}`;
    case "faint":
      return `Gain ${n} Faint Feeling`;
    default:
      return "";
  }
}

// Returns a list of problems (empty = valid) plus the point totals.
function validateSkill(skill, weaponTiles) {
  const errors = [];

  if (!skill.name || !skill.name.trim()) {
    errors.push("Give the skill a name.");
  }

  if (!Number.isInteger(skill.cost) || skill.cost < 0 || skill.cost > MAX_WILL_COST) {
    errors.push(`Will cost must be between 0 and ${MAX_WILL_COST}.`);
  }

  if (!DAMAGE_TYPES.includes(skill.damageType)) {
    errors.push("Pick a valid damage type.");
  }

  skill.attributes.forEach((attr) => {
    const rule = ATTRIBUTE_RULES[attr.type];
    if (!rule) {
      errors.push("Unknown attribute.");
      return;
    }
    if (!Number.isInteger(attr.points) || attr.points < 0) {
      errors.push(`${rule.label}: extra points can't be negative.`);
    }
    if (rule.statuses && !rule.statuses.includes(attr.status)) {
      errors.push(`${rule.label}: pick a status.`);
    }
  });

  const total = skillTotalPoints(skill.cost, weaponTiles);
  const spent = skillPointsSpent(skill, total);
  if (spent > total) {
    errors.push(`This skill uses ${spent} points but only has ${total}.`);
  }

  return { errors, total, spent };
}

// Skills saved by the first version counted the add cost inside `points`.
// Convert them so the total points spent stays the same.
function normalizeSkill(skill) {
  if (skill.rules === 2) return skill;
  return {
    ...skill,
    rules: 2,
    attributes: (skill.attributes || []).map((attr) => {
      const rule = ATTRIBUTE_RULES[attr.type];
      return { ...attr, points: Math.max(0, attr.points - (rule ? rule.addCost : 0)) };
    }),
  };
}

// Card images are stored as small JPEG data URLs; only accept that shape.
function isSafeCardImage(value) {
  return (
    typeof value === "string" &&
    /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(value)
  );
}

function buildImageIcon() {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("class", "ruina-card-art-icon");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.5");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");

  const frame = document.createElementNS(ns, "rect");
  frame.setAttribute("x", "3");
  frame.setAttribute("y", "4");
  frame.setAttribute("width", "18");
  frame.setAttribute("height", "16");
  frame.setAttribute("rx", "1");

  const sun = document.createElementNS(ns, "circle");
  sun.setAttribute("cx", "9");
  sun.setAttribute("cy", "10");
  sun.setAttribute("r", "1.6");

  const hills = document.createElementNS(ns, "path");
  hills.setAttribute("d", "M3 17l5-5 4 4 3-3 6 6");

  svg.appendChild(frame);
  svg.appendChild(sun);
  svg.appendChild(hills);
  return svg;
}

// Opens the file picker, shrinks the chosen image to a small JPEG and
// resolves with its data URL (or null if nothing usable was chosen).
function pickCardImage() {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";

    input.addEventListener("change", () => {
      const file = input.files && input.files[0];
      if (!file || !file.type.startsWith("image/")) {
        resolve(null);
        return;
      }

      const reader = new FileReader();
      reader.onerror = () => resolve(null);
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => resolve(null);
        img.onload = () => {
          const width = 280;
          const height = 154;
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          ctx.fillStyle = "#0e0c0b";
          ctx.fillRect(0, 0, width, height);

          // "cover" crop: fill the frame, cutting off the overflow.
          const scale = Math.max(width / img.width, height / img.height);
          const drawW = img.width * scale;
          const drawH = img.height * scale;
          ctx.drawImage(img, (width - drawW) / 2, (height - drawH) / 2, drawW, drawH);

          resolve(canvas.toDataURL("image/jpeg", 0.75));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });

    input.click();
  });
}

// ---- Card rendering (Library of Ruina style) ----

// options.onArtClick (optional): makes the picture area clickable so a
// custom image can be uploaded.
function buildRuinaCard(skill, options = {}) {
  const dealsDamage = skillDealsDamage(skill);
  const typeKey = dealsDamage ? skill.damageType : "none";

  const card = document.createElement("div");
  card.className = `ruina-card ruina-card-${typeKey}`;

  const cost = document.createElement("div");
  cost.className = "ruina-card-cost";
  cost.textContent = skill.cost;

  const name = document.createElement("p");
  name.className = "ruina-card-name display";
  name.textContent = skill.name || "Unnamed Skill";

  const art = document.createElement("div");
  art.className = "ruina-card-art";

  if (isSafeCardImage(skill.image)) {
    art.classList.add("has-image");
    art.style.backgroundImage = `url("${skill.image}")`;
  } else {
    art.appendChild(buildImageIcon());
  }

  if (options.onArtClick) {
    art.classList.add("is-uploadable");
    art.title = "Click to upload an image";
    art.tabIndex = 0;
    art.setAttribute("role", "button");
    art.setAttribute("aria-label", "Upload an image for this skill");
    art.addEventListener("click", (event) => {
      event.stopPropagation();
      options.onArtClick();
    });
    art.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        event.stopPropagation();
        options.onArtClick();
      }
    });
  }

  const effects = document.createElement("div");
  effects.className = "ruina-card-effects";

  if (skill.attributes.length === 0) {
    const none = document.createElement("p");
    none.textContent = "No effects.";
    effects.appendChild(none);
  } else {
    skill.attributes.forEach((attr) => {
      const line = document.createElement("p");
      if (attr.type === "deal") line.className = "is-damage";
      line.textContent = describeAttribute(attr, skill.damageType);
      effects.appendChild(line);
    });
  }

  card.appendChild(cost);
  card.appendChild(name);
  card.appendChild(art);
  card.appendChild(effects);
  return card;
}

// ---- Skill editor ----
// Renders a form (with a live card preview) into `container`.
// Calls onSave(skill), onCancel(), or onDelete(id) — the caller handles storage.

function openSkillEditor({ container, skill, weaponTiles, onSave, onCancel, onDelete }) {
  const isNew = !skill;
  const draft = skill
    ? JSON.parse(JSON.stringify(normalizeSkill(skill)))
    : {
        id: crypto.randomUUID(),
        rules: 2,
        name: "",
        cost: 0,
        damageType: "red",
        attributes: [],
      };

  container.innerHTML = "";
  container.style.display = "block";

  const title = document.createElement("h3");
  title.className = "skill-editor-title display";
  title.textContent = isNew ? "New Skill" : "Edit Skill";

  const body = document.createElement("div");
  body.className = "skill-editor-body";

  const form = document.createElement("div");
  form.className = "skill-editor-form";

  const previewWrap = document.createElement("div");
  previewWrap.className = "skill-editor-preview";
  const previewHolder = document.createElement("div");
  const previewHint = document.createElement("p");
  previewHint.className = "skill-editor-hint";
  previewHint.textContent = "Click the picture area to upload an image.";
  const removeImageBtn = document.createElement("button");
  removeImageBtn.type = "button";
  removeImageBtn.className = "small-btn";
  removeImageBtn.textContent = "Remove image";
  removeImageBtn.addEventListener("click", () => {
    delete draft.image;
    refresh();
  });
  previewWrap.appendChild(previewHolder);
  previewWrap.appendChild(previewHint);
  previewWrap.appendChild(removeImageBtn);

  // Name
  const nameField = document.createElement("div");
  nameField.className = "creator-field";
  const nameLabel = document.createElement("label");
  nameLabel.textContent = "Name";
  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.maxLength = 40;
  nameInput.value = draft.name;
  nameInput.addEventListener("input", () => {
    draft.name = nameInput.value;
    refresh();
  });
  nameField.appendChild(nameLabel);
  nameField.appendChild(nameInput);

  // Will cost
  const costField = document.createElement("div");
  costField.className = "creator-field";
  const costLabel = document.createElement("label");
  costLabel.textContent = "Will Cost";
  const costSelect = document.createElement("select");
  for (let c = 0; c <= MAX_WILL_COST; c++) {
    const opt = document.createElement("option");
    opt.value = c;
    opt.textContent = c;
    costSelect.appendChild(opt);
  }
  costSelect.value = draft.cost;
  costSelect.addEventListener("change", () => {
    draft.cost = parseInt(costSelect.value, 10);
    refresh();
  });
  costField.appendChild(costLabel);
  costField.appendChild(costSelect);

  // Points summary
  const pointsEl = document.createElement("p");
  pointsEl.className = "skill-points display";
  const breakdownEl = document.createElement("p");
  breakdownEl.className = "skill-points-breakdown";

  // Damage type
  const typeField = document.createElement("div");
  typeField.className = "creator-field";
  const typeLabel = document.createElement("label");
  typeLabel.textContent = "Damage Type";
  const typeSelect = document.createElement("select");
  DAMAGE_TYPES.forEach((type) => {
    const opt = document.createElement("option");
    opt.value = type;
    typeSelect.appendChild(opt);
  });
  typeSelect.addEventListener("change", () => {
    draft.damageType = typeSelect.value;
    refresh();
  });
  const typeNote = document.createElement("p");
  typeNote.className = "skill-points-breakdown";
  typeField.appendChild(typeLabel);
  typeField.appendChild(typeSelect);
  typeField.appendChild(typeNote);

  // Attributes
  const attrTitle = document.createElement("p");
  attrTitle.className = "skill-attr-title display";
  attrTitle.textContent = "Attributes";
  const attrList = document.createElement("div");
  attrList.className = "attr-list";

  const addRow = document.createElement("div");
  addRow.className = "skill-add-row";
  const addSelect = document.createElement("select");
  Object.entries(ATTRIBUTE_RULES).forEach(([key, rule]) => {
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = `${rule.label} (costs ${rule.addCost} pts)`;
    addSelect.appendChild(opt);
  });
  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "small-btn";
  addBtn.textContent = "+ Add attribute";
  addBtn.addEventListener("click", () => {
    const rule = ATTRIBUTE_RULES[addSelect.value];
    draft.attributes.push({
      type: addSelect.value,
      status: rule.statuses ? rule.statuses[0] : undefined,
      points: 0,
    });
    renderAttrRows();
  });
  addRow.appendChild(addSelect);
  addRow.appendChild(addBtn);

  const errorEl = document.createElement("p");
  errorEl.className = "skill-editor-error";

  const buttonRow = document.createElement("div");
  buttonRow.className = "save-row";

  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "small-btn";
  saveBtn.textContent = "Save Skill";
  saveBtn.addEventListener("click", () => {
    draft.name = draft.name.trim();
    const { errors } = validateSkill(draft, weaponTiles);
    if (errors.length) {
      errorEl.textContent = errors.join(" ");
      return;
    }
    onSave(draft);
  });

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "small-btn";
  cancelBtn.textContent = "Cancel";
  cancelBtn.addEventListener("click", () => onCancel());

  buttonRow.appendChild(saveBtn);
  buttonRow.appendChild(cancelBtn);

  if (!isNew) {
    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "small-btn";
    deleteBtn.textContent = "Delete";
    deleteBtn.addEventListener("click", () => {
      if (window.confirm(`Delete the skill "${draft.name || "Unnamed Skill"}"?`)) {
        onDelete(draft.id);
      }
    });
    buttonRow.appendChild(deleteBtn);
  }

  form.appendChild(nameField);
  form.appendChild(costField);
  form.appendChild(pointsEl);
  form.appendChild(breakdownEl);
  form.appendChild(typeField);
  form.appendChild(attrTitle);
  form.appendChild(attrList);
  form.appendChild(addRow);
  form.appendChild(errorEl);
  form.appendChild(buttonRow);

  body.appendChild(form);
  body.appendChild(previewWrap);
  container.appendChild(title);
  container.appendChild(body);

  let attrRows = []; // { attr, resultEl } for live text updates

  function renderAttrRows() {
    attrList.innerHTML = "";
    attrRows = [];

    draft.attributes.forEach((attr, index) => {
      const rule = ATTRIBUTE_RULES[attr.type];
      const row = document.createElement("div");
      row.className = "attr-row";

      const label = document.createElement("span");
      label.className = "attr-label";
      label.textContent = rule.label;
      if (rule.tooltip) label.title = rule.tooltip;
      row.appendChild(label);

      if (rule.statuses) {
        const statusSelect = document.createElement("select");
        rule.statuses.forEach((status) => {
          const opt = document.createElement("option");
          opt.value = status;
          opt.textContent = status;
          statusSelect.appendChild(opt);
        });
        statusSelect.value = attr.status;
        statusSelect.addEventListener("change", () => {
          attr.status = statusSelect.value;
          refresh();
        });
        row.appendChild(statusSelect);
      }

      const pointsInput = document.createElement("input");
      pointsInput.type = "number";
      pointsInput.min = 0;
      pointsInput.step = 1;
      pointsInput.value = attr.points;
      pointsInput.setAttribute("aria-label", `${rule.label} points`);
      pointsInput.addEventListener("input", () => {
        const parsed = parseInt(pointsInput.value, 10);
        attr.points = Number.isNaN(parsed) ? 0 : parsed;
        refresh();
      });
      row.appendChild(pointsInput);

      const resultEl = document.createElement("span");
      resultEl.className = "attr-result";
      row.appendChild(resultEl);

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "small-btn";
      removeBtn.textContent = "✕";
      removeBtn.setAttribute("aria-label", `Remove ${rule.label}`);
      removeBtn.addEventListener("click", () => {
        draft.attributes.splice(index, 1);
        renderAttrRows();
      });
      row.appendChild(removeBtn);

      attrList.appendChild(row);
      attrRows.push({ attr, resultEl });
    });

    refresh();
  }

  // Recomputes everything that depends on the draft, without rebuilding
  // the input rows (so typing never loses focus).
  function refresh() {
    const total = skillTotalPoints(draft.cost, weaponTiles);
    const spent = skillPointsSpent(draft, total);
    const dealsDamage = skillDealsDamage(draft);

    pointsEl.textContent = `Points: ${spent} / ${total}`;
    pointsEl.classList.toggle("is-over", spent > total);
    breakdownEl.textContent =
      `Base ${skillBasePoints(draft.cost)} + weapon bonus ` +
      `${weaponTiles * draft.cost} (${weaponTiles} tiles × ${draft.cost} Will)`;

    Array.from(typeSelect.options).forEach((opt) => {
      const cost = damageTypeCost(opt.value, total);
      opt.textContent = `${capitalizeWord(opt.value)} (${cost === 0 ? "free" : cost + " pts"})`;
    });
    typeSelect.value = draft.damageType;
    typeSelect.disabled = !dealsDamage;
    typeNote.textContent = dealsDamage
      ? ""
      : "Add a Deal attribute to give this skill a damage type.";

    attrRows.forEach(({ attr, resultEl }) => {
      resultEl.textContent = "→ " + describeAttribute(attr, draft.damageType);
    });

    previewHolder.innerHTML = "";
    previewHolder.appendChild(
      buildRuinaCard(draft, {
        onArtClick: async () => {
          const image = await pickCardImage();
          if (image) {
            draft.image = image;
            refresh();
          }
        },
      })
    );
    removeImageBtn.style.display = draft.image ? "inline-block" : "none";
  }

  renderAttrRows();
}

// ---- E.G.O ----
// Zayin is the starting E.G.O every character builds themselves, with the
// same point-buy attribute system as weapon skills (fixed 50-point budget,
// fixed 3 Faint Feeling cost). Teth, He, Waw and Aleph are made freely by
// the Dungeon Master — any attributes, any amounts, any Faint Feeling cost.

const EGO_TYPES = ["zayin", "teth", "he", "waw", "aleph"];
const DM_EGO_TYPES = ["teth", "he", "waw", "aleph"];
const EGO_TYPE_LABELS = {
  zayin: "Zayin",
  teth: "Teth",
  he: "He",
  waw: "Waw",
  aleph: "Aleph",
};
const ZAYIN_BUDGET = 50;
const ZAYIN_FAINT_COST = 3;

function addEgoTypeBadge(card, egoType) {
  const badge = document.createElement("div");
  badge.className = `ego-type-badge ego-type-${egoType || "zayin"}`;
  badge.textContent = EGO_TYPE_LABELS[egoType] || egoType;
  card.appendChild(badge);
}

// Renders an E.G.O using the same card look as a weapon skill: the
// hexagon shows Faint Feeling cost instead of Will cost, plus a type badge.
function buildEgoCard(ego, options = {}) {
  const card = buildRuinaCard(
    {
      name: ego.name,
      cost: ego.faintCost,
      damageType: ego.damageType,
      attributes: ego.attributes,
      image: ego.image,
    },
    options
  );
  addEgoTypeBadge(card, ego.egoType);
  card.classList.add(`ego-card-${ego.egoType || "zayin"}`);
  return card;
}

function validateEgoName(ego) {
  return ego.name && ego.name.trim() ? [] : ["Give the E.G.O a name."];
}

// ---- Zayin editor (player, fixed 50-point budget) ----

function openZayinEgoEditor({ container, ego, onSave, onCancel, onDelete }) {
  const isNew = !ego;
  const draft = ego
    ? JSON.parse(JSON.stringify(ego))
    : {
        id: crypto.randomUUID(),
        egoType: "zayin",
        name: "",
        faintCost: ZAYIN_FAINT_COST,
        damageType: "red",
        attributes: [],
      };
  draft.egoType = "zayin";
  draft.faintCost = ZAYIN_FAINT_COST;

  container.innerHTML = "";
  container.style.display = "block";

  const title = document.createElement("h3");
  title.className = "skill-editor-title display";
  title.textContent = isNew ? "Create Your Zayin E.G.O" : "Edit Zayin E.G.O";

  const body = document.createElement("div");
  body.className = "skill-editor-body";
  const form = document.createElement("div");
  form.className = "skill-editor-form";
  const previewWrap = document.createElement("div");
  previewWrap.className = "skill-editor-preview";
  const previewHolder = document.createElement("div");
  const removeImageBtn = document.createElement("button");
  removeImageBtn.type = "button";
  removeImageBtn.className = "small-btn";
  removeImageBtn.textContent = "Remove image";
  removeImageBtn.addEventListener("click", () => {
    delete draft.image;
    refresh();
  });
  previewWrap.appendChild(previewHolder);
  previewWrap.appendChild(removeImageBtn);

  const meta = document.createElement("p");
  meta.className = "skill-points-breakdown";
  meta.textContent = `Type: Zayin · Faint Feeling cost: ${ZAYIN_FAINT_COST} (fixed)`;

  const nameField = document.createElement("div");
  nameField.className = "creator-field";
  const nameLabel = document.createElement("label");
  nameLabel.textContent = "Name";
  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.maxLength = 40;
  nameInput.value = draft.name;
  nameInput.addEventListener("input", () => {
    draft.name = nameInput.value;
    refresh();
  });
  nameField.appendChild(nameLabel);
  nameField.appendChild(nameInput);

  const pointsEl = document.createElement("p");
  pointsEl.className = "skill-points display";

  const typeField = document.createElement("div");
  typeField.className = "creator-field";
  const typeLabel = document.createElement("label");
  typeLabel.textContent = "Damage Type";
  const typeSelect = document.createElement("select");
  DAMAGE_TYPES.forEach((type) => {
    const opt = document.createElement("option");
    opt.value = type;
    typeSelect.appendChild(opt);
  });
  typeSelect.addEventListener("change", () => {
    draft.damageType = typeSelect.value;
    refresh();
  });
  const typeNote = document.createElement("p");
  typeNote.className = "skill-points-breakdown";
  typeField.appendChild(typeLabel);
  typeField.appendChild(typeSelect);
  typeField.appendChild(typeNote);

  const attrTitle = document.createElement("p");
  attrTitle.className = "skill-attr-title display";
  attrTitle.textContent = "Attributes";
  const attrList = document.createElement("div");
  attrList.className = "attr-list";

  const addRow = document.createElement("div");
  addRow.className = "skill-add-row";
  const addSelect = document.createElement("select");
  Object.entries(ATTRIBUTE_RULES).forEach(([key, rule]) => {
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = `${rule.label} (costs ${rule.addCost} pts)`;
    addSelect.appendChild(opt);
  });
  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "small-btn";
  addBtn.textContent = "+ Add attribute";
  addBtn.addEventListener("click", () => {
    const rule = ATTRIBUTE_RULES[addSelect.value];
    draft.attributes.push({
      type: addSelect.value,
      status: rule.statuses ? rule.statuses[0] : undefined,
      points: 0,
    });
    renderAttrRows();
  });
  addRow.appendChild(addSelect);
  addRow.appendChild(addBtn);

  const errorEl = document.createElement("p");
  errorEl.className = "skill-editor-error";

  const buttonRow = document.createElement("div");
  buttonRow.className = "save-row";
  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "small-btn";
  saveBtn.textContent = "Save E.G.O";
  saveBtn.addEventListener("click", () => {
    draft.name = draft.name.trim();
    const errors = validateEgoName(draft);
    const spent = skillPointsSpent(draft, ZAYIN_BUDGET);
    if (spent > ZAYIN_BUDGET) {
      errors.push(`This E.G.O uses ${spent} points but only has ${ZAYIN_BUDGET}.`);
    }
    if (errors.length) {
      errorEl.textContent = errors.join(" ");
      return;
    }
    onSave(draft);
  });
  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "small-btn";
  cancelBtn.textContent = "Cancel";
  cancelBtn.addEventListener("click", () => onCancel());
  buttonRow.appendChild(saveBtn);
  buttonRow.appendChild(cancelBtn);
  if (!isNew) {
    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "small-btn";
    deleteBtn.textContent = "Delete";
    deleteBtn.addEventListener("click", () => {
      if (window.confirm(`Delete the E.G.O "${draft.name || "Unnamed"}"?`)) {
        onDelete(draft.id);
      }
    });
    buttonRow.appendChild(deleteBtn);
  }

  form.appendChild(meta);
  form.appendChild(nameField);
  form.appendChild(pointsEl);
  form.appendChild(typeField);
  form.appendChild(attrTitle);
  form.appendChild(attrList);
  form.appendChild(addRow);
  form.appendChild(errorEl);
  form.appendChild(buttonRow);
  body.appendChild(form);
  body.appendChild(previewWrap);
  container.appendChild(title);
  container.appendChild(body);

  let attrRows = [];

  function renderAttrRows() {
    attrList.innerHTML = "";
    attrRows = [];
    draft.attributes.forEach((attr, index) => {
      const rule = ATTRIBUTE_RULES[attr.type];
      const row = document.createElement("div");
      row.className = "attr-row";
      const label = document.createElement("span");
      label.className = "attr-label";
      label.textContent = rule.label;
      if (rule.tooltip) label.title = rule.tooltip;
      row.appendChild(label);
      if (rule.statuses) {
        const statusSelect = document.createElement("select");
        rule.statuses.forEach((status) => {
          const opt = document.createElement("option");
          opt.value = status;
          opt.textContent = status;
          statusSelect.appendChild(opt);
        });
        statusSelect.value = attr.status;
        statusSelect.addEventListener("change", () => {
          attr.status = statusSelect.value;
          refresh();
        });
        row.appendChild(statusSelect);
      }
      const pointsInput = document.createElement("input");
      pointsInput.type = "number";
      pointsInput.min = 0;
      pointsInput.step = 1;
      pointsInput.value = attr.points;
      pointsInput.setAttribute("aria-label", `${rule.label} extra points`);
      pointsInput.addEventListener("input", () => {
        const parsed = parseInt(pointsInput.value, 10);
        attr.points = Number.isNaN(parsed) ? 0 : parsed;
        refresh();
      });
      row.appendChild(pointsInput);
      const resultEl = document.createElement("span");
      resultEl.className = "attr-result";
      row.appendChild(resultEl);
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "small-btn";
      removeBtn.textContent = "✕";
      removeBtn.addEventListener("click", () => {
        draft.attributes.splice(index, 1);
        renderAttrRows();
      });
      row.appendChild(removeBtn);
      attrList.appendChild(row);
      attrRows.push({ attr, resultEl });
    });
    refresh();
  }

  function refresh() {
    const spent = skillPointsSpent(draft, ZAYIN_BUDGET);
    const dealsDamage = skillDealsDamage(draft);

    pointsEl.textContent = `Points: ${spent} / ${ZAYIN_BUDGET}`;
    pointsEl.classList.toggle("is-over", spent > ZAYIN_BUDGET);

    Array.from(typeSelect.options).forEach((opt) => {
      const cost = damageTypeCost(opt.value, ZAYIN_BUDGET);
      opt.textContent = `${capitalizeWord(opt.value)} (${cost === 0 ? "free" : cost + " pts"})`;
    });
    typeSelect.value = draft.damageType;
    typeSelect.disabled = !dealsDamage;
    typeNote.textContent = dealsDamage
      ? ""
      : "Add a Deal attribute to give this E.G.O a damage type.";

    attrRows.forEach(({ attr, resultEl }) => {
      resultEl.textContent = "→ " + describeAttribute(attr, draft.damageType);
    });

    previewHolder.innerHTML = "";
    previewHolder.appendChild(
      buildEgoCard(draft, {
        onArtClick: async () => {
          const image = await pickCardImage();
          if (image) {
            draft.image = image;
            refresh();
          }
        },
      })
    );
    removeImageBtn.style.display = draft.image ? "inline-block" : "none";
  }

  renderAttrRows();
}

// ---- DM editor (Teth / He / Waw / Aleph, fully free-form) ----

function openDmEgoEditor({ container, ego, onSave, onCancel, onDelete }) {
  const isNew = !ego;
  const draft = ego
    ? JSON.parse(JSON.stringify(ego))
    : {
        id: crypto.randomUUID(),
        egoType: "teth",
        name: "",
        faintCost: 0,
        damageType: "red",
        attributes: [],
      };
  if (!DM_EGO_TYPES.includes(draft.egoType)) draft.egoType = "teth";

  container.innerHTML = "";
  container.style.display = "block";

  const title = document.createElement("h3");
  title.className = "skill-editor-title display";
  title.textContent = isNew ? "Create E.G.O (Dungeon Master)" : "Edit E.G.O";

  const body = document.createElement("div");
  body.className = "skill-editor-body";
  const form = document.createElement("div");
  form.className = "skill-editor-form";
  const previewWrap = document.createElement("div");
  previewWrap.className = "skill-editor-preview";
  const previewHolder = document.createElement("div");
  const removeImageBtn = document.createElement("button");
  removeImageBtn.type = "button";
  removeImageBtn.className = "small-btn";
  removeImageBtn.textContent = "Remove image";
  removeImageBtn.addEventListener("click", () => {
    delete draft.image;
    refresh();
  });
  previewWrap.appendChild(previewHolder);
  previewWrap.appendChild(removeImageBtn);

  const note = document.createElement("p");
  note.className = "skill-points-breakdown";
  note.textContent = "As the Dungeon Master, add any attributes at any amount, freely.";

  const nameField = document.createElement("div");
  nameField.className = "creator-field";
  const nameLabel = document.createElement("label");
  nameLabel.textContent = "Name";
  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.maxLength = 40;
  nameInput.value = draft.name;
  nameInput.addEventListener("input", () => {
    draft.name = nameInput.value;
    refresh();
  });
  nameField.appendChild(nameLabel);
  nameField.appendChild(nameInput);

  const typeAndCostField = document.createElement("div");
  typeAndCostField.className = "creator-field";
  const typeAndCostRow = document.createElement("div");
  typeAndCostRow.className = "skill-add-row";

  const egoTypeSelect = document.createElement("select");
  DM_EGO_TYPES.forEach((type) => {
    const opt = document.createElement("option");
    opt.value = type;
    opt.textContent = EGO_TYPE_LABELS[type];
    egoTypeSelect.appendChild(opt);
  });
  egoTypeSelect.value = draft.egoType;
  egoTypeSelect.addEventListener("change", () => {
    draft.egoType = egoTypeSelect.value;
    refresh();
  });

  const faintLabel = document.createElement("span");
  faintLabel.className = "attr-label";
  faintLabel.textContent = "Faint Feeling cost";
  const faintInput = document.createElement("input");
  faintInput.type = "number";
  faintInput.min = 0;
  faintInput.step = 1;
  faintInput.value = draft.faintCost;
  faintInput.addEventListener("input", () => {
    const parsed = parseInt(faintInput.value, 10);
    draft.faintCost = Number.isNaN(parsed) ? 0 : parsed;
    refresh();
  });

  typeAndCostRow.appendChild(egoTypeSelect);
  typeAndCostRow.appendChild(faintLabel);
  typeAndCostRow.appendChild(faintInput);
  typeAndCostField.appendChild(typeAndCostRow);

  const typeField = document.createElement("div");
  typeField.className = "creator-field";
  const damageLabel = document.createElement("label");
  damageLabel.textContent = "Damage Type";
  const typeSelect = document.createElement("select");
  DAMAGE_TYPES.forEach((type) => {
    const opt = document.createElement("option");
    opt.value = type;
    opt.textContent = capitalizeWord(type);
    typeSelect.appendChild(opt);
  });
  typeSelect.addEventListener("change", () => {
    draft.damageType = typeSelect.value;
    refresh();
  });
  const typeNote = document.createElement("p");
  typeNote.className = "skill-points-breakdown";
  typeField.appendChild(damageLabel);
  typeField.appendChild(typeSelect);
  typeField.appendChild(typeNote);

  const attrTitle = document.createElement("p");
  attrTitle.className = "skill-attr-title display";
  attrTitle.textContent = "Attributes";
  const attrList = document.createElement("div");
  attrList.className = "attr-list";

  const addRow = document.createElement("div");
  addRow.className = "skill-add-row";
  const addSelect = document.createElement("select");
  Object.entries(ATTRIBUTE_RULES).forEach(([key, rule]) => {
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = rule.label;
    addSelect.appendChild(opt);
  });
  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "small-btn";
  addBtn.textContent = "+ Add attribute";
  addBtn.addEventListener("click", () => {
    const rule = ATTRIBUTE_RULES[addSelect.value];
    draft.attributes.push({
      type: addSelect.value,
      status: rule.statuses ? rule.statuses[0] : undefined,
      direct: true,
      amount: 0,
    });
    renderAttrRows();
  });
  addRow.appendChild(addSelect);
  addRow.appendChild(addBtn);

  const errorEl = document.createElement("p");
  errorEl.className = "skill-editor-error";

  const buttonRow = document.createElement("div");
  buttonRow.className = "save-row";
  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "small-btn";
  saveBtn.textContent = "Save E.G.O";
  saveBtn.addEventListener("click", () => {
    draft.name = draft.name.trim();
    const errors = validateEgoName(draft);
    if (errors.length) {
      errorEl.textContent = errors.join(" ");
      return;
    }
    onSave(draft);
  });
  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "small-btn";
  cancelBtn.textContent = "Cancel";
  cancelBtn.addEventListener("click", () => onCancel());
  buttonRow.appendChild(saveBtn);
  buttonRow.appendChild(cancelBtn);
  if (!isNew) {
    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "small-btn";
    deleteBtn.textContent = "Delete";
    deleteBtn.addEventListener("click", () => {
      if (window.confirm(`Delete the E.G.O "${draft.name || "Unnamed"}"?`)) {
        onDelete(draft.id);
      }
    });
    buttonRow.appendChild(deleteBtn);
  }

  form.appendChild(note);
  form.appendChild(nameField);
  form.appendChild(typeAndCostField);
  form.appendChild(typeField);
  form.appendChild(attrTitle);
  form.appendChild(attrList);
  form.appendChild(addRow);
  form.appendChild(errorEl);
  form.appendChild(buttonRow);
  body.appendChild(form);
  body.appendChild(previewWrap);
  container.appendChild(title);
  container.appendChild(body);

  let attrRows = [];

  function renderAttrRows() {
    attrList.innerHTML = "";
    attrRows = [];
    draft.attributes.forEach((attr, index) => {
      const rule = ATTRIBUTE_RULES[attr.type];
      const row = document.createElement("div");
      row.className = "attr-row";
      const label = document.createElement("span");
      label.className = "attr-label";
      label.textContent = rule.label;
      if (rule.tooltip) label.title = rule.tooltip;
      row.appendChild(label);
      if (rule.statuses) {
        const statusSelect = document.createElement("select");
        rule.statuses.forEach((status) => {
          const opt = document.createElement("option");
          opt.value = status;
          opt.textContent = status;
          statusSelect.appendChild(opt);
        });
        statusSelect.value = attr.status;
        statusSelect.addEventListener("change", () => {
          attr.status = statusSelect.value;
          refresh();
        });
        row.appendChild(statusSelect);
      }
      const amountInput = document.createElement("input");
      amountInput.type = "number";
      amountInput.min = 0;
      amountInput.step = 1;
      amountInput.value = attr.amount || 0;
      amountInput.setAttribute("aria-label", `${rule.label} amount`);
      amountInput.addEventListener("input", () => {
        const parsed = parseInt(amountInput.value, 10);
        attr.amount = Number.isNaN(parsed) ? 0 : parsed;
        refresh();
      });
      row.appendChild(amountInput);
      const minNote = document.createElement("span");
      minNote.className = "attr-min";
      minNote.textContent = "amount (n)";
      row.appendChild(minNote);
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "small-btn";
      removeBtn.textContent = "✕";
      removeBtn.addEventListener("click", () => {
        draft.attributes.splice(index, 1);
        renderAttrRows();
      });
      row.appendChild(removeBtn);
      attrList.appendChild(row);
      attrRows.push(row);
    });
    refresh();
  }

  function refresh() {
    const dealsDamage = skillDealsDamage(draft);
    typeSelect.value = draft.damageType;
    typeSelect.disabled = !dealsDamage;
    typeNote.textContent = dealsDamage
      ? ""
      : "Add a Deal attribute to give this E.G.O a damage type.";

    previewHolder.innerHTML = "";
    previewHolder.appendChild(
      buildEgoCard(draft, {
        onArtClick: async () => {
          const image = await pickCardImage();
          if (image) {
            draft.image = image;
            refresh();
          }
        },
      })
    );
    removeImageBtn.style.display = draft.image ? "inline-block" : "none";
  }

  renderAttrRows();
}
