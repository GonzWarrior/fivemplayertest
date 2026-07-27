import { getPlayerKey, isPlayerFavorite, updateActivePlayers } from './favorites.js';
import { checkPendingSearch, isSearching, searchPlayers } from './search.js';
import { setServerInfo, setTitle } from './server.js';
import { API_BASE_URL, DEFAULT_HEADERS, PROXIES } from './utils/constants.js';
import { getDiscordId, getSteamId } from './utils/user.js';
import { fixColors } from './utils/color.js';

const refreshButton = document.querySelector('#refresh-button');
const loader = document.querySelector('#loader');
const table = document.querySelector('table');

let currentPlayers;

export const getPlayers = () => currentPlayers;

// Single attempt at a URL with a hard timeout. Throws on network error, abort, or non-OK status.
const fetchWithTimeout = async (url, options, timeout) => {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeout);

	try {
		const response = await fetch(url, { ...options, signal: controller.signal });
		if (!response.ok) {
			throw new Error(`Retryable status: ${response.status}`);
		}
		return response;
	} finally {
		clearTimeout(timer);
	}
};

// Strategy: try the direct request first (fastest path, works whenever the API allows CORS).
// If it fails, race every configured proxy in parallel and return whichever answers first,
// instead of walking through them one by one with exponential backoff. This bounds the worst
// case latency to roughly one direct attempt + one proxy round-trip, instead of potentially
// minutes of sequential retries.
async function retryFetch(url, options = {}) {
	const { timeout = 6000 } = options;
	const proxyList = options.proxyList ? [...options.proxyList, ...PROXIES] : PROXIES;
	const targets = proxyList.length ? proxyList : [null];

	const hasDirect = targets.some((proxy) => !proxy);
	if (hasDirect) {
		try {
			return await fetchWithTimeout(url, options, timeout);
		} catch (err) {
			console.warn('Direct request failed, racing proxies...', err);
		}
	}

	const proxies = targets.filter((proxy) => proxy);
	if (!proxies.length) {
		throw new Error('Direct request failed and no proxies are configured');
	}

	try {
		return await Promise.any(proxies.map((proxy) => fetchWithTimeout(proxy + url, options, timeout)));
	} catch (err) {
		throw new Error('All proxy attempts failed');
	}
}

export const fetchServer = (serverId) => {
	try {
		if (!isValidServerId(serverId)) {
			showNotification('Invalid server ID format', 'error');
			return;
		}

		setTitle('Loading server data from FiveM API...');

		showLoader(true);

		refreshButton.onclick = () => fetchServer(serverId);
		const url = `${API_BASE_URL}/servers/single/${serverId}`;
		console.info(`Fetching server info`, serverId, url);

		retryFetch(url, { headers: DEFAULT_HEADERS })
			.then(handleResponse)
			.then((json) => {
				setServerInfo(serverId, json.Data);

				// The player list is already included in this same response — no need for a
				// second, identical request to the same endpoint (that was doubling load time
				// and could occasionally return a slightly different snapshot than the one
				// used for the header, e.g. a player mid-connect still reporting a placeholder
				// name).
				if (!Array.isArray(json.Data.players)) {
					showNotification('This server is not sharing its player list with the public API', 'warning');
				}

				const players = formatPlayers(json.Data.players);
				warnIfNamesAreAnonymized(players);

				// Only update if players changed
				if (!arraysEqual(currentPlayers, players)) {
					currentPlayers = players;
					renderPlayers(players);
					updateActivePlayers(players);
					checkPendingSearch();
				}

				showNotification('Server data loaded successfully', 'success');
			})
			.catch((error) => {
				console.error(error);
				setTitle('Error loading server data');
				showNotification('Failed to load server data', 'error');
			})
			.finally(() => showLoader(false));
	} catch (error) {
		console.error('Error in fetchServer:', error);
		showNotification('An unexpected error occurred', 'error');
		showLoader(false);
	}
};

// Some servers configure their "playernames" resource (via the playernames_template /
// playernames_svTemplate convars) to report the exact same generic string — "Anon",
// "Player", their own server name, etc. — for every single player, usually on purpose to
// hide real identities on roleplay servers. That value comes straight from the server, so
// there's nothing to "unmask" client-side; the most useful thing this page can do is make
// it obvious that's what's happening instead of leaving it looking like a display bug.
const warnIfNamesAreAnonymized = (players) => {
	if (!players.length) return;

	const counts = new Map();
	players.forEach((player) => {
		const key = player.name.toLowerCase();
		counts.set(key, (counts.get(key) || 0) + 1);
	});

	const [mostCommonName, mostCommonCount] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];

	if (players.length >= 3 && mostCommonCount / players.length >= 0.8) {
		showNotification(
			`This server reports "${mostCommonName}" as the name for most/all players — that's sent by the server itself (privacy setting), not something this page can reveal`,
			'warning',
			8000
		);
	}
};

const handleResponse = (response) => {
	if (!response.ok) {
		throw new Error(`HTTP error! Status: ${response.status}`);
	}
	return response.json();
};

const formatPlayers = (players) => {
	if (!Array.isArray(players)) return [];

	const formattedPlayers = [];
	players.forEach((player) => {
		const socials = {};

		if (player.identifiers) {
			const steamIdentifier = getSteamId(player.identifiers);
			if (steamIdentifier) socials.steam = steamIdentifier;

			const discordIdentifier = getDiscordId(player.identifiers);
			if (discordIdentifier) socials.discord = discordIdentifier;
		}

		// Server hostnames/player names can contain FiveM's "^1", "^2"... color codes.
		// Left as-is they render as literal garbage text in the table, which is one of the
		// things that made names look "broken". Strip them and fall back to a clearly
		// labeled placeholder only when the server truly sent an empty name (some servers,
		// by their own configuration, only ever report a generic name for every player —
		// that value comes straight from the server itself and isn't something this page
		// can recover, since the public API never exposes more than what the server sends).
		const cleanName = fixColors(player.name || '').trim();

		formattedPlayers.push({
			name: cleanName || `Player #${player.id}`,
			id: player.id,
			socials,
			ping: player.ping,
		});
	});
	return formattedPlayers.sort((a, b) => a.id - b.id);
};

const resetTable = () => {
	[...table.querySelectorAll('tr')].filter((tr) => tr.id !== 'table-header').forEach((tr) => tr.remove());
};

const STEAM_LINK = 'https://steamcommunity.com/profiles/%id%';
const DISCORD_LINK = 'https://discord.com/users/%id%';

export const renderPlayers = (players, search = false) => {
	resetTable();

	console.info('Rendering new players', players.length);
	let index = 1;
	players.forEach((player) => {
		const tr = document.createElement('tr');
		// Ajoute la clé stable comme attribut pour la gestion des favoris
		const playerKey = getPlayerKey(player);
		tr.setAttribute('data-player-key', playerKey);

		const no = document.createElement('td');
		const star = document.createElement('td');
		const id = document.createElement('td');
		const name = document.createElement('td');
		const socials = document.createElement('td');
		const ping = document.createElement('td');

		no.className = 'table-no';
		star.className = 'table-favorite';
		id.className = 'table-id';
		name.className = 'table-name';
		socials.className = 'table-socials';
		ping.className = 'table-ping';

		no.textContent = index++ + '.';
		const isFavorite = isPlayerFavorite(playerKey);

		const starImg = document.createElement('img');
		starImg.src = isFavorite ? 'img/star.svg' : 'img/empty-star.svg';
		starImg.alt = isFavorite ? 'Remove from Favorites' : 'Add to Favorites';
		starImg.title = isFavorite ? 'Remove from Favorites' : 'Add to Favorites';
		star.appendChild(starImg);

		id.textContent = player.id;
		name.textContent = player.name;
		ping.textContent = `${player.ping}ms`;

		if (player.socials.steam) {
			const link = document.createElement('a');
			link.href = STEAM_LINK.replace('%id%', player.socials.steam);
			link.target = '_blank';
			const steamImg = document.createElement('img');
			steamImg.src = 'img/steam.svg';
			steamImg.alt = 'Steam';
			link.appendChild(steamImg);
			socials.appendChild(link);
		}
		if (player.socials.discord) {
			const link = document.createElement('a');
			link.href = DISCORD_LINK.replace('%id%', player.socials.discord);
			link.target = '_blank';
			const discordImg = document.createElement('img');
			discordImg.src = 'img/discord.svg';
			discordImg.alt = 'Discord';
			link.appendChild(discordImg);
			socials.appendChild(link);
		}

		tr.appendChild(no);
		tr.appendChild(star);
		tr.appendChild(id);
		tr.appendChild(name);
		tr.appendChild(socials);
		tr.appendChild(ping);

		table.appendChild(tr);
	});
	const footerTr = document.createElement('tr');
	footerTr.className = 'table-footer';

	const footerTd = document.createElement('td');
	footerTd.rowSpan = 5;

	const span1 = document.createElement('span');
	span1.textContent = 'This page is not affiliated with FiveM or any other server.';
	footerTd.appendChild(span1);

	footerTr.appendChild(footerTd);
	table.appendChild(footerTr);

	if (isSearching() && !search) searchPlayers();
};

const isValidServerId = (serverId) => {
	return typeof serverId === 'string' && /^[a-zA-Z0-9]+$/.test(serverId);
};

const arraysEqual = (a, b) => {
	if (!a || !b) return false;
	if (a.length !== b.length) return false;

	// Simple comparison of player IDs and names
	const aIds = a.map((p) => `${p.id}-${p.name}-${p.ping}`).sort();
	const bIds = b.map((p) => `${p.id}-${p.name}-${p.ping}`).sort();

	return JSON.stringify(aIds) === JSON.stringify(bIds);
};

const showLoader = (isVisible) => {
	if (loader) {
		loader.style.display = isVisible ? 'flex' : 'none';
	}
};

// Notification system
const showNotification = (message, type, duration = 3000) => {
	if (window.createNotification) {
		window.createNotification({
			message,
			type,
			duration,
		});
	}
};
