// Fills in the account area of the navbar depending on whether
// someone is currently logged in, and keeps it live if that changes.
if (!window.client) {
  console.error(
    "Supabase client is missing. Make sure js/supabase-client.js is loaded before js/navbar.js."
  );
}
var client = window.client;

const navAccount = document.getElementById("nav-account");

function clearNavAccount() {
  while (navAccount.firstChild) {
    navAccount.removeChild(navAccount.firstChild);
  }
}

function renderLoggedOut() {
  clearNavAccount();
  const link = document.createElement("a");
  link.className = "nav-account-link";
  link.href = "login.html";
  link.textContent = "Login";
  navAccount.appendChild(link);
}

function renderLoggedIn(user) {
  clearNavAccount();

  const email = document.createElement("span");
  email.className = "nav-account-email";
  email.textContent = user.email;

  const signOutButton = document.createElement("button");
  signOutButton.className = "nav-account-link";
  signOutButton.type = "button";
  signOutButton.textContent = "Log Out";
  signOutButton.addEventListener("click", async () => {
    await client.auth.signOut();
  });

  navAccount.appendChild(email);
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
