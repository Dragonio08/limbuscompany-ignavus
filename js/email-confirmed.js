// Supabase sends email confirmation (and password recovery) links back to
// a redirect URL with the result encoded in the URL's hash fragment:
//   success: #access_token=...&type=signup&...
//   failure: #error=...&error_code=...&error_description=...
// The Supabase client (created in supabase-client.js) automatically
// detects a success hash and establishes a session from it. We just need
// to read the result and show a friendly message either way, instead of
// leaving the person on a blank or 404 page.

if (!window.client) {
  console.error(
    "Supabase client is missing. Make sure js/supabase-client.js is loaded before js/email-confirmed.js."
  );
}
var client = window.client;

const titleEl = document.getElementById("confirm-title");
const messageEl = document.getElementById("confirm-message");
const linkEl = document.getElementById("confirm-link");

function parseHashParams() {
  const hash = window.location.hash.startsWith("#")
    ? window.location.hash.slice(1)
    : window.location.hash;
  return new URLSearchParams(hash);
}

function showSuccess() {
  titleEl.textContent = "Email Confirmed";
  messageEl.textContent = "Your account is verified and you're logged in.";
  linkEl.textContent = "Go to Main Page";
  linkEl.href = "index.html";
  linkEl.style.display = "inline-block";
}

function showError(description) {
  titleEl.textContent = "Confirmation Link Expired";
  messageEl.textContent = description
    ? description.replace(/\+/g, " ")
    : "This confirmation link is no longer valid.";
  linkEl.textContent = "Back to Login";
  linkEl.href = "login.html";
  linkEl.style.display = "inline-block";
}

async function checkConfirmation() {
  const params = parseHashParams();

  if (params.has("error")) {
    showError(params.get("error_description"));
    return;
  }

  // Give supabase-js a moment to parse a success hash into a session.
  for (let attempt = 0; attempt < 10; attempt++) {
    const { data } = await client.auth.getSession();
    if (data.session) {
      showSuccess();
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  titleEl.textContent = "Nothing To Confirm";
  messageEl.textContent = "This page is for email confirmation links — you don't need to do anything here.";
  linkEl.textContent = "Go to Main Page";
  linkEl.href = "index.html";
  linkEl.style.display = "inline-block";
}

checkConfirmation();
