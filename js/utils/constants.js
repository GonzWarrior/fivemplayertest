//  endpoints
export const API_BASE_URL = `https://frontend.cfx-services.net/api`;
export const SERVERS_ICON_URL = 'https://servers-live.fivem.net/servers/icon';

// links templates
export const STEAM_PROFILE_URL = 'https://steamcommunity.com/profiles/%id%';
export const DISCORD_PROFILE_URL = 'https://discord.com/users/%id%';

// default headers for fetch requests
// Kept to a "simple request" (no Content-Type, no custom User-Agent — the browser blocks
// that header anyway) so it never triggers a CORS preflight. Several of the public proxies
// below don't handle preflighted OPTIONS requests at all, so a request with disallowed
// headers would just fail silently against them.
export const DEFAULT_HEADERS = {
	Accept: '*/*',
};

// Theme options
export const THEMES = {
	DARK: 'dark',
	LIGHT: 'light',
};

// LocalStorage keys
export const STORAGE_KEYS = {
	SERVER_ID: 'serverId',
	LAST_ID: 'lastId', // Legacy
	THEME: 'theme',
	FAVORITES: 'favorites',
	HISTORY: 'serverHistory',
	ACTIVE_TAB: 'activeTab',
};

// Default refresh time in seconds
export const DEFAULT_REFRESH_TIME = 30;

// '' = direct request (tried first, no proxy). The rest are raced in parallel as fallback.
// cors-proxy.htmldriven.com and test.cors.workers.dev were dropped: the first has been
// offline for years, the second isn't a public service — both only added dead weight/latency.
export const PROXIES = ['', 'https://corsproxy.io/?url=', 'https://api.allorigins.win/raw?url=', 'https://api.codetabs.com/v1/proxy?quest=', 'https://thingproxy.freeboard.io/fetch/'];
