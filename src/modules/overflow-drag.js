const OVERFLOW_DRAG_TRACK_SELECTOR = [
	"[data-overflow-drag='track']",
	".overflow-content_track",
	".trust-bar_track",
].join(", ");
const OVERFLOW_DRAG_ITEMS_SELECTOR = [
	"[data-overflow-drag='content']",
	".overflow-content_list",
	".trust-bar_items",
].join(", ");
const OVERFLOW_DRAG_CLEANUP_KEY = "__overflowDragCleanup";
const OVERFLOW_DRAG_REVEAL_KEY = "__overflowDragReveal";

export function revealOverflowItem(item) {
	const wrapper = item?.closest(OVERFLOW_DRAG_TRACK_SELECTOR);
	const reveal = wrapper?.[OVERFLOW_DRAG_REVEAL_KEY];
	if (typeof reveal === "function") {
		reveal(item);
	} else {
		item?.scrollIntoView?.({ block: "nearest", inline: "nearest", behavior: "instant" });
	}
}

export function initOverflowDrag() {
	if (typeof gsap === "undefined" || typeof Draggable === "undefined") {
		console.warn("[overflowDrag] GSAP or Draggable not found.");

		return;
	}

	document.querySelectorAll(OVERFLOW_DRAG_TRACK_SELECTOR).forEach((wrapper) => {
		const items = wrapper.querySelector(OVERFLOW_DRAG_ITEMS_SELECTOR);

		if (!items) {
			return;
		}

		if (typeof wrapper[OVERFLOW_DRAG_CLEANUP_KEY] === "function") {
			wrapper[OVERFLOW_DRAG_CLEANUP_KEY]();
		}

		wrapper.dataset.overflowDragBound = "true";

		let draggable;
		let resizeTimer;

		function getMetrics() {
			const visibleWidth = wrapper.clientWidth;

			const contentWidth = items.scrollWidth;
			const overflowAmount = contentWidth - visibleWidth;
			const hasOverflow = overflowAmount > 0;

			wrapper.classList.toggle("has-overflow", hasOverflow);

			return {
				visibleWidth,
				contentWidth,
				overflowAmount,
				hasOverflow,
				minX: Math.min(0, visibleWidth - contentWidth),
				maxX: 0,
			};
		}

		function init() {
			const metrics = getMetrics();

			if (draggable) {
				draggable.kill();
				draggable = null;
			}

			gsap.set(items, {
				x: 0,
			});

			if (!metrics.hasOverflow) {
				return;
			}

			draggable = Draggable.create(items, {
				type: "x",
				inertia: true,
				zIndexBoost: false,
				bounds: {
					minX: metrics.minX,
					maxX: metrics.maxX,
				},
				edgeResistance: 0.9,
				dragClickables: true,
				onPress() {
					items.classList.add("is-dragging");
				},
				onRelease() {
					items.classList.remove("is-dragging");
				},
				onDragEnd() {
					items.classList.remove("is-dragging");
				},
			})[0];

			if (items.contains(document.activeElement)) {
				revealItem(document.activeElement);
			}
		}

		function onResize() {
			clearTimeout(resizeTimer);

			resizeTimer = setTimeout(() => {
				init();
			}, 100);
		}

		function revealItem(item) {
			if (!items.contains(item) || item.closest(OVERFLOW_DRAG_TRACK_SELECTOR) !== wrapper) return;
			// Keyboard focus takes over from a drag, including a still-pending throw.
			draggable?.tween?.kill();
			gsap.killTweensOf(items);
			const trackRect = wrapper.getBoundingClientRect();
			const itemRect = item.getBoundingClientRect();
			const offset = itemRect.left < trackRect.left
				? trackRect.left - itemRect.left
				: Math.min(0, trackRect.right - itemRect.right);
			if (!offset) return;

			const { minX, maxX } = getMetrics();
			const currentX = Number(gsap.getProperty(items, "x")) || 0;
			gsap.set(items, { x: Math.max(minX, Math.min(maxX, currentX + offset)) });
			draggable?.update(true);
		}

		function cleanup() {
			clearTimeout(resizeTimer);
			window.removeEventListener("resize", onResize);

			if (draggable) {
				draggable.kill();
				draggable = null;
			}

			wrapper.classList.remove("has-overflow");
			if (wrapper[OVERFLOW_DRAG_REVEAL_KEY] === revealItem) {
				delete wrapper[OVERFLOW_DRAG_REVEAL_KEY];
			}
		}

		init();
		window.addEventListener("resize", onResize);
		wrapper[OVERFLOW_DRAG_CLEANUP_KEY] = cleanup;
		wrapper[OVERFLOW_DRAG_REVEAL_KEY] = revealItem;
	});
}
