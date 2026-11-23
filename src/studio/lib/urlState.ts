// Deep-link / screenshot params: ?panel=properties|filters|looks|effects
// &select=<id>[,<id>]&tool=<tool>&dialog=export|shortcuts&assistant=1
// &events=0 (no SSE)&start=1&project=<local id>&lang=en|fr
export function urlParam(name: string): string | null {
  try {
    return new URLSearchParams(location.search).get(name) ?? new URLSearchParams(location.hash.replace(/^#/, "")).get(name);
  } catch {
    return null;
  }
}
