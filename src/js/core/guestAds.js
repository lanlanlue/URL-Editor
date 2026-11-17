// Privacy-first policy: neither local nor cloud application pages load ads.
// Keep this entry point for callers; any future opt-in requires a separate
// product/privacy decision and must not weaken the authenticated app CSP.
export async function initGuestAds() {}

export default { initGuestAds };
