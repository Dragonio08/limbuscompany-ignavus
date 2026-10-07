// Uses the shared client created in js/supabase-client.js (loaded first).
if (!window.client) {
  console.error(
    "Supabase client is missing. Make sure js/supabase-client.js is loaded before js/map.js."
  );
}
var client = window.client;

const pageEl = document.getElementById("map-page");
const waitingTemplate = document.getElementById("waiting-room-template");
const sessionTemplate = document.getElementById("session-template");

let currentUserId = null;
let viewerIsDm = false;
let sessionRow = null;

// Known structural state we've already built the DOM for — avoids
// rebuilding (and re-attaching listeners to) the whole page on every
// realtime update, only on actual mode/status changes.
let builtStatus = null;
let builtMode = null;

function showMessage(text) {
  pageEl.innerHTML = "";
  const p = document.createElement("p");
  p.className = "page-note";
  p.textContent = text;
  pageEl.appendChild(p);
}

async function fetchCharactersByIds(ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  const map = new Map();
  if (unique.length === 0) return map;
  const { data } = await client.from("characters").select("*").in("id", unique);
  (data || []).forEach((c) => map.set(c.id, c));
  return map;
}

async function fetchProfilesByIds(ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  const map = new Map();
  if (unique.length === 0) return map;
  const { data } = await client.from("profiles").select("*").in("id", unique);
  (data || []).forEach((p) => map.set(p.id, p));
  return map;
}

function tokenVisual(character) {
  // Returns a small element showing a character's portrait (or initial).
  const el = document.createElement("div");
  el.className = "token-portrait";
  if (character && character.portrait) {
    el.style.backgroundImage = `url("${character.portrait}")`;
  } else {
    el.textContent = character ? character.name.charAt(0).toUpperCase() : "?";
  }
  if (character && character.signature_color) {
    el.style.borderColor = character.signature_color;
  }
  return el;
}

// ---- Boot ----

async function init() {
  const { data: authData } = await client.auth.getSession();
  if (!authData.session) {
    window.location.href = "login.html";
    return;
  }
  currentUserId = authData.session.user.id;

  const { data: profile } = await client
    .from("profiles")
    .select("is_dm")
    .eq("id", currentUserId)
    .maybeSingle();
  viewerIsDm = !!(profile && profile.is_dm);

  await loadSession();
  renderNavParticipants();
  // navbar.js rebuilds #nav-account on auth changes, which would wipe the
  // participant bubbles we add to it — re-add them whenever that happens.
  client.auth.onAuthStateChange(() => renderNavParticipants());
  subscribeRealtime();
}

async function loadSession() {
  const { data, error } = await client
    .from("game_session")
    .select("*")
    .eq("id", 1)
    .maybeSingle();

  if (error || !data) {
    showMessage("Couldn't load the session: " + (error ? error.message : "not found"));
    return;
  }

  sessionRow = data;
  render();
}

function subscribeRealtime() {
  client
    .channel("session-updates")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "game_session", filter: "id=eq.1" },
      (payload) => {
        sessionRow = payload.new;
        render();
      }
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "session_players" },
      () => {
        render();
        renderNavParticipants();
      }
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "session_npcs" },
      () => render()
    )
    .subscribe();
}

// ---- Top-level render: switches between waiting room and session view ----

function render() {
  if (!sessionRow) return;

  const needsRebuild = builtStatus !== sessionRow.status || builtMode !== sessionRow.mode;

  if (needsRebuild) {
    pageEl.innerHTML = "";
    if (sessionRow.status === "waiting") {
      pageEl.appendChild(waitingTemplate.content.cloneNode(true));
      wireWaitingRoom();
    } else {
      pageEl.appendChild(sessionTemplate.content.cloneNode(true));
      wireSessionView();
    }
    builtStatus = sessionRow.status;
    builtMode = sessionRow.mode;
  }

  if (sessionRow.status === "waiting") {
    renderWaitingList();
  } else {
    updateModeVisibility();
    if (sessionRow.mode === "story") renderStoryTokens();
    if (sessionRow.mode === "map") renderMapMode();
    if (sessionRow.mode === "encounter") renderEncounterMode();
  }
}

// ---- Navbar participant bubbles (session mode only) ----

async function renderNavParticipants() {
  const existing = document.getElementById("nav-session-participants");
  if (existing) existing.remove();

  const { data: players } = await client
    .from("session_players")
    .select("user_id, character_id");

  if (!players || players.length === 0) return;

  const profiles = await fetchProfilesByIds(players.map((p) => p.user_id));
  const { data: dmProfiles } = await client.from("profiles").select("id").eq("is_dm", true);
  const dmIds = new Set((dmProfiles || []).map((p) => p.id));

  const wrap = document.createElement("div");
  wrap.id = "nav-session-participants";
  wrap.className = "nav-session-participants";

  players.forEach((p) => {
    const profile = profiles.get(p.user_id);
    const bubble = document.createElement("span");
    bubble.className = "nav-participant-bubble" + (dmIds.has(p.user_id) ? " is-dm" : "");
    bubble.title = (profile && profile.username) || "A traveler";
    if (profile && profile.avatar) {
      bubble.style.backgroundImage = `url("${profile.avatar}")`;
    } else {
      bubble.textContent = (profile && profile.username) ? profile.username.charAt(0).toUpperCase() : "?";
    }
    wrap.appendChild(bubble);
  });

  const navAccount = document.getElementById("nav-account");
  if (navAccount.firstChild) {
    navAccount.insertBefore(wrap, navAccount.firstChild);
  } else {
    navAccount.appendChild(wrap);
  }
}

// =====================================================================
// Waiting room
// =====================================================================

function wireWaitingRoom() {
  document.getElementById("waiting-dm-controls").style.display = viewerIsDm ? "flex" : "none";
  document.getElementById("waiting-note").textContent = viewerIsDm
    ? "Players are picking their characters. Press Ready when everyone's set."
    : "Waiting for the Dungeon Master…";

  loadMyCharactersIntoSelect();

  document.getElementById("waiting-join-btn").addEventListener("click", async () => {
    const statusEl = document.getElementById("waiting-join-status");
    const select = document.getElementById("waiting-char-select");
    const characterId = select.value;

    if (!characterId) {
      statusEl.textContent = "Pick a character first.";
      return;
    }

    const { error } = await client
      .from("session_players")
      .upsert({ user_id: currentUserId, character_id: characterId }, { onConflict: "user_id" });

    statusEl.textContent = error ? "Couldn't join: " + error.message : "Joined!";
  });

  if (viewerIsDm) {
    document.getElementById("waiting-ready-btn").addEventListener("click", async () => {
      await client.from("game_session").update({ status: "active" }).eq("id", 1);
    });
  }
}

async function loadMyCharactersIntoSelect() {
  const select = document.getElementById("waiting-char-select");

  const { data: myChars } = await client
    .from("characters")
    .select("id, name")
    .eq("owner_id", currentUserId)
    .eq("is_npc", false)
    .order("created_at", { ascending: false });

  (myChars || []).forEach((c) => {
    const opt = document.createElement("option");
    opt.value = c.id;
    opt.textContent = c.name;
    select.appendChild(opt);
  });

  // The DM doesn't need a character to run the session.
  if (viewerIsDm) {
    document.getElementById("waiting-char-field").style.display =
      myChars && myChars.length > 0 ? "block" : "none";
  }
}

async function renderWaitingList() {
  const list = document.getElementById("waiting-list");
  if (!list) return;

  const { data: players } = await client
    .from("session_players")
    .select("*")
    .order("joined_at", { ascending: true });

  if (!players || players.length === 0) {
    list.innerHTML = "";
    const p = document.createElement("p");
    p.className = "chars-empty-note";
    p.textContent = "No one's joined yet.";
    list.appendChild(p);
    return;
  }

  const profiles = await fetchProfilesByIds(players.map((p) => p.user_id));
  const characters = await fetchCharactersByIds(players.map((p) => p.character_id));
  const { data: dmProfiles } = await client.from("profiles").select("id").eq("is_dm", true);
  const dmIds = new Set((dmProfiles || []).map((p) => p.id));

  list.innerHTML = "";
  players.forEach((p) => {
    const profile = profiles.get(p.user_id);
    const character = characters.get(p.character_id);

    const row = document.createElement("div");
    row.className = "waiting-row";

    const bubble = document.createElement("span");
    bubble.className = "nav-participant-bubble" + (dmIds.has(p.user_id) ? " is-dm" : "");
    if (profile && profile.avatar) {
      bubble.style.backgroundImage = `url("${profile.avatar}")`;
    } else {
      bubble.textContent = (profile && profile.username) ? profile.username.charAt(0).toUpperCase() : "?";
    }

    const label = document.createElement("span");
    const name = (profile && profile.username) || "unnamed";
    label.textContent = dmIds.has(p.user_id)
      ? `${name} (Dungeon Master)`
      : character
      ? `${name} — playing ${character.name}`
      : `${name} — choosing a character…`;

    row.appendChild(bubble);
    row.appendChild(label);
    list.appendChild(row);
  });
}

// =====================================================================
// Session view: mode switcher + End Session
// =====================================================================

function wireSessionView() {
  const switcher = document.getElementById("session-mode-switcher");
  const label = document.getElementById("session-mode-label");

  if (viewerIsDm) {
    switcher.style.display = "flex";
    document.getElementById("mode-btn-story").addEventListener("click", () => setMode("story"));
    document.getElementById("mode-btn-map").addEventListener("click", () => setMode("map"));
    document.getElementById("mode-btn-encounter").addEventListener("click", () => setMode("encounter"));

    document.getElementById("session-dm-end").style.display = "flex";
    document.getElementById("end-session-btn").addEventListener("click", async () => {
      const confirmed = window.confirm("End the session and clear the waiting room?");
      if (!confirmed) return;
      await client.from("session_players").delete().neq("user_id", "00000000-0000-0000-0000-000000000000");
      await client.from("session_npcs").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      await client.from("game_session").update({ status: "waiting" }).eq("id", 1);
    });
  } else {
    label.style.display = "block";
  }

  wireStoryControls();
  wireMapControls();
  wireEncounterControls();
}

async function setMode(mode) {
  if (!viewerIsDm) return;
  await client.from("game_session").update({ mode }).eq("id", 1);
}

function updateModeVisibility() {
  ["story", "map", "encounter"].forEach((m) => {
    document.getElementById(`mode-${m}`).style.display = m === sessionRow.mode ? "block" : "none";
    const btn = document.getElementById(`mode-btn-${m}`);
    if (btn) btn.classList.toggle("is-active", m === sessionRow.mode);
  });
  const label = document.getElementById("session-mode-label");
  if (label) label.textContent = `Mode: ${sessionRow.mode.charAt(0).toUpperCase() + sessionRow.mode.slice(1)}`;
}

// =====================================================================
// Story mode: free-form portraits, DM drags everything
// =====================================================================

function wireStoryControls() {
  document.getElementById("story-dm-controls").style.display = viewerIsDm ? "flex" : "none";
  if (!viewerIsDm) return;

  loadNpcOptionsInto("story-npc-select");

  document.getElementById("story-add-npc-btn").addEventListener("click", async () => {
    const select = document.getElementById("story-npc-select");
    const statusEl = document.getElementById("story-status");
    if (!select.value) {
      statusEl.textContent = "Pick an NPC first.";
      return;
    }
    const { error } = await client
      .from("session_npcs")
      .insert({ character_id: select.value, story_x: 50, story_y: 15 });
    statusEl.textContent = error ? "Couldn't add: " + error.message : "";
  });
}

async function loadNpcOptionsInto(selectId) {
  const select = document.getElementById(selectId);
  select.innerHTML = '<option value="" disabled selected>Choose an NPC</option>';

  const { data: npcs } = await client
    .from("characters")
    .select("id, name")
    .eq("is_npc", true)
    .order("name", { ascending: true });

  (npcs || []).forEach((n) => {
    const opt = document.createElement("option");
    opt.value = n.id;
    opt.textContent = n.name;
    select.appendChild(opt);
  });
}

async function renderStoryTokens() {
  const canvas = document.getElementById("story-canvas");
  if (!canvas) return;

  const { data: players } = await client.from("session_players").select("*");
  const { data: npcs } = await client.from("session_npcs").select("*");

  const characters = await fetchCharactersByIds([
    ...(players || []).map((p) => p.character_id),
    ...(npcs || []).map((n) => n.character_id),
  ]);

  canvas.innerHTML = "";

  (players || []).forEach((p) => {
    if (!p.character_id) return;
    const character = characters.get(p.character_id);
    const token = buildStoryToken(character, p.story_x, p.story_y, "player", p.user_id);
    canvas.appendChild(token);
  });

  (npcs || []).forEach((n) => {
    const character = characters.get(n.character_id);
    const token = buildStoryToken(character, n.story_x, n.story_y, "npc", n.id);
    canvas.appendChild(token);
  });
}

function buildStoryToken(character, x, y, kind, id) {
  const token = document.createElement("div");
  token.className = "story-token";
  token.style.left = `${x}%`;
  token.style.top = `${y}%`;
  token.dataset.origLeft = x;
  token.dataset.origTop = y;

  token.appendChild(tokenVisual(character));

  const nameEl = document.createElement("span");
  nameEl.className = "story-token-name display";
  nameEl.textContent = character ? character.name : "?";
  token.appendChild(nameEl);

  if (viewerIsDm) {
    token.classList.add("is-draggable");
    token.style.touchAction = "none";
    token.addEventListener("pointerdown", (event) => {
      startFreeDrag(
        event,
        token,
        async (xPct, yPct) => {
          const table = kind === "player" ? "session_players" : "session_npcs";
          const idColumn = kind === "player" ? "user_id" : "id";
          await client
            .from(table)
            .update({ story_x: xPct, story_y: yPct })
            .eq(idColumn, id);
        },
        kind === "npc"
          ? () => {
              openTokenPopup(event.clientX, event.clientY, character ? character.name : "NPC", [
                {
                  label: "Remove",
                  onClick: async () => {
                    await client.from("session_npcs").delete().eq("id", id);
                  },
                },
              ]);
            }
          : null
      );
    });
  }

  return token;
}

// Generic percentage-based free drag within a token's offsetParent.
// onDrop(xPercent, yPercent) is called once, on release, if the pointer
// actually moved past a small threshold. If it didn't move (a plain
// click/tap), onClick() is called instead and the position is untouched.
function startFreeDrag(event, el, onDrop, onClick) {
  event.preventDefault();
  const parent = el.offsetParent;
  const parentRect = parent.getBoundingClientRect();
  const startX = event.clientX;
  const startY = event.clientY;
  let moved = false;

  function onMove(moveEvent) {
    if (Math.abs(moveEvent.clientX - startX) > 4 || Math.abs(moveEvent.clientY - startY) > 4) {
      moved = true;
    }
    const xPct = ((moveEvent.clientX - parentRect.left) / parentRect.width) * 100;
    const yPct = ((moveEvent.clientY - parentRect.top) / parentRect.height) * 100;
    el.style.left = `${Math.max(0, Math.min(100, xPct))}%`;
    el.style.top = `${Math.max(0, Math.min(100, yPct))}%`;
  }

  function onUp(upEvent) {
    document.removeEventListener("pointermove", onMove);
    document.removeEventListener("pointerup", onUp);

    if (!moved) {
      // Snap back visually — renderer will redraw it at its real position
      // if onClick doesn't change anything.
      el.style.left = `${el.dataset.origLeft}%`;
      el.style.top = `${el.dataset.origTop}%`;
      if (onClick) onClick();
      return;
    }

    const xPct = ((upEvent.clientX - parentRect.left) / parentRect.width) * 100;
    const yPct = ((upEvent.clientY - parentRect.top) / parentRect.height) * 100;
    onDrop(Math.max(0, Math.min(100, xPct)), Math.max(0, Math.min(100, yPct)));
  }

  document.addEventListener("pointermove", onMove);
  document.addEventListener("pointerup", onUp);
}

// ---- Tiny popup used for "click a token" actions (currently: remove an NPC) ----

function openTokenPopup(x, y, title, buttons) {
  closeTokenPopup();

  const popup = document.createElement("div");
  popup.id = "token-popup";
  popup.className = "token-popup";
  popup.style.left = `${x}px`;
  popup.style.top = `${y}px`;

  const titleEl = document.createElement("p");
  titleEl.className = "token-popup-title display";
  titleEl.textContent = title;
  popup.appendChild(titleEl);

  const row = document.createElement("div");
  row.className = "save-row";
  buttons.forEach(({ label, onClick }) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "small-btn";
    btn.textContent = label;
    btn.addEventListener("click", () => {
      closeTokenPopup();
      onClick();
    });
    row.appendChild(btn);
  });
  popup.appendChild(row);

  document.body.appendChild(popup);

  // Close on an outside click, but not the same click that opened it.
  setTimeout(() => {
    document.addEventListener("click", closeTokenPopupOnOutsideClick);
  }, 0);
}

function closeTokenPopupOnOutsideClick(event) {
  const popup = document.getElementById("token-popup");
  if (popup && !popup.contains(event.target)) {
    closeTokenPopup();
  }
}

function closeTokenPopup() {
  const popup = document.getElementById("token-popup");
  if (popup) popup.remove();
  document.removeEventListener("click", closeTokenPopupOnOutsideClick);
}

// =====================================================================
// Map mode: pannable background image + player dots
// =====================================================================

function wireMapControls() {
  document.getElementById("map-dm-controls").style.display = viewerIsDm ? "flex" : "none";
  if (!viewerIsDm) return;

  document.getElementById("map-upload-btn").addEventListener("click", () => uploadMapImage("map-status"));
}

function uploadMapImage(statusElId) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";

  input.addEventListener("change", () => {
    const file = input.files && input.files[0];
    if (!file || !file.type.startsWith("image/")) return;

    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = async () => {
        const maxDim = 1200;
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.8);

        const { error } = await client
          .from("game_session")
          .update({ map_image: dataUrl, map_offset: { x: 0, y: 0 } })
          .eq("id", 1);

        const statusEl = document.getElementById(statusElId);
        if (statusEl) statusEl.textContent = error ? "Couldn't save: " + error.message : "";
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });

  input.click();
}

async function renderMapMode() {
  const canvas = document.getElementById("map-canvas");
  const layer = document.getElementById("map-layer");
  if (!canvas || !layer) return;

  layer.innerHTML = "";
  const offset = sessionRow.map_offset || { x: 0, y: 0 };
  layer.style.transform = `translate(${offset.x}px, ${offset.y}px)`;

  if (sessionRow.map_image) {
    const img = document.createElement("img");
    img.className = "map-bg-image";
    img.src = sessionRow.map_image;
    img.draggable = false;
    layer.appendChild(img);
  } else {
    const note = document.createElement("p");
    note.className = "page-note";
    note.textContent = viewerIsDm ? "Upload a map image above." : "No map loaded yet.";
    layer.appendChild(note);
  }

  // Panning: dragging empty canvas space moves the whole layer.
  if (viewerIsDm) {
    canvas.style.touchAction = "none";
    canvas.onpointerdown = (event) => {
      if (event.target.closest(".map-dot")) return; // dots handle their own drag
      startPanDrag(event, layer, offset, async (newOffset) => {
        await client.from("game_session").update({ map_offset: newOffset }).eq("id", 1);
      });
    };
  }

  const { data: players } = await client.from("session_players").select("*");
  const characters = await fetchCharactersByIds((players || []).map((p) => p.character_id));

  (players || []).forEach((p) => {
    if (!p.character_id) return;
    const character = characters.get(p.character_id);
    const dot = document.createElement("div");
    dot.className = "map-dot";
    dot.style.left = `${p.map_x}%`;
    dot.style.top = `${p.map_y}%`;
    dot.title = character ? character.name : "?";
    if (character && character.signature_color) {
      dot.style.background = character.signature_color;
    }

    if (viewerIsDm) {
      dot.classList.add("is-draggable");
      dot.style.touchAction = "none";
      dot.addEventListener("pointerdown", (event) => {
        event.stopPropagation();
        startFreeDrag(event, dot, async (xPct, yPct) => {
          await client
            .from("session_players")
            .update({ map_x: xPct, map_y: yPct })
            .eq("user_id", p.user_id);
        });
      });
    }

    layer.appendChild(dot);
  });
}

function startPanDrag(event, layer, startOffset, onDrop) {
  event.preventDefault();
  const startX = event.clientX;
  const startY = event.clientY;
  let latest = startOffset;

  function onMove(moveEvent) {
    const dx = moveEvent.clientX - startX;
    const dy = moveEvent.clientY - startY;
    latest = { x: startOffset.x + dx, y: startOffset.y + dy };
    layer.style.transform = `translate(${latest.x}px, ${latest.y}px)`;
  }

  function onUp() {
    document.removeEventListener("pointermove", onMove);
    document.removeEventListener("pointerup", onUp);
    onDrop(latest);
  }

  document.addEventListener("pointermove", onMove);
  document.addEventListener("pointerup", onUp);
}

// =====================================================================
// Encounter mode: background + tile grid, roster tray, snap-to-tile
// =====================================================================

function wireEncounterControls() {
  document.getElementById("encounter-dm-controls").style.display = viewerIsDm ? "flex" : "none";
  if (!viewerIsDm) return;

  document
    .getElementById("encounter-upload-btn")
    .addEventListener("click", () => uploadMapImage("encounter-status"));

  loadAllCharacterOptionsInto("encounter-npc-select");

  document.getElementById("encounter-add-npc-btn").addEventListener("click", async () => {
    const select = document.getElementById("encounter-npc-select");
    const statusEl = document.getElementById("encounter-status");
    if (!select.value) {
      statusEl.textContent = "Pick a character first.";
      return;
    }
    const { error } = await client.from("session_npcs").insert({ character_id: select.value });
    statusEl.textContent = error ? "Couldn't add: " + error.message : "";
  });
}

// Encounter mode can add ANY character as a token (NPCs and player
// characters alike), not just NPCs — useful for a character whose player
// isn't in the live session, or for planning ahead.
async function loadAllCharacterOptionsInto(selectId) {
  const select = document.getElementById(selectId);
  select.innerHTML = '<option value="" disabled selected>Choose a character</option>';

  const { data: chars } = await client
    .from("characters")
    .select("id, name, is_npc")
    .order("name", { ascending: true });

  (chars || []).forEach((c) => {
    const opt = document.createElement("option");
    opt.value = c.id;
    opt.textContent = c.is_npc ? `${c.name} (NPC)` : c.name;
    select.appendChild(opt);
  });
}

async function renderEncounterMode() {
  const layer = document.getElementById("encounter-layer");
  const grid = document.getElementById("encounter-grid");
  const roster = document.getElementById("encounter-roster");
  if (!layer || !grid || !roster) return;

  const cols = sessionRow.encounter_cols || 10;
  const rows = sessionRow.encounter_rows || 8;

  layer.querySelectorAll(".map-bg-image, .encounter-token").forEach((el) => el.remove());

  if (sessionRow.map_image) {
    const img = document.createElement("img");
    img.className = "map-bg-image";
    img.draggable = false;
    img.src = sessionRow.map_image;
    layer.insertBefore(img, grid);
  }

  grid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
  grid.style.gridTemplateRows = `repeat(${rows}, 1fr)`;
  grid.innerHTML = "";
  for (let i = 0; i < cols * rows; i++) {
    const cell = document.createElement("div");
    cell.className = "encounter-cell";
    cell.dataset.col = i % cols;
    cell.dataset.row = Math.floor(i / cols);
    grid.appendChild(cell);
  }

  const { data: players } = await client.from("session_players").select("*");
  const { data: npcs } = await client.from("session_npcs").select("*");
  const characters = await fetchCharactersByIds([
    ...(players || []).map((p) => p.character_id),
    ...(npcs || []).map((n) => n.character_id),
  ]);

  roster.innerHTML = "";
  const rosterTitle = document.createElement("p");
  rosterTitle.className = "sheet-section-title display";
  rosterTitle.textContent = "Roster — drag onto the grid";
  roster.appendChild(rosterTitle);

  const rosterTray = document.createElement("div");
  rosterTray.className = "encounter-roster-tray";
  roster.appendChild(rosterTray);

  function placeToken(character, tileCol, tileRow, kind, id) {
    const token = document.createElement("div");
    token.className = "encounter-token";
    token.appendChild(tokenVisual(character));
    token.title = character ? character.name : "?";

    const isPlaced = tileCol !== null && tileCol !== undefined;
    if (isPlaced) {
      token.style.left = `${((tileCol + 0.5) / cols) * 100}%`;
      token.style.top = `${((tileRow + 0.5) / rows) * 100}%`;
      layer.appendChild(token);
    } else {
      rosterTray.appendChild(token);
    }

    if (viewerIsDm) {
      token.classList.add("is-draggable");
      token.style.touchAction = "none";
      token.addEventListener("pointerdown", (event) => {
        event.stopPropagation();
        startTileDrag(event, token, layer, cols, rows, async (col, row) => {
          const table = kind === "player" ? "session_players" : "session_npcs";
          const idColumn = kind === "player" ? "user_id" : "id";
          await client
            .from(table)
            .update({ tile_col: col, tile_row: row })
            .eq(idColumn, id);
        });
      });
    }
  }

  (players || []).forEach((p) => {
    if (!p.character_id) return;
    placeToken(characters.get(p.character_id), p.tile_col, p.tile_row, "player", p.user_id);
  });

  (npcs || []).forEach((n) => {
    placeToken(characters.get(n.character_id), n.tile_col, n.tile_row, "npc", n.id);
  });
}

function startTileDrag(event, token, layer, cols, rows, onDrop) {
  event.preventDefault();
  const wasInTray = token.parentElement !== layer;

  // Reparent into the layer so it can move freely over the grid while dragging.
  if (token.parentElement !== layer) {
    layer.appendChild(token);
    token.style.left = "-999px";
    token.style.top = "-999px";
  }

  function layerRect() {
    return layer.getBoundingClientRect();
  }

  function onMove(moveEvent) {
    const rect = layerRect();
    const xPct = ((moveEvent.clientX - rect.left) / rect.width) * 100;
    const yPct = ((moveEvent.clientY - rect.top) / rect.height) * 100;
    token.style.left = `${xPct}%`;
    token.style.top = `${yPct}%`;
  }

  function onUp(upEvent) {
    document.removeEventListener("pointermove", onMove);
    document.removeEventListener("pointerup", onUp);

    const rect = layerRect();
    const col = Math.floor(((upEvent.clientX - rect.left) / rect.width) * cols);
    const row = Math.floor(((upEvent.clientY - rect.top) / rect.height) * rows);
    const clampedCol = Math.max(0, Math.min(cols - 1, col));
    const clampedRow = Math.max(0, Math.min(rows - 1, row));

    const inBounds =
      upEvent.clientX >= rect.left &&
      upEvent.clientX <= rect.right &&
      upEvent.clientY >= rect.top &&
      upEvent.clientY <= rect.bottom;

    if (inBounds) {
      onDrop(clampedCol, clampedRow);
    } else if (wasInTray) {
      onDrop(null, null); // dropped outside — send back to the roster
    }
    // else: dropped outside after already being placed — leave it where it was (re-render will restore it).
  }

  document.addEventListener("pointermove", onMove);
  document.addEventListener("pointerup", onUp);
}

init();
