import { formAttribution } from "./forms/core.js";

/**
 * Floating contact widget.
 *
 * A launcher in the bottom-right corner that opens a panel of contact actions
 * (WhatsApp, Book an Appointment, Find Us, Complete Form).
 *
 * State model: this module never touches inline styles. It only flips a single
 * state ATTRIBUTE on the root and mirrors ARIA. ALL display, visibility and
 * animation belong to CSS, keyed off the attribute below. Using an attribute
 * (rather than a class) means the state is previewable in the Webflow Designer:
 * set data-widget-open="true"/"false" on the wrap to see either state on canvas.
 *
 *   [data-widget-open="true"]   -> panel visible
 *   [data-widget-open="false"]  -> panel hidden (default)
 *
 * Markup contract (data-widget-* selection system):
 *   [data-widget="contact"]            root component (one or more)
 *     [data-widget-toggle]             launcher button (open/close)
 *     [data-widget-panel]              the panel that shows/hides
 *     [data-widget-close]              optional explicit close control(s)
 *     [data-widget-action="whatsapp"]  WhatsApp link(s) — href built in JS
 *   Other actions (book/find/form) are plain Webflow links and need no JS.
 *
 * An in-page launcher can live OUTSIDE the root: give it
 * [data-widget-toggle="contact"] (the value = the target's data-widget name)
 * and it drives that widget exactly like the built-in launcher.
 *
 * Optional per-instance override (editable in Designer, NOT for dynamic
 * number insertion — the WhatsApp number is fixed; Ruler DNI applies to
 * tel: links only):
 *   [data-widget="contact"][data-widget-wa-number="447398469961"]
 */

// WhatsApp Business number. Format: country code, no leading +, no spaces.
const WHATSAPP_NUMBER = "447398469961";

const SELECTORS = {
	root: "[data-widget='contact']",
	toggle: "[data-widget-toggle]",
	panel: "[data-widget-panel]",
	close: "[data-widget-close]",
	whatsapp: "[data-widget-action='whatsapp']",
};

const OPEN_ATTR = "data-widget-open";

// Registered open/close controllers, so global listeners can reach every instance.
const controllers = [];
let globalBound = false;

/**
 * Resolve UTM source/medium/campaign for the WhatsApp message.
 * Reuses the site's existing attribution engine, which already merges URL
 * params and infers organic/direct/referral when no paid signal is present.
 * Falls back to raw URL params if attribution is unavailable.
 */
function resolveAttribution() {
	try {
		formAttribution.capture();
		const stored = formAttribution.readAttribution(formAttribution.getStorage());
		if (stored && (stored.utm_source || stored.utm_medium || stored.utm_campaign)) {
			return {
				utm_source: stored.utm_source || "",
				utm_medium: stored.utm_medium || "",
				utm_campaign: stored.utm_campaign || "",
			};
		}
	} catch (error) {
		// Defensive: attribution must never block the WhatsApp link.
	}

	// Raw-URL fallback bypasses the attribution store, so sanitise here too:
	// a link that absorbed trailing text (e.g. `direct Hello`) must not reach
	// the pre-filled WhatsApp message or dataLayer.
	const params = new URLSearchParams(window.location.search);
	const clean = (v) => formAttribution.sanitizeUtmValue(v || "");
	return {
		utm_source: clean(params.get("utm_source")),
		utm_medium: clean(params.get("utm_medium")),
		utm_campaign: clean(params.get("utm_campaign")),
	};
}

/**
 * Build the pre-filled WhatsApp deep link for the current page.
 * Carries the greeting plus the landing-page URL (with resolved UTM parameters).
 *
 * Message order is URL first, "Hello" last, by design.
 * WhatsApp's link auto-detection can greedily absorb the trailing
 * "Hello" into the URL's query string on click-through (e.g. `utm_medium=direct`
 * → `direct Hello`). This is DELIBERATELY tolerated here because the corruption
 * is neutralised at the capture choke point: sanitizeUtmValue() collapses any
 * such value back to its first token on the landing page, so attribution stays
 * clean regardless of ordering. See conditions.js sanitizeUtmValue.
 */
function buildWhatsappLink(number) {
	const url = new URL(window.location.href);
	const attribution = resolveAttribution();

	if (attribution.utm_source) url.searchParams.set("utm_source", attribution.utm_source);
	if (attribution.utm_medium) url.searchParams.set("utm_medium", attribution.utm_medium);
	if (attribution.utm_campaign) url.searchParams.set("utm_campaign", attribution.utm_campaign);

	const message = `${url.href}\n\nHello`;
	return `https://api.whatsapp.com/send?phone=${number}&text=${encodeURIComponent(message)}`;
}

/**
 * Notify GTM that the WhatsApp action was clicked (GA4 whatsapp_click event).
 * Does nothing when GTM/dataLayer is absent (matches the form engine).
 */
function pushWhatsappClick(number) {
	if (typeof window.dataLayer === "undefined") return;
	const attribution = resolveAttribution();
	window.dataLayer.push({
		event: "whatsapp_click",
		wa_number: number,
		page_url: window.location.href,
		utm_source: attribution.utm_source || "",
		utm_medium: attribution.utm_medium || "",
		utm_campaign: attribution.utm_campaign || "",
	});
}

function refreshWhatsappLinks(root, number) {
	root.querySelectorAll(SELECTORS.whatsapp).forEach((target) => {
		// The marker may sit on the anchor itself or on a wrapper (e.g. the
		// Webflow Button component renders its link as an inner <a>).
		const link = target.tagName === "A" ? target : target.querySelector("a") || target;
		const href = buildWhatsappLink(number);
		if (link.tagName === "A") link.href = href;
		link.setAttribute("data-message", href);
	});
}

function ensureGlobalListeners() {
	if (globalBound) return;
	globalBound = true;

	document.addEventListener("click", (event) => {
		controllers.forEach((controller) => {
			if (controller.isOpen() && !controller.root.contains(event.target)) {
				controller.close();
			}
		});
	});

	document.addEventListener("keydown", (event) => {
		if (event.key !== "Escape") return;
		controllers.forEach((controller) => {
			if (controller.isOpen()) controller.close();
		});
	});
}

function createController(root) {
	// Every [data-widget-toggle] toggles — there can be more than one
	// (e.g. the launcher and a toggle inside the panel/close), so wire them all.
	const toggles = Array.from(root.querySelectorAll(SELECTORS.toggle));
	const number = (root.getAttribute("data-widget-wa-number") || WHATSAPP_NUMBER).trim();

	function setOpen(open) {
		root.setAttribute(OPEN_ATTR, open ? "true" : "false");
		toggles.forEach((t) => t.setAttribute("aria-expanded", open ? "true" : "false"));
	}

	function isOpen() {
		return root.getAttribute(OPEN_ATTR) === "true";
	}

	function open() {
		refreshWhatsappLinks(root, number);
		setOpen(true);
	}

	function close() {
		setOpen(false);
	}

	// External launchers (outside the root) register here so their ARIA state
	// is mirrored by setOpen alongside the built-in toggles.
	function registerToggle(toggle) {
		if (!toggles.includes(toggle)) toggles.push(toggle);
		toggle.setAttribute("aria-expanded", isOpen() ? "true" : "false");
	}

	const controller = { root, isOpen, open, close, registerToggle };

	const panel = root.querySelector(SELECTORS.panel);
	toggles.forEach((toggle) => {
		toggle.setAttribute("aria-expanded", "false");
		if (panel && panel.id) toggle.setAttribute("aria-controls", panel.id);

		toggle.addEventListener("click", (event) => {
			event.preventDefault();
			if (isOpen()) close();
			else open();
		});
	});

	root.querySelectorAll(SELECTORS.close).forEach((control) => {
		control.addEventListener("click", (event) => {
			event.preventDefault();
			close();
		});
	});

	// Navigate on click rather than relying on an <a href>. The Webflow Button
	// component can render its clickable as a native <button> (Type = "Button"),
	// in which case the inner <a> is hidden and never navigates. Building + opening
	// the link here works whether the clickable is an anchor or a button.
	root.querySelectorAll(SELECTORS.whatsapp).forEach((target) => {
		target.addEventListener("click", (event) => {
			event.preventDefault();
			pushWhatsappClick(number);
			window.open(buildWhatsappLink(number), "_blank", "noopener");
		});
	});

	// Prime links and starting state up front.
	refreshWhatsappLinks(root, number);
	setOpen(false);

	return controller;
}

/**
 * Wire in-page launchers that sit OUTSIDE a widget root. An external toggle
 * declares its target by data-widget value: [data-widget-toggle="contact"]
 * drives [data-widget="contact"]. Toggles inside a root are already handled by
 * createController and are skipped here. Idempotent per element.
 */
function bindExternalToggles(scope) {
	Array.from(scope.querySelectorAll(SELECTORS.toggle)).forEach((toggle) => {
		if (toggle.closest(SELECTORS.root)) return; // handled by its own controller
		if (toggle._contactWidgetBound) return;

		const targetName = (toggle.getAttribute("data-widget-toggle") || "").trim();
		if (!targetName) return; // bare toggle outside a root has no target — ignore

		const controller = controllers.find((c) => c.root.getAttribute("data-widget") === targetName);
		if (!controller) return;

		toggle._contactWidgetBound = true;
		controller.registerToggle(toggle);
		if (controller.root.id) toggle.setAttribute("aria-controls", controller.root.id);
		toggle.addEventListener("click", (event) => {
			event.preventDefault();
			// The launcher sits outside the root, so the global "click outside →
			// close" listener would treat this very click as an outside click and
			// close the widget again in the same event. Stop it reaching document.
			event.stopPropagation();
			if (controller.isOpen()) controller.close();
			else controller.open();
		});
	});
}

/**
 * Wire WhatsApp action buttons that sit OUTSIDE a widget root — e.g. the
 * "Get Started" module's "WhatsApp us" CTA. These must open WhatsApp
 * directly with the same prefilled message as the in-widget button, NOT open
 * the floating chat widget. In Webflow the button carries
 * [data-widget-action="whatsapp"] (not [data-widget-toggle]). Buttons inside a
 * root are already handled by createController and are skipped here.
 * Idempotent per element; works with or without a floating widget on the page.
 */
function bindExternalWhatsapp(scope) {
	// Accept either the semantic attribute (data-widget-action="whatsapp", as the
	// in-widget button uses) OR data-widget-toggle="whatsapp" — the latter is how
	// the Get Started CTA is authored in Webflow (a "toggle" whose target is the
	// whatsapp action rather than a widget name). Both mean "open WhatsApp".
	Array.from(scope.querySelectorAll(SELECTORS.whatsapp + ", [data-widget-toggle='whatsapp']")).forEach((target) => {
		if (target.closest(SELECTORS.root)) return; // handled by its own controller
		if (target._contactWhatsappBound) return;
		target._contactWhatsappBound = true;

		const number = (
			target.getAttribute("data-widget-wa-number") ||
			target.closest("[data-widget-wa-number]")?.getAttribute("data-widget-wa-number") ||
			WHATSAPP_NUMBER
		).trim();

		// Prime href/data-message so it behaves as a real link too; the click
		// handler rebuilds the link so attribution is fresh at click time.
		const link = target.tagName === "A" ? target : target.querySelector("a") || target;
		const href = buildWhatsappLink(number);
		if (link.tagName === "A") link.href = href;
		link.setAttribute("data-message", href);

		// Give it an accessible name (these overlay CTAs have no text), so screen
		// readers announce it and the a11y sweep doesn't mislabel it from the URL.
		if (!(target.textContent || "").trim() && !target.getAttribute("aria-label")) {
			target.setAttribute("aria-label", "WhatsApp us");
		}

		target.addEventListener("click", (event) => {
			event.preventDefault();       // stop the overlay <a href="#"> navigating
			event.stopPropagation();      // never bubble to a parent toggle / outside-click close
			pushWhatsappClick(number);
			window.open(buildWhatsappLink(number), "_blank", "noopener");
		});
	});
}

/**
 * Initialise every contact widget within the given scope. Idempotent: a root
 * is only wired once, so this is safe to call after CMS injection.
 */
export function initContactWidget(scope = document) {
	// WhatsApp CTAs outside the widget (Get Started module) — wire regardless of
	// whether a floating widget exists on this page.
	bindExternalWhatsapp(scope);

	const roots = Array.from(scope.querySelectorAll(SELECTORS.root));
	if (!roots.length) return [];

	ensureGlobalListeners();

	const instances = roots
		.map((root) => {
			if (root._contactWidget) return root._contactWidget;
			const controller = createController(root);
			root._contactWidget = controller;
			controllers.push(controller);
			return controller;
		})
		.filter(Boolean);

	bindExternalToggles(scope);

	return instances;
}

/** Getter for registered widget controllers. */
export function getContactWidgetInstances() {
	return controllers.slice();
}
