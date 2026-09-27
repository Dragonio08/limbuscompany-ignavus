// Uses the shared client created in js/supabase-client.js (loaded first).
if (!window.client) {
  console.error(
    "Supabase client is missing. Make sure js/supabase-client.js is loaded before js/characters.js."
  );
}
var client = window.client;

const newCharacterBtn = document.getElementById("new-character-btn");
const scrollBox = document.getElementById("chars-scroll-box");

newCharacterBtn.addEventListener("click", async () => {
  const { data } = await client.auth.getSession();
  if (!data.session) {
    window.location.href = "login.html";
    return;
  }
  window.location.href = "character-creator.html";
});

function renderMessage(text) {
  scrollBox.innerHTML = "";
  const p = document.createElement("p");
  p.className = "chars-empty-note";
  p.textContent = text;
  scrollBox.appendChild(p);
}

function renderCharacterCard(character) {
  const card = document.createElement("a");
  card.className = "char-card";
  card.href = `character-sheet.html?id=${character.id}`;

  const name = document.createElement("p");
  name.className = "char-card-name display";
  name.textContent = character.name;

  const meta = document.createElement("p");
  meta.className = "char-card-meta";
  meta.textContent = `${character.district} — Level ${character.level} — ${character.classification}`;

  card.appendChild(name);
  card.appendChild(meta);
  return card;
}

async function loadCharacters() {
  const { data: sessionData } = await client.auth.getSession();

  if (!sessionData.session) {
    renderMessage("Log in to see your characters.");
    return;
  }

  const userId = sessionData.session.user.id;

  let isDm = false;
  const { data: profile } = await client
    .from("profiles")
    .select("is_dm")
    .eq("id", userId)
    .maybeSingle();
  if (profile && profile.is_dm) isDm = true;

  let query = client
    .from("characters")
    .select("*")
    .order("created_at", { ascending: false });

  if (!isDm) {
    query = query.eq("owner_id", userId);
  }

  const { data: characters, error } = await query;

  if (error) {
    renderMessage("Couldn't load characters: " + error.message);
    return;
  }

  if (!characters || characters.length === 0) {
    renderMessage(
      isDm
        ? "No characters have been created yet."
        : "You haven't made a character yet. Click 'Make new +' to start."
    );
    return;
  }

  scrollBox.innerHTML = "";
  characters.forEach((character) => {
    scrollBox.appendChild(renderCharacterCard(character));
  });
}

// Re-load whenever login state changes, and once on page load.
client.auth.onAuthStateChange(() => loadCharacters());
loadCharacters();
