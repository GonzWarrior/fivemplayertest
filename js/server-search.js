import { fetchServer, retryFetch } from './fetch.js';
import { setId } from './index.js';
import { fixColors } from './utils/color.js';
import { API_BASE_URL, DEFAULT_HEADERS } from './utils/constants.js';

// The single-server endpoint (servers/single/{id}) has no search — it only accepts one exact
// ID per call. The only endpoint that lists servers by name is the full public directory dump,
// which the FiveM server browser itself uses. It's large (tens of thousands of servers), so we
// fetch it once, keep it in memory for the session, and filter locally afterwards — the same
// approach the official server browser and every third-party FiveM search tool use, since there
// is no lighter "search by name" endpoint available.
const SERVERS_LIST_PATHS = [`${API_BASE_URL}/servers/streamRedir/`, 'https://servers-frontend.fivem.net/api/servers/streamRedir/'];

const MAX_RESULTS = 25;
const DEBOUNCE_MS = 250;

let allServers = null; // null = not loaded yet, [] = loaded but empty/failed
let loadPromise = null;
let debounceTimer = null;

export const initServerSearch = () => {
	const button = document.querySelector('#server-search-button');
	const panel = document.querySelector('#server-search-panel');
	const input = document.querySelector('#server-search-input');
	const results = document.querySelector('#server-search-results');

	if (!button || !panel || !input || !results) return;

	button.addEventListener('click', () => {
		const isOpening = !panel.classList.contains('show');
		panel.classList.toggle('show');
		if (isOpening) {
			input.focus();
			ensureServersLoaded(results);
		}
	});

	document.addEventListener('click', (e) => {
		if (!e.target.closest('#server-search-button') && !e.target.closest('#server-search-panel')) {
			panel.classList.remove('show');
		}
	});

	input.addEventListener('input', () => {
		clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => renderResults(results, input.value.trim()), DEBOUNCE_MS);
	});
};

const ensureServersLoaded = (results) => {
	if (allServers !== null) {
		renderResults(results, document.querySelector('#server-search-input').value.trim());
		return;
	}

	if (!loadPromise) {
		setStatus(results, 'Loading the public server list (this can take a little while the first time)…');
		loadPromise = loadAllServers()
			.then((servers) => {
				allServers = servers;
			})
			.catch((err) => {
				console.error('Failed to load server list', err);
				allServers = [];
			});
	}

	loadPromise.then(() => {
		if (!allServers.length) {
			setStatus(
				results,
				'Could not load the public server list right now. You can still paste a Server ID directly, or use the FiveM Server Browser (the "?" icon) to find one.'
			);
			return;
		}
		renderResults(results, document.querySelector('#server-search-input').value.trim());
	});
};

const loadAllServers = async () => {
	let lastError;
	for (const path of SERVERS_LIST_PATHS) {
		try {
			const response = await retryFetch(path, { headers: DEFAULT_HEADERS, timeout: 45000 });
			const text = await response.text();
			const parsed = parseServerList(text);
			if (parsed.length) return parsed;
		} catch (err) {
			lastError = err;
		}
	}
	if (lastError) throw lastError;
	return [];
};

// The endpoint has been reported to sometimes stream newline-delimited JSON instead of a single
// JSON array/object, so this tries the straightforward parse first and falls back to a
// line-by-line parse (skipping any broken lines) rather than failing outright.
const parseServerList = (text) => {
	try {
		const json = JSON.parse(text);
		const list = Array.isArray(json) ? json : json.data || json.servers || Object.values(json);
		return list.filter((entry) => entry && entry.Data && entry.Data.hostname);
	} catch (err) {
		const entries = [];
		text.split('\n').forEach((line) => {
			const trimmed = line.trim();
			if (!trimmed) return;
			try {
				const entry = JSON.parse(trimmed);
				if (entry && entry.Data && entry.Data.hostname) entries.push(entry);
			} catch {
				// skip malformed line
			}
		});
		return entries;
	}
};

const renderResults = (results, query) => {
	if (allServers === null) return;

	while (results.firstChild) results.removeChild(results.firstChild);

	if (!query) {
		const hint = document.createElement('div');
		hint.className = 'no-favorites';
		hint.textContent = `Type a server name to search (${allServers.length.toLocaleString()} servers available).`;
		results.appendChild(hint);
		return;
	}

	const needle = query.toLowerCase();
	const matches = allServers
		.filter((server) => {
			const d = server.Data;
			return (
				fixColors(d.hostname || '').toLowerCase().includes(needle) ||
				(d.vars && d.vars.sv_projectName && fixColors(d.vars.sv_projectName).toLowerCase().includes(needle)) ||
				(d.gametype || '').toLowerCase().includes(needle) ||
				(d.vars && d.vars.tags && d.vars.tags.toLowerCase().includes(needle))
			);
		})
		.sort((a, b) => (b.Data.clients || 0) - (a.Data.clients || 0))
		.slice(0, MAX_RESULTS);

	if (!matches.length) {
		setStatus(results, 'No servers found for that name.');
		return;
	}

	const ul = document.createElement('ul');
	matches.forEach((server) => {
		const li = document.createElement('li');
		const button = document.createElement('button');
		button.className = 'favorite-item';

		const span = document.createElement('span');
		span.textContent = fixColors(server.Data.hostname);

		const count = document.createElement('span');
		count.className = 'server-search-count';
		count.textContent = `${server.Data.clients ?? 0}/${server.Data.svMaxclients ?? server.Data.sv_maxclients ?? '?'}`;

		button.appendChild(span);
		button.appendChild(count);
		button.addEventListener('click', () => {
			fetchServer(server.EndPoint);
			setId(server.EndPoint);
			document.querySelector('#server-search-panel').classList.remove('show');
		});

		li.appendChild(button);
		ul.appendChild(li);
	});
	results.appendChild(ul);
};

const setStatus = (results, message) => {
	while (results.firstChild) results.removeChild(results.firstChild);
	const div = document.createElement('div');
	div.className = 'no-favorites';
	div.textContent = message;
	results.appendChild(div);
};
