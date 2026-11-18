import { canStartFaq, fallbackFaq, registerFaqCleanup, completeFaq } from "./faq-startup.js";
import { BREAKPOINT_PX } from "../utils/breakpoints.js";

const DESKTOP_MQ = `(min-width: ${BREAKPOINT_PX.tabletMin}px)`;
const COMPONENT = '[data-faq-split="component"]';
const instances = new Map();
let splitMq = null;
let waitingForMarkup = false;

function collectNewItems(instance) {
	const { component, source, items, positions } = instance;
	const candidates = [...component.querySelectorAll('[data-faq-split="item"]'),
		...source.querySelectorAll('[data-faq-split="item"]')];
	candidates.forEach((item) => {
		if (items.includes(item)) return;
		const owner = item.closest(COMPONENT);
		if (owner && owner !== component) return;
		items.push(item);
		// Runtime target columns are not an authored source location. New static
		// questions belong after existing source items on later normal resizes.
		positions.push({ item, parent: source.contains(item) ? item.parentNode : source,
			next: source.contains(item) ? item.nextSibling : null });
	});
}

function restoreFocus(element) {
	if (element && element !== document.activeElement && element.isConnected &&
		!element.closest("[hidden], [inert]")) element.focus({ preventScroll: true });
}

function restoreWrapperDisplay(instance) {
	if (!instance.splitWrapper) return;
	if (instance.wrapperDisplay) instance.splitWrapper.style.setProperty("display", instance.wrapperDisplay, instance.wrapperPriority);
	else instance.splitWrapper.style.removeProperty("display");
}

function restoreFaqSource(instance) {
	collectNewItems(instance);
	const { source, positions, placeholder, sourceParent, sourceNext, component } = instance;
	const focused = document.activeElement;
	// Reverse insertion preserves authored wrappers, node identities and source order.
	[...positions].reverse().forEach(({ item, parent, next }) => {
		const following = positions.slice(positions.findIndex((p) => p.item === item) + 1)
			.find((p) => p.parent === parent && p.item.parentNode === parent)?.item;
		const anchor = next?.parentNode === parent ? next : following || null;
		if (item.parentNode !== parent || item.nextSibling !== anchor) parent.insertBefore(item, anchor);
	});
	if (placeholder.parentNode) placeholder.replaceWith(source);
	else if (source.parentNode !== sourceParent) sourceParent.insertBefore(source, sourceNext?.parentNode === sourceParent ? sourceNext : null);
	// Fallback CSS hides inactive columns. Never let our mobile display:none
	// become the next instance's authored desktop display after a retry.
	restoreWrapperDisplay(instance);
	component.removeAttribute("data-faq-split-state");
	instance.isDesktop = null;
	restoreFocus(focused);
}

function failLayout(instance, error) {
	fallbackFaq(instance.component);
	if (instances.has(instance.component)) {
		restoreFaqSource(instance);
		instance.detach?.();
		instances.delete(instance.component);
	}
	console.warn("[faq] restored source after layout failure", error);
}

function setLayout(instance, isDesktop) {
	if (instance.component.getAttribute("data-faq-startup-state") === "fallback" || instance.isDesktop === isDesktop) return;
	const { component, source, items, target1, target2, placeholder, splitWrapper } = instance;
	collectNewItems(instance);
	if (!isDesktop) {
		restoreFaqSource(instance);
		if (splitWrapper) splitWrapper.style.display = "none";
	} else {
		// Hidden items have no measurable position: assign columns by source index.
		items.forEach((item, index) => (index % 2 === 0 ? target1 : target2).appendChild(item));
		source.replaceWith(placeholder);
		restoreWrapperDisplay(instance);
	}
	instance.isDesktop = isDesktop;
	component.setAttribute("data-faq-split-state", isDesktop ? "desktop" : "mobile");
}

function updateLayouts() {
	instances.forEach((instance, component) => {
		const focused = document.activeElement;
		try {
			if (!component.isConnected) { restoreFaqSource(instance); instance.detach?.(); instances.delete(component); return; }
			setLayout(instance, splitMq.matches);
		} catch (error) { failLayout(instance, error); }
		finally { restoreFocus(focused); }
	});
}

function initWhenReady() {
	waitingForMarkup = false;
	try {
		if (!splitMq) {
			const mq = window.matchMedia(DESKTOP_MQ);
			mq.addEventListener("change", updateLayouts);
			splitMq = mq;
		}
	} catch (error) {
		document.querySelectorAll(COMPONENT).forEach((root) => fallbackFaq(root));
		console.warn("[faq] media setup failed", error); return;
	}

	document.querySelectorAll(COMPONENT).forEach((component) => {
		if (instances.has(component) || !canStartFaq(component)) return;
		try {
			const owned = (selector) => [...component.querySelectorAll(selector)].find((el) => el.closest(COMPONENT) === component);
			const source = owned('[data-faq-split="source"]');
			const target1 = owned('[data-faq-split="target-1"]');
			const target2 = owned('[data-faq-split="target-2"]');
			if (!source || !target1 || !target2) { fallbackFaq(component); return; }
			const items = [...source.querySelectorAll('[data-faq-split="item"]')].filter((item) => item.closest(COMPONENT) === component);
			if (!items.length) { completeFaq(component); return; }
			const parent = target1.parentElement;
			const splitWrapper = parent === target2.parentElement && !parent.contains(source) ? parent : null;
			const instance = {
				component, source, items, target1, target2,
				positions: items.map((item) => ({ item, parent: item.parentNode, next: item.nextSibling })),
				sourceParent: source.parentNode, sourceNext: source.nextSibling,
				placeholder: document.createComment("FAQ source"), splitWrapper,
				wrapperDisplay: splitWrapper?.style.getPropertyValue("display") || "",
				wrapperPriority: splitWrapper?.style.getPropertyPriority("display") || "",
				isDesktop: null,
			};
			instances.set(component, instance);
			instance.detach = registerFaqCleanup(component, instance, () => {
				restoreFaqSource(instance);
				instance.detach?.();
				instances.delete(component);
			});
			if (!instances.has(component)) return;
			const focused = document.activeElement;
			try { setLayout(instance, splitMq.matches); completeFaq(component); }
			finally { restoreFocus(focused); }
		} catch (error) {
			const instance = instances.get(component);
			if (instance) failLayout(instance, error);
			else fallbackFaq(component);
			console.warn("[faq] setup failed", error);
		}
	});
}

export function initFaq() {
	// Existing source nodes need no image measurement. Never wait for window.load.
	if (document.readyState !== "loading") initWhenReady();
	else if (!waitingForMarkup) {
		document.addEventListener("DOMContentLoaded", initWhenReady, { once: true });
		waitingForMarkup = true;
	}
}

export function destroyFaq() {
	document.removeEventListener("DOMContentLoaded", initWhenReady);
	waitingForMarkup = false;
	splitMq?.removeEventListener("change", updateLayouts);
	splitMq = null;
	instances.forEach((instance) => { restoreFaqSource(instance); instance.detach?.(); });
	instances.clear();
}
