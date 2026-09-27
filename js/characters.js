// Uses the shared client created in js/supabase-client.js (loaded first).
if (!window.client) {
  console.error(
    "Supabase client is missing. Make sure js/supabase-client.js is loaded before js/characters.js."
  );
}
var client = window.client;

const newCharacterBtn = document.getElementById("new-character-btn");
const scrollBox = document.getElementById("chars-scroll-box");
const dmSection = document.getElementById("dm-section");
const dmScrollBox = document.getElementById("dm-scroll-box");

newCharacterBtn.addEventListener("click", async () => {
  const { data } = await client.auth.getSession();
  if (!data.session) {
    window.location.href = "login.html";
    return;
  }
  window.location.href = "character-creator.html";
});

function renderMessageInto(box, text) {
  box.innerHTML = "";
  const p = document.createElement("p");
  p.className = "chars-empty-note";
  p.textContent = text;
  box.appendChild(p);
}

function renderCharacterCard(character, onDeleted) {
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

async function loadCharacters() {
  const { data: sessionData } = await client.auth.getSession();

  if (!sessionData.session) {
    renderMessageInto(scrollBox, "Log in to see your characters.");
    dmSection.style.display = "none";
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

  // Always: only this account's own characters in the main list.
  const { data: ownCharacters, error: ownError } = await client
    .from("characters")
    .select("*")
    .eq("owner_id", userId)
    .order("created_at", { ascending: false });

  if (ownError) {
    renderMessageInto(scrollBox, "Couldn't load characters: " + ownError.message);
  } else if (!ownCharacters || ownCharacters.length === 0) {
    renderMessageInto(scrollBox, "You haven't made a character yet. Click 'Make new +' to start.");
  } else {
    scrollBox.innerHTML = "";
    ownCharacters.forEach((character) => {
      scrollBox.appendChild(
        renderCharacterCard(character, () => {
          if (!scrollBox.querySelector(".char-card-row")) {
            renderMessageInto(scrollBox, "You haven't made a character yet. Click 'Make new +' to start.");
          }
        })
      );
    });
  }

  if (!isDm) {
    dmSection.style.display = "none";
    return;
  }

  // DM: show everyone else's characters below.
  dmSection.style.display = "flex";

  const { data: allCharacters, error: allError } = await client
    .from("characters")
    .select("*")
    .neq("owner_id", userId)
    .order("created_at", { ascending: false });

  if (allError) {
    renderMessageInto(dmScrollBox, "Couldn't load characters: " + allError.message);
    return;
  }

  if (!allCharacters || allCharacters.length === 0) {
    renderMessageInto(dmScrollBox, "No other characters have been created yet.");
    return;
  }

  dmScrollBox.innerHTML = "";
  allCharacters.forEach((character) => {
    dmScrollBox.appendChild(
      renderCharacterCard(character, () => {
        if (!dmScrollBox.querySelector(".char-card-row")) {
          renderMessageInto(dmScrollBox, "No other characters have been created yet.");
        }
      })
    );
  });
}

// Re-load whenever login state changes, and once on page load.
client.auth.onAuthStateChange(() => loadCharacters());
loadCharacters();
