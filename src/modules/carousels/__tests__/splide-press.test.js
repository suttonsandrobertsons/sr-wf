import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPressLayoutCollisionController } from "../splide-press.js";

describe("createPressLayoutCollisionController", () => {
	let originalInnerWidth;
	let originalGetComputedStyle;

	beforeEach(() => {
		originalInnerWidth = window.innerWidth;
		originalGetComputedStyle = window.getComputedStyle;
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.runOnlyPendingTimers();
		vi.useRealTimers();
		Object.defineProperty(window, "innerWidth", {
			configurable: true,
			value: originalInnerWidth,
			writable: true,
		});
		Object.defineProperty(window, "getComputedStyle", {
			configurable: true,
			value: originalGetComputedStyle,
			writable: true,
		});
		document.body.innerHTML = "";
	});

	function setInnerWidth(width) {
		Object.defineProperty(window, "innerWidth", {
			configurable: true,
			value: width,
			writable: true,
		});
	}

	function setElementRect(element, rect) {
		Object.defineProperty(element, "getBoundingClientRect", {
			configurable: true,
			value: () => ({
				left: rect.left,
				right: rect.right,
				width: rect.right - rect.left,
				top: rect.top ?? 0,
				bottom: rect.bottom ?? 20,
				height: (rect.bottom ?? 20) - (rect.top ?? 0),
				x: rect.left,
				y: rect.top ?? 0,
				toJSON() {},
			}),
		});
	}

	function setComputedGap(element, gap) {
		const nextGetComputedStyle = (target) => {
			if (target === element) {
				return {
					columnGap: gap,
					gap,
					gridColumnGap: gap,
					rowGap: gap,
				};
			}

			return originalGetComputedStyle(target);
		};

		Object.defineProperty(window, "getComputedStyle", {
			configurable: true,
			value: nextGetComputedStyle,
			writable: true,
		});

		return () => {
			Object.defineProperty(window, "getComputedStyle", {
				configurable: true,
				value: originalGetComputedStyle,
				writable: true,
			});
		};
	}

	function buildDom() {
		document.body.innerHTML = `
			<div class="press_layout-outer">
				<div class="press_layout-inner">
					<div class="press_header is-left">AS SEEN IN</div>
					<div class="splide">
						<div class="splide__track">
							<ul class="splide__list"></ul>
						</div>
					</div>
				</div>
			</div>
		`;

		const root = document.querySelector(".splide");
		const header = document.querySelector(".press_header");
		const outer = document.querySelector(".press_layout-outer");
		const inner = document.querySelector(".press_layout-inner");
		const list = document.querySelector(".splide__list");

		return { root, header, outer, inner, list };
	}

	function createSplide(root, width) {
		return {
			Components: {
				Layout: {
					listSize: () => width,
				},
				Elements: {
					list: document.querySelector(".splide__list"),
				},
			},
			root,
		};
	}

	it("adds the collision class when the header, list, and gap exceed the outer width", () => {
		setInnerWidth(1024);
		const { root, header, outer, inner, list } = buildDom();
		setElementRect(outer, { left: 0, right: 500 });
		setElementRect(header, { left: 0, right: 200 });
		setElementRect(list, { left: 0, right: 260 });
		const restoreGap = setComputedGap(inner, "48px");

		const controller = createPressLayoutCollisionController(root, createSplide(root, 260));
		controller.update();

		expect(document.querySelector(".press_layout-outer").classList.contains("is-vertical")).toBe(true);
		restoreGap();
		controller.destroy();
	});

	it("removes the collision class below the mobile breakpoint", () => {
		setInnerWidth(1024);
		const { root, header, outer, inner, list } = buildDom();
		setElementRect(outer, { left: 0, right: 600 });
		setElementRect(header, { left: 0, right: 150 });
		setElementRect(list, { left: 0, right: 250 });
		const restoreGap = setComputedGap(inner, "24px");

		const controller = createPressLayoutCollisionController(root, createSplide(root, 250));
		controller.update();
		expect(document.querySelector(".press_layout-outer").classList.contains("is-vertical")).toBe(false);

		setInnerWidth(767);
		window.dispatchEvent(new Event("resize"));
		vi.advanceTimersByTime(120);

		expect(document.querySelector(".press_layout-outer").classList.contains("is-vertical")).toBe(false);
		restoreGap();
		controller.destroy();
	});

	it("debounces resize handling before recomputing collision state", () => {
		setInnerWidth(1024);
		const { root, header, outer, inner, list } = buildDom();
		setElementRect(outer, { left: 0, right: 700 });
		setElementRect(header, { left: 0, right: 100 });
		setElementRect(list, { left: 0, right: 400 });
		const restoreGap = setComputedGap(inner, "24px");

		let outerWidth = 700;
		const splide = createSplide(root, 400);
		Object.defineProperty(outer, "getBoundingClientRect", {
			configurable: true,
			value: () => ({
				left: 0,
				right: outerWidth,
				width: outerWidth,
				top: 0,
				bottom: 20,
				height: 20,
				x: 0,
				y: 0,
				toJSON() {},
			}),
		});

		const controller = createPressLayoutCollisionController(root, splide);
		controller.update();
		expect(document.querySelector(".press_layout-outer").classList.contains("is-vertical")).toBe(false);

		outerWidth = 520;
		window.dispatchEvent(new Event("resize"));

		expect(document.querySelector(".press_layout-outer").classList.contains("is-vertical")).toBe(false);

		vi.advanceTimersByTime(120);

		expect(document.querySelector(".press_layout-outer").classList.contains("is-vertical")).toBe(true);
		restoreGap();
		controller.destroy();
	});
	it("restores an authored collision class when destroyed", () => {
		const { root, outer } = buildDom();
		outer.classList.add("is-vertical");
		const controller = createPressLayoutCollisionController(root, createSplide(root, 250));
		controller.destroy();
		expect(outer.classList.contains("is-vertical")).toBe(true);
	});

});
