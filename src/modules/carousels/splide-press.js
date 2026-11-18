const PRESS_LAYOUT_SELECTOR = ".press_layout-outer";
const PRESS_LAYOUT_INNER_SELECTOR = ".press_layout-inner";
const PRESS_HEADER_SELECTOR = ".press_header";
const DEFAULT_COLLISION_CLASS = "is-vertical";
const MOBILE_MAX_WIDTH = 767;
const RESIZE_DEBOUNCE_MS = 120;
const DEFAULT_GAP_PX = 0;

function debounce(callback, delay = RESIZE_DEBOUNCE_MS) {
	let timeoutId = null;

	const debounced = () => {
		window.clearTimeout(timeoutId);
		timeoutId = window.setTimeout(() => {
			timeoutId = null;
			callback();
		}, delay);
	};

	debounced.cancel = () => {
		window.clearTimeout(timeoutId);
		timeoutId = null;
	};

	return debounced;
}

function resolveFiniteNumber(value, fallback = 0) {
	return Number.isFinite(value) ? value : fallback;
}

function getElementWidth(element) {
	if (!element) return 0;

	const rectWidth = element.getBoundingClientRect?.().width || 0;
	const offsetWidth = element.offsetWidth || 0;
	const width = Math.max(rectWidth, offsetWidth);

	return Number.isFinite(width) ? width : 0;
}

function getGapWidth(inner) {
	if (!inner) return DEFAULT_GAP_PX;

	const style = window.getComputedStyle?.(inner);
	if (!style) return DEFAULT_GAP_PX;

	const rawGap = style.columnGap || style.gap || style.gridColumnGap || style.rowGap || "";
	const gap = Number.parseFloat(rawGap);

	return Number.isFinite(gap) && gap >= 0 ? gap : DEFAULT_GAP_PX;
}

export function createPressLayoutCollisionController(root, splide, options = {}) {
	const pressLayout = root?.closest(PRESS_LAYOUT_SELECTOR);
	const pressLayoutInner = pressLayout?.querySelector(PRESS_LAYOUT_INNER_SELECTOR);
	const pressHeader = pressLayout?.querySelector(PRESS_HEADER_SELECTOR);
	const splideList = splide?.Components?.Elements?.list || root?.querySelector(".splide__list");

	if (!pressLayout || !pressLayoutInner || !pressHeader || !splideList) {
		return {
			update() {},
			scheduleUpdate() {},
			destroy() {},
		};
	}

	const collisionClass = options.collisionClass || DEFAULT_COLLISION_CLASS;
	const gapPx =
		Number.isFinite(options.gapPx) && options.gapPx >= 0 ? options.gapPx : DEFAULT_GAP_PX;

	const originalCollisionActive = pressLayout.classList.contains(collisionClass);
	let isCollisionActive = originalCollisionActive;
	let recheckFrame = null;
	const scheduleUpdate = debounce(update);

	function setCollisionState(isCollision) {
		isCollisionActive = isCollision;
		pressLayout.classList.toggle(collisionClass, isCollision);
	}

	function scheduleRecheck() {
		if (recheckFrame !== null) {
			return;
		}

		recheckFrame = window.requestAnimationFrame(() => {
			recheckFrame = null;
			update();
		});
	}

	function update() {
		if (window.innerWidth <= MOBILE_MAX_WIDTH) {
			setCollisionState(false);
			return false;
		}

		const outerWidth = getElementWidth(pressLayout);
		const headerWidth = getElementWidth(pressHeader);
		const carouselWidth = getElementWidth(splideList);
		const gapWidth = getGapWidth(pressLayoutInner);
		const totalWidth = headerWidth + carouselWidth + gapWidth + gapPx;
		const isCollision = outerWidth > 0 && totalWidth > outerWidth;

		if (isCollision !== isCollisionActive) {
			setCollisionState(isCollision);

			// Re-run once after the layout has had a chance to react to the new class.
			scheduleRecheck();
		}

		return isCollision;
	}

	window.addEventListener("resize", scheduleUpdate, { passive: true });

	return {
		update,
		scheduleUpdate,
		destroy() {
			window.removeEventListener("resize", scheduleUpdate);
			scheduleUpdate.cancel();
			if (recheckFrame !== null) {
				window.cancelAnimationFrame(recheckFrame);
				recheckFrame = null;
			}
			setCollisionState(originalCollisionActive);
		},
	};
}
