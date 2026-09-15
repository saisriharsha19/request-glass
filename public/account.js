import { getSession, accountRequest } from "/auth-client.js";
const $ = (s) => document.querySelector(s);
let mode = "login",
  working = false,
  recoveryKey = "",
  user = null;
const channel =
  typeof BroadcastChannel === "function"
    ? new BroadcastChannel("returnradar-account")
    : null;
function message(text) {
  $("#account-status").textContent = text;
}
function setMode(next) {
  if (working) return;
  mode = next;
  $("#account-title").textContent =
    next === "register"
      ? "Create an account"
      : next === "recover"
        ? "Recover your account"
        : "Welcome back.";
  $("#name-label").hidden = next !== "register";
  $("#account-display-name").required = next === "register";
  $("#recovery-label").hidden = next !== "recover";
  $("#account-recovery").required = next === "recover";
  $("#password-label").textContent =
    next === "recover" ? "New password" : "Password";
  $("#password-help").hidden = next === "login";
  $("#account-password").autocomplete =
    next === "login" ? "current-password" : "new-password";
  $("#account-submit").textContent =
    next === "register"
      ? "Create my account ↗"
      : next === "recover"
        ? "Reset password ↗"
        : "Sign in ↗";
  document
    .querySelectorAll("[data-auth-mode]")
    .forEach((b) =>
      b.setAttribute("aria-pressed", String(b.dataset.authMode === mode)),
    );
  message(
    next === "recover"
      ? "Use the recovery key you saved when creating your account."
      : "Your purchases, together on every device.",
  );
}
function render() {
  $("#auth-forms").hidden = !!user || !!recoveryKey;
  $("#account-details").hidden = !user || !!recoveryKey;
  $("#recovery-result").hidden = !recoveryKey;
  if (recoveryKey) {
    $("#account-title").textContent = "Account created";
    $("#recovery-key").textContent = recoveryKey;
    message("One last thing: save your recovery key.");
  } else if (user) {
    $("#account-title").textContent = `${user.name}’s account`;
    $("#account-name").textContent = user.name;
    $("#account-id").textContent = `@${user.username}`;
    message("Signed in. Purchases saved to your account sync across devices.");
  } else {
    $("#account-name").textContent = "";
    $("#account-id").textContent = "";
    setMode("login");
  }
}
async function connect() {
  $("#account-retry").hidden = true;
  try {
    const session = await getSession();
    user = session.user;
    render();
  } catch (error) {
    message(error.message);
    $("#account-retry").hidden = false;
  }
}
$("#account-form").onsubmit = async (event) => {
  event.preventDefault();
  if (working) return;
  working = true;
  $("#account-submit").disabled = true;
  message(
    mode === "register" ? "Creating your account…" : "Checking your details…",
  );
  try {
    const result = await accountRequest(mode, {
      username: $("#account-username").value,
      password: $("#account-password").value,
      name: $("#account-display-name").value,
      recoveryCode: $("#account-recovery").value,
    });
    user = result.user;
    recoveryKey = result.recoveryCode || "";
    $("#account-password").value = "";
    $("#account-recovery").value = "";
    channel?.postMessage("changed");
    render();
  } catch (error) {
    message(error.message);
  } finally {
    working = false;
    $("#account-submit").disabled = false;
  }
};
for (const button of document.querySelectorAll("[data-auth-mode]"))
  button.onclick = () => setMode(button.dataset.authMode);
$("#recover-account").onclick = () => setMode("recover");
$("#show-password").onclick = () => {
  const visible = $("#account-password").type === "password";
  $("#account-password").type = visible ? "text" : "password";
  $("#show-password").textContent = visible ? "Hide" : "Show";
  $("#show-password").setAttribute(
    "aria-label",
    visible ? "Hide password" : "Show password",
  );
  $("#show-password").setAttribute("aria-pressed", String(visible));
};
$("#sign-out").onclick = async () => {
  $("#sign-out").disabled = true;
  try {
    await accountRequest("logout", {});
    user = null;
    channel?.postMessage("changed");
    render();
  } catch (error) {
    message(error.message);
  } finally {
    $("#sign-out").disabled = false;
  }
};
$("#download-recovery").onclick = () => {
  const url = URL.createObjectURL(
    new Blob(
      [
        `ReturnRadar recovery key\nUsername: ${user.username}\nRecovery key: ${recoveryKey}\nKeep this private. It can reset your password.\n`,
      ],
      { type: "text/plain" },
    ),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = "returnradar-recovery-key.txt";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
$("#recovery-saved").onchange = () => {
  $("#recovery-done").disabled = !$("#recovery-saved").checked;
};
$("#recovery-done").onclick = () => {
  recoveryKey = "";
  $("#recovery-key").textContent = "";
  $("#recovery-saved").checked = false;
  $("#recovery-done").disabled = true;
  render();
};
$("#account-retry").onclick = connect;
window.addEventListener("beforeunload", (event) => {
  if (recoveryKey) {
    event.preventDefault();
    event.returnValue = "";
  }
});
connect();
