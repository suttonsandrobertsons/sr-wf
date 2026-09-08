import { qsa, qs } from "../../utils/dom.js";
import { BREAKPOINT_PX } from "../../utils/breakpoints.js";
import { createPressLayoutCollisionController } from "./splide-press.js";
let instances = [];
const FORM_CHANGE_LISTENER_KEY = "__splideFormChangeListenerBound";
const IMAGE_LOAD_REFRESH_TIMEOUT_MS = 5000;

const defaults = {
	selector: ".splide",
	trackSelector: ".splide__track",
	slideSelector: ".splide__slide",

	dotsListClass: "carousel-controls_dots",
	dotsSelector: ".carousel-controls_dots",
	dotClass: "carousel-controls_dot",
	activeClass: "is-active",
	activeCarouselClass: "is-carousel-active",
	inactiveCarouselClass: "is-carousel-inactive",
	draggingClass: "is-dragging",
	centerSlideClass: "is-center-slide",

	loopAttr: "data-splide-loop",
	loopMobileAttr: "data-splide-loop-mobile",
	draggableAttr: "data-splide-draggable",
	paginationAttr: "data-splide-pagination",
	gapAttr: "data-splide-gap",
	gapMobileAttr: "data-splide-gap-mobile",
	centeredAttr: "data-splide-centered",
	centerSlideAttr: "data-splide-update-center", // optional behaviour to add a class to the slide closest to the center of the track on each move/resize
	customAttr: "data-splide-custom",
	autoScrollAttr: "data-splide-autoscroll",
	autoScrollMobileAttr: "data-splide-autoscroll-mobile",
	autoScrollSpeedAttr: "data-splide-autoscroll-speed",
	autoScrollPauseOnHoverAttr: "data-splide-autoscroll-pause-on-hover",
	splideAutoplayDelay: 1,
	centerSlideMinWidth: BREAKPOINT_PX.tabletMin,
	mobileMaxWidth: BREAKPOINT_PX.tabletMin,

	options: {
		loop: false,
		loopMobile: null,
		draggable: true,
		drag: true,
		centered: false,
		centerSlide: false,
		autoScroll: false,
		autoScrollMobile: null,
		autoScrollSpeed: 2,
		autoScrollPauseOnHover: null,
		gap: 36,
		gapMobile: 16,
		perPage: "auto",
		pagination: true,
		flickPower: 400,
	},
};

function getCarouselLabel(root) {
	if (!root) return "unknown-carousel";

	const name = root.getAttribute("data-splide-name") || root.getAttribute("data-carousel-name");
	if (name) {
		return name;
	}

	if (root.id) {
		return `#${root.id}`;
	}

	const className = typeof root.className === "string" ? root.className.trim() : "";
	if (className) {
		const fallbackClass = className.split(/\s+/).find((classToken) => classToken);

		if (fallbackClass) {
			return `.${fallbackClass}`;
		}
	}

	return root.tagName.toLowerCase();
}

function logCarousel(root, message, details) {
	const prefix = `[carousels/splide] ${getCarouselLabel(root)}`;

	if (typeof details === "undefined") {
		console.log(prefix, message);
		return;
	}

	console.log(prefix, message, details);
}

function getSplideActiveState(splide, isOverflow) {
	if (!splide) return false;

	if (typeof isOverflow === "boolean") {
		return isOverflow;
	}

	const layout = splide.Components?.Layout;
	if (layout && typeof layout.isOverflow === "function") {
		return layout.isOverflow();
	}

	const root = splide.root || splide.Components?.Elements?.root;
	return Boolean(root?.classList?.contains("is-overflow"));
}

function isCustomCarousel(root, settings) {
	return Boolean(root?.hasAttribute(settings.customAttr));
}

function parseBooleanAttr(root, attrName, fallbackValue) {
	const value = root.getAttribute(attrName);

	if (value === null) {
		return fallbackValue;
	}

	if (value === "true") {
		return true;
	}

	if (value === "false") {
		return false;
	}

	console.warn(
		`[carousels/splide] Ignoring invalid boolean attribute value for ${attrName}:`,
		value,
		root,
	);
	return fallbackValue;
}

function parsePositiveNumberAttr(root, attrName, fallbackValue) {
	const value = root.getAttribute(attrName);

	if (value === null) {
		return fallbackValue;
	}

	const parsed = Number(value);
	if (Number.isFinite(parsed) && parsed > 0) {
		return parsed;
	}

	console.warn(
		`[carousels/splide] Ignoring invalid numeric attribute value for ${attrName}:`,
		value,
		root,
	);
	return fallbackValue;
}

function parseNonNegativeNumberAttr(root, attrName, fallbackValue) {
	const value = root.getAttribute(attrName);

	if (value === null) {
		return fallbackValue;
	}

	const parsed = Number(value);
	if (Number.isFinite(parsed) && parsed >= 0) {
		return parsed;
	}

	console.warn(
		`[carousels/splide] Ignoring invalid numeric attribute value for ${attrName}:`,
		value,
		root,
	);
	return fallbackValue;
}

function resolveSettings(root, userSettings) {
	const settings = {
		...defaults,
		...userSettings,
		options: {
			...defaults.options,
			...(userSettings.options || {}),
		},
	};

	settings.options.loop = parseBooleanAttr(root, settings.loopAttr, settings.options.loop);
	settings.options.loopMobile = parseBooleanAttr(
		root,
		settings.loopMobileAttr,
		settings.options.loopMobile,
	);
	settings.options.centered = parseBooleanAttr(
		root,
		settings.centeredAttr,
		settings.options.centered,
	);
	settings.options.centerSlide = parseBooleanAttr(
		root,
		settings.centerSlideAttr,
		settings.options.centerSlide,
	);
	settings.options.draggable = parseBooleanAttr(
		root,
		settings.draggableAttr,
		settings.options.draggable,
	);
	settings.options.drag = settings.options.draggable;
	settings.options.autoScroll = parseBooleanAttr(
		root,
		settings.autoScrollAttr,
		settings.options.autoScroll,
	);
	settings.options.autoScrollMobile = parseBooleanAttr(
		root,
		settings.autoScrollMobileAttr,
		settings.options.autoScrollMobile,
	);
	settings.options.autoScrollSpeed = parsePositiveNumberAttr(
		root,
		settings.autoScrollSpeedAttr,
		settings.options.autoScrollSpeed,
	);
	settings.options.autoScrollPauseOnHover = parseBooleanAttr(
		root,
		settings.autoScrollPauseOnHoverAttr,
		settings.options.autoScrollPauseOnHover,
	);
	settings.options.pagination = parseBooleanAttr(
		root,
		settings.paginationAttr,
		settings.options.pagination,
	);
	settings.options.gap = parseNonNegativeNumberAttr(root, settings.gapAttr, settings.options.gap);
	settings.options.gapMobile = parseNonNegativeNumberAttr(
		root,
		settings.gapMobileAttr,
		settings.options.gapMobile,
	);

	return settings;
}

function getSplideAutoScrollExtensions() {
	const globalExtensions = window.splide?.Extensions;

	if (globalExtensions?.AutoScroll) {
		return globalExtensions;
	}

	if (typeof window.AutoScroll === "function") {
		return { AutoScroll: window.AutoScroll };
	}

	if (typeof SplideAutoScroll === "function") {
		return { AutoScroll: SplideAutoScroll };
	}

	return null;
}

function getSplideOptions(root, settings) {
	const isLooping = settings.options.loop === true;
	const isDraggable = settings.options.draggable === true;
	const isAutoScrollEnabled = settings.options.autoScroll === true;
	const isPaginationEnabled = settings.options.pagination === true;
	const autoScrollSpeed = settings.options.autoScrollSpeed;

	const options = {
		type: isLooping ? "loop" : "slide",
		rewind: !isLooping,
		drag: isDraggable,
		pagination: isPaginationEnabled,
		arrows: false,
		autoWidth: true,
		gap: settings.options.gap || 0,
		focus: isLooping || settings.options.centered ? "center" : 0,
		omitEnd: true,
		classes: {
			pagination: "splide__pagination",
			page: `splide__pagination__page ${settings.dotClass}`,
		},
		flickPower: settings.options.flickPower || 400,
	};

	if (isAutoScrollEnabled) {
		const autoScrollExtensions = getSplideAutoScrollExtensions();

		if (autoScrollExtensions?.AutoScroll) {
			options.autoScroll = {
				speed: autoScrollSpeed,
				autoStart: false,
			};

			if (typeof settings.options.autoScrollPauseOnHover === "boolean") {
				options.autoScroll.pauseOnHover = settings.options.autoScrollPauseOnHover;
			}
		} else {
			options.autoplay = true;
			// Approximates AutoScroll's continuous motion with fixed-interval autoplay
			// when the extension is absent; 8000 is a rough speed-to-ms conversion.
			options.interval = Math.max(1000, Math.round(8000 / autoScrollSpeed));
			options.pauseOnHover =
				typeof settings.options.autoScrollPauseOnHover === "boolean"
					? settings.options.autoScrollPauseOnHover
					: false;
		}
	}

	if (Number.isFinite(settings.options.gapMobile)) {
		options.breakpoints = {
			[settings.mobileMaxWidth - 1]: {
				gap: settings.options.gapMobile,
			},
		};
	}

	return options;
}

function updateSplideState(splide, root, settings, isOverflow) {
	const isActive = getSplideActiveState(splide, isOverflow);
	const carouselControls = qs(root, ".carousel-controls");
	const paginationEl = carouselControls ? qs(carouselControls, settings.dotsSelector) : null;

	// root.classList.toggle(settings.activeCarouselClass, isActive);
	// root.classList.toggle(settings.inactiveCarouselClass, !isActive);
	// root.setAttribute("data-splide-active", isActive ? "true" : "false");
	// root.setAttribute("data-carousel-active", isActive ? "true" : "false");

	if (paginationEl) {
		const slides = splide.Components?.Slide?.getSlides() || [];
		const shouldHide = !isActive || slides.length <= 1;
		const previousHidden = paginationEl.hidden;

		paginationEl.hidden = shouldHide;

		if (previousHidden !== shouldHide) {
			logCarousel(root, "Pagination visibility changed via updateSplideState", {
				hidden: shouldHide,
				reason: !isActive ? "carousel-not-active" : slides.length <= 1 ? "single-slide" : "visible",
				isActive,
				isOverflow: typeof isOverflow === "boolean" ? isOverflow : undefined,
				slideCount: slides.length,
				paginationPresent: true,
			});
		}
	}
}

function updateSplideDragForOverflow(splide, settings, isOverflow) {
	// Splide's options setter merges these keys into the existing config rather
	// than replacing it, so this touches drag alone.
	splide.options = {
		drag: settings.options.draggable === true && isOverflow,
	};
}

function syncSplideAutoScrollForOverflow(splide, settings, isOverflow) {
	if (settings.options.autoScroll !== true) return;

	const autoScroll = splide.Components?.AutoScroll;
	if (!autoScroll) return;

	const shouldRun = getSplideActiveState(splide, isOverflow);

	if (shouldRun) {
		// The extension can pause itself during Splide's initial positioning,
		// dragging, hover, or focus. Its own isPaused() state is authoritative.
		if (autoScroll.isPaused?.() !== false) {
			autoScroll.play?.();
		}
	} else {
		autoScroll.pause?.();
	}
}

function startSplideAutoScrollWhenReady(splide, settings) {
	if (settings.options.autoScroll !== true) return;
	if (!getSplideActiveState(splide)) return;

	const autoScroll = splide.Components?.AutoScroll;
	if (!autoScroll) return;

	if (autoScroll.isPaused?.() !== false) {
		autoScroll.play?.();
	}
}

function createImageLoadRefreshController(slides, refresh) {
	const images = slides.flatMap((slide) => qsa(slide, "img"));

	if (images.length === 0) {
		return { destroy() {} };
	}

	const pendingImages = new Set(images.filter((image) => !image.complete));
	const imageListeners = new Map();
	let settleTimeout = null;
	let fallbackTimeout = null;
	let isDestroyed = false;

	function destroy() {
		if (isDestroyed) return;
		isDestroyed = true;

		if (settleTimeout !== null) {
			window.clearTimeout(settleTimeout);
			settleTimeout = null;
		}

		if (fallbackTimeout !== null) {
			window.clearTimeout(fallbackTimeout);
			fallbackTimeout = null;
		}

		imageListeners.forEach((listener, image) => {
			image.removeEventListener("load", listener);
			image.removeEventListener("error", listener);
		});
		imageListeners.clear();
	}

	function scheduleSingleRefresh() {
		if (isDestroyed || settleTimeout !== null) return;

		// Let the browser apply the final intrinsic image dimensions before measuring.
		settleTimeout = window.setTimeout(() => {
			settleTimeout = null;
			destroy();
			refresh();
		}, 0);
	}

	images.forEach((image) => {
		if (pendingImages.has(image)) {
			const handleSettle = () => {
				pendingImages.delete(image);

				if (pendingImages.size === 0) {
					scheduleSingleRefresh();
				}
			};

			imageListeners.set(image, handleSettle);
			image.addEventListener("load", handleSettle);
			image.addEventListener("error", handleSettle);
		}

		// Every logo is needed to calculate a stable auto-width loop. Native lazy
		// loading can otherwise leave off-screen slides at zero width indefinitely.
		image.loading = "eager";

		// Cover a cached image completing between the initial check and listener setup.
		if (pendingImages.has(image) && image.complete) {
			imageListeners.get(image)?.();
		}
	});

	// Cached images may already be complete before listeners are attached.
	if (pendingImages.size === 0) {
		scheduleSingleRefresh();
	} else {
		// Do not leave the carousel inactive forever if an image never settles.
		fallbackTimeout = window.setTimeout(
			scheduleSingleRefresh,
			IMAGE_LOAD_REFRESH_TIMEOUT_MS,
		);
	}

	return { destroy };
}

function updateCenterSlideClass(splide, root, settings) {
	const slides = splide.Components?.Elements?.slides || [];
	const track = qs(root, settings.trackSelector) || root;
	const trackRect = track.getBoundingClientRect();
	const centerX = trackRect.left + trackRect.width / 2;
	let closestSlide = null;
	let closestDistance = Infinity;

	slides.forEach((slide) => {
		const rect = slide.getBoundingClientRect();

		if (rect.right <= trackRect.left || rect.left >= trackRect.right) {
			return;
		}

		const slideCenter = rect.left + rect.width / 2;
		const distance = Math.abs(slideCenter - centerX);

		if (distance < closestDistance) {
			closestDistance = distance;
			closestSlide = slide;
		}
	});

	if (root._centerSlide === closestSlide) {
		return;
	}

	root._centerSlide?.classList.remove(settings.centerSlideClass);
	closestSlide?.classList.add(settings.centerSlideClass);
	root._centerSlide = closestSlide || null;
}

function shouldUpdateCenterSlide(settings) {
	return (
		settings.options.centerSlide === true &&
		window.matchMedia(`(min-width: ${settings.centerSlideMinWidth}px)`).matches
	);
}

function clearCenterSlideClass(root, settings) {
	root._centerSlide?.classList.remove(settings.centerSlideClass);
	root._centerSlide = null;
}

function hasConditionHiddenContent(slide) {
	if (!slide) return false;
	if (slide.matches("[data-form-state~='condition-hidden']")) return true;
	return Boolean(slide.querySelector("[data-form-state~='condition-hidden']"));
}

function orderSlidesByConditionVisibility(root) {
	if (!root) return;

	const list = qs(root, ".splide__list");
	if (!list) return;

	const slides = qsa(list, defaults.slideSelector);
	if (slides.length <= 1) return;

	const visibleSlides = slides.filter((slide) => !hasConditionHiddenContent(slide));
	if (visibleSlides.length === slides.length) return;

	const hiddenSlides = slides.filter((slide) => hasConditionHiddenContent(slide));
	[...visibleSlides, ...hiddenSlides].forEach((slide) => {
		list.appendChild(slide);
	});
}

function resetCarouselToStart(instance) {
	const splide = instance?.splide;
	if (!splide) return;
	if (
		typeof Splide !== "undefined" &&
		Splide.STATES?.DESTROYED &&
		splide.state?.is?.(Splide.STATES.DESTROYED)
	) {
		return;
	}

	orderSlidesByConditionVisibility(instance.root || splide.root);

	if (typeof splide.refresh === "function") {
		splide.refresh();
	}

	if (typeof splide.go === "function") {
		splide.go(0);
	}
}

function resetCarouselsInForm(form) {
	if (!form?.querySelectorAll) return;

	qsa(form, defaults.selector).forEach((root) => {
		resetCarouselToStart(root._splideInstance);
	});
}

function bindFormChangeReset() {
	if (document.documentElement[FORM_CHANGE_LISTENER_KEY]) return;

	document.documentElement[FORM_CHANGE_LISTENER_KEY] = true;

	document.addEventListener("suttons:form-change", (event) => {
		const form = event.target?.closest?.("form") || event.detail?.form?.root || event.detail?.form;
		const reset = () => {
			resetCarouselsInForm(form);
		};

		if (typeof window.requestAnimationFrame === "function") {
			window.requestAnimationFrame(reset);
		} else {
			reset();
		}
	});
}

function createSplideCarousel(root, settings, userSettings = {}) {
	if (typeof Splide === "undefined") {
		console.warn("[carousels/splide] Splide not found.", root);
		return null;
	}

	const track = qs(root, settings.trackSelector);

	if (!track) {
		console.warn("[carousels/splide] Missing track:", root);
		return null;
	}

	const slides = qsa(root, settings.slideSelector);
	const slideCount = slides.length;

	const desktopLoop = settings.options.loop;
	const mobileLoop =
		settings.options.loopMobile === null ? desktopLoop : settings.options.loopMobile;
	const desktopAutoScroll = settings.options.autoScroll;
	const mobileAutoScroll =
		settings.options.autoScrollMobile === null
			? desktopAutoScroll
			: settings.options.autoScrollMobile;
	const viewportMediaQuery = window.matchMedia(`(max-width: ${settings.mobileMaxWidth - 1}px)`);
	const viewportMatches = viewportMediaQuery.matches;
	const loopsDifferByViewport = mobileLoop !== desktopLoop;
	const autoScrollDiffersByViewport = mobileAutoScroll !== desktopAutoScroll;
	const viewportOptionsDiffer = loopsDifferByViewport || autoScrollDiffersByViewport;
	const effectiveLoop = viewportMatches ? mobileLoop : desktopLoop;
	const effectiveAutoScroll = viewportMatches ? mobileAutoScroll : desktopAutoScroll;

	const effectiveSettings = {
		...settings,
		options: {
			...settings.options,
			loop: slideCount <= 1 ? false : effectiveLoop,
			autoScroll: slideCount <= 1 ? false : effectiveAutoScroll,
		},
	};

	const splideOptions = getSplideOptions(root, effectiveSettings);
	const autoScrollExtensions =
		effectiveSettings.options.autoScroll === true ? getSplideAutoScrollExtensions() : null;

	logCarousel(root, "Splide options (init)", {
		options: splideOptions,
		slideCount,
	});

	const splide = new Splide(root, splideOptions);
	const pressLayoutCollision = createPressLayoutCollisionController(root, splide);

	let centerSlideFrame = null;
	let centerSlideLoopFrame = null;
	let isCenterSlideLoopRunning = false;
	let isDestroyed = false;
	let hasActiveLayout = false;

	function requestCenterSlideUpdate() {
		if (!shouldUpdateCenterSlide(effectiveSettings)) {
			clearCenterSlideClass(root, effectiveSettings);
			return;
		}

		if (centerSlideFrame) return;

		centerSlideFrame = requestAnimationFrame(() => {
			centerSlideFrame = null;
			updateCenterSlideClass(splide, root, effectiveSettings);
		});
	}

	function runCenterSlideLoop() {
		if (!shouldUpdateCenterSlide(effectiveSettings)) {
			stopCenterSlideLoop();
			clearCenterSlideClass(root, effectiveSettings);
			return;
		}

		updateCenterSlideClass(splide, root, effectiveSettings);

		if (!isCenterSlideLoopRunning) {
			centerSlideLoopFrame = null;
			return;
		}

		centerSlideLoopFrame = requestAnimationFrame(runCenterSlideLoop);
	}

	function startCenterSlideLoop() {
		if (!shouldUpdateCenterSlide(effectiveSettings) || isCenterSlideLoopRunning) return;

		isCenterSlideLoopRunning = true;
		centerSlideLoopFrame = requestAnimationFrame(runCenterSlideLoop);
	}

	function stopCenterSlideLoop() {
		isCenterSlideLoopRunning = false;

		if (centerSlideLoopFrame) {
			cancelAnimationFrame(centerSlideLoopFrame);
			centerSlideLoopFrame = null;
		}

		requestCenterSlideUpdate();
	}

	function refreshCarouselLayout() {
		if (isDestroyed) return;

		splide.refresh();
		updateSplideState(splide, root, effectiveSettings);
		requestCenterSlideUpdate();
		pressLayoutCollision.update();
	}

	const imageLoadRefresh =
		effectiveSettings.options.autoScroll === true
			? createImageLoadRefreshController(slides, () => {
					// If Splide mounted active, AutoScroll is already running and refreshing
					// its loop here would cause a visible jump and another play request.
					if (hasActiveLayout) return;
					refreshCarouselLayout();
				})
			: { destroy() {} };

	// Setup custom pagination if carousel-controls element exists within splide
	const carouselControls = qs(root, ".carousel-controls");
	const paginationEl = carouselControls ? qs(carouselControls, settings.dotsSelector) : null;
	const shouldRenderPagination = effectiveSettings.options.pagination === true;

	function syncPaginationButtonState(activeIndex) {
		if (!paginationEl) return;

		const buttons = qsa(paginationEl, "button");
		buttons.forEach((btn, idx) => {
			btn.classList.toggle(effectiveSettings.activeClass, idx === activeIndex);
		});
	}

	if (paginationEl && shouldRenderPagination) {
		paginationEl.innerHTML = "";

		{
			const isActive = getSplideActiveState(splide);
			const shouldHide = !isActive || slideCount <= 1;
			paginationEl.hidden = shouldHide;
			logCarousel(root, "Pagination initial visibility", {
				hidden: shouldHide,
				reason: !isActive ? "carousel-not-active" : slideCount <= 1 ? "single-slide" : "visible",
				isActive,
				slideCount,
				paginationPresent: true,
				source: "createSplideCarousel",
			});
		}
	} else if (paginationEl) {
		paginationEl.innerHTML = "";
		paginationEl.hidden = true;
		logCarousel(root, "Pagination hidden because rendering is disabled or element is missing", {
			hidden: true,
			reason: !paginationEl ? "pagination-element-missing" : "pagination-disabled",
			paginationEnabled: shouldRenderPagination,
			slideCount,
			paginationPresent: Boolean(paginationEl),
			source: "createSplideCarousel",
		});
	}

	splide.on("pagination:mounted", ({ list, items }) => {
		list.classList.add(effectiveSettings.dotsListClass);

		logCarousel(root, "Pagination mounted", {
			listClassName: list.className,
			itemCount: items.length,
			slideCount,
			paginationPresent: Boolean(paginationEl),
		});

		items.forEach((item, idx) => {
			item.button.classList.toggle(effectiveSettings.activeClass, idx === splide.index);
		});

		syncPaginationButtonState(splide.index);
	});

	// Setup Splide event listeners
	splide.on("mounted", () => {
		hasActiveLayout ||= getSplideActiveState(splide);
		updateSplideState(splide, root, effectiveSettings);
		syncSplideAutoScrollForOverflow(splide, effectiveSettings);
		requestCenterSlideUpdate();
		pressLayoutCollision.update();
	});

	// AutoScroll may be paused by Splide's own initial positioning after the
	// mounted event. Recheck its real state once the carousel is fully ready.
	splide.on("ready", () => {
		startSplideAutoScrollWhenReady(splide, effectiveSettings);
	});

	splide.on("move", (newIndex) => {
		syncPaginationButtonState(newIndex);
		updateSplideState(splide, root, effectiveSettings);
		startCenterSlideLoop();
	});

	splide.on("moved", () => {
		stopCenterSlideLoop();
	});

	splide.on("resize", () => {
		hasActiveLayout ||= getSplideActiveState(splide);
		updateSplideState(splide, root, effectiveSettings);
		requestCenterSlideUpdate();
		pressLayoutCollision.scheduleUpdate();
	});

	splide.on("overflow", (isOverflow) => {
		hasActiveLayout ||= isOverflow;
		updateSplideDragForOverflow(splide, effectiveSettings, isOverflow);
		updateSplideState(splide, root, effectiveSettings, isOverflow);
		syncSplideAutoScrollForOverflow(splide, effectiveSettings, isOverflow);
		requestCenterSlideUpdate();
		pressLayoutCollision.scheduleUpdate();
	});

	splide.on("drag", () => {
		if (getSplideActiveState(splide)) {
			root.classList.add(effectiveSettings.draggingClass);
			startCenterSlideLoop();
		}
	});

	splide.on("dragged", () => {
		root.classList.remove(effectiveSettings.draggingClass);
		stopCenterSlideLoop();
	});

	splide.mount(autoScrollExtensions || undefined);

	function destroy() {
		logCarousel(root, "Destroying Splide carousel instance");
		isDestroyed = true;
		imageLoadRefresh.destroy();

		if (viewportMediaQuery && handleViewportChange) {
			viewportMediaQuery.removeEventListener("change", handleViewportChange);
		}

		if (centerSlideFrame) {
			cancelAnimationFrame(centerSlideFrame);
			centerSlideFrame = null;
		}

		isCenterSlideLoopRunning = false;

		if (centerSlideLoopFrame) {
			cancelAnimationFrame(centerSlideLoopFrame);
			centerSlideLoopFrame = null;
		}

		pressLayoutCollision.destroy();

		root.classList.remove(
			effectiveSettings.activeCarouselClass,
			effectiveSettings.inactiveCarouselClass,
			effectiveSettings.draggingClass,
		);
		root.removeAttribute("data-splide-active");
		root.removeAttribute("data-carousel-active");

		clearCenterSlideClass(root, effectiveSettings);

		if (paginationEl) {
			paginationEl.innerHTML = "";
			paginationEl.hidden = false;
			logCarousel(root, "Pagination cleared on destroy", {
				hidden: false,
				source: "destroy",
			});
		}

		splide.destroy();
		root._splideInstance = null;
		root._carouselInstance = null;
		instances = instances.filter((instance) => instance.root !== root);
	}

	const instance = {
		root,
		splide,
		destroy,
		reInit() {
			refreshCarouselLayout();
		},
	};

	root._splideInstance = instance;
	root._carouselInstance = instance;
	instances.push(instance);

	let handleViewportChange = null;

	if (viewportOptionsDiffer) {
		let wasMobile = viewportMatches;

		handleViewportChange = () => {
			const isMobile = viewportMediaQuery.matches;
			if (isMobile === wasMobile) return;
			wasMobile = isMobile;

			logCarousel(root, "Rebuilding carousel for viewport breakpoint change", {
				isMobile,
				desktopLoop,
				mobileLoop,
				desktopAutoScroll,
				mobileAutoScroll,
			});

			instance.destroy();
			createCarousel(root, userSettings);
		};

		viewportMediaQuery.addEventListener("change", handleViewportChange);
	}

	return instance;
}

export function createCarousel(root, userSettings = {}) {
	if (!root || root._splideInstance) return root?._splideInstance || null;

	const settings = resolveSettings(root, userSettings);
	if (isCustomCarousel(root, settings)) {
		return null;
	}

	return createSplideCarousel(root, settings, userSettings);
}

export function initCarousels(userSettings = {}) {
	bindFormChangeReset();

	return qsa(document, defaults.selector)
		.filter((root) => !isCustomCarousel(root, defaults))
		.map((root) => createCarousel(root, userSettings))
		.filter(Boolean);
}

export function destroyCarousels() {
	instances.slice().forEach((instance) => {
		instance.destroy();
	});

	instances = [];
}

export function reInitCarousels() {
	instances.forEach((instance) => {
		instance.reInit();
	});
}

export function getCarouselInstances() {
	return instances;
}

export const splideCarouselInternals = {
	hasConditionHiddenContent,
	orderSlidesByConditionVisibility,
	resetCarouselToStart,
	resetCarouselsInForm,
	bindFormChangeReset,
};
