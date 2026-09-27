// Uses the shared `client` created in js/supabase-client.js (loaded first).

const form = document.getElementById("auth-form");
const emailInput = document.getElementById("auth-email");
const passwordInput = document.getElementById("auth-password");
const submitButton = document.getElementById("auth-submit");
const toggleButton = document.getElementById("auth-toggle");
const messageEl = document.getElementById("auth-message");
const formWrap = document.getElementById("auth-form-wrap");
const signedInWrap = document.getElementById("auth-signed-in");
const signedInEmail = document.getElementById("auth-signed-in-email");
const signOutButton = document.getElementById("auth-signout");

let mode = "login"; // or "signup"

function setMessage(text, kind) {
  messageEl.textContent = text || "";
  messageEl.classList.remove("is-error", "is-ok");
  if (kind) messageEl.classList.add(kind);
}

function showSignedIn(user) {
  formWrap.style.display = "none";
  signedInWrap.style.display = "flex";
  signedInEmail.textContent = user.email;
}

function showForm() {
  formWrap.style.display = "block";
  signedInWrap.style.display = "none";
}

toggleButton.addEventListener("click", () => {
  mode = mode === "login" ? "signup" : "login";
  submitButton.textContent = mode === "login" ? "Log In" : "Sign Up";
  toggleButton.textContent =
    mode === "login"
      ? "Need an account? Sign up"
      : "Already have an account? Log in";
  setMessage("");
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  setMessage("");
  submitButton.disabled = true;

  const email = emailInput.value.trim();
  const password = passwordInput.value;

  try {
    if (mode === "signup") {
      const { data, error } = await client.auth.signUp({ email, password });
      if (error) throw error;
      if (data.user && !data.session) {
        setMessage("Check your email to confirm your account.", "is-ok");
      } else if (data.session) {
        showSignedIn(data.user);
      }
    } else {
      const { data, error } = await client.auth.signInWithPassword({
        email,
        password,
      });
      if (error) throw error;
      showSignedIn(data.user);
    }
  } catch (err) {
    setMessage(err.message || "Something went wrong.", "is-error");
  } finally {
    submitButton.disabled = false;
  }
});

signOutButton.addEventListener("click", async () => {
  await client.auth.signOut();
  showForm();
  form.reset();
  setMessage("Signed out.", "is-ok");
});

// If a session already exists (e.g. returning visitor), show it immediately.
client.auth.getSession().then(({ data }) => {
  if (data.session) {
    showSignedIn(data.session.user);
  }
});
