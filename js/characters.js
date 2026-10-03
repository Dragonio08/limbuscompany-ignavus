// Uses the shared client created in js/supabase-client.js (loaded first).
if (!window.client) {
  console.error(
    "Supabase client is missing. Make sure js/supabase-client.js is loaded before js/characters.js."
  );
}
var client = window.client;

const newCharacterBtn = document.getElementById("new-character-btn");
const scrollBox = document.getElementById("chars-scroll-box");
const usersScrollBox = document.getElementById("users-scroll-box");
const npcsScrollBox = document.getElementById("npcs-scroll-box");

let activeTab = "mine";
let viewerIsDm = false;

// ---- Tabs ----

function wireTabs() {
  const tabs = {
    mine: { btn: document.getElementById("tab-btn-mine"), panel: document.getElementById("tab-mine") },
    users: { btn: document.getElementById("tab-btn-users"), panel: document.getElementById("tab-users") },
    npcs: { btn: document.getElementById("tab-btn-npcs"), panel: document.getElementById("tab-npcs") },
  };

  function showTab(name) {
    activeTab = name;
    Object.entries(tabs).forEach(([key, { btn, panel }]) => {
      const active = key === name;
      panel.style.display = active ? "block" : "none";
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-selected", active ? "true" : "false");
    });
    newCharacterBtn.textContent = name === "npcs" ? "Make new NPC +" : "Make new +";
  }

  tabs.mine.btn.addEventListener("click", () => showTab("mine"));
  tabs.users.btn.addEventListener("click", () => showTab("users"));
  tabs.npcs.btn.addEventListener("click", () => showTab("npcs"));
}

newCharacterBtn.addEventListener("click", async () => {
  const { data } = await client.auth.getSession();
  if (!data.session) {
    window.location.href = "login.html";
    return;
  }
  window.location.href = activeTab === "npcs" ? "npc-creator.html" : "character-creator.html";
});

// ---- Rendering ----

function renderMessageInto(box, text) {
  box.innerHTML = "";
  const p = document.createElement("p");
  p.className = "chars-empty-note";
  p.textContent = text;
  box.appendChild(p);
}

function renderCharacterCard(character, ownerLabel, onDeleted) {
  const card = document.createElement("div");
  card.className = "char-card-row";

  const link = document.createElement("a");
  link.className = "char-card";
  link.href = `character-sheet.html?id=${character.id}`;

  const name = document.createElement("p");
  name.className = "char-card-name display";
  name.textContent = character.name;

  const meta = document.createElement("p");
  meta.className = "char-card-meta";
  meta.textContent = `${character.district} / Level ${character.level} / ${character.classification}`;

  link.appendChild(name);
  if (ownerLabel) {
    const owner = document.createElement("p");
    owner.className = "char-card-owner";
    owner.textContent = `by ${ownerLabel}`;
    link.appendChild(owner);
  }
  link.appendChild(meta);

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "char-card-delete";
  deleteBtn.setAttribute("aria-label", `Delete ${character.name}`);
  deleteBtn.textContent = "✕";

  deleteBtn.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();

    const confirmed = window.confirm(
      `Delete "${character.name}" forever? This cannot be undone.`
    );
    if (!confirmed) return;

    const { error } = await client
      .from("characters")
      .delete()
      .eq("id", character.id);

    if (error) {
      window.alert("Couldn't delete: " + error.message);
      return;
    }

    card.remove();
    if (onDeleted) onDeleted();
  });

  card.appendChild(link);
  card.appendChild(deleteBtn);
  return card;
}

// Looks up usernames for a set of owner ids; falls back to "a traveler".
async function fetchUsernames(ownerIds) {
  const uniqueIds = [...new Set(ownerIds)];
  if (uniqueIds.length === 0) return new Map();

  const { data: profiles } = await client
    .from("profiles")
    .select("id, username")
    .in("id", uniqueIds);

  const map = new Map();
  (profiles || []).forEach((p) => map.set(p.id, p.username));
  return map;
}

async function loadCharacters() {
  const { data: sessionData } = await client.auth.getSession();

  if (!sessionData.session) {
    renderMessageInto(scrollBox, "Log in to see your characters.");
    renderMessageInto(usersScrollBox, "Log in to see other players' characters.");
    document.getElementById("tab-btn-npcs").style.display = "none";
    return;
  }

  const userId = sessionData.session.user.id;

  const { data: profile } = await client
    .from("profiles")
    .select("is_dm")
    .eq("id", userId)
    .maybeSingle();
  viewerIsDm = !!(profile && profile.is_dm);
  document.getElementById("tab-btn-npcs").style.display = viewerIsDm ? "block" : "none";

  // ---- "Characters" tab: this account's own, non-NPC characters ----
  const { data: ownCharacters, error: ownError } = await client
    .from("characters")
    .select("*")
    .eq("owner_id", userId)
    .eq("is_npc", false)
    .order("created_at", { ascending: false });

  if (ownError) {
    renderMessageInto(scrollBox, "Couldn't load characters: " + ownError.message);
  } else if (!ownCharacters || ownCharacters.length === 0) {
    renderMessageInto(scrollBox, "You haven't made a character yet. Click 'Make new +' to start.");
  } else {
    scrollBox.innerHTML = "";
    ownCharacters.forEach((character) => {
      scrollBox.appendChild(
        renderCharacterCard(character, null, () => {
          if (!scrollBox.querySelector(".char-card-row")) {
            renderMessageInto(scrollBox, "You haven't made a character yet. Click 'Make new +' to start.");
          }
        })
      );
    });
  }

  // ---- "User's Characters" tab: everyone else's non-NPC characters ----
  const { data: otherCharacters, error: otherError } = await client
    .from("characters")
    .select("*")
    .neq("owner_id", userId)
    .eq("is_npc", false)
    .order("created_at", { ascending: false });

  if (otherError) {
    renderMessageInto(usersScrollBox, "Couldn't load characters: " + otherError.message);
  } else if (!otherCharacters || otherCharacters.length === 0) {
    renderMessageInto(usersScrollBox, "No other characters have been created yet.");
  } else {
    const usernames = await fetchUsernames(otherCharacters.map((c) => c.owner_id));
    usersScrollBox.innerHTML = "";
    otherCharacters.forEach((character) => {
      const ownerLabel = usernames.get(character.owner_id) || "unnamed";
      usersScrollBox.appendChild(
        renderCharacterCard(character, ownerLabel, () => {
          if (!usersScrollBox.querySelector(".char-card-row")) {
            renderMessageInto(usersScrollBox, "No other characters have been created yet.");
          }
        })
      );
    });
  }

  // ---- "NPCs" tab: DM only ----
  if (!viewerIsDm) return;

  const { data: npcs, error: npcError } = await client
    .from("characters")
    .select("*")
    .eq("is_npc", true)
    .order("created_at", { ascending: false });

  if (npcError) {
    renderMessageInto(npcsScrollBox, "Couldn't load NPCs: " + npcError.message);
  } else if (!npcs || npcs.length === 0) {
    renderMessageInto(npcsScrollBox, "No NPCs yet. Click 'Make new NPC +' to create one.");
  } else {
    npcsScrollBox.innerHTML = "";
    npcs.forEach((character) => {
      npcsScrollBox.appendChild(
        renderCharacterCard(character, null, () => {
          if (!npcsScrollBox.querySelector(".char-card-row")) {
            renderMessageInto(npcsScrollBox, "No NPCs yet. Click 'Make new NPC +' to create one.");
          }
        })
      );
    });
  }
}

wireTabs();
client.auth.onAuthStateChange(() => loadCharacters());
loadCharacters();
