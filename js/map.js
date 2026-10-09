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
      () => render()
    )
    // Token positions live in this same table, so UPDATE events fire on
    // every drag. The navbar bubbles only need rebuilding when someone
    // actually joins or leaves — doing it on every update made them flicker.
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "session_players" },
      () => renderNavParticipants()
    )
    .on(
      "postgres_changes",
      { event: "DELETE", schema: "public", table: "session_players" },
      () => renderNavParticipants()
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

  // Only a status change (waiting <-> active) needs a full rebuild. Switching
  // mode just swaps which stage is visible, so the DM's open menu survives it.
  const needsRebuild = builtStatus !== sessionRow.status;

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
  }

  // In a session the stage fills the page, so the page itself must not scroll.
  document.body.classList.toggle("session-active", sessionRow.status === "active");

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

// getSession/onAuthStateChange/realtime can all trigger this around the
// same time, and it's async (it queries players+profiles), so overlapping
// calls can race. This token makes sure only the most recently started
// call is allowed to touch the DOM, and the removal+insertion happens as
// one synchronous block right after the await — same pattern as the
// duplicate avatar/logout bug fixed earlier in navbar.js.
let navParticipantsToken = 0;

async function renderNavParticipants() {
  const myToken = ++navParticipantsToken;

  const { data: players } = await client
    .from("session_players")
    .select("user_id, character_id");

  const profiles = players && players.length ? await fetchProfilesByIds(players.map((p) => p.user_id)) : new Map();
  const { data: dmProfiles } = await client.from("profiles").select("id").eq("is_dm", true);

  if (myToken !== navParticipantsToken) return; // a newer call superseded this one

  const existing = document.getElementById("nav-session-participants");
  if (existing) existing.remove();

  if (!players || players.length === 0) return;

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

  // A little "/" separating everyone in the room from your own profile button.
  const divider = document.createElement("span");
  divider.className = "nav-session-divider display";
  divider.textContent = "/";
  divider.setAttribute("aria-hidden", "true");
  wrap.appendChild(divider);

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

let sessionMenuOpen = false;

function setSessionMenuOpen(open) {
  sessionMenuOpen = open;
  const menu = document.getElementById("session-menu");
  const toggle = document.getElementById("session-menu-toggle");
  if (!menu || !toggle) return;
  menu.classList.toggle("is-open", open);
  toggle.classList.toggle("is-open", open);
  toggle.setAttribute("aria-expanded", open ? "true" : "false");
  toggle.textContent = open ? "‹ Close" : "☰ Menu";
}

function wireSessionView() {
  const label = document.getElementById("session-mode-label");

  if (viewerIsDm) {
    const menu = document.getElementById("session-menu");
    const toggle = document.getElementById("session-menu-toggle");
    menu.style.display = "flex";
    toggle.style.display = "block";
    setSessionMenuOpen(sessionMenuOpen);

    toggle.addEventListener("click", () => setSessionMenuOpen(!sessionMenuOpen));

    document.getElementById("mode-btn-story").addEventListener("click", () => setMode("story"));
    document.getElementById("mode-btn-map").addEventListener("click", () => setMode("map"));
    document.getElementById("mode-btn-encounter").addEventListener("click", () => setMode("encounter"));

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

    // The tools for a mode live in the pull-out menu, shown only while that mode is active.
    const tools = document.getElementById(`${m}-dm-controls`);
    if (tools) tools.style.display = viewerIsDm && m === sessionRow.mode ? "flex" : "none";
  });
  const label = document.getElementById("session-mode-label");
  if (label) label.textContent = `Mode: ${sessionRow.mode.charAt(0).toUpperCase() + sessionRow.mode.slice(1)}`;
}

// =====================================================================
// Story mode: free-form portraits, DM drags everything
// =====================================================================

function wireStoryControls() {
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
//
// The element keeps following the exact spot it was grabbed at (instead of
// re-centring itself on the pointer, which made it jump), and its position
// is applied at most once per animation frame so fast drags stay smooth.
function startFreeDrag(event, el, onDrop, onClick) {
  event.preventDefault();

  const parent = el.offsetParent;
  const startX = event.clientX;
  const startY = event.clientY;
  const origLeft = el.style.left;
  const origTop = el.style.top;

  // Where inside the element it was grabbed, relative to its centre
  // (tokens are positioned by their centre via translate(-50%, -50%)).
  const startRect = el.getBoundingClientRect();
  const grabDX = startX - (startRect.left + startRect.width / 2);
  const grabDY = startY - (startRect.top + startRect.height / 2);

  let moved = false;
  let latest = { x: startX, y: startY };
  let rafId = null;

  const clamp = (n) => Math.max(0, Math.min(100, n));

  function percentAt(clientX, clientY) {
    const rect = parent.getBoundingClientRect();
    return {
      x: clamp(((clientX - grabDX - rect.left) / rect.width) * 100),
      y: clamp(((clientY - grabDY - rect.top) / rect.height) * 100),
    };
  }

  function applyFrame() {
    rafId = null;
    const p = percentAt(latest.x, latest.y);
    el.style.left = `${p.x}%`;
    el.style.top = `${p.y}%`;
  }

  function stop() {
    document.removeEventListener("pointermove", onMove);
    document.removeEventListener("pointerup", onUp);
    document.removeEventListener("pointercancel", onCancel);
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  function onMove(moveEvent) {
    latest = { x: moveEvent.clientX, y: moveEvent.clientY };

    if (!moved) {
      if (Math.abs(latest.x - startX) <= 4 && Math.abs(latest.y - startY) <= 4) return;
      moved = true;
      el.classList.add("is-dragging");
    }

    if (rafId === null) rafId = requestAnimationFrame(applyFrame);
  }

  function onUp(upEvent) {
    stop();

    if (!moved) {
      if (onClick) onClick();
      return;
    }

    const p = percentAt(upEvent.clientX, upEvent.clientY);
    el.style.left = `${p.x}%`;
    el.style.top = `${p.y}%`;
    onDrop(p.x, p.y);
    el.classList.remove("is-dragging");
  }

  function onCancel() {
    stop();
    el.style.left = origLeft;
    el.style.top = origTop;
    el.classList.remove("is-dragging");
  }

  document.addEventListener("pointermove", onMove);
  document.addEventListener("pointerup", onUp);
  document.addEventListener("pointercancel", onCancel);
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

// Map mode is updated in place: the image stays the same element, and each
// dot is created once and then just moved. Nothing is ever cleared and
// rebuilt, which is what used to make everything flicker on every update.
// Data is fetched BEFORE touching the DOM, so there's no blank moment either.
const mapState = {
  layer: null,
  img: null,
  imgSrc: null,
  note: null,
  dots: new Map(), // user_id -> dot element
  pendingDots: new Map(), // user_id -> {x, y} dropped locally, not yet echoed back
};
let mapRenderToken = 0;

// Character rows barely change mid-session, so keep them instead of
// re-querying on every single update.
const characterCache = new Map();

async function fetchCharactersCached(ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  const missing = unique.filter((id) => !characterCache.has(id));
  if (missing.length > 0) {
    const fetched = await fetchCharactersByIds(missing);
    fetched.forEach((character, id) => characterCache.set(id, character));
  }
  const result = new Map();
  unique.forEach((id) => {
    if (characterCache.has(id)) result.set(id, characterCache.get(id));
  });
  return result;
}

function resetMapState(layer) {
  mapState.layer = layer;
  mapState.img = null;
  mapState.imgSrc = null;
  mapState.note = null;
  mapState.dots = new Map();
  mapState.pendingDots = new Map();
}

function currentMapOffset() {
  return sessionRow.map_offset || { x: 0, y: 0 };
}

// Remember the new offset locally right away, so a render that happens
// before the database echo arrives doesn't snap the map back.
async function commitMapOffset(newOffset) {
  sessionRow = { ...sessionRow, map_offset: newOffset };
  await client.from("game_session").update({ map_offset: newOffset }).eq("id", 1);
}

const snappedLayers = new WeakSet();

function applyLayerOffset(layer) {
  if (layer.classList.contains("is-panning")) return; // being dragged right now
  const offset = currentMapOffset();
  const value = `translate(${offset.x}px, ${offset.y}px)`;

  // The very first placement should just appear in position, not slide in.
  if (!snappedLayers.has(layer)) {
    snappedLayers.add(layer);
    layer.style.transition = "none";
    layer.style.transform = value;
    void layer.offsetWidth;
    layer.style.transition = "";
    return;
  }

  layer.style.transform = value;
}

function syncMapImage(layer) {
  const src = sessionRow.map_image;

  if (src) {
    if (mapState.note) {
      mapState.note.remove();
      mapState.note = null;
    }
    if (!mapState.img || mapState.imgSrc !== src) {
      if (mapState.img) mapState.img.remove();
      const img = document.createElement("img");
      img.className = "map-bg-image";
      img.draggable = false;
      img.src = src;
      layer.insertBefore(img, layer.firstChild);
      mapState.img = img;
      mapState.imgSrc = src;
      sizeLayerToImage(layer, img, src);
    }
    return;
  }

  if (mapState.img) {
    mapState.img.remove();
    mapState.img = null;
    mapState.imgSrc = null;
  }
  resetLayerSize(layer);
  if (!mapState.note) {
    mapState.note = document.createElement("p");
    mapState.note.className = "page-note map-empty-note";
    layer.insertBefore(mapState.note, layer.firstChild);
  }
  mapState.note.textContent = viewerIsDm
    ? "Open the menu and upload an image."
    : "No map loaded yet.";
}

function createMapDot(userId) {
  const dot = document.createElement("div");
  dot.className = "map-dot";

  if (viewerIsDm) {
    dot.classList.add("is-draggable");
    dot.style.touchAction = "none";
    dot.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
      startFreeDrag(event, dot, async (xPct, yPct) => {
        mapState.pendingDots.set(userId, { x: xPct, y: yPct });
        await client
          .from("session_players")
          .update({ map_x: xPct, map_y: yPct })
          .eq("user_id", userId);
        mapState.pendingDots.delete(userId);
      });
    });
  }

  return dot;
}

function syncMapDots(layer, players, characters) {
  const wanted = new Set();

  (players || []).forEach((p) => {
    if (!p.character_id) return;
    wanted.add(p.user_id);

    const character = characters.get(p.character_id);
    let dot = mapState.dots.get(p.user_id);
    if (!dot) {
      dot = createMapDot(p.user_id);
      mapState.dots.set(p.user_id, dot);
      layer.appendChild(dot);
    }

    dot.title = character ? character.name : "?";
    dot.style.background = character && character.signature_color ? character.signature_color : "";

    // Never move a dot out from under the pointer while it's being dragged.
    if (!dot.classList.contains("is-dragging")) {
      const pending = mapState.pendingDots.get(p.user_id);
      dot.style.left = `${pending ? pending.x : p.map_x}%`;
      dot.style.top = `${pending ? pending.y : p.map_y}%`;
    }
  });

  mapState.dots.forEach((dot, userId) => {
    if (!wanted.has(userId)) {
      dot.remove();
      mapState.dots.delete(userId);
    }
  });
}

async function renderMapMode() {
  const canvas = document.getElementById("map-canvas");
  const layer = document.getElementById("map-layer");
  if (!canvas || !layer) return;

  const myToken = ++mapRenderToken;

  const { data: players } = await client.from("session_players").select("*");
  const characters = await fetchCharactersCached((players || []).map((p) => p.character_id));

  if (myToken !== mapRenderToken) return; // a newer render superseded this one

  if (mapState.layer !== layer) resetMapState(layer);

  applyLayerOffset(layer);
  syncMapImage(layer);
  syncMapDots(layer, players, characters);

  // Panning: dragging empty canvas space moves the whole layer.
  if (viewerIsDm) {
    canvas.style.touchAction = "none";
    canvas.onpointerdown = (event) => {
      if (event.target.closest(".map-dot")) return; // dots handle their own drag
      startPanDrag(event, layer, currentMapOffset(), commitMapOffset);
    };
  }
}

// Map and Encounter layers are sized to the image itself. That keeps every
// percentage-based position (dots, grid tiles, tokens) tied to the picture
// rather than to whatever size each person's screen happens to be, and lets
// the grid cover exactly the map. The size is cached per image so the
// constant re-renders from realtime updates don't make the layer flash.
const imageSizeCache = { src: null, width: 0, height: 0 };

function sizeLayerToImage(layer, img, src) {
  const apply = (w, h) => {
    layer.style.width = `${w}px`;
    layer.style.height = `${h}px`;
  };

  if (imageSizeCache.src === src && imageSizeCache.width) {
    apply(imageSizeCache.width, imageSizeCache.height);
    return;
  }

  const onReady = () => {
    imageSizeCache.src = src;
    imageSizeCache.width = img.naturalWidth;
    imageSizeCache.height = img.naturalHeight;
    apply(img.naturalWidth, img.naturalHeight);
  };

  if (img.complete && img.naturalWidth) {
    onReady();
  } else {
    img.addEventListener("load", onReady);
  }
}

function resetLayerSize(layer) {
  layer.style.width = "";
  layer.style.height = "";
}

function startPanDrag(event, layer, startOffset, onDrop) {
  event.preventDefault();
  const startX = event.clientX;
  const startY = event.clientY;
  let latest = startOffset;
  let moved = false;
  let rafId = null;

  layer.classList.add("is-panning");

  function applyFrame() {
    rafId = null;
    layer.style.transform = `translate(${latest.x}px, ${latest.y}px)`;
  }

  function finish() {
    document.removeEventListener("pointermove", onMove);
    document.removeEventListener("pointerup", onUp);
    document.removeEventListener("pointercancel", onCancel);
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    layer.style.transform = `translate(${latest.x}px, ${latest.y}px)`;
    void layer.offsetWidth; // make sure the final position lands before transitions come back
    layer.classList.remove("is-panning");
  }

  function onMove(moveEvent) {
    const dx = moveEvent.clientX - startX;
    const dy = moveEvent.clientY - startY;
    if (!moved && Math.abs(dx) <= 3 && Math.abs(dy) <= 3) return;
    moved = true;
    latest = { x: startOffset.x + dx, y: startOffset.y + dy };
    if (rafId === null) rafId = requestAnimationFrame(applyFrame);
  }

  function onUp() {
    finish();
    if (moved) onDrop(latest);
  }

  function onCancel() {
    latest = startOffset;
    moved = false;
    finish();
  }

  document.addEventListener("pointermove", onMove);
  document.addEventListener("pointerup", onUp);
  document.addEventListener("pointercancel", onCancel);
}

// =====================================================================
// Encounter mode: background + tile grid, roster tray, snap-to-tile
// =====================================================================

function wireEncounterControls() {
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

  const canvas = document.getElementById("encounter-canvas");

  const cols = sessionRow.encounter_cols || 10;
  const rows = sessionRow.encounter_rows || 8;

  // Same shared offset as Map mode, so the picture moves the same way here.
  applyLayerOffset(layer);

  roster.style.display = viewerIsDm ? "block" : "none";

  layer.querySelectorAll(".map-bg-image, .encounter-token").forEach((el) => el.remove());

  if (sessionRow.map_image) {
    const img = document.createElement("img");
    img.className = "map-bg-image";
    img.draggable = false;
    img.src = sessionRow.map_image;
    layer.insertBefore(img, grid);
    sizeLayerToImage(layer, img, sessionRow.map_image);
  } else {
    resetLayerSize(layer);
  }

  // Panning: dragging anywhere that isn't a token moves the whole map + grid.
  // Tokens stop their own pointerdown from bubbling, so they drag separately.
  if (viewerIsDm && canvas) {
    canvas.style.touchAction = "none";
    canvas.onpointerdown = (event) => {
      if (event.target.closest(".encounter-token")) return;
      startPanDrag(event, layer, currentMapOffset(), commitMapOffset);
    };
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
