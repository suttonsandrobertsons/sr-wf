import { BREAKPOINT_PX } from "../utils/breakpoints.js";

const DESKTOP_MQ = `(min-width: ${BREAKPOINT_PX.tabletMin}px)`;
const COMPONENT = '[data-faq-split="component"]';
const instances = new Map();
let splitMq = null;

function setLayout(instance, isDesktop) {
	if (instance.isDesktop === isDesktop) return;
	const { source, items, target1, target2, placeholder, splitWrapper } = instance;

	// Keep the original item references and order shared with load more.
	// Hidden items have no measurable position, so assign columns by index.
	items.forEach((item, index) => {
		const target = isDesktop ? (index % 2 === 0 ? target1 : target2) : source;
		target.appendChild(item);
	});

	if (isDesktop) {
		source.replaceWith(placeholder);
	} else if (placeholder.parentNode) {
		placeholder.replaceWith(source);
	}

	if (splitWrapper) {
		splitWrapper.style.display = isDesktop ? instance.wrapperDisplay : "none";
	}
	instance.isDesktop = isDesktop;
}

function updateLayouts() {
	instances.forEach((instance, component) => {
		if (!component.isConnected) {
			instances.delete(component);
			return;
		}
		setLayout(instance, splitMq.matches);
	});
}

function initWhenReady() {
	if (!splitMq) {
		splitMq = window.matchMedia(DESKTOP_MQ);
		splitMq.addEventListener("change", updateLayouts);
	}

	document.querySelectorAll(COMPONENT).forEach((component) => {
		if (instances.has(component)) return;
		const owned = (selector) => [...component.querySelectorAll(selector)]
			.find((element) => element.closest(COMPONENT) === component);
		const source = owned('[data-faq-split="source"]');
		const target1 = owned('[data-faq-split="target-1"]');
		const target2 = owned('[data-faq-split="target-2"]');
		if (!source || !target1 || !target2) return;

		const items = [...source.querySelectorAll('[data-faq-split="item"]')]
			.filter((item) => item.closest(COMPONENT) === component);
		if (!items.length) return;

		// Hide the empty columns wrapper on mobile without hiding the source.
		const parent = target1.parentElement;
		const splitWrapper = parent === target2.parentElement && !parent.contains(source)
			? parent : null;
		instances.set(component, {
			source, items, target1, target2,
			placeholder: document.createComment("FAQ source"),
			splitWrapper,
			wrapperDisplay: splitWrapper?.style.display || "",
			isDesktop: null,
		});
	});

	updateLayouts();
}

export function initFaq() {
	if (document.documentElement.classList.contains("sr-page-loaded")) {
		initWhenReady();
	} else {
		window.addEventListener("load", initWhenReady, { once: true });
	}
}
