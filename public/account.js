import { getClerk } from "/auth-client.js";
const $ = (s) => document.querySelector(s);
let unsubscribe,
  generation = 0,
  mounted = "";
async function connect() {
  const run = ++generation;
  $("#account-retry").hidden = true;
  $("#account-status").textContent = "Connecting to sign-in…";
  try {
    const clerk = await getClerk(true);
    if (run !== generation) return;
    if (!clerk) {
      $("#account-status").textContent =
        "Account sign-in isn’t connected yet. You can keep using purchases on this device.";
      return;
    }
    const render = async () => {
      if (run !== generation) return;
      const signedIn = Boolean(clerk.user && clerk.session);
      $("#account-title").textContent = signedIn
        ? "Good to see you."
        : "Make yourself at home.";
      $("#sign-in").hidden = signedIn;
      $("#account-details").hidden = !signedIn;
      $("#account-status").textContent = signedIn
        ? "Signed in. Purchases remain on this device."
        : "Sign in or create your account.";
      if (signedIn) {
        $("#account-name").textContent =
          clerk.user.fullName ||
          clerk.user.primaryEmailAddress?.emailAddress ||
          "Your account";
        $("#account-id").textContent = `Account: ${clerk.user.id}`;
        if (mounted !== "user") {
          clerk.unmountSignIn($("#sign-in"));
          clerk.mountUserButton($("#user-button"));
          mounted = "user";
        }
      } else if (mounted !== "sign-in") {
        clerk.unmountUserButton($("#user-button"));
        $("#account-name").textContent = "";
        $("#account-id").textContent = "";
        clerk.mountSignIn($("#sign-in"), {
          routing: "hash",
          forceRedirectUrl: `${location.origin}/account`,
        });
        mounted = "sign-in";
      }
    };
    unsubscribe?.();
    unsubscribe = clerk.addListener(render);
    await render();
  } catch {
    $("#account-status").textContent =
      "We couldn’t connect to sign-in. Your local purchases are still available.";
    $("#account-retry").hidden = false;
  }
}
$("#account-retry").onclick = connect;
connect();
