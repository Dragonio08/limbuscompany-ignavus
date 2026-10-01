// Uses the shared client created in js/supabase-client.js (loaded first).
if (!window.client) {
  console.error(
    "Supabase client is missing. Make sure js/supabase-client.js is loaded before js/profile.js."
  );
}
var client = window.client;

const avatarBtn = document.getElementById("profile-avatar-btn");
const removeBtn = document.getElementById("profile-avatar-remove");
const usernameInput = document.getElementById("profile-username-input");
const saveBtn = document.getElementById("profile-save");
const statusEl = document.getElementById("profile-status");
const emailEl = document.getElementById("profile-email");

// undefined = no change queued, null = remove photo, string = new data URL
let pendingAvatar = undefined;

function updateAvatarPreview(avatarDataUrl) {
  if (avatarDataUrl) {
    avatarBtn.style.backgroundImage = `url("${avatarDataUrl}")`;
    avatarBtn.textContent = "";
  } else {
    avatarBtn.style.backgroundImage = "";
    avatarBtn.textContent = "👤";
  }
}

async function loadProfile() {
  const { data: sessionData } = await client.auth.getSession();
  if (!sessionData.session) {
    window.location.href = "login.html";
    return;
  }

  const user = sessionData.session.user;
  emailEl.textContent = user.email;

  const { data: profile } = await client
    .from("profiles")
    .select("username, avatar")
    .eq("id", user.id)
    .maybeSingle();

  usernameInput.value = (profile && profile.username) || "";
  updateAvatarPreview(profile && profile.avatar);
}

avatarBtn.addEventListener("click", () => {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";

  input.addEventListener("change", () => {
    const file = input.files && input.files[0];
    if (!file || !file.type.startsWith("image/")) return;

    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const size = 240;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");

        const scale = Math.max(size / img.width, size / img.height);
        const drawW = img.width * scale;
        const drawH = img.height * scale;
        ctx.drawImage(img, (size - drawW) / 2, (size - drawH) / 2, drawW, drawH);

        pendingAvatar = canvas.toDataURL("image/jpeg", 0.8);
        updateAvatarPreview(pendingAvatar);
        statusEl.textContent = "Photo ready — click Save Profile to apply.";
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });

  input.click();
});

removeBtn.addEventListener("click", () => {
  pendingAvatar = null;
  updateAvatarPreview(null);
  statusEl.textContent = "Photo removed — click Save Profile to apply.";
});

saveBtn.addEventListener("click", async () => {
  const { data: sessionData } = await client.auth.getSession();
  if (!sessionData.session) return;

  const userId = sessionData.session.user.id;
  const username = usernameInput.value.trim();

  const updates = { id: userId, username };
  if (pendingAvatar !== undefined) updates.avatar = pendingAvatar;

  const { error } = await client.from("profiles").upsert(updates, { onConflict: "id" });

  if (error) {
    statusEl.textContent = "Couldn't save: " + error.message;
    return;
  }

  pendingAvatar = undefined;
  statusEl.textContent = "Saved.";
});

loadProfile();
