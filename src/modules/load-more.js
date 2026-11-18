import { BREAKPOINT_QUERIES } from "../utils/breakpoints.js";
import { qsa } from "../utils/dom.js";

let instances = [];

const defaults = {
	initialCount: 4,
	loadCount: 4,
	breakpoints: "",
};

const selectors = {
	component: '[data-load-more="component"]',
	list: '[data-load-more="list"]',
	item: '[data-load-more="item"]',
	trigger: '[data-load-more="trigger"]',
};

function isLoadMoreScope(value) {
	return Boolean(value) && typeof value.querySelectorAll === "function";
}

function normalizeInitArgs(scopeOrSettings = document, maybeSettings = {}) {
	if (isLoadMoreScope(scopeOrSettings)) {
		return {
			scope: scopeOrSettings,
			settings: maybeSettings,
		};
	}

	return {
		scope: document,
		settings: scopeOrSettings || {},
	};
}

function getComponents(scope = document) {
	if (!scope) return [];

	const components = [];

	if (typeof scope.matches === "function" && scope.matches(selectors.component)) {
		components.push(scope);
	}

	if (typeof scope.querySelectorAll === "function") {
		components.push(...scope.querySelectorAll(selectors.component));
	}

	return components;
}

function parseNumber(value, fallbackValue) {
	const parsedValue = parseInt(value, 10);

	return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : fallbackValue;
}

function parseBreakpointList(value) {
	if (!value || typeof value !== "string") return [];

	return value
		.split(",")
		.map((breakpoint) => breakpoint.trim().toLowerCase())
		.filter((breakpoint) => breakpoint in BREAKPOINT_QUERIES);
}

function getBreakpointSetting(root, userSettings) {
	const attributeValue = root.getAttribute("data-load-more-breakpoints");
	const settingValue = userSettings.breakpoints;

	return parseBreakpointList(attributeValue || settingValue);
}

function matchesBreakpoints(breakpoints) {
	if (!breakpoints.length) return true;

	return breakpoints.some(
		(breakpoint) => window.matchMedia(BREAKPOINT_QUERIES[breakpoint]).matches,
	);
}

function setItemVisibility(item, shouldShow) {
	item.style.display = shouldShow ? "" : "none";
	item.hidden = !shouldShow;
	item.toggleAttribute("inert", !shouldShow);
}

function bindInstance(instance) {
	if (instance.isBound) return;

	instance.trigger.addEventListener("click", instance.onTriggerClick);
	instance.isBound = true;
}

function unbindInstance(instance) {
	if (!instance.isBound) return;

	instance.trigger.removeEventListener("click", instance.onTriggerClick);
	instance.isBound = false;
}

function showAllItems(instance) {
	instance.items.forEach((item) => {
		const original = instance.originalItems.get(item);
		if (original.display) item.style.setProperty("display", original.display, original.priority);
		else item.style.removeProperty("display");
		item.toggleAttribute("hidden", original.hidden);
		item.toggleAttribute("inert", original.inert);
	});
	instance.root.removeAttribute("data-load-more-ready");
	instance.trigger.style.display = "none";
	instance.trigger.setAttribute("aria-hidden", "true");
}

function updateItems(instance) {
	instance.items.forEach((item, index) => {
		setItemVisibility(item, index < instance.visibleCount);
	});

	const hasMoreItems = instance.visibleCount < instance.items.length;

	instance.trigger.style.display = hasMoreItems ? "" : "none";
	instance.trigger.setAttribute("aria-hidden", hasMoreItems ? "false" : "true");
}

export function createLoadMore(root, userSettings = {}) {
	if (!root || root._loadMoreInstance) return root?._loadMoreInstance || null;

	const settings = {
		...defaults,
		...userSettings,
	};

	const trigger = qsa(root, selectors.trigger).find((element) => element.closest(selectors.component) === root);

	if (!trigger) return null;

	const items = qsa(root, selectors.item).filter(
		(item) => item.closest(selectors.component) === root,
	);
	const activeBreakpoints = getBreakpointSetting(root, settings);

	const initialCount = parseNumber(
		root.getAttribute("data-load-more-initial-count"),
		settings.initialCount,
	);

	const loadCount = parseNumber(root.getAttribute("data-load-more-count"), settings.loadCount);

	const instance = {
		root,
		list: root.querySelector(selectors.list),
		trigger,
		items,
		originalItems: new Map(items.map((item) => [item, {
			display: item.style.getPropertyValue("display"), priority: item.style.getPropertyPriority("display"),
			hidden: item.hasAttribute("hidden"), inert: item.hasAttribute("inert"),
		}])),
		settings: null,
		isActive: null,
		destroyed: false,
		isBound: false,
		visibleCount: initialCount,
		mediaQueries: [],
		evaluateBreakpointState: null,
		onTriggerClick: null,
		destroy: null,
	};

	instance.settings = {
		...settings,
		initialCount,
		loadCount,
		breakpoints: activeBreakpoints,
	};

	const fail = (error) => {
		instance.destroy();
		console.warn("[load-more] restored delivered items after failure", error);
	};

	instance.onTriggerClick = () => {
		if (!instance.isActive) return;
		try {
			instance.visibleCount = Math.min(instance.visibleCount + instance.settings.loadCount, instance.items.length);
			updateItems(instance);
		} catch (error) { fail(error); }
	};

	instance.destroy = () => {
		if (instance.destroyed) return;
		instance.destroyed = true;
		instance.mediaQueries.forEach((mq) => mq.removeEventListener("change", instance.evaluateBreakpointState));
		unbindInstance(instance);
		showAllItems(instance);
		instance.isActive = false;
		if (root._loadMoreInstance === instance) root._loadMoreInstance = null;
		instances = instances.filter((loadMore) => loadMore !== instance);
	};

	instance.evaluateBreakpointState = () => {
		if (instance.destroyed) return;
		try {
			const shouldBeActive = matchesBreakpoints(activeBreakpoints);
			if (shouldBeActive === instance.isActive) return;
			instance.isActive = shouldBeActive;
			if (shouldBeActive) {
				instance.visibleCount = instance.settings.initialCount;
				bindInstance(instance);
				updateItems(instance);
				root.setAttribute("data-load-more-ready", "true");
				return;
			}
			unbindInstance(instance);
			showAllItems(instance);
		} catch (error) { fail(error); }
	};

	try {
		activeBreakpoints.forEach((breakpoint) => {
			const mq = window.matchMedia(BREAKPOINT_QUERIES[breakpoint]);
			instance.mediaQueries.push(mq);
			mq.addEventListener("change", instance.evaluateBreakpointState);
		});
		root._loadMoreInstance = instance;
		instances.push(instance);
		instance.evaluateBreakpointState();
	} catch (error) { fail(error); return null; }

	return instance.destroyed ? null : instance;
}

export function initLoadMore(scopeOrSettings = document, maybeSettings = {}) {
	const { scope, settings } = normalizeInitArgs(scopeOrSettings, maybeSettings);

	return getComponents(scope)
		.map((component) => {
			try { return createLoadMore(component, settings); }
			catch (error) { console.warn("[load-more] setup failed", error); return null; }
		})
		.filter(Boolean);
}

export function destroyLoadMore(scope) {
	const scopedRoots = scope ? new Set(getComponents(scope)) : null;

	[...instances].forEach((instance) => {
		if (!scopedRoots || scopedRoots.has(instance.root)) {
			instance.destroy();
		}
	});
}

export function reInitLoadMore(scopeOrSettings = document, maybeSettings = {}) {
	const { scope, settings } = normalizeInitArgs(scopeOrSettings, maybeSettings);

	destroyLoadMore(scope);
	return initLoadMore(scope, settings);
}

export function getLoadMoreInstances() {
	return [...instances];
}
