// Fills in the account area of the navbar depending on whether
// someone is currently logged in, and keeps it live if that changes.
if (!window.client) {
  console.error(
    "Supabase client is missing. Make sure js/supabase-client.js is loaded before js/navbar.js."
  );
}
var client = window.client;

const navAccount = document.getElementById("nav-account");

// getSession() and onAuthStateChange can both fire around the same time,
// and renderLoggedIn is async (it queries the profile), so two calls can
// overlap. This token makes sure only the most recently started call is
// allowed to actually touch the DOM, and the clear+append happens as one
// synchronous block right after the await, so a stale call can't leave
// duplicate elements behind.
let renderToken = 0;

function clearNavAccount() {
  while (navAccount.firstChild) {
    navAccount.removeChild(navAccount.firstChild);
  }
}

function renderLoggedOut() {
  renderToken += 1;
  clearNavAccount();
  const link = document.createElement("a");
  link.className = "nav-account-link";
  link.href = "login.html";
  link.textContent = "Login";
  navAccount.appendChild(link);
}

async function renderLoggedIn(user) {
  const myToken = ++renderToken;

  const { data: profile } = await client
    .from("profiles")
    .select("username, avatar")
    .eq("id", user.id)
    .maybeSingle();

  if (myToken !== renderToken) return; // a newer call superseded this one

  clearNavAccount();

  const avatarBtn = document.createElement("a");
  avatarBtn.className = "nav-avatar";
  avatarBtn.href = "profile.html";
  avatarBtn.setAttribute("aria-label", "Your profile");
  avatarBtn.title = (profile && profile.username) || "Your profile";

  if (profile && profile.avatar) {
    avatarBtn.classList.add("has-image");
    avatarBtn.style.backgroundImage = `url("${profile.avatar}")`;
  } else {
    const initial = (profile && profile.username) ? profile.username.charAt(0).toUpperCase() : "?";
    avatarBtn.textContent = initial;
  }

  navAccount.appendChild(avatarBtn);

  if (profile && profile.username) {
    const usernameEl = document.createElement("span");
    usernameEl.className = "nav-username display";
    usernameEl.textContent = profile.username;
    navAccount.appendChild(usernameEl);
  }

  const signOutButton = document.createElement("button");
  signOutButton.className = "nav-account-link";
  signOutButton.type = "button";
  signOutButton.textContent = "Log Out";
  signOutButton.addEventListener("click", async () => {
    await client.auth.signOut();
  });

  navAccount.appendChild(signOutButton);
}

client.auth.getSession().then(({ data }) => {
  if (data.session) {
    renderLoggedIn(data.session.user);
  } else {
    renderLoggedOut();
  }
});

client.auth.onAuthStateChange((_event, session) => {
  if (session) {
    renderLoggedIn(session.user);
  } else {
    renderLoggedOut();
  }
});
