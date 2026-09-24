import { describe, it, expect, beforeEach } from "vitest";
import { initContactWidget, getContactWidgetInstances } from "../contact-widget.js";

function buildWidget() {
	document.body.innerHTML = `
		<div data-widget="contact">
			<button data-widget-toggle>Contact us</button>
			<div data-widget-panel id="contact-panel">
				<button data-widget-close>Close</button>
				<a data-widget-action="whatsapp" href="#">WhatsApp Us</a>
				<a href="/book">Book</a>
			</div>
		</div>
	`;
	return document.querySelector("[data-widget='contact']");
}

describe("contact-widget", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
	});

	it("starts closed and exposes ARIA state", () => {
		const root = buildWidget();
		initContactWidget();

		expect(root.getAttribute("data-widget-open")).toBe("false");
		const toggle = root.querySelector("[data-widget-toggle]");
		expect(toggle.getAttribute("aria-expanded")).toBe("false");
		expect(toggle.getAttribute("aria-controls")).toBe("contact-panel");
	});

	it("toggles open and closed via the launcher", () => {
		const root = buildWidget();
		initContactWidget();
		const toggle = root.querySelector("[data-widget-toggle]");

		toggle.click();
		expect(root.getAttribute("data-widget-open")).toBe("true");
		expect(toggle.getAttribute("aria-expanded")).toBe("true");

		toggle.click();
		expect(root.getAttribute("data-widget-open")).toBe("false");
		expect(toggle.getAttribute("aria-expanded")).toBe("false");
	});

	it("wires every [data-widget-toggle], not just the first", () => {
		const root = buildWidget();
		// A second toggle inside the panel (e.g. on the close icon).
		const panel = root.querySelector("[data-widget-panel]");
		const second = document.createElement("button");
		second.setAttribute("data-widget-toggle", "");
		panel.appendChild(second);
		initContactWidget();

		root.querySelector("[data-widget-toggle]").click(); // launcher opens
		expect(root.getAttribute("data-widget-open")).toBe("true");
		second.click(); // second toggle should close
		expect(root.getAttribute("data-widget-open")).toBe("false");
	});

	it("closes via the close control and on Escape", () => {
		const root = buildWidget();
		initContactWidget();
		const toggle = root.querySelector("[data-widget-toggle]");

		toggle.click();
		root.querySelector("[data-widget-close]").click();
		expect(root.getAttribute("data-widget-open")).toBe("false");

		toggle.click();
		document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
		expect(root.getAttribute("data-widget-open")).toBe("false");
	});

	it("closes when clicking outside the widget", () => {
		const root = buildWidget();
		initContactWidget();
		root.querySelector("[data-widget-toggle]").click();
		expect(root.getAttribute("data-widget-open")).toBe("true");

		document.body.click();
		expect(root.getAttribute("data-widget-open")).toBe("false");
	});

	it("builds a pre-filled WhatsApp link with the fixed number and landing URL", () => {
		const root = buildWidget();
		initContactWidget();

		const link = root.querySelector("[data-widget-action='whatsapp']");
		expect(link.href).toContain("https://api.whatsapp.com/send?phone=447398469961");
		// The current page URL is encoded into the prefilled message.
		const text = decodeURIComponent(link.href.split("text=")[1]);
		expect(text).toContain(window.location.href.split("?")[0]);
		expect(text).toContain("Hello");

		// Message order: URL first, "Hello" last. If WhatsApp carries the
		// greeting into the URL, sanitizeUtmValue strips it on landing (see
		// conditions.js).
		const lines = text.split("\n").filter(Boolean);
		expect(lines[0].startsWith("http")).toBe(true);
		expect(lines[lines.length - 1]).toBe("Hello");
	});

	it("navigates to the WhatsApp link on click (button or anchor)", () => {
		const root = buildWidget();
		initContactWidget();
		const calls = [];
		const originalOpen = window.open;
		window.open = (url) => { calls.push(url); return null; };

		try {
			root.querySelector("[data-widget-action='whatsapp']").click();
		} finally {
			window.open = originalOpen;
		}

		expect(calls.length).toBe(1);
		expect(calls[0]).toContain("https://api.whatsapp.com/send?phone=447398469961");
		expect(decodeURIComponent(calls[0])).toContain("Hello");
	});

	it("pushes a whatsapp_click event to the dataLayer on click", () => {
		const root = buildWidget();
		window.dataLayer = [];
		initContactWidget();
		const originalOpen = window.open;
		window.open = () => null;
		try {
			root.querySelector("[data-widget-action='whatsapp']").click();
		} finally {
			window.open = originalOpen;
		}
		const evt = window.dataLayer.find((e) => e && e.event === "whatsapp_click");
		expect(evt).toBeTruthy();
		expect(evt.wa_number).toBe("447398469961");
		expect(evt.page_url).toBe(window.location.href);
		delete window.dataLayer;
	});

	it("does not throw when dataLayer is absent", () => {
		const root = buildWidget();
		initContactWidget();
		const originalOpen = window.open;
		window.open = () => null;
		expect(() => root.querySelector("[data-widget-action='whatsapp']").click()).not.toThrow();
		window.open = originalOpen;
	});

	it("honours a per-instance data-widget-wa-number override", () => {
		const root = buildWidget();
		root.setAttribute("data-widget-wa-number", "447000000000");
		initContactWidget();

		const link = root.querySelector("[data-widget-action='whatsapp']");
		expect(link.href).toContain("phone=447000000000");
	});

	it("is idempotent: re-init returns the same controller", () => {
		buildWidget();
		const first = initContactWidget();
		const before = getContactWidgetInstances().length;
		const second = initContactWidget();

		expect(second[0]).toBe(first[0]);
		expect(getContactWidgetInstances().length).toBe(before);
	});

	// a WhatsApp action OUTSIDE the widget (Get Started module) must open
	// WhatsApp directly, not the floating widget.
	it("opens WhatsApp for a [data-widget-action='whatsapp'] outside the widget root", () => {
		document.body.innerHTML = `
			<div data-widget="contact"><button data-widget-toggle></button>
				<div data-widget-panel id="p"></div></div>
			<div class="get-started">
				<div data-widget-action="whatsapp">WhatsApp us</div>
			</div>`;
		window.dataLayer = [];
		initContactWidget();

		const widget = document.querySelector("[data-widget='contact']");
		const external = document.querySelector(".get-started [data-widget-action='whatsapp']");
		const calls = [];
		const originalOpen = window.open;
		window.open = (url) => { calls.push(url); return null; };
		try {
			external.click();
		} finally {
			window.open = originalOpen;
		}

		// Opened WhatsApp, and did NOT open the floating widget.
		expect(calls.length).toBe(1);
		expect(calls[0]).toContain("https://api.whatsapp.com/send?phone=447398469961");
		expect(widget.getAttribute("data-widget-open")).not.toBe("true");
		// and it emitted the whatsapp_click event.
		expect(window.dataLayer.find((e) => e && e.event === "whatsapp_click")).toBeTruthy();
		delete window.dataLayer;
	});
});
