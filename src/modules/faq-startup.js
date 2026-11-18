// Shared FAQ transaction state. The independent head bootstrap owns the only
// clock; these callbacks restore module-owned mutations before terminal reveal.
const FAQ = '[data-faq-split="component"]';
const transactions = new WeakMap();

export function startupPolicy() {
	return window.sr?.componentStartup || window.sr?.tabStartup;
}

export function canStartComponent() {
	return startupPolicy()?.canEnhance?.() ?? true;
}

export function registerPending(root, rollback) {
	return startupPolicy()?.register?.(root, rollback) || (() => {});
}

export function faqRoot(element) {
	return element?.closest?.(FAQ) || null;
}

export function accordionFaqRoot(element) {
	const root = faqRoot(element);
	if (!root) return null;
	// An accordion inside an answer owns its own lifecycle, even when that
	// answer belongs to an outer FAQ. Whole nested FAQ roots are already distinct.
	if (faqRoot(element.parentElement?.closest('[data-accordion="item"]')) === root) return null;
	return root;
}

export function fallbackFaq(root, reason = "component-error") {
	if (!root) return;
	root.setAttribute("data-faq-startup-state", "fallback");
	root.querySelectorAll('[data-accordion="item"]').forEach((item) => {
		if (accordionFaqRoot(item) === root) item.setAttribute("data-accordion-startup-state", "fallback");
	});
	const transaction = transactions.get(root);
	if (!transaction) return;
	transaction.unregister?.();
	const callbacks = [...transaction.callbacks.values()];
	transaction.callbacks.clear();
	callbacks.forEach((rollback) => {
		try { rollback(reason); }
		catch (error) { console.warn("[faq] rollback failed", error); }
	});
}

export function canStartFaq(root) {
	if (root?.getAttribute("data-faq-startup-state") === "fallback") return false;
	if (!canStartComponent()) {
		if (root?.getAttribute("data-faq-startup-state") !== "managed") fallbackFaq(root, "deadline");
		return false;
	}
	return true;
}

export function registerFaqCleanup(root, owner, rollback) {
	let transaction = transactions.get(root);
	if (!transaction) {
		transaction = { callbacks: new Map(), unregister: null };
		transactions.set(root, transaction);
		transaction.callbacks.set(owner, rollback);
		transaction.unregister = registerPending(root, () => {
			if (root.getAttribute("data-faq-startup-state") !== "managed") fallbackFaq(root, "deadline");
		});
	} else transaction.callbacks.set(owner, rollback);
	if (root.getAttribute("data-faq-startup-state") === "fallback") fallbackFaq(root);
	return () => {
		if (!transaction.callbacks.delete(owner) || root.getAttribute("data-faq-startup-state") !== "managed") return;
		// Normal teardown invalidates whole-root completion. A partial rebuild
		// must have a fresh pending rollback, rather than inherit stale success.
		root.removeAttribute("data-faq-startup-state");
		transaction.unregister = registerPending(root, () => fallbackFaq(root, "deadline"));
	};
}

export function completeFaq(root) {
	if (!canStartFaq(root)) return false;
	const incomplete = [...root.querySelectorAll('[data-accordion="item"]')].some((item) =>
		accordionFaqRoot(item) === root &&
		item.getAttribute("data-accordion-startup-state") !== "managed" &&
		item.getAttribute("data-accordion-ready") !== "true");
	if (incomplete) { fallbackFaq(root, "incomplete-accordion"); return false; }
	root.setAttribute("data-faq-startup-state", "managed");
	transactions.get(root)?.unregister?.();
	return true;
}
