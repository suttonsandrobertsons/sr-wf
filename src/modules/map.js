// Google Maps module
// Requires the Google Maps JS bootstrap (importLibrary stub) in the page head,
// not the async direct maps/api/js script tag.
// Supports a wrapper component around each <gmp-map> element and can attach
// markers from hidden CMS data later.

const COMPONENT_SELECTOR = '[data-map="component"]';
const MAP_SELECTOR = "gmp-map";
const PIN_COLLECTION_SELECTOR = "[data-map-pins]";
const DEFAULT_MAP_ID = "d2cbc55e9915bf49da56f430";
const BOOTSTRAP_WAIT_MS = 10000;
const BOOTSTRAP_POLL_MS = 50;
const BOOTSTRAP_MISSING_ERROR = "Google Maps bootstrap is missing. Did the head script load?";

const initializedMaps = new WeakSet();
const mapState = new WeakMap();

let mapsInitPromise = null;
let mapsLibraryPromise = null;
let markerLibraryPromise = null;
let bootstrapReadyPromise = null;

function hasGoogleMapsBootstrap() {
	return Boolean(window.google?.maps?.importLibrary);
}

function waitForGoogleMapsBootstrap(timeoutMs = BOOTSTRAP_WAIT_MS) {
	if (hasGoogleMapsBootstrap()) {
		return Promise.resolve();
	}

	if (!bootstrapReadyPromise) {
		bootstrapReadyPromise = new Promise((resolve, reject) => {
			const startedAt = Date.now();

			const poll = () => {
				if (hasGoogleMapsBootstrap()) {
					bootstrapReadyPromise = null;
					resolve();
					return;
				}

				if (Date.now() - startedAt >= timeoutMs) {
					bootstrapReadyPromise = null;
					reject(new Error(BOOTSTRAP_MISSING_ERROR));
					return;
				}

				window.setTimeout(poll, BOOTSTRAP_POLL_MS);
			};

			poll();
		});
	}

	return bootstrapReadyPromise;
}

async function loadMapsLibrary() {
	await waitForGoogleMapsBootstrap();

	if (!mapsLibraryPromise) {
		mapsLibraryPromise = window.google.maps.importLibrary("maps");
	}

	return mapsLibraryPromise;
}

async function loadMarkerLibrary() {
	await waitForGoogleMapsBootstrap();

	if (!markerLibraryPromise) {
		markerLibraryPromise = window.google.maps.importLibrary("marker");
	}

	return markerLibraryPromise;
}

// Webflow lowercases custom attribute names in rendered markup, so a "mapId"
// attribute set in the Designer can arrive here as "mapid".
function getMapId(mapElement) {
	return (
		mapElement.getAttribute("map-id") ||
		mapElement.getAttribute("mapId") ||
		mapElement.getAttribute("mapid") ||
		mapElement.mapId ||
		mapElement.dataset.mapId ||
		DEFAULT_MAP_ID
	);
}

function ensureMapId(mapElement) {
	const mapId = getMapId(mapElement);
	if (!mapElement.getAttribute("map-id")) {
		mapElement.setAttribute("map-id", mapId);
	}
	if (!mapElement.mapId) {
		mapElement.mapId = mapId;
	}
}

function getMapState(mapElement) {
	let state = mapState.get(mapElement);

	if (!state) {
		state = {
			markerMode: null,
			capabilityListener: null,
		};
		mapState.set(mapElement, state);
	}

	return state;
}

function getMapElement(container) {
	if (!container) return null;

	if (typeof container.matches === "function" && container.matches(MAP_SELECTOR)) {
		return container;
	}

	return container.querySelector(MAP_SELECTOR);
}

function getMapContainers(root = document) {
	const components = [];

	if (typeof root.matches === "function" && root.matches(COMPONENT_SELECTOR)) {
		components.push(root);
	}

	components.push(...Array.from(root.querySelectorAll(COMPONENT_SELECTOR)));
	if (components.length > 0) {
		return components;
	}

	const directMaps = [];

	if (typeof root.matches === "function" && root.matches(MAP_SELECTOR)) {
		directMaps.push(root);
	}

	directMaps.push(...Array.from(root.querySelectorAll(MAP_SELECTOR)));
	return directMaps;
}

function extractPinData(container) {
	const pinsContainer = container.querySelector(PIN_COLLECTION_SELECTOR);
	if (!pinsContainer) return [];

	return Array.from(pinsContainer.querySelectorAll("[data-lat][data-lng]"))
		.map((pinElement) => {
			const lat = Number.parseFloat(pinElement.getAttribute("data-lat"));
			const lng = Number.parseFloat(pinElement.getAttribute("data-lng"));
			const name = pinElement.getAttribute("data-name") || "";
			const linkElement =
				pinElement.querySelector(".panel_loc-link a[href]") ||
				pinElement.querySelector(".panel_loc-link[href]") ||
				pinElement.querySelector("a[href]");
			const link =
				linkElement?.getAttribute("href") ||
				linkElement?.href ||
				pinElement.getAttribute("data-google-maps-link") ||
				pinElement.getAttribute("data-google-maps-url") ||
				pinElement.getAttribute("data-map-link") ||
				pinElement.getAttribute("data-url") ||
				pinElement.getAttribute("href") ||
				"";

			if (Number.isNaN(lat) || Number.isNaN(lng)) {
				return null;
			}

			return { lat, lng, name, link };
		})
		.filter(Boolean);
}

function openPinLink(url) {
	if (!url) return;

	window.open(url, "_blank", "noopener,noreferrer");
}

function bindPinClick(marker, url, eventName) {
	if (!url || !marker) return;

	const handleClick = () => {
		openPinLink(url);
	};

	if (eventName === "gmp-click" && typeof marker.addEventListener === "function") {
		marker.addEventListener(eventName, handleClick);
		return;
	}

	if (typeof marker.addListener === "function") {
		marker.addListener("click", handleClick);
	}
}

async function waitForInnerMap(mapElement) {
	await loadMapsLibrary();

	if (typeof customElements !== "undefined" && customElements.whenDefined) {
		await customElements.whenDefined(MAP_SELECTOR);
	}

	for (let attempt = 0; attempt < 30; attempt += 1) {
		if (mapElement.innerMap) {
			return mapElement.innerMap;
		}

		await new Promise((resolve) => window.requestAnimationFrame(resolve));
	}

	return mapElement.innerMap || null;
}

async function addPins(pins, mapElement, map) {
	if (pins.length === 0) return false;

	if (!getMapId(mapElement)) {
		console.warn(
			"Google Maps pins were found, but the <gmp-map> element has no map-id.",
			mapElement,
		);
		return;
	}

	const { AdvancedMarkerElement } = await loadMarkerLibrary();

	pins.forEach((pin) => {
		const marker = new AdvancedMarkerElement({
			map,
			position: { lat: pin.lat, lng: pin.lng },
			title: pin.name,
			gmpClickable: true,
		});

		bindPinClick(marker, pin.link, "gmp-click");
	});

	return true;
}

function addFallbackPins(pins, mapElement, map) {
	if (pins.length === 0) return false;

	const Marker = window.google?.maps?.Marker;
	if (typeof Marker !== "function") {
		console.warn(
			"Google Maps fallback markers are unavailable, so pins could not be added.",
			mapElement,
		);
		return false;
	}

	pins.forEach((pin) => {
		const marker = new Marker({
			map,
			position: { lat: pin.lat, lng: pin.lng },
			title: pin.name,
		});

		bindPinClick(marker, pin.link, "click");
	});

	return true;
}

function getMarkerMode(mapElement, map) {
	const mapCapabilities =
		typeof map.getMapCapabilities === "function" ? map.getMapCapabilities() : null;
	const advancedMarkersAvailable = Boolean(
		mapCapabilities?.isAdvancedMarkersAvailable && getMapId(mapElement),
	);

	return advancedMarkersAvailable ? "advanced" : "fallback";
}

async function renderPins(pins, mapElement, map) {
	const state = getMapState(mapElement);
	const nextMode = getMarkerMode(mapElement, map);

	if (state.markerMode === nextMode) {
		return true;
	}

	let rendered = false;

	if (nextMode === "advanced") {
		rendered = await addPins(pins, mapElement, map);
	} else {
		rendered = addFallbackPins(pins, mapElement, map);
	}

	if (rendered) {
		state.markerMode = nextMode;
	}

	return rendered;
}

function subscribeToCapabilityChanges(pins, mapElement, map) {
	if (typeof map.addListener !== "function" || typeof map.getMapCapabilities !== "function") {
		return;
	}

	const state = getMapState(mapElement);
	if (state.capabilityListener) {
		return;
	}

	// mapcapabilities_changed fires repeatedly; re-rendering on every fire would
	// duplicate the pins.
	state.capabilityListener = map.addListener("mapcapabilities_changed", () => {
		renderPins(pins, mapElement, map).catch((error) => {
			console.error("Failed to render Google Maps pins:", error);
		});
	});
}

async function initializeMap(container) {
	const mapElement = getMapElement(container);

	if (!mapElement) {
		console.warn("Map component found, but no <gmp-map> element inside:", container);
		return;
	}

	if (initializedMaps.has(mapElement)) {
		return;
	}

	try {
		await waitForGoogleMapsBootstrap();
		ensureMapId(mapElement);
		const map = await waitForInnerMap(mapElement);
		const pins = extractPinData(container);

		if (!map) {
			console.warn("Google Maps element did not expose an innerMap instance:", mapElement);
			return;
		}

		map.setOptions({
			gestureHandling: "greedy",
		});

		subscribeToCapabilityChanges(pins, mapElement, map);
		const rendered = await renderPins(pins, mapElement, map);
		mapElement.dataset.srMapReady = "true";
		if (rendered || pins.length === 0) {
			initializedMaps.add(mapElement);
		}
	} catch (error) {
		console.error("Failed to initialize Google Maps element:", error);
	}
}

async function initMaps(root = document) {
	if (mapsInitPromise) return mapsInitPromise;

	const mapContainers = getMapContainers(root);
	if (mapContainers.length === 0) return Promise.resolve();

	mapsInitPromise = waitForGoogleMapsBootstrap()
		.then(() => Promise.all(mapContainers.map((container) => initializeMap(container))))
		.catch((error) => {
			throw error;
		})
		.finally(() => {
			mapsInitPromise = null;
		});

	return mapsInitPromise;
}

function scheduleInitMaps() {
	initMaps().catch((error) => {
		console.error("Failed to initialize Google Maps:", error);
	});
}

if (!import.meta.vitest) {
	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", scheduleInitMaps, { once: true });
	} else {
		scheduleInitMaps();
	}
}

export {
	initMaps,
	waitForGoogleMapsBootstrap,
	getMapId,
	ensureMapId,
	DEFAULT_MAP_ID,
	BOOTSTRAP_MISSING_ERROR,
};
