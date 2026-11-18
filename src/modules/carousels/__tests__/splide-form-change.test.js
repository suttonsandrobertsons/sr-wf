import { beforeEach, describe, expect, it, vi } from "vitest";
import { splideCarouselInternals } from "../splide.js";

describe("Splide form change integration", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
		document.documentElement.__splideFormChangeListenerBound = false;
		window.requestAnimationFrame = (callback) => {
			callback();
			return 1;
		};
	});

	it("refreshes and moves form-owned Splide carousels back to the first slide", () => {
		document.body.innerHTML = `
			<form data-form="product-finder">
				<div class="splide" id="inside">
					<div class="splide__list">
						<div class="splide__slide" id="hidden-first">
							<div data-form-state="condition-hidden">Hidden first</div>
						</div>
						<div class="splide__slide" id="visible-second">Visible second</div>
						<div class="splide__slide" id="hidden-third" data-form-state="condition-hidden">Hidden third</div>
						<div class="splide__slide" id="visible-fourth">Visible fourth</div>
					</div>
				</div>
			</form>
			<div class="splide" id="outside"></div>
		`;

		const inside = document.querySelector("#inside");
		const outside = document.querySelector("#outside");
		inside._splideInstance = {
			root: inside,
			splide: {
				refresh: vi.fn(),
				go: vi.fn(),
			},
		};
		outside._splideInstance = {
			root: outside,
			splide: {
				refresh: vi.fn(),
				go: vi.fn(),
			},
		};

		splideCarouselInternals.bindFormChangeReset();
		document.querySelector("form").dispatchEvent(new CustomEvent("suttons:form-change", {
			detail: {},
			bubbles: true,
		}));

		expect(inside._splideInstance.splide.refresh).toHaveBeenCalledTimes(1);
		expect(inside._splideInstance.splide.go).toHaveBeenCalledWith(0);
		expect(Array.from(inside.querySelectorAll(".splide__slide")).map((slide) => slide.id)).toEqual([
			"visible-second",
			"visible-fourth",
			"hidden-first",
			"hidden-third",
		]);
		expect(outside._splideInstance.splide.refresh).not.toHaveBeenCalled();
		expect(outside._splideInstance.splide.go).not.toHaveBeenCalled();
	});
	it("does not reorder nested slides into the parent's list", () => {
		document.body.innerHTML = `<div class="splide" id="outer"><ul class="splide__list"><li class="splide__slide" id="outer-hidden" data-form-state="condition-hidden"></li><li class="splide__slide" id="outer-visible"><div class="splide" id="inner"><ul class="splide__list"><li class="splide__slide" id="inner-slide"></li></ul></div></li></ul></div>`;
		const inner = document.querySelector("#inner"), slide = document.querySelector("#inner-slide");
		splideCarouselInternals.orderSlidesByConditionVisibility(document.querySelector("#outer"));
		expect(slide.parentElement).toBe(inner.querySelector(".splide__list"));
		expect(Array.from(document.querySelector("#outer > .splide__list").children).map(el => el.id)).toEqual(["outer-visible", "outer-hidden"]);
	});
	it("contains a failing form reset and still refreshes the next carousel", () => {
		document.body.innerHTML = '<form><div class="splide" id="bad"></div><div class="splide" id="good"></div></form>';
		const bad = document.querySelector("#bad"), good = document.querySelector("#good");
		bad._splideInstance = { destroy: vi.fn(), splide: { refresh() { throw Error("refresh failed"); } } };
		good._splideInstance = { splide: { refresh: vi.fn(), go: vi.fn() } };
		expect(() => splideCarouselInternals.resetCarouselsInForm(document.querySelector("form"))).not.toThrow();
		expect(bad._splideInstance.destroy).toHaveBeenCalledOnce();
		expect(good._splideInstance.splide.go).toHaveBeenCalledWith(0);
	});

});
