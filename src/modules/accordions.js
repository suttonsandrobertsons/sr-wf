import { faqRoot, accordionFaqRoot, canStartFaq, canStartComponent, fallbackFaq, registerFaqCleanup, registerPending } from "./faq-startup.js";
import { BREAKPOINT_QUERIES } from "../utils/breakpoints.js";

let instances = [];
let hasCreatedAccordionEase = false;
let hasBoundFinsweetEvents = false;
let pendingInits = [];

const accordionEaseName = "cssEase";
const accordionEaseCurve = "M0,0 C0.25,0.1 0.25,1 1,1";
const defaults = {
	closeOthers: true,
	breakpoints: "",
};

const selectors = {
	component: '[data-accordion="component"]',
	item: '[data-accordion="item"]',
	trigger: '[data-accordion="trigger"]',
	content: '[data-accordion="content"]',
	icon: '[data-accordion="icon"]',
};

function qsa(root, selector) {
	return Array.from(root.querySelectorAll(selector));
}

function isAccordionScope(value) {
	return Boolean(value) && typeof value.querySelectorAll === "function";
}

function normalizeInitArgs(scopeOrSettings = document, maybeSettings = {}) {
	if (isAccordionScope(scopeOrSettings)) {
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

function getAccordionRoots(scope = document) {
	if (!scope) return [];

	const roots = [];
	const seen = new Set();

	const pushUnique = (element) => {
		if (!element || seen.has(element)) return;

		seen.add(element);
		roots.push(element);
	};

	const canMatch = typeof scope.matches === "function";
	const canQuery = typeof scope.querySelectorAll === "function";

	if (canMatch && scope.matches(selectors.component)) {
		pushUnique(scope);
	}

	if (canQuery) {
		qsa(scope, selectors.component).forEach(pushUnique);
	}

	const pushStandaloneItem = (item) => {
		if (!item || owningAccordionRoot(item) !== item) return;
		pushUnique(item);
	};

	if (canMatch && scope.matches(selectors.item)) {
		pushStandaloneItem(scope);
	}

	if (canQuery) {
		qsa(scope, selectors.item).forEach(pushStandaloneItem);
	}

	return roots;
}

function owningAccordionRoot(item) {
	const boundary = item.parentElement?.closest(`${selectors.component}, ${selectors.item}`);
	return boundary?.matches(selectors.component) && faqRoot(item) === faqRoot(boundary) ? boundary : item;
}

function getItemsFromRoot(root) {
	if (!root) return [];

	if (typeof root.matches === "function" && root.matches(selectors.item)) {
		return [root];
	}

	return qsa(root, selectors.item).filter((item) => owningAccordionRoot(item) === root);
}

function getAccordionEase() {
	if (typeof CustomEase === "undefined") {
		return "power2.inOut";
	}

	if (!hasCreatedAccordionEase) {
		CustomEase.create(accordionEaseName, accordionEaseCurve);
		hasCreatedAccordionEase = true;
	}

	return accordionEaseName;
}

function getBooleanSetting(root, attributeName, fallbackValue) {
	const attributeValue = root.getAttribute(attributeName);

	if (attributeValue === null) {
		return fallbackValue;
	}

	return attributeValue === "true";
}

function parseBreakpointList(value) {
	if (!value || typeof value !== "string") return [];

	return value
		.split(",")
		.map((breakpoint) => breakpoint.trim().toLowerCase())
		.filter((breakpoint) => breakpoint in BREAKPOINT_QUERIES);
}

function getBreakpointSetting(root, userSettings) {
	const attributeValue = root.getAttribute("data-accordion-breakpoints");
	const settingValue = userSettings.breakpoints;

	return parseBreakpointList(attributeValue || settingValue);
}

function matchesBreakpoints(breakpoints) {
	if (!breakpoints.length) return true;

	return breakpoints.some(
		(breakpoint) => window.matchMedia(BREAKPOINT_QUERIES[breakpoint]).matches,
	);
}

// Snapshot only properties this enhancement owns; never replace an entire style.
function snapshot(element, styles = [], attributes = []) {
	const values = styles.map((name) => [name, element.style.getPropertyValue(name), element.style.getPropertyPriority(name)]);
	const attrs = attributes.map((name) => [name, element.getAttribute(name)]);
	return () => {
		values.forEach(([name, value, priority]) => value ? element.style.setProperty(name, value, priority) : element.style.removeProperty(name));
		attrs.forEach(([name, value]) => value === null ? element.removeAttribute(name) : element.setAttribute(name, value));
	};
}

function resetItemNativeState(record, kill = false) {
	// GSAP can write styles while rewinding; restore snapshots afterwards.
	try { kill ? record.timeline?.kill() : record.timeline?.pause(0); }
	catch (error) { console.warn("[accordions] timeline cleanup failed", error); }
	unbindRecord(record);
	record.item.removeAttribute("data-accordion-ready");
	record.item.classList.toggle("is-open", record.wasOpen);
	record.restoreContent();
	record.restoreTrigger();
	record.restoreIcon?.();
}

function failRecord(record, error) {
	record.failed = true;
	record.item.setAttribute("data-accordion-startup-state", "fallback");
	resetItemNativeState(record, true);
	fallbackFaq(accordionFaqRoot(record.item));
	console.warn("[accordions] item fell back to readable content", error);
}

function bindRecord(record) {
	if (record.isBound) return;

	if (!record.isNativeButton) {
		record.trigger.setAttribute("role", "button");
		record.trigger.setAttribute("tabindex", "0");
		record.trigger.addEventListener("keydown", record.onTriggerKeydown);
	}
	record.trigger.addEventListener("click", record.onTriggerClick);
	record.isBound = true;
}

function unbindRecord(record) {
	if (!record.isBound) return;

	record.trigger.removeEventListener("click", record.onTriggerClick);
	record.trigger.removeEventListener("keydown", record.onTriggerKeydown);
	record.isBound = false;
}

function setItemOpenState(record, isOpen) {
	if (!record.instance?.isActive || record.instance.destroyed || record.failed) return;

	record.item.classList.toggle("is-open", isOpen);
	record.trigger.setAttribute("aria-expanded", isOpen ? "true" : "false");
	record.content.toggleAttribute("inert", !isOpen);
	record.content.setAttribute("aria-hidden", isOpen ? "false" : "true");

	// The timeline is rendered during setup, so GSAP caches the resolved value of
	// `height: "auto"`. Content injected later would otherwise animate to that
	// stale height before snapping to its current auto height.
	record.timeline.invalidate();

	if (isOpen) {
		record.timeline.play();
		return;
	}

	record.timeline.reverse();
}

function pushScope(scopes, scope) {
	if (!scope || typeof scope.querySelectorAll !== "function") return;
	if (!scopes.includes(scope)) {
		scopes.push(scope);
	}
}

function getFinsweetScopes(instance) {
	const scopes = [];

	pushScope(scopes, instance?.listInstance?.list);
	pushScope(scopes, instance?.listInstance?.wrapper);
	pushScope(scopes, instance?.list);
	pushScope(scopes, instance?.element);

	if (Array.isArray(instance?.items)) {
		instance.items.forEach((item) => {
			pushScope(scopes, item?.element || item);
		});
	}

	if (!scopes.length) {
		pushScope(scopes, document);
	}

	return scopes;
}

function bindFinsweetEvents() {
	if (hasBoundFinsweetEvents || typeof window === "undefined") return;

	hasBoundFinsweetEvents = true;
	window.fsAttributes = window.fsAttributes || [];

	// CMS Filter may swap visible list items; re-run accordion init within that list.
	window.fsAttributes.push([
		"cmsfilter",
		(filterInstances) => {
			filterInstances.forEach((filterInstance) => {
				if (typeof filterInstance?.listInstance?.on !== "function") return;

				filterInstance.listInstance.on("renderitems", () => {
					getFinsweetScopes(filterInstance).forEach((scope) => {
						initAccordions(scope);
					});
				});
			});
		},
	]);

	// CMS Load appends new items; initialize accordions in changed list scope.
	window.fsAttributes.push([
		"cmsload",
		(loadInstances) => {
			loadInstances.forEach((loadInstance) => {
				if (typeof loadInstance?.on !== "function") return;

				loadInstance.on("pagechanged", () => {
					getFinsweetScopes(loadInstance).forEach((scope) => {
						initAccordions(scope);
					});
				});
			});
		},
	]);
}

export function createAccordion(root, userSettings = {}) {
	if (!root || root._accordionInstance) return root?._accordionInstance || null;

	const faq = accordionFaqRoot(root);
	const items = getItemsFromRoot(root);
	const fallback = () => {
		items.forEach((item) => item.setAttribute("data-accordion-startup-state", "fallback"));
		fallbackFaq(faq);
	};
	const refuseLate = () => {
		items.forEach((item) => item.setAttribute("data-accordion-startup-state", "fallback"));
		if (faq?.getAttribute("data-faq-startup-state") !== "managed") fallbackFaq(faq);
	};
	if ((faq && !canStartFaq(faq)) || !canStartComponent()) { refuseLate(); return null; }
	if (items.length && items.every((item) => item.getAttribute("data-accordion-startup-state") === "fallback")) return null;
	if (typeof gsap === "undefined") {
		fallback();
		console.warn("[accordions] gsap not found.");
		return null;
	}

	const settings = {
		...defaults,
		...userSettings,
	};
	const isComponentRoot = root.matches(selectors.component);
	const allowFirstOpen = root.getAttribute("data-accordion-first-open") === "true";
	const activeBreakpoints = getBreakpointSetting(root, settings);
	const closeOthers = isComponentRoot
		? getBooleanSetting(root, "data-accordion-close-others", settings.closeOthers)
		: false;
	let ease;
	try { ease = getAccordionEase(); }
	catch (error) { fallback(); console.warn("[accordions] ease failed", error); return null; }
	const records = [];

	const instance = {
		root,
		items: records,
		settings: null,
		isActive: null,
		destroyed: false,
		mediaQueries: [],
		evaluateBreakpointState: null,
		destroy: null,
	};

	items.forEach((item, index) => {
		const owned = (selector) => qsa(item, selector).find((element) => element.closest(selectors.item) === item);
		const trigger = owned(selectors.trigger);
		const content = owned(selectors.content);
		const icon = owned(selectors.icon);
		if (item.getAttribute("data-accordion-startup-state") === "fallback") return;
		if (!trigger || !content) {
			item.setAttribute("data-accordion-startup-state", "fallback");
			fallbackFaq(faq);
			return;
		}

		const record = {
			instance, item, trigger, content, icon, timeline: null,
			onTriggerClick: null, onTriggerKeydown: null,
			isNativeButton: trigger.matches('button, input[type="button"], input[type="submit"], input[type="reset"]'),
			isInitiallyOpen: allowFirstOpen && index === 0,
			wasOpen: item.classList.contains("is-open"), isBound: false, failed: false,
			restoreContent: snapshot(content, ["height", "overflow"], ["inert", "aria-hidden"]),
			restoreTrigger: snapshot(trigger, [], ["aria-expanded", "role", "tabindex"]),
			restoreIcon: icon ? snapshot(icon,
				["transform", "transform-origin", "translate", "rotate", "scale"],
				["transform", "data-svg-origin"]) : null,
		};
		records.push(record);

		record.onTriggerClick = () => {
			try {
				const isOpen = item.classList.contains("is-open");
				if (closeOthers) records.forEach((other) => {
					if (other !== record) {
						try { setItemOpenState(other, false); } catch (error) { failRecord(other, error); }
					}
				});
				setItemOpenState(record, !isOpen);
			} catch (error) { failRecord(record, error); }
		};
		record.onTriggerKeydown = (event) => {
			if (event.target !== trigger || (event.key !== "Enter" && event.key !== " ")) return;
			event.preventDefault();
			if (!event.repeat) trigger.click();
		};
	});

	instance.settings = {
		...settings,
		closeOthers,
		breakpoints: activeBreakpoints,
	};

	let detachFaq = () => {};
	let unregister = () => {};
	instance.destroy = () => {
		if (instance.destroyed) return;
		instance.destroyed = true;
		detachFaq();
		unregister();
		instance.isActive = false;
		instance.mediaQueries.forEach((mq) => mq.removeEventListener("change", instance.evaluateBreakpointState));
		records.forEach((record) => resetItemNativeState(record, true));
		if (root._accordionInstance === instance) root._accordionInstance = null;
		instances = instances.filter((accordion) => accordion !== instance);
	};

	instance.evaluateBreakpointState = () => {
		if (instance.destroyed) return;
		try {
			const shouldBeActive = matchesBreakpoints(activeBreakpoints);
			if (shouldBeActive === instance.isActive) return;
			instance.isActive = shouldBeActive;
			records.forEach((record) => {
				if (record.failed || instance.destroyed) return;
				try {
					if (!shouldBeActive) { resetItemNativeState(record); return; }
					bindRecord(record);
					gsap.set(record.content, { height: record.isInitiallyOpen ? "auto" : 0, overflow: "hidden" });
					if (record.icon) gsap.set(record.icon, { rotation: record.isInitiallyOpen ? 180 : 0 });
					record.item.classList.toggle("is-open", record.isInitiallyOpen);
					record.trigger.setAttribute("aria-expanded", record.isInitiallyOpen ? "true" : "false");
					record.content.toggleAttribute("inert", !record.isInitiallyOpen);
					record.content.setAttribute("aria-hidden", record.isInitiallyOpen ? "false" : "true");
					record.timeline.progress(record.isInitiallyOpen ? 1 : 0).pause();
					record.item.setAttribute("data-accordion-ready", "true");
				} catch (error) { failRecord(record, error); }
			});
		} catch (error) {
			fallback();
			instance.destroy();
			console.warn("[accordions] breakpoint setup failed", error);
		}
	};

	const rollback = () => { fallback(); instance.destroy(); };
	if (faq) detachFaq = registerFaqCleanup(faq, instance, () => instance.destroy());
	else unregister = registerPending(root, rollback);
	if (instance.destroyed) return null;


	try {
		records.forEach((record) => {
			if (instance.destroyed) return;
			try {
				record.timeline = gsap.timeline({ paused: true, reversed: !record.isInitiallyOpen });
				record.timeline.fromTo(record.content, { height: 0 }, { height: "auto", duration: 0.4, ease });
				if (record.icon) record.timeline.fromTo(record.icon, { rotation: 0 }, { rotation: 180, duration: 0.4, ease }, "<");
			} catch (error) { failRecord(record, error); }
		});
		if (instance.destroyed) return null;
		activeBreakpoints.forEach((breakpoint) => {
			const mq = window.matchMedia(BREAKPOINT_QUERIES[breakpoint]);
			instance.mediaQueries.push(mq);
			mq.addEventListener("change", instance.evaluateBreakpointState);
		});
		root._accordionInstance = instance;
		instances.push(instance);
		instance.evaluateBreakpointState();
		if (instance.destroyed) return null;
		if (faq ? !canStartFaq(faq) : !canStartComponent()) {
			refuseLate();
			instance.destroy();
			return null;
		}
		records.forEach((record) => {
			if (!record.failed) record.item.setAttribute("data-accordion-startup-state", "managed");
		});
		unregister();
	} catch (error) {
		rollback();
		console.warn("[accordions] setup failed", error);
		return null;
	}

	return instance.destroyed ? null : instance;
}

export function initAccordions(scopeOrSettings = document, maybeSettings = {}) {
	const { scope, settings } = normalizeInitArgs(scopeOrSettings, maybeSettings);
	if (document.readyState === "loading") {
		const pending = { scope, run: null };
		pending.run = () => {
			pendingInits = pendingInits.filter((entry) => entry !== pending);
			initAccordions(scope, settings);
		};
		pendingInits.push(pending);
		document.addEventListener("DOMContentLoaded", pending.run, { once: true });
		return [];
	}

	bindFinsweetEvents();

	return getAccordionRoots(scope)
		.map((component) => {
			try { return createAccordion(component, settings); }
			catch (error) {
				getItemsFromRoot(component).forEach((item) => item.setAttribute("data-accordion-startup-state", "fallback"));
				fallbackFaq(accordionFaqRoot(component));
				console.warn("[accordions] setup failed", error); return null;
			}
		})
		.filter(Boolean);
}

export function destroyAccordions(scope) {
	pendingInits = pendingInits.filter((entry) => {
		if (scope && entry.scope !== scope) return true;
		document.removeEventListener("DOMContentLoaded", entry.run);
		return false;
	});
	const scopedRoots = scope ? new Set(getAccordionRoots(scope)) : null;

	[...instances].forEach((instance) => {
		if (!scopedRoots || scopedRoots.has(instance.root)) {
			instance.destroy();
		}
	});
}

export function reInitAccordions(scopeOrSettings = document, maybeSettings = {}) {
	const { scope, settings } = normalizeInitArgs(scopeOrSettings, maybeSettings);

	destroyAccordions(scope);
	return initAccordions(scope, settings);
}

export function getAccordionInstances() {
	return [...instances];
}
