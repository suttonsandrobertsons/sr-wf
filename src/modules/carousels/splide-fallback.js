// Keep ownership at the nearest Splide root, including for nested carousels.
export function ownedElements(root, selector) {
	return Array.from(root.querySelectorAll(selector)).filter(el => el.closest(".splide") === root);
}

// Splide removes these attributes on structural elements during full teardown.
const STRUCTURAL_ATTRIBUTES = [
	"id", "role", "tabindex", "disabled", "aria-label", "aria-labelledby", "aria-roledescription",
	"aria-hidden", "aria-controls", "aria-current", "aria-orientation",
];
const isOwnedClass = name => /^(splide--|splide__track--|splide__list--|splide__pagination--)/.test(name)
	|| /^is-(active|visible|prev|next|initialized|rendered|overflow|focus-in|loading|dragging|center-slide|carousel-active|carousel-inactive)$/.test(name);

function readStyles(element, filter = () => true) {
	return new Map(Array.from(element.style).filter(filter).map(name => [
		name, [element.style.getPropertyValue(name), element.style.getPropertyPriority(name)],
	]));
}

export function snapshotCarousel(root, list, settings) {
	const nodes = new Set([root, ...ownedElements(root, "*")]);
	const listChildren = Array.from(list.childNodes);
	const pagination = ownedElements(root, settings.dotsSelector)[0];
	const paginationChildren = pagination ? Array.from(pagination.childNodes) : null;
	const records = [];
	const images = new Map();
	const classOwned = name => isOwnedClass(name) || [
		settings.dotsListClass, settings.activeClass, settings.activeCarouselClass,
		settings.inactiveCarouselClass, settings.draggingClass, settings.centerSlideClass,
	].includes(name);

	function capture(el, attrs, styleProperties = [], ownsClasses = false) {
		if (!el) return;
		records.push({
			el, attrs: attrs.map(name => [name, el.getAttribute(name)]),
			styleProperties, styles: styleProperties.length ? readStyles(el) : null,
			ownsClasses, classes: ownsClasses ? Array.from(el.classList).filter(classOwned) : [],
		});
	}
	capture(root, [...STRUCTURAL_ATTRIBUTES, "data-splide-active", "data-carousel-active"], ["max-width"], true);
	capture(list.parentElement, [...STRUCTURAL_ATTRIBUTES, "aria-live", "aria-atomic", "aria-busy"], [
		"height", "padding-left", "padding-right", "padding-top", "padding-bottom",
	], true);
	capture(list, STRUCTURAL_ATTRIBUTES, ["transform", "transition"], true);
	Array.from(list.children).filter(el => el.matches(settings.slideSelector)).forEach(slide => {
		capture(slide, STRUCTURAL_ATTRIBUTES, [
			"width", "height", "margin-left", "margin-right", "margin-top", "margin-bottom", "transform", "transition",
		], true);
		// Splide changes tab stops inside slides; it does not own their form
		// disabled state, visibility, classes or content styles.
		ownedElements(root, "a, button, textarea, input, select, iframe, [tabindex]")
			.filter(el => el !== slide && slide.contains(el))
			.forEach(el => capture(el, ["tabindex"]));
	});
	capture(pagination, ["hidden"], [], true);

	let foreignStyles;
	return {
		captureImageLoading(elements) {
			elements.forEach(el => images.set(el, el.getAttribute("loading")));
		},
		beforeDestroy() {
			// Complete vendor teardown removes entire structural style attrs.
			foreignStyles = records.map(({ el, styleProperties, styles }) => styles
				? readStyles(el, name => !styleProperties.includes(name)) : null);
		},
		restore() {
			const document = root.ownerDocument;
			const focused = root.contains(document.activeElement) ? document.activeElement : null;
			// Preserve original node identities and any independently owned child.
			ownedElements(root, `.splide__slide--clone, [${settings.marqueeDuplicateAttr}], .splide__pagination`)
				.forEach(el => { if (!nodes.has(el)) el.remove(); });
			const restoreChildren = (parent, children) => {
				if (parent.childNodes.length !== children.length || children.some((node, index) => parent.childNodes[index] !== node)) {
					parent.replaceChildren(...children);
				}
			};
			restoreChildren(list, listChildren);
			if (pagination) restoreChildren(pagination, paginationChildren);
			records.forEach(({ el, attrs, classes, styles, styleProperties, ownsClasses }, index) => {
				attrs.forEach(([name, value]) => {
					if (value === null) el.removeAttribute(name);
					else el.setAttribute(name, value);
				});
				if (ownsClasses) {
					Array.from(el.classList).filter(classOwned).forEach(name => el.classList.remove(name));
					classes.forEach(name => el.classList.add(name));
				}
				if (!styles) return;
				const unowned = foreignStyles?.[index] || readStyles(el, name => !styleProperties.includes(name));
				Array.from(el.style).forEach(name => el.style.removeProperty(name));
				styleProperties.forEach(name => {
					const value = styles.get(name);
					if (value) el.style.setProperty(name, ...value);
				});
				unowned.forEach((value, name) => el.style.setProperty(name, ...value));
				if (!el.style.length) el.removeAttribute("style");
			});
			images.forEach((value, el) => {
				if (value === null) el.removeAttribute("loading");
				else el.setAttribute("loading", value);
			});
			// The caller first exposes fallback, so native focus can reach the card.
			return () => {
				if (focused?.isConnected && root.contains(focused) && document.activeElement === document.body) {
					focused.focus({ preventScroll: true });
				}
			};
		},
	};
}
