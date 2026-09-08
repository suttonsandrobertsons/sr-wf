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
		mediaQueryListeners = new Set();
		createdInstances = [];

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
				this._events.get("mounted")?.forEach((callback) => callback());

				if (pauseAutoScrollBeforeReady) {
					this._autoScrollPaused = true;
				}

				this._events.get("ready")?.forEach((callback) => callback());
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
	} = {}) {
		document.body.innerHTML = `
			<div class="splide" data-splide-autoscroll="${autoScroll}" ${
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

	it("restarts an overflowing carousel if initialization pauses it before ready", () => {
		currentIsOverflow = true;
		pauseAutoScrollBeforeReady = true;
		const root = buildCarousel({ autoScroll: "true" });

		const instance = createCarousel(root);

		expect(instance.splide.Components.AutoScroll.play).toHaveBeenCalledTimes(2);
		expect(instance.splide.Components.AutoScroll.isPaused()).toBe(false);
	});
});
