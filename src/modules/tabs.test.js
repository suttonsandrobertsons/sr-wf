import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initTabs } from "./tabs.js";

function renderPage(markup) {
	document.body.innerHTML = markup;
}

function renderTabs({ carousel = false } = {}) {
	renderPage(`
		<div class="tabs_main" data-tab-element="component">
			<div class="tabs_tabs"><div data-tab-element="tabs">
				<button hidden data-tab-element="tab-template"><h3 class="tabs_tabs-item-text"></h3></button>
			</div></div>
			<div class="tabs_panels">
				<div class="tabs_panel" data-tab-element="panel" data-tab-text="Old transport">
					<div data-tab-element="label">Transport</div><a href="#transport">Transport link</a>
					${carousel ? `<div class="panel-carousel">
						<button class="panel-carousel_btn is-prev"></button><button class="panel-carousel_btn"></button>
						<div class="panel-carousel_list"><div class="panel-carousel_item">First slide</div><div class="panel-carousel_item">Second slide</div></div>
					</div>` : ""}
				</div>
				<div class="tabs_panel" data-tab-element="panel" data-tab-text="Valuation"><div data-tab-element="label">Valuation</div></div>
			</div>
		</div>
	`);
	return document.querySelector('[data-tab-element="component"]');
}

describe("initTabs", () => {
	beforeEach(() => {
		renderPage("");
		delete window.sr;
	});

	afterEach(() => {
		document.querySelectorAll('[data-tab-element="component"]').forEach((component) => component.__tabsCleanup?.());
		renderPage("");
		delete window.sr;
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it("hides a single-tab strip and retains its template for another setup", () => {
		renderPage(`
			<div data-tab-element="component">
				<div data-tab-element="tabs">
					<button data-tab-element="tab-template">
						<span class="tabs_tabs-item-text"></span>
					</button>
				</div>
				<div data-tab-element="panel" data-tab-text="Only tab">
					<p>Panel content</p>
				</div>
			</div>
		`);

		const instances = initTabs();
		const component = document.querySelector('[data-tab-element="component"]');
		const tabsRoot = component.querySelector('[data-tab-element="tabs"]');
		const panel = component.querySelector('[data-tab-element="panel"]');
		const tabs = component.querySelectorAll('[data-tab-element="tab"]');

		expect(instances).toHaveLength(1);
		expect(tabs).toHaveLength(1);
		expect(tabsRoot.style.display).toBe("none");
		expect(tabsRoot.getAttribute("aria-hidden")).toBe("true");
		expect(document.querySelector('[data-tab-element="tab-template"]').hidden).toBe(true);
		expect(panel.classList.contains("is-active")).toBe(true);
		expect(panel.style.display).not.toBe("none");
	});

	it("uses the real panel label and preserves click and keyboard selection", () => {
		const component = renderTabs();
		initTabs();
		const tabs = component.querySelectorAll('[data-tab-element="tab"]');
		const panels = component.querySelectorAll('[data-tab-element="panel"]');
		expect([...tabs].map((tab) => tab.textContent.trim())).toEqual(["Transport", "Valuation"]);
		expect(component.dataset.componentState).toBe("ready");
		expect(component.classList.contains("is-fallback")).toBe(false);
		expect(panels[0].style.display).toBe("");
		expect(panels[1].style.display).toBe("none");
		tabs[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
		expect(tabs[1].getAttribute("aria-selected")).toBe("true");
		expect(document.activeElement).toBe(tabs[1]);
		expect(panels[0].style.display).toBe("none");
		expect(panels[1].style.display).toBe("");
		tabs[0].click();
		expect(panels[0].style.display).toBe("");
		expect(panels[1].style.display).toBe("none");
	});

	it("keeps attribute-only markup compatible", () => {
		const component = renderTabs();
		component.querySelectorAll('[data-tab-element="label"]').forEach((label) => label.remove());
		initTabs();
		expect(component.querySelector('[data-tab-element="tab"]').textContent.trim()).toBe("Old transport");
	});

	it("does not reset a ready child component's carousel when its parent initialises", () => {
		const child = renderTabs({ carousel: true });
		const outer = child.cloneNode(true);
		outer.querySelectorAll(".panel-carousel").forEach((carousel) => carousel.remove());
		document.body.append(outer);
		outer.querySelector('[data-tab-element="panel"]').append(child);
		const [childInstance] = initTabs(child);
		childInstance.panelCarousels[0].setActiveSlide(1, { withTransition: false });
		const childSlides = childInstance.panelCarousels[0].slides;
		expect(childSlides.map((slide) => slide.style.display)).toEqual(["none", ""]);
		const [outerInstance] = initTabs(outer);
		expect(childSlides.map((slide) => slide.style.display)).toEqual(["none", ""]);
		expect(outerInstance.panelCarousels).toHaveLength(0);
		outerInstance.destroy();
		expect(child.dataset.componentState).toBe("ready");
		expect(childSlides.map((slide) => slide.style.display)).toEqual(["none", ""]);
	});

	it("does not read a source label owned by a nested component", () => {
		const component = renderTabs();
		const panel = component.querySelector('[data-tab-element="panel"]');
		panel.querySelector('[data-tab-element="label"]').remove();
		panel.insertAdjacentHTML("afterbegin", '<div data-tab-element="component"><div data-tab-element="label">Child label</div></div>');
		initTabs(component);
		expect(component.querySelector('[data-tab-element="tab"]').textContent.trim()).toBe("Old transport");
	});

	it("leaves expired startup in fallback without building or hiding panels", () => {
		const component = renderTabs();
		window.sr = { tabStartup: { canEnhance: () => false } };
		expect(initTabs()).toEqual([]);
		expect(component.classList.contains("is-fallback")).toBe(true);
		expect(component.dataset.componentState).toBe("fallback");
		expect(component.getAttribute("aria-busy")).not.toBe("true");
		expect(component.querySelectorAll('[data-tab-element="tab"]')).toHaveLength(0);
		component.querySelectorAll('[data-tab-element="panel"]').forEach((panel) => {
			expect(panel.style.display).not.toBe("none");
			expect(panel.hasAttribute("role")).toBe(false);
		});
	});

	it.each(["missing", "non-button"])("falls back for a %s template and still initialises the next component", (type) => {
		const invalid = renderTabs();
		const valid = invalid.cloneNode(true);
		document.body.append(valid);
		const template = invalid.querySelector('[data-tab-element="tab-template"]');
		if (type === "missing") template.remove();
		else template.outerHTML = '<div data-tab-element="tab-template"></div>';
		const instances = initTabs();
		expect(instances).toHaveLength(1);
		expect(instances[0].component).toBe(valid);
		expect(invalid.classList.contains("is-fallback")).toBe(true);
		expect(invalid.getAttribute("aria-busy")).not.toBe("true");
		expect(valid.dataset.componentState).toBe("ready");
	});

	it("restores partially mutated panels and nested slides after setup fails", () => {
		const component = renderTabs({ carousel: true });
		const panels = component.querySelectorAll('[data-tab-element="panel"]');
		panels[0].style.padding = "7px";
		panels[0].id = "original-panel";
		vi.spyOn(console, "error").mockImplementation(() => {});
		vi.spyOn(panels[1], "setAttribute").mockImplementationOnce(() => { throw new Error("setup failure"); });
		expect(() => initTabs()).not.toThrow();
		expect(component.classList.contains("is-fallback")).toBe(true);
		expect(component.querySelectorAll('[data-tab-element="tab"]')).toHaveLength(0);
		expect(component.querySelector('[data-tab-element="tab-template"]')).not.toBeNull();
		expect(panels[0].id).toBe("original-panel");
		expect(panels[0].style.padding).toBe("7px");
		for (const panel of panels) {
			expect(panel.hasAttribute("role")).toBe(false);
			expect(panel.hasAttribute("aria-labelledby")).toBe(false);
			expect(panel.hasAttribute("aria-hidden")).toBe(false);
			expect(panel.style.display).toBe("");
		}
		for (const slide of component.querySelectorAll(".panel-carousel_item")) {
			expect(slide.style.display).toBe("");
			expect(slide.style.opacity).toBe("");
			expect(slide.style.visibility).toBe("");
			expect(slide.hasAttribute("aria-hidden")).toBe(false);
		}
	});

	it("returns the existing instance on repeated init without duplicating controls", () => {
		const component = renderTabs();
		const [first] = initTabs();
		const [second] = initTabs();
		expect(second).toBe(first);
		expect(component.querySelectorAll('[data-tab-element="tab"]')).toHaveLength(2);
	});

	it("destroys to the Designer-style fallback and can initialise again", () => {
		const component = renderTabs({ carousel: true });
		const [first] = initTabs();
		first.setActiveTab(1, { withTransition: false });
		first.destroy();
		expect(component.classList.contains("is-fallback")).toBe(true);
		expect(component.querySelector('[data-tab-element="tabs"]').hasAttribute("role")).toBe(false);
		for (const panel of component.querySelectorAll('[data-tab-element="panel"]')) {
			expect(panel.style.display).toBe("");
			expect(panel.hasAttribute("aria-hidden")).toBe(false);
		}
		const [second] = initTabs();
		expect(second).toBeDefined();
		expect(second).not.toBe(first);
		expect(component.dataset.componentState).toBe("ready");
		expect(component.classList.contains("is-fallback")).toBe(false);
		expect(component.querySelectorAll('[data-tab-element="tab"]')).toHaveLength(2);
	});

	it("restores the whole component if a nested carousel interaction fails", () => {
		const component = renderTabs({ carousel: true });
		let shouldThrow = false;
		vi.stubGlobal("gsap", {
			killTweensOf() {},
			set() { if (shouldThrow) throw new Error("carousel animation failure"); },
			fromTo() {},
			to() {},
		});
		vi.spyOn(console, "error").mockImplementation(() => {});
		let uncaught = null;
		const onError = (event) => { uncaught = event.error; event.preventDefault(); };
		window.addEventListener("error", onError);
		try {
			initTabs();
			shouldThrow = true;
			component.querySelector(".panel-carousel_btn:not(.is-prev)").click();
			expect(uncaught).toBeNull();
			expect(component.classList.contains("is-fallback")).toBe(true);
			component.querySelectorAll(".panel-carousel_item").forEach((slide) => {
				expect(slide.style.display).toBe("");
				expect(slide.hasAttribute("aria-hidden")).toBe(false);
			});
		} finally { window.removeEventListener("error", onError); }
	});

	it("restores fallback when a nested carousel animation completion fails", () => {
		const component = renderTabs({ carousel: true });
		const completions = [];
		vi.stubGlobal("gsap", {
			killTweensOf() {}, set() {}, fromTo() {},
			to(_element, options) { if (options.onComplete) completions.push(options.onComplete); },
		});
		vi.spyOn(console, "error").mockImplementation(() => {});
		initTabs();
		component.querySelector(".panel-carousel_btn:not(.is-prev)").click();
		const firstSlide = component.querySelector(".panel-carousel_item");
		vi.spyOn(firstSlide, "setAttribute").mockImplementationOnce(() => { throw new Error("completion failure"); });
		expect(() => completions[0]()).not.toThrow();
		expect(component.classList.contains("is-fallback")).toBe(true);
		expect(firstSlide.style.display).toBe("");
	});
});
