import { BREAKPOINT_PX } from "../utils/breakpoints.js";

const DESKTOP_MQ = `(min-width: ${BREAKPOINT_PX.tabletMin}px)`;
const COMPONENT = '[data-faq-split="component"]';
const instances = new Map();
let splitMq = null;
let waitingForLoad = false;

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
	const { source, positions, placeholder, sourceParent, sourceNext, component } = instance;
	const focused = document.activeElement;
	// Reverse insertion preserves authored wrappers, node identities and source order.
	[...positions].reverse().forEach(({ item, parent, next }) => {
		const anchor = next?.parentNode === parent ? next : null;
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
	try { restoreFaqSource(instance); }
	finally { instances.delete(instance.component); }
	console.warn("[faq] restored source after layout failure", error);
}

function setLayout(instance, isDesktop) {
	if (instance.isDesktop === isDesktop) return;
	const { component, source, items, target1, target2, placeholder, splitWrapper } = instance;
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
			if (!component.isConnected) { restoreFaqSource(instance); instances.delete(component); return; }
			setLayout(instance, splitMq.matches);
		} catch (error) { failLayout(instance, error); }
		finally { restoreFocus(focused); }
	});
}

function initWhenReady() {
	waitingForLoad = false;
	try {
		if (!splitMq) {
			const mq = window.matchMedia(DESKTOP_MQ);
			mq.addEventListener("change", updateLayouts);
			splitMq = mq;
		}
	} catch (error) { console.warn("[faq] media setup failed", error); return; }

	document.querySelectorAll(COMPONENT).forEach((component) => {
		if (instances.has(component)) return;
		try {
			const owned = (selector) => [...component.querySelectorAll(selector)].find((el) => el.closest(COMPONENT) === component);
			const source = owned('[data-faq-split="source"]');
			const target1 = owned('[data-faq-split="target-1"]');
			const target2 = owned('[data-faq-split="target-2"]');
			if (!source || !target1 || !target2) return;
			const items = [...source.querySelectorAll('[data-faq-split="item"]')].filter((item) => item.closest(COMPONENT) === component);
			if (!items.length) return;
			const parent = target1.parentElement;
			const splitWrapper = parent === target2.parentElement && !parent.contains(source) ? parent : null;
			instances.set(component, {
				component, source, items, target1, target2,
				positions: items.map((item) => ({ item, parent: item.parentNode, next: item.nextSibling })),
				sourceParent: source.parentNode, sourceNext: source.nextSibling,
				placeholder: document.createComment("FAQ source"), splitWrapper,
				wrapperDisplay: splitWrapper?.style.getPropertyValue("display") || "",
				wrapperPriority: splitWrapper?.style.getPropertyPriority("display") || "",
				isDesktop: null,
			});
		} catch (error) { console.warn("[faq] setup failed", error); }
	});
	updateLayouts();
}

export function initFaq() {
	if (document.documentElement.classList.contains("sr-page-loaded")) initWhenReady();
	else if (!waitingForLoad) {
		window.addEventListener("load", initWhenReady, { once: true });
		waitingForLoad = true;
	}
}

export function destroyFaq() {
	window.removeEventListener("load", initWhenReady);
	waitingForLoad = false;
	splitMq?.removeEventListener("change", updateLayouts);
	splitMq = null;
	instances.forEach((instance) => restoreFaqSource(instance));
	instances.clear();
}
