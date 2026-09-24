import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCarousel } from "../splide.js";

describe("Splide autoscroll", () => {
	let originalSplide;
	let originalMatchMedia;
	let mobileMatches;
	let mediaQueryListeners;
	let createdInstances;
	let currentIsOverflow;
	let pauseAutoScrollBeforeReady;
	let overflowBeforeMounted;
	let marqueeSlideWidth;
	let marqueeContainerWidth;
	let originalGetBoundingClientRect;

	beforeEach(() => {
		originalSplide = globalThis.Splide;
		originalMatchMedia = window.matchMedia;
		window.splide = {
			Extensions: {
				AutoScroll: vi.fn(),
			},
		};
		mobileMatches = false;
		currentIsOverflow = false;
		pauseAutoScrollBeforeReady = false;
		overflowBeforeMounted = false;
		// null disables the marquee measurements, so tests that do not care
		// about expansion are unaffected.
		marqueeSlideWidth = null;
		marqueeContainerWidth = null;
		mediaQueryListeners = new Set();
		createdInstances = [];

		// jsdom reports every rect as zero. The module measures real slide widths,
		// so give slides a width when a test asks for one.
		originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;
		Element.prototype.getBoundingClientRect = function getBoundingClientRect() {
			const width =
				marqueeSlideWidth !== null && this.classList?.contains("splide__slide")
					? marqueeSlideWidth
					: 0;
			return { width, height: 0, top: 0, left: 0, right: width, bottom: 0, x: 0, y: 0 };
		};

		window.matchMedia = vi.fn(() => ({
			media: "(max-width: 767px)",
			get matches() {
				return mobileMatches;
			},
			addEventListener(type, callback) {
				if (type === "change") {
					mediaQueryListeners.add(callback);
				}
			},
			removeEventListener(type, callback) {
				if (type === "change") {
					mediaQueryListeners.delete(callback);
				}
			},
		}));

		globalThis.Splide = class FakeSplide {
			constructor(root, options) {
				this.root = root;
				this.options = options;
				this.index = 0;
				this.destroyed = false;
				this._autoScrollPaused = true;
				this.Components = {
					Layout: {
						isOverflow: () => currentIsOverflow,
						listSize: () => marqueeContainerWidth ?? 0,
					},
					Elements: {
						list: root.querySelector(".splide__list"),
						slides: Array.from(root.querySelectorAll(".splide__slide")),
						root,
					},
					Slide: {
						getSlides: () => Array.from(root.querySelectorAll(".splide__slide")),
					},
					AutoScroll: {
						isPaused: vi.fn(() => this._autoScrollPaused),
						play: vi.fn(() => {
							// The extension's interval does not exist before it mounts.
							if (overflowBeforeMounted && !this._mounted) {
								throw new TypeError("Cannot read properties of undefined (reading 'start')");
							}
							this._autoScrollPaused = false;
						}),
						pause: vi.fn(() => {
							this._autoScrollPaused = true;
						}),
					},
				};
				this._events = new Map();
				createdInstances.push(this);
			}

			on(eventName, callback) {
				const callbacks = this._events.get(eventName) || [];
				callbacks.push(callback);
				this._events.set(eventName, callbacks);
			}

			mount(extensions) {
				this.mountedExtensions = extensions;
				// Real Splide lays out, and reports overflow, before extensions mount.
				if (overflowBeforeMounted) this.trigger("overflow", currentIsOverflow);
				this._mounted = true;
				this._events.get("mounted")?.forEach((callback) => callback());

				if (pauseAutoScrollBeforeReady) {
					this._autoScrollPaused = true;
				}

				this._events.get("ready")?.forEach((callback) => callback());
			}

			add(slides) {
				const list = this.root.querySelector(".splide__list");
				[].concat(slides).forEach((slide) => list.appendChild(slide));
				this.addCalls = (this.addCalls || 0) + 1;
				// Splide refreshes after add, which re-emits layout events.
				this.refresh();
			}

			refresh() {
				this.trigger("overflow", currentIsOverflow);
			}

			destroy() {
				this.destroyed = true;
			}

			trigger(eventName, ...args) {
				this._events.get(eventName)?.forEach((callback) => callback(...args));
			}
		};
	});

	afterEach(() => {
		Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
		vi.useRealTimers();
		window.matchMedia = originalMatchMedia;
		globalThis.Splide = originalSplide;
		delete window.splide;
		document.body.innerHTML = "";
	});

	function buildCarousel({
		autoScroll = "false",
		autoScrollMobile = null,
		autoScrollPauseOnHover = null,
		withImages = false,
		loop = null,
	} = {}) {
		document.body.innerHTML = `
			<div class="splide" data-splide-autoscroll="${autoScroll}" ${
				loop === null ? "" : `data-splide-loop="${loop}"`
			} ${
				autoScrollMobile === null ? "" : `data-splide-autoscroll-mobile="${autoScrollMobile}"`
			} ${
				autoScrollPauseOnHover === null
					? ""
					: `data-splide-autoscroll-pause-on-hover="${autoScrollPauseOnHover}"`
			}>
				<div class="splide__track">
					<ul class="splide__list">
						<li class="splide__slide">Slide 1${withImages ? '<img alt="">' : ""}</li>
						<li class="splide__slide">Slide 2${withImages ? '<img alt="">' : ""}</li>
					</ul>
				</div>
			</div>
		`;

		return document.querySelector(".splide");
	}

	function emitMediaChange() {
		mediaQueryListeners.forEach((callback) => {
			callback({ matches: mobileMatches, media: "(max-width: 767px)" });
		});
	}

	it("enables autoscroll on mobile when the mobile attribute is true", () => {
		const root = buildCarousel({ autoScroll: "false", autoScrollMobile: "true" });
		mobileMatches = true;

		createCarousel(root);

		expect(createdInstances).toHaveLength(1);
		expect(createdInstances[0].options.autoScroll).toEqual({ speed: 2, autoStart: false });
		expect(createdInstances[0].mountedExtensions).toBe(window.splide.Extensions);
	});

	it("keeps desktop autoscroll off when the mobile flag differs", () => {
		const root = buildCarousel({ autoScroll: "false", autoScrollMobile: "true" });

		createCarousel(root);

		expect(createdInstances).toHaveLength(1);
		expect(createdInstances[0].options.autoScroll).toBeUndefined();
		expect(createdInstances[0].mountedExtensions).toBeUndefined();
	});

	it("rebuilds when the viewport changes and mobile autoscroll differs", () => {
		const root = buildCarousel({ autoScroll: "false", autoScrollMobile: "true" });

		createCarousel(root);
		mobileMatches = true;
		emitMediaChange();

		expect(createdInstances).toHaveLength(2);
		expect(createdInstances[0].destroyed).toBe(true);
		expect(createdInstances[1].options.autoScroll).toEqual({ speed: 2, autoStart: false });
	});

	it("allows hover pausing to be disabled by attribute", () => {
		const root = buildCarousel({
			autoScroll: "true",
			autoScrollPauseOnHover: "false",
		});

		createCarousel(root);

		expect(createdInstances[0].options.autoScroll).toEqual({
			speed: 2,
			autoStart: false,
			pauseOnHover: false,
		});
	});

	it("applies the hover pause attribute to the autoplay fallback", () => {
		window.splide.Extensions = {};
		const root = buildCarousel({
			autoScroll: "true",
			autoScrollPauseOnHover: "true",
		});

		createCarousel(root);

		expect(createdInstances[0].options.autoScroll).toBeUndefined();
		expect(createdInstances[0].options.autoplay).toBe(true);
		expect(createdInstances[0].options.pauseOnHover).toBe(true);
	});

	it("pauses until the carousel is actually overflowing", () => {
		const root = buildCarousel({ autoScroll: "false", autoScrollMobile: "true" });
		mobileMatches = true;

		createCarousel(root);

		expect(createdInstances[0].Components.AutoScroll.pause).toHaveBeenCalledTimes(1);
		expect(createdInstances[0].Components.AutoScroll.play).not.toHaveBeenCalled();

		currentIsOverflow = true;
		createdInstances[0].trigger("overflow", true);

		expect(createdInstances[0].Components.AutoScroll.play).toHaveBeenCalledTimes(1);
	});

	it("refreshes once after all images settle", () => {
		vi.useFakeTimers();
		const root = buildCarousel({ autoScroll: "true", withImages: true });
		const images = Array.from(root.querySelectorAll("img"));
		images.forEach((image) => {
			Object.defineProperty(image, "complete", { configurable: true, value: false });
		});

		const instance = createCarousel(root);
		const refresh = vi.spyOn(instance.splide, "refresh");

		expect(images.every((image) => image.loading === "eager")).toBe(true);

		images[0].dispatchEvent(new Event("load"));
		vi.advanceTimersByTime(0);
		expect(refresh).not.toHaveBeenCalled();

		currentIsOverflow = true;
		images[1].dispatchEvent(new Event("load"));
		vi.advanceTimersByTime(0);
		expect(refresh).toHaveBeenCalledTimes(1);
		expect(instance.splide.Components.AutoScroll.play).toHaveBeenCalledTimes(1);

		images.forEach((image) => image.dispatchEvent(new Event("load")));
		vi.runAllTimers();
		expect(refresh).toHaveBeenCalledTimes(1);
	});

	it("does not refresh an autoscroll carousel that mounted active", () => {
		vi.useFakeTimers();
		currentIsOverflow = true;
		const root = buildCarousel({ autoScroll: "true", withImages: true });
		const images = Array.from(root.querySelectorAll("img"));
		images.forEach((image) => {
			Object.defineProperty(image, "complete", { configurable: true, value: true });
		});

		const instance = createCarousel(root);
		const refresh = vi.spyOn(instance.splide, "refresh");

		vi.runAllTimers();

		expect(refresh).not.toHaveBeenCalled();
		expect(instance.splide.Components.AutoScroll.play).toHaveBeenCalledTimes(1);
	});

	it("does not schedule image refreshes for an autoscroll carousel without images", () => {
		vi.useFakeTimers();
		const root = buildCarousel({ autoScroll: "true" });

		const instance = createCarousel(root);
		const refresh = vi.spyOn(instance.splide, "refresh");

		vi.runAllTimers();

		expect(refresh).not.toHaveBeenCalled();
		expect(instance.splide.Components.AutoScroll.pause).toHaveBeenCalledTimes(1);
	});

	it("leaves AutoScroll alone until it has mounted", () => {
		currentIsOverflow = true;
		overflowBeforeMounted = true;
		const root = buildCarousel({ autoScroll: "false", autoScrollMobile: "true" });
		mobileMatches = true;

		const instance = createCarousel(root);

		expect(instance.splide.Components.AutoScroll.isPaused()).toBe(false);
	});

	it("restarts an overflowing carousel if initialization pauses it before ready", () => {
		currentIsOverflow = true;
		pauseAutoScrollBeforeReady = true;
		const root = buildCarousel({ autoScroll: "true" });

		const instance = createCarousel(root);

		expect(instance.splide.Components.AutoScroll.play).toHaveBeenCalledTimes(2);
		expect(instance.splide.Components.AutoScroll.isPaused()).toBe(false);
	});
	// --- marquee overflow expansion -------------------------------------------
	// Splide's isOverflow() counts only real slides, so a short brand list on a
	// wide viewport stops overflowing. Autoscroll is then paused AND, because
	// Controller.getEnd() collapses under omitEnd, loop wrapping degenerates.
	// The module duplicates real slides so the marquee genuinely overflows.

	function buildMarquee({ slideWidth, containerWidth, isOverflow = false }) {
		marqueeSlideWidth = slideWidth;
		marqueeContainerWidth = containerWidth;
		currentIsOverflow = isOverflow;
		// A real marquee always loops; expansion only applies to looping carousels.
		return buildCarousel({ autoScroll: "true", loop: "true" });
	}

	function realSlides(root) {
		return Array.from(root.querySelectorAll(".splide__slide"));
	}

	it("duplicates slides when the marquee no longer overflows", () => {
		// 2 slides x 100px = 200px of content in a 1000px container.
		const root = buildMarquee({ slideWidth: 100, containerWidth: 1000 });

		createCarousel(root);

		const slides = realSlides(root);
		expect(slides.length).toBeGreaterThan(2);
		// ceil(1000 * 1.25 / 200) = 7 sets total -> 6 sets added -> 12 extra slides.
		expect(slides.filter((s) => s.hasAttribute("data-marquee-duplicate"))).toHaveLength(12);
	});

	it("leaves an already overflowing marquee alone", () => {
		const root = buildMarquee({ slideWidth: 900, containerWidth: 1000, isOverflow: true });

		createCarousel(root);

		expect(realSlides(root)).toHaveLength(2);
		expect(createdInstances[0].addCalls).toBeUndefined();
	});

	it("hides duplicates from assistive tech and the tab order", () => {
		document.body.innerHTML = `
			<div class="splide" data-splide-autoscroll="true" data-splide-loop="true">
				<div class="splide__track">
					<ul class="splide__list">
						<li class="splide__slide"><a href="/a" aria-current="page">A</a></li>
						<li class="splide__slide"><a href="/b">B</a></li>
					</ul>
				</div>
			</div>
		`;
		marqueeSlideWidth = 100;
		marqueeContainerWidth = 1000;
		const root = document.querySelector(".splide");

		createCarousel(root);

		const duplicates = realSlides(root).filter((s) =>
			s.hasAttribute("data-marquee-duplicate"),
		);
		expect(duplicates.length).toBeGreaterThan(0);
		duplicates.forEach((slide) => {
			expect(slide.getAttribute("aria-hidden")).toBe("true");
			slide.querySelectorAll("a").forEach((link) => {
				expect(link.getAttribute("tabindex")).toBe("-1");
				expect(link.hasAttribute("aria-current")).toBe(false);
			});
		});

		// The originals keep their semantics.
		const original = realSlides(root)[0];
		expect(original.hasAttribute("aria-hidden")).toBe(false);
		expect(original.querySelector("a").hasAttribute("tabindex")).toBe(false);
	});

	it("does not duplicate slides for a carousel that is not a marquee", () => {
		marqueeSlideWidth = 100;
		marqueeContainerWidth = 1000;
		const root = buildCarousel({ autoScroll: "false", loop: "true" });

		createCarousel(root);

		expect(realSlides(root)).toHaveLength(2);
	});

	it("caps duplication instead of expanding without bound", () => {
		// 20px of content against a 100000px container would want ~6250 sets.
		const root = buildMarquee({ slideWidth: 10, containerWidth: 100000 });

		createCarousel(root);

		// marqueeMaxDuplicateSets is 8 -> at most 7 added sets of 2 slides.
		expect(realSlides(root).length).toBeLessThanOrEqual(2 + 7 * 2);
	});

	it("does not compound duplicates when overflow reports false repeatedly", () => {
		const root = buildMarquee({ slideWidth: 100, containerWidth: 1000 });

		createCarousel(root);
		const afterMount = realSlides(root).length;

		createdInstances[0].trigger("overflow", false);
		createdInstances[0].trigger("overflow", false);

		// Duplicates are measured from the originals, and the widened track is
		// re-measured each time, so repeats must not stack up.
		expect(realSlides(root).length).toBe(afterMount);
	});
	it("refuses to expand on an unlaid-out measurement", () => {
		// Slides exist but are not laid out yet: 2 x 1px would clear a summed
		// threshold and ask for the cap, so it must be ignored.
		const root = buildMarquee({ slideWidth: 1, containerWidth: 2560 });

		createCarousel(root);

		expect(realSlides(root)).toHaveLength(2);
		expect(createdInstances[0].addCalls).toBeUndefined();
	});

	it("expands once real widths arrive after an unlaid-out first pass", () => {
		const root = buildMarquee({ slideWidth: 1, containerWidth: 2560 });

		createCarousel(root);
		expect(realSlides(root)).toHaveLength(2);

		// Images settle; the refresh path re-enters with real widths.
		marqueeSlideWidth = 125;
		createdInstances[0].trigger("resize");

		const duplicates = realSlides(root).filter((s) =>
			s.hasAttribute("data-marquee-duplicate"),
		);
		expect(duplicates.length).toBeGreaterThan(0);
		// ceil(2560 * 1.25 / 250) = 13 -> capped at 8 sets -> 7 added -> 14 slides.
		expect(duplicates).toHaveLength(14);
	});
});
