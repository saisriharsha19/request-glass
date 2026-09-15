import { api, getAuthConfig, getSession } from "/auth-client.js";
export class PurchaseSync {
  user = null;
  revision = null;
  configured = false;
  primaryOrigin = null;
  generation = 0;
  lastChecked = null;
  async refreshSession() {
    const next = this.configured ? (await getSession()).user : null;
    const changed = next?.id !== this.user?.id;
    if (changed) {
      this.user = next;
      this.revision = null;
      this.generation++;
    }
    return changed;
  }
  async initialize() {
    const config = await getAuthConfig();
    this.configured = !!config.configured;
    this.primaryOrigin = config.primaryOrigin || null;
    this.user = this.configured ? (await getSession()).user : null;
    return this.user;
  }
  headers() {
    return { "X-Account-ID": this.user.id };
  }
  async list(force = false) {
    const generation = this.generation;
    for (let attempt = 0; attempt < 2; attempt++) {
      let after = "",
        revision = null,
        records = [],
        changed = false;
      do {
        const response = await api(
          `/api/purchases${after ? `?after=${encodeURIComponent(after)}` : ""}`,
          {
            headers: {
              ...this.headers(),
              ...(!after && !force && this.revision !== null
                ? { "If-None-Match": `"${this.revision}"` }
                : {}),
            },
          },
        );
        if (generation !== this.generation) return null;
        if (!response) {
          this.lastChecked = new Date();
          return null;
        }
        if (revision !== null && revision !== response.revision) {
          changed = true;
          break;
        }
        revision = response.revision;
        records.push(...response.purchases);
        after = response.next;
        if (records.length > 500)
          throw new Error(
            "This account has more records than this view can load.",
          );
      } while (after);
      if (changed) {
        force = true;
        continue;
      }
      if (generation !== this.generation) return null;
      this.lastChecked = new Date();
      this.revision = revision;
      return records;
    }
    throw new Error(
      "Purchases are changing on another device. Tap Sync now to refresh.",
    );
  }
  async save(purchase, baseVersion) {
    this.generation++;
    const details = { ...purchase, image: null, hasImage: false };
    const response = await api(
      `/api/purchases/${encodeURIComponent(purchase.id)}`,
      {
        method: "PUT",
        headers: { ...this.headers(), "Content-Type": "application/json" },
        body: JSON.stringify({ purchase: details, baseVersion }),
      },
    );
    this.generation++;
    this.revision = null;
    return response.purchase;
  }
  async remove(purchase) {
    this.generation++;
    await api(`/api/purchases/${encodeURIComponent(purchase.id)}`, {
      method: "DELETE",
      headers: { ...this.headers(), "Content-Type": "application/json" },
      body: JSON.stringify({ baseVersion: purchase._version }),
    });
    this.generation++;
    this.revision = null;
  }
}
