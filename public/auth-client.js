let configPromise, clerkPromise;
export async function getAuthConfig() {
  if (!configPromise)
    configPromise = fetch("/api/auth/config", { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error("Account connection unavailable.");
        return r.json();
      })
      .catch((error) => {
        configPromise = null;
        throw error;
      });
  return configPromise;
}
function loadScript(src, key) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.crossOrigin = "anonymous";
    if (key) script.dataset.clerkPublishableKey = key;
    const timeout = setTimeout(() => {
      script.remove();
      reject(new Error("Sign-in took too long to load. Please retry."));
    }, 15000);
    script.onload = () => {
      clearTimeout(timeout);
      resolve();
    };
    script.onerror = () => {
      clearTimeout(timeout);
      script.remove();
      reject(new Error("Sign-in could not load. Please retry."));
    };
    document.head.append(script);
  });
}
export async function getClerk(withUI = false) {
  const { auth } = await getAuthConfig();
  if (!auth) return null;
  if (!clerkPromise)
    clerkPromise = (async () => {
      await loadScript(
        `${auth.issuer}/npm/@clerk/clerk-js@6/dist/clerk.browser.js`,
        auth.publishableKey,
      );
      if (withUI)
        await loadScript(`${auth.issuer}/npm/@clerk/ui@1/dist/ui.browser.js`);
      await window.Clerk.load(
        withUI ? { ui: { ClerkUI: window.__internal_ClerkUICtor } } : {},
      );
      return window.Clerk;
    })().catch((error) => {
      clerkPromise = null;
      throw error;
    });
  const clerk = await clerkPromise;
  if (withUI && !window.__internal_ClerkUICtor) {
    await loadScript(`${auth.issuer}/npm/@clerk/ui@1/dist/ui.browser.js`);
    await clerk.load({ ui: { ClerkUI: window.__internal_ClerkUICtor } });
  }
  return clerk;
}
export async function accountToken() {
  const clerk = await getClerk();
  return clerk?.session ? clerk.session.getToken() : null;
}
