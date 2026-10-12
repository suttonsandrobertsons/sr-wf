import { DESKTOP_MEDIA_QUERY } from "../utils/breakpoints.js";

console.log("[S&R nav] updated nav.js loaded — in-situ nav mode");

const SELECTORS = {
	component: ".nav",
	trigger: "[data-nav-trigger]",
	panel: "[data-nav-mega]",
	/* desktop mega panels */
	megaCol: ".nav_mega-col[data-nav-data-src]",
	megaColAny: ".nav_mega-col",
	megaColStack: ".nav_mega-col-stack",
	megaList: '.nav_mega-list[data-nav-list="primary"]',
	megaItem: ".nav_mega-item",
	revealTrigger: "[data-nav-reveal-panel-id]",
	panelAction: "[data-nav-url]",
	megaFallback: "[data-nav-panel-fallback]",
	megaMedia: "[data-nav-media]",
	megaDesc: "[data-nav-replace$='-desc']",
	megaImg: "[data-nav-replace$='-img']",
	/* Authored level-1 links drive the child columns through data-nav-target. */
	megaDriver: '.nav_mega-col[data-nav-panel-level="1"]',
	generalData: '[data-nav-type="general"]',
	/* mobile selectors */
	mobile: ".nav_mobile",
	mobileBtn: ".nav_mobile-btn",
	mobilePanel: "[data-nav-mbl-panel-id]",
	mobilePanelList: ".nav_mobile-list",
	mobileTarget: "[data-nav-target]",
	mobileBack: ".nav_mobile-header",
	mobileFallback: "[data-nav-mbl-panel-fallback]",
};

const CLASSES = {
	open: "is-mega-open",
	active: "is-active",
	mobileActive: "is-active",
	mobileOpen: "nav-mobile-open",
	scrolled: "nav-scrolled",
};

const DEFAULT_IMAGE = "";
const RESIZE_DEBOUNCE_MS = 150;

/* Asset slugs are plural in the asset collection but singular in the brand
 * filter-product / brand-product values. Normalise both to a shared key. */
const ASSET_PRODUCT_ALIASES = {
	watch: "watch",
	watches: "watch",
	jewellery: "jewellery",
	handbag: "handbag",
	handbags: "handbag",
	gold: "gold",
	silver: "silver",
	platinum: "platinum",
	other: "other",
};

function assetProductKey(value) {
	const key = normalise(value);
	return ASSET_PRODUCT_ALIASES[key] || key;
}

const DEBUG_MOBILE_NAV = false;

function logMobileNav(message, data = {}) {
	if (!DEBUG_MOBILE_NAV) return;
	console.log(`[nav:mobile] ${message}`, data);
}

function toBool(value) {
	return value === "true" || value === true;
}

function normalise(value) {
	return String(value || "")
		.trim()
		.toLowerCase();
}

function normaliseGeneralType(value) {
	const type = normalise(value);

	// Webflow's CMS option values are length-limited, so some "other-*" types
	// arrive truncated as "othr-*". Normalise back to the canonical prefix.
	if (type.startsWith("othr-")) {
		return `other-${type.slice(5)}`;
	}

	return type;
}

function normaliseNavLocation(value) {
	const location = normalise(value);

	if (["mobile", "mobile-only", "mobile only"].includes(location)) return "mobile-only";
	if (["desktop", "desktop-only", "desktop only"].includes(location)) return "desktop-only";

	return "all";
}

function isVisibleInNavLocation(item, location) {
	const itemLocation = item?.navLocation || "all";

	return itemLocation === "all" || itemLocation === `${location}-only`;
}

function debounce(fn, wait = RESIZE_DEBOUNCE_MS) {
	let timeoutId;

	return (...args) => {
		window.clearTimeout(timeoutId);
		timeoutId = window.setTimeout(() => fn(...args), wait);
	};
}

function matchesDesktopViewport() {
	return Boolean(window.matchMedia?.(DESKTOP_MEDIA_QUERY)?.matches);
}

function getDataMap(el) {
	return { ...el.dataset };
}

let generalItemsCache = null;

function setImage(img, src, alt = "") {
	if (!img) return;

	const nextSrc = src || DEFAULT_IMAGE;

	if (!nextSrc) return;

	img.src = nextSrc;
	img.alt = alt;
}

function setText(el, text) {
	if (!el) return;
	el.textContent = text || "";
}

function clearActive(elements) {
	elements.forEach((el) => el.classList.remove(CLASSES.active));
}

function setActive(el) {
	if (!el) return;
	el.classList.add(CLASSES.active);
}

function getImageFromItem(item) {
	const wrapper = item?.closest?.("[data-nav-additional-panel]");
	const image = wrapper?.querySelector("[data-nav-img]");

	return image?.getAttribute("src") || item?.dataset?.navImg || "";
}

function getImageAltFromItem(item) {
	const wrapper = item?.closest?.("[data-nav-additional-panel]");
	const image = wrapper?.querySelector("[data-nav-img]");

	return image?.getAttribute("alt") || item?.textContent?.trim() || "";
}

function getDescriptionFromItem(item) {
	const wrapper = item?.closest?.("[data-nav-additional-panel]");
	return wrapper?.dataset?.navDescription || item?.dataset?.navDesc || "";
}

function getTargetFromItem(item) {
	const wrapper = item?.closest?.("[data-nav-additional-panel]");
	return wrapper?.dataset?.navTarget || item?.dataset?.navTarget || "";
}

function getItemHref(item) {
	return item?.getAttribute("href") || "";
}

function getBrands() {
	return getGeneral()
		.filter((item) => item.type.startsWith("brand-"))
		.map((item) => ({
			...item,
			popular: toBool(item.data.navBrandPopular || item.data.navPopular),
			image: item.brandImage || item.image,
			logo: item.data.navLogoUrl,
			products: [],
			urls: {
				loanWatch: item.data.navLoanWatchUrl,
				loanJewellery: item.data.navLoanJewelleryUrl,
				loanHandbag: item.data.navLoanHandbagUrl,
				sellWatch: item.data.navSellWatchUrl,
				sellJewellery: item.data.navSellJewelleryUrl,
				sellHandbag: item.data.navSellHandbagUrl,
			},
		}));
}

function getAssets() {
	return getGeneral()
		.filter((item) => item.type.startsWith("asset"))
		.map((item) => ({
			...item,
			image: item.assetImage || item.image,
			url: item.urls?.[item.type.includes("sell") ? "sell" : "loan"] || item.url,
			target: item.targetPanelId || item.target,
		}));
}

function getGeneral() {
	if (generalItemsCache) return generalItemsCache;

	generalItemsCache = [...document.querySelectorAll(SELECTORS.generalData)].map((el, index) => {
		const data = getDataMap(el);

		return {
			el,
			data,
			name: data.navName,
			slug: data.navSlug,
			id: data.navId || data.navSlug,
			type: normaliseGeneralType(data.navGeneralType),
			url: data.navUrl,
			image: data.navImgUrl,
			brandId: data.navBrandId,
			brandImage: data.navBrandImgUrl,
			asset: data.navAsset,
			assetSlug: data.navAssetSlug,
			assetId: data.navAssetId,
			assetImage: data.navAssetImgUrl,
			assetGroup: normalise(data.navAssetGroup),
			goldSlug: data.navGoldSlug,
			goldImage: data.navGoldImgUrl,
			goldLoanUrl: data.navGoldLoanUrl,
			goldSellUrl: data.navGoldSellUrl,
			useCase: data.navUseCase,
			useCaseSlug: data.navUseCaseSlug,
			useCaseId: data.navUseCaseId,
			useCaseUrl: data.navUseCaseUrl,
			useCaseImage: data.navUseCaseImgUrl,
			targetPanelId: normalise(data.navTargetPanelId),
			target: normalise(data.navTargetPanelId || data.navTarget),
			revealPanelId: normalise(data.navRevealPanelId),
			navLocation: normaliseNavLocation(data.navLocation || data.navDisplay),
			desc: data.navDesc,
			popular: toBool(data.navPopular),
			sort: toNumber(data.navSort ?? index),
			urls: {
				loan: data.navLoanUrl,
				sell: data.navSellUrl,
				loanWatch: data.navLoanWatchUrl,
				loanJewellery: data.navLoanJewelleryUrl,
				loanHandbag: data.navLoanHandbagUrl,
				sellWatch: data.navSellWatchUrl,
				sellJewellery: data.navSellJewelleryUrl,
				sellHandbag: data.navSellHandbagUrl,
			},
		};
	});

	return generalItemsCache;
}

function hasValidHref(el) {
	const href = el.getAttribute("href") || "";
	return href && href !== "#" && !href.startsWith("javascript:");
}

function toNumber(value) {
	const number = Number(value);
	return Number.isFinite(number) ? number : Infinity;
}

function capitalise(value) {
	return value ? value.charAt(0).toUpperCase() + value.slice(1) : "";
}

function getServiceProductUrl(item, service, product) {
	if (!item) return "";

	if (item.urls?.[`${service}${capitalise(product)}`]) {
		return item.urls[`${service}${capitalise(product)}`];
	}

	const data = item.data || item;

	return data?.[`nav${capitalise(service)}${capitalise(product)}Url`] || "";
}

function getOtherUrl(item, service) {
	return (
		item?.urls?.[service] ||
		item?.data?.[`navAsset${capitalise(service)}Url`] ||
		item?.data?.[`nav${capitalise(service)}Url`] ||
		item?.url ||
		""
	);
}

function getAssetGeneralUrl(item, service) {
	return (
		item?.data?.[`navAsset${capitalise(service)}Url`] || item?.urls?.[service] || item?.url || ""
	);
}

function matchesReference(item, refs) {
	return refs.some((ref) => {
		const key = normalise(ref);
		return key && [item.id, item.slug, item.name].some((value) => normalise(value) === key);
	});
}

function getReferencedBrandUrl(data, service, product) {
	if (!service || !product) return "";

	const refs = [data.navBrandId];
	const brand = getBrands().find(
		(item) =>
			refs.some((ref) => normalise(ref) && normalise(item.brandId) === normalise(ref)) ||
			matchesReference(item, refs),
	);

	return brand ? getServiceProductUrl(brand, service, product) : "";
}

function getReferencedAssetUrl(data, service) {
	if (!service) return "";

	const refs = [data.navAssetId, data.navAssetSlug, data.navAsset, data.navName];
	const asset = getAssets().find((item) => matchesReference(item, refs));

	return asset ? getAssetGeneralUrl(asset, service) : "";
}

function getReferencedImage(items, refs) {
	const item = items.find((candidate) => matchesReference(candidate, refs));

	return item?.image || item?.assetImage || item?.brandImage || item?.useCaseImage || "";
}

function getReferencedAssetImage(data) {
	const refs = [data.navAssetId, data.navAssetSlug, data.navAsset, data.navName];

	return getReferencedImage(getAssets(), refs);
}

function getReferencedUseCaseUrl(data) {
	const refs = [data.navUseCaseId, data.navUseCaseSlug, data.navUseCase, data.navUseCaseName];
	const useCase = getSimpleSourceItems("use-case").find((item) => matchesReference(item, refs));

	return useCase?.useCaseUrl || useCase?.url || "";
}

function getReferencedUseCaseImage(data) {
	const refs = [
		data.navUseCaseId,
		data.navUseCaseSlug,
		data.navUseCase,
		data.navUseCaseName,
		data.navName,
	];

	return getReferencedImage(getSimpleSourceItems("use-case"), refs);
}

function getReferencedGoldImage(data) {
	const refs = [data.navGoldId, data.navGoldSlug, data.navGold, data.navGoldName, data.navName];
	const strippedName = normalise(data.navName).replace(/^gold\s+/, "");

	if (strippedName) refs.push(strippedName);

	const images = getAssets().concat(getGeneral().filter((item) => item.type.startsWith("gold")));
	const directMatch = getReferencedImage(images, refs);
	if (directMatch) return directMatch;

	const genericGoldAsset = getGeneral().find(
		(item) => item.targetPanelId === "gold" || item.assetSlug === "gold" || item.asset === "Gold",
	);

	return genericGoldAsset?.assetImage || genericGoldAsset?.image || "";
}

function getGoldUrl(data, service) {
	if (!service) return data.navGoldUrl || "";

	return data[`navGold${capitalise(service)}Url`] || data.navGoldUrl || "";
}

function getReferencedGeneralUrl(data, service, product) {
	return (
		getReferencedBrandUrl(data, service, product) ||
		getReferencedAssetUrl(data, service) ||
		getReferencedUseCaseUrl(data) ||
		(service && product ? getServiceProductUrl(data, service, product) : "") ||
		(service ? getAssetGeneralUrl(data, service) : "")
	);
}

function getGeneralUrl(data, service, product, fallback = "") {
	const type = normaliseGeneralType(data.navGeneralType);

	if (type.startsWith("gold")) {
		const goldUrl = getGoldUrl(data, service);
		if (goldUrl) return goldUrl;
	}

	if (type === "use-case") {
		if (data.navUseCaseUrl) return data.navUseCaseUrl;
	}

	if (type.startsWith("other")) {
		const otherUrl =
			data[`navAsset${capitalise(service)}Url`] ||
			data.navAssetLoanUrl ||
			data.navAssetSellUrl ||
			data.navUrl ||
			"";

		if (otherUrl) return otherUrl;
	}

	if (data.navUrl) return data.navUrl;

	const referencedUrl = getReferencedGeneralUrl(data, service, product);
	if (referencedUrl) return referencedUrl;

	return fallback && fallback !== "#" ? fallback : "";
}

function getGeneralTypeImage(data) {
	const type = normaliseGeneralType(data.navGeneralType);

	if (type.startsWith("asset")) {
		return data.navAssetImgUrl || getReferencedAssetImage(data) || data.navImgUrl || "";
	}

	if (type === "use-case") {
		return data.navUseCaseImgUrl || getReferencedUseCaseImage(data) || data.navImgUrl || "";
	}

	if (type.startsWith("gold")) {
		return data.navGoldImgUrl || getReferencedGoldImage(data) || data.navImgUrl || "";
	}

	return data.navImgUrl || "";
}

function getGeneralImage(item, data, service, product) {
	const generalTypeImage = getGeneralTypeImage(data);

	if (service && product)
		return item.brandImage || item.logo || item.image || generalTypeImage || "";
	if (service) return generalTypeImage || item.image || item.brandImage || item.logo || "";

	return item.image || item.brandImage || item.logo || generalTypeImage || "";
}

function getGold() {
	return getGeneral()
		.filter((item) => item.type.startsWith("gold"))
		.map((item) => ({
			...item,
			image: item.goldImage || item.image,
			urls: {
				loan: item.goldLoanUrl,
				sell: item.goldSellUrl,
			},
			url: item.goldLoanUrl || item.goldSellUrl || item.url,
		}));
}

function getOtherItems() {
	return getGeneral()
		.filter((item) => item.type.startsWith("other"))
		.map((item) => ({
			...item,
			url:
				item.data.navAssetLoanUrl ||
				item.data.navAssetSellUrl ||
				item.data.navLoanUrl ||
				item.data.navSellUrl ||
				item.url,
			urls: {
				loan: item.data.navAssetLoanUrl || item.data.navLoanUrl || item.url,
				sell: item.data.navAssetSellUrl || item.data.navSellUrl || item.url,
			},
		}));
}

function getSimpleSourceItems(source) {
	if (source !== "use-case") return [];

	return getGeneral()
		.filter((item) => item.type === normaliseGeneralType("use-case"))
		.map((item) => ({
			...item,
			url: item.useCaseUrl || item.url,
			image: item.useCaseImage || item.image,
		}));
}

function createMobileRow(label, href, target = "") {
	const row = document.createElement("a");

	row.className = "nav_mobile-row w-inline-block";
	row.href = href || "#";
	row.dataset.navTarget = target || "";
	row.dataset.navMblGenerated = "true";

	row.innerHTML = `
		<p class="nav_mobile-row-text">${label}</p>
		<div aria-hidden="true" class="nav_mobile-row-icon">
			<svg width="100%" height="100%" viewBox="0 0 8 16" aria-hidden="true">
				<path d="M8 8 .982 16 0 14.88 6.035 8 0 1.12.982 0z" fill="currentColor"></path>
			</svg>
		</div>
	`;

	return row;
}

function populateMobilePanel(panel) {
	const source = normalise(panel.dataset.navMblDataSrc);
	logMobileNav("populateMobilePanel:start", {
		panelId: panel.dataset.navMblPanelId,
		source,
		service: panel.dataset.navMblFilterService,
		product: panel.dataset.navMblFilterProduct,
		limit: panel.dataset.navMblDataLimit,
	});
	if (!source || source !== "general") return;

	const list = panel.querySelector(SELECTORS.mobilePanelList);
	if (!list) return;

	list.querySelectorAll("[data-nav-mbl-generated]").forEach((el) => el.remove());

	const service = normalise(panel.dataset.navMblFilterService);
	const product = normalise(panel.dataset.navMblFilterProduct);
	const limit = Number(panel.dataset.navMblDataLimit) || Infinity;
	const fallback = panel.querySelector(SELECTORS.mobileFallback)?.getAttribute("href") || "";

	let items = [];
	const filter = normaliseGeneralType(panel.dataset.navMblFilterGeneral);

	items = getGeneral()
		.filter((item) => isVisibleInNavLocation(item, "mobile"))
		.filter((item) => !filter || item.type === filter)
		.map((item) => {
			const target = item.targetPanelId || item.target;

			return {
				name: item.name,
				url: target ? "" : getGeneralUrl(item.data, service, product, fallback),
				target,
				sort: item.sort,
			};
		})
		.filter((item) => item.name && (item.url || item.target));

	logMobileNav("populateMobilePanel:items", {
		panelId: panel.dataset.navMblPanelId,
		count: items.length,
		items,
	});

	items
		.sort((a, b) => a.sort - b.sort)
		.slice(0, limit)
		.forEach((item) => {
			list.appendChild(createMobileRow(item.name, item.url, item.target));
		});
}

function applyMobileFallbackLinks(panel) {
	const fallbackEl = panel.querySelector(SELECTORS.mobileFallback);
	const fallback = fallbackEl?.getAttribute("href") || "";

	logMobileNav("applyMobileFallbackLinks:start", {
		panelId: panel.dataset.navMblPanelId,
		fallback,
	});

	if (!fallback || fallback === "#") return;

	panel.querySelectorAll(SELECTORS.mobileTarget).forEach((row) => {
		const target = normalise(row.dataset.navTarget);

		if (target || hasValidHref(row)) return;

		logMobileNav("applyMobileFallbackLinks:applied", {
			panelId: panel.dataset.navMblPanelId,
			text: row.textContent.trim(),
			fallback,
		});

		row.href = fallback;
	});
}

function initMobileNav(root) {
	const mobile = root.querySelector(SELECTORS.mobile);
	logMobileNav("initMobileNav:start", {
		mobileFound: Boolean(mobile),
	});
	if (!mobile) return;

	const mobileBtn = root.querySelector(SELECTORS.mobileBtn);

	const panels = [...mobile.querySelectorAll(SELECTORS.mobilePanel)];
	logMobileNav("initMobileNav:panels", {
		count: panels.length,
		panelIds: panels.map((panel) => panel.dataset.navMblPanelId),
	});

	function getPanel(id) {
		return panels.find((panel) => panel.dataset.navMblPanelId === id);
	}

	function resolvePanelId(target, contextPanel) {
		const rawTarget = normalise(target);
		if (!rawTarget) return "";

		const candidates = [rawTarget];
		const panelId = normalise(contextPanel?.dataset.navMblPanelId);
		const parentId = normalise(contextPanel?.dataset.navMblParent);

		if (panelId) candidates.push(`${panelId}-${rawTarget}`);
		if (parentId) candidates.push(`${parentId}-${rawTarget}`);

		return candidates.find((id) => Boolean(getPanel(id))) || rawTarget;
	}

	function activatePanel(id = "primary") {
		const nextPanel = getPanel(id) || getPanel("primary");
		logMobileNav("activatePanel", {
			requestedId: id,
			resolvedId: nextPanel?.dataset.navMblPanelId,
			foundRequestedPanel: Boolean(getPanel(id)),
		});
		if (!nextPanel) return;

		panels.forEach((panel) => {
			panel.classList.toggle(CLASSES.mobileActive, panel === nextPanel);
		});
	}

	function resetPanels() {
		logMobileNav("resetPanels");
		activatePanel("primary");
	}

	function setMobileOpen(isOpen) {
		document.documentElement.classList.toggle(CLASSES.mobileOpen, isOpen);
		mobile.classList.toggle(CLASSES.active, isOpen);

		if (mobileBtn) {
			mobileBtn.setAttribute("aria-expanded", String(isOpen));
			mobileBtn.setAttribute("aria-label", isOpen ? "Close menu" : "Open menu");
		}

		logMobileNav("setMobileOpen", { isOpen });

		if (!isOpen) resetPanels();
	}

	function resetMobileStateForDesktop() {
		logMobileNav("resetMobileStateForDesktop");
		setMobileOpen(false);
	}

	panels.forEach((panel) => {
		applyMobileFallbackLinks(panel);
	});

	mobile.addEventListener("click", (event) => {
		logMobileNav("click", {
			targetTag: event.target.tagName,
			targetClass: event.target.className,
			targetText: event.target.textContent?.trim(),
		});
		const targetLink = event.target.closest(SELECTORS.mobileTarget);
		logMobileNav("click:targetLink", {
			found: Boolean(targetLink),
			text: targetLink?.textContent?.trim(),
			target: targetLink?.dataset.navTarget,
			href: targetLink?.getAttribute("href"),
		});

		if (targetLink) {
			const panel = event.target.closest(SELECTORS.mobilePanel);
			const target = resolvePanelId(targetLink.dataset.navTarget, panel);

			logMobileNav("click:targetResolved", {
				target,
				panelFound: Boolean(getPanel(target)),
			});

			if (target && getPanel(target)) {
				event.preventDefault();
				activatePanel(target);
				return;
			}
		}

		const back = event.target.closest(SELECTORS.mobileBack);
		logMobileNav("click:back", {
			found: Boolean(back),
		});

		if (back) {
			const panel = event.target.closest(SELECTORS.mobilePanel);
			const parent = normalise(panel?.dataset.navMblParent);

			logMobileNav("click:backResolved", {
				currentPanel: panel?.dataset.navMblPanelId,
				parent,
				parentPanelFound: Boolean(getPanel(parent)),
			});

			if (parent && getPanel(parent)) {
				event.preventDefault();
				activatePanel(parent);
			}
		}
	});

	if (mobileBtn) {
		mobileBtn.setAttribute("aria-expanded", "false");
		mobileBtn.setAttribute("aria-label", "Open menu");

		mobileBtn.addEventListener("click", () => {
			setMobileOpen(!document.documentElement.classList.contains(CLASSES.mobileOpen));
		});
	}

	document.addEventListener("keydown", (event) => {
		if (event.key !== "Escape") return;
		if (!document.documentElement.classList.contains(CLASSES.mobileOpen)) return;

		setMobileOpen(false);
	});

	const handleViewportResize = debounce(() => {
		if (!matchesDesktopViewport()) return;
		resetMobileStateForDesktop();
	});

	window.addEventListener("resize", handleViewportResize, { passive: true });

	if (matchesDesktopViewport()) {
		resetMobileStateForDesktop();
	}

	resetPanels();
}

/* ----------------------------------------------------------------
 * Desktop mega panels (data-driven, mirrors the mobile approach)
 * ---------------------------------------------------------------- */

function createMegaItem({ label, href, image, target, product, desc, revealPanelId }) {
	const link = document.createElement("a");

	link.className = "nav_mega-item";
	link.href = href || "#";
	link.textContent = label || "";
	link.dataset.navGenerated = "true";

	if (image) link.dataset.navImg = image;
	if (target) link.dataset.navTarget = target;
	if (product) link.dataset.navProduct = product;
	if (desc) link.dataset.navDesc = desc;
	if (revealPanelId) link.dataset.navRevealPanelId = revealPanelId;

	return link;
}

function colFallbackHref(col) {
	const fallback = col?.querySelector(SELECTORS.megaFallback);
	return fallback?.getAttribute("href") || "";
}

/* Each child col in a stack maps to a single asset via a shared product key. */
function childColKey(col) {
	const source = normalise(col.dataset.navDataSrc);

	if (source === "brand") return assetProductKey(col.dataset.navFilterProduct);
	if (source === "gold") return "gold";
	if (source === "other") return "other";

	return assetProductKey(col.dataset.navFilterProduct || col.dataset.navPanelId);
}

function getStackChildMap(panel) {
	const map = new Map();
	const stack = panel.querySelector(SELECTORS.megaColStack);

	if (!stack) return map;

	stack.querySelectorAll(SELECTORS.megaColAny).forEach((col) => {
		if (!col.dataset.navPanelId) return;

		const key = childColKey(col);
		if (key && !map.has(key)) map.set(key, col);
	});

	return map;
}

function buildAssetItems(col, panel) {
	const childMap = getStackChildMap(panel);
	const service = normalise(col?.dataset.navFilterService) || normalise(panel?.dataset.navMega);
	const assetGroup = normalise(col?.dataset.navAssetGroup);

	return getAssets()
		.filter((asset) => isVisibleInNavLocation(asset, "desktop"))
		.filter((asset) => !assetGroup || asset.assetGroup === assetGroup)
		.map((asset) => {
			const key = assetProductKey(asset.slug);
			const child = childMap.get(key);
			const href = asset.urls?.[service] || asset.url || "";

			if (!child && !href) return null;

			return {
				label: asset.name,
				href: href || colFallbackHref(child),
				image: asset.image,
				target: child?.dataset.navPanelId || asset.targetPanelId || asset.target || "",
				product: key,
				sort: asset.sort,
			};
		})
		.filter(Boolean);
}

function buildBrandItems(service, product) {
	const productKey = assetProductKey(product);

	return getBrands()
		.filter((brand) => isVisibleInNavLocation(brand, "desktop"))
		.map((brand) => ({
			label: brand.name,
			href: getServiceProductUrl(brand, service, product),
			image: brand.image || brand.logo,
			sort: brand.sort,
			hasProduct: !brand.products.length || brand.products.includes(productKey),
		}))
		.filter((item) => item.href && item.hasProduct);
}

function buildOtherProductItems(service) {
	return getOtherItems()
		.filter((item) => isVisibleInNavLocation(item, "desktop"))
		.map((item) => {
			return {
				label: item.name,
				href:
					getGeneralUrl(item.data, service, "", "") ||
					item.urls?.[service] ||
					getOtherUrl(item, service),
				image: item.image || item.assetImage || item.brandImage || "",
				sort: item.sort,
			};
		})
		.filter((item) => item.href);
}

function buildSimpleItems(source) {
	return getSimpleSourceItems(source)
		.filter((item) => isVisibleInNavLocation(item, "desktop"))
		.map((item) => {
			return {
				label: item.name,
				href: item.useCaseUrl || item.url,
				image: item.image || item.useCaseImage || "",
				desc: item.desc,
				sort: item.sort,
			};
		})
		.filter((item) => item.label && item.href);
}

function buildGeneralItems(col, panel) {
	const filter = normaliseGeneralType(col.dataset.navFilterGeneral);
	const service = normalise(col.dataset.navFilterService) || normalise(panel?.dataset.navMega);
	const product = normalise(col.dataset.navFilterProduct);
	const fallback = colFallbackHref(col);

	return getGeneral()
		.filter((item) => isVisibleInNavLocation(item, "desktop"))
		.filter((item) => !filter || item.type === filter)
		.map((item) => {
			const target = item.targetPanelId || item.target;

			return {
				label: item.name,
				href: getGeneralUrl(item.data, service, product, fallback),
				image: getGeneralImage(item, item.data, service, product),
				desc: item.desc,
				target,
				revealPanelId: item.revealPanelId,
				sort: item.sort,
			};
		})
		.filter((item) => item.label && (item.href || item.target));
}

function buildGoldItems(service) {
	return getGold()
		.filter((item) => isVisibleInNavLocation(item, "desktop"))
		.map((item) => ({
			label: item.name,
			href: item.urls?.[service] || item.url || "",
			image: item.image,
			sort: item.sort,
		}))
		.filter((item) => item.label && item.href);
}

function buildMegaItems(col, panel) {
	const source = normalise(col.dataset.navDataSrc);
	const service = normalise(col.dataset.navFilterService);
	const product = normalise(col.dataset.navFilterProduct);

	if (source === "general") return buildGeneralItems(col, panel);
	if (source === "asset") return buildAssetItems(col, panel);
	if (source === "brand") return buildBrandItems(service, product);
	if (source === "other") return buildOtherProductItems(service);
	if (source === "use-case") return buildSimpleItems("use-case");
	if (source === "gold") return buildGoldItems(service || normalise(panel?.dataset.navMega));

	/* Unknown / static source — leave authored content untouched. */
	return null;
}

function applyMegaFallback(col) {
	const fallback = colFallbackHref(col);

	if (!fallback || fallback === "#") return;

	col.querySelectorAll(SELECTORS.megaItem).forEach((item) => {
		if (normalise(item.dataset.navTarget)) return;
		if (hasValidHref(item)) return;
		item.href = fallback;
	});
}

function populateMegaColumn(col, panel) {
	const items = buildMegaItems(col, panel);
	if (!items) return;

	const list = col.querySelector(SELECTORS.megaList);
	if (!list) return;

	list.querySelectorAll("[data-nav-generated]").forEach((el) => el.remove());

	const limit = Number(col.dataset.navDataLimit) || Infinity;

	items
		.sort((a, b) => (a.sort ?? Infinity) - (b.sort ?? Infinity))
		.slice(0, limit)
		.forEach((item) => list.appendChild(createMegaItem(item)));

	applyMegaFallback(col);
}

function getPanelMedia(panel) {
	return (
		panel.querySelector(`${SELECTORS.megaMedia} img`) || panel.querySelector(SELECTORS.megaImg)
	);
}

function getPanelDescs(panel) {
	return [...panel.querySelectorAll(SELECTORS.megaDesc)];
}

function setPanelDesc(panel, text) {
	getPanelDescs(panel).forEach((desc) => setText(desc, text));
}

function setPanelActionHref(panel, href) {
	const nextHref = href || "#";

	panel.querySelectorAll(SELECTORS.panelAction).forEach((action) => {
		action.dataset.navUrl = href || "";

		if (typeof action.getAttribute === "function" && action.matches("a")) {
			action.setAttribute("href", nextHref);
		}

		action.querySelectorAll(".button_clickable").forEach((link) => {
			link.setAttribute("href", nextHref);
		});
	});
}

function initStackPanel(panel, stack) {
	const media = getPanelMedia(panel);
	const driver = panel.querySelector(SELECTORS.megaDriver);
	const driverItems = driver ? [...driver.querySelectorAll(SELECTORS.megaItem)] : [];
	const childCols = [...stack.querySelectorAll(SELECTORS.megaColAny)].filter(
		(col) => col.dataset.navPanelId,
	);
	const revealTriggers = [...panel.querySelectorAll(SELECTORS.revealTrigger)];
	const defaultChildId = childCols[0]?.dataset.navPanelId || "";

	let currentAssetImage = "";
	let currentAssetImageAlt = "";
	let currentDriverTargetId = defaultChildId;
	let currentRevealPanelId = "";
	let currentActionHref = "";

	function setMedia(src, alt) {
		if (src) setImage(media, src, alt);
	}

	function showChild(targetIds) {
		const visibleIds = targetIds instanceof Set ? targetIds : new Set(targetIds ? [targetIds] : []);

		childCols.forEach((col) => {
			col.classList.toggle(CLASSES.active, visibleIds.has(col.dataset.navPanelId));
		});
	}

	function renderChildVisibility(baseId, revealId = "") {
		const visibleIds = new Set();
		const resolvedBaseId = normalise(baseId) || defaultChildId;
		const resolvedRevealId = normalise(revealId);

		if (resolvedBaseId && childCols.some((col) => col.dataset.navPanelId === resolvedBaseId)) {
			visibleIds.add(resolvedBaseId);
		}

		if (resolvedRevealId && childCols.some((col) => col.dataset.navPanelId === resolvedRevealId)) {
			visibleIds.add(resolvedRevealId);
		}

		showChild(visibleIds);
	}

	function activateDriver(item) {
		if (!item) return;

		clearActive(driverItems);
		setActive(item);

		currentDriverTargetId = normalise(getTargetFromItem(item)) || defaultChildId;
		currentRevealPanelId = normalise(item.dataset.navRevealPanelId);
		currentActionHref = getItemHref(item) || currentActionHref;
		renderChildVisibility(currentDriverTargetId, currentRevealPanelId);

		currentAssetImage = getImageFromItem(item);
		currentAssetImageAlt = getImageAltFromItem(item);
		setMedia(currentAssetImage, currentAssetImageAlt);
		setPanelActionHref(panel, currentActionHref);
		setPanelDesc(panel, getDescriptionFromItem(item));
	}

	function activateRevealTrigger(trigger) {
		const revealPanelId = normalise(trigger.dataset.navRevealPanelId);
		if (!revealPanelId) return;

		currentRevealPanelId = revealPanelId;
		currentActionHref = getItemHref(trigger) || currentActionHref;
		renderChildVisibility(currentDriverTargetId, currentRevealPanelId);
		setPanelActionHref(panel, currentActionHref);
	}

	function activateChildItem(item) {
		currentActionHref = getItemHref(item) || currentActionHref;
		setPanelActionHref(panel, currentActionHref);
		const image = getImageFromItem(item);
		if (image) {
			setMedia(image, getImageAltFromItem(item));
		} else {
			setMedia(currentAssetImage, currentAssetImageAlt);
		}
		setPanelDesc(panel, getDescriptionFromItem(item));
	}

	function handlePanelItemHover(event) {
		const item = event.target.closest(SELECTORS.megaItem);
		if (!item || !panel.contains(item)) return;

		if (driverItems.includes(item)) {
			activateDriver(item);
			return;
		}

		activateChildItem(item);
	}

	panel.addEventListener("mouseover", handlePanelItemHover);
	panel.addEventListener("focusin", handlePanelItemHover);

	revealTriggers.forEach((trigger) => {
		trigger.addEventListener("mouseenter", () => activateRevealTrigger(trigger));
		trigger.addEventListener("focus", () => activateRevealTrigger(trigger));
	});

	activateDriver(
		driverItems.find((item) => item.classList.contains(CLASSES.active)) || driverItems[0],
	);
}

function initDetailPanel(panel) {
	const media = getPanelMedia(panel);
	const driver = panel.querySelector(SELECTORS.megaDriver);
	if (!driver) return;

	const items = [...driver.querySelectorAll(SELECTORS.megaItem)];
	let currentActionHref = "";

	function activate(item) {
		if (!item) return;

		clearActive(items);
		setActive(item);
		currentActionHref = getItemHref(item) || currentActionHref;
		setPanelActionHref(panel, currentActionHref);

		const image = getImageFromItem(item);
		if (image) setImage(media, image, getImageAltFromItem(item));

		setPanelDesc(panel, getDescriptionFromItem(item));
	}

	function handlePanelItemHover(event) {
		const item = event.target.closest(SELECTORS.megaItem);
		if (!item || !panel.contains(item)) return;

		activate(item);
	}

	panel.addEventListener("mouseover", handlePanelItemHover);
	panel.addEventListener("focusin", handlePanelItemHover);

	activate(items.find((item) => item.classList.contains(CLASSES.active)) || items[0]);
}

function initMegaPanel(panel) {
	const stack = panel.querySelector(SELECTORS.megaColStack);

	if (stack) {
		initStackPanel(panel, stack);
	} else {
		initDetailPanel(panel);
	}
}

function initDesktopMega(root) {
	root.querySelectorAll(SELECTORS.panel).forEach(initMegaPanel);
}

function initNavScrollState(root) {
	const threshold = Number(root.dataset.navScrolledThreshold) || 24;

	function updateScrollState() {
		document.documentElement.classList.toggle(CLASSES.scrolled, window.scrollY > threshold);
	}

	function start() {
		updateScrollState();

		if (window.gsap && window.ScrollTrigger) {
			window.gsap.registerPlugin(window.ScrollTrigger);

			window.ScrollTrigger.create({
				start: 0,
				end: () => window.ScrollTrigger.maxScroll(window),
				onUpdate: (self) => {
					document.documentElement.classList.toggle(CLASSES.scrolled, self.scroll() > threshold);
				},
			});

			return;
		}

		window.addEventListener("scroll", updateScrollState, { passive: true });
	}

	if (document.readyState === "loading") {
		window.addEventListener("load", start, { once: true });
		return;
	}

	start();
}

function initDesktopNav(root) {
	const triggers = [...root.querySelectorAll(SELECTORS.trigger)];
	const panels = [...root.querySelectorAll(SELECTORS.panel)];

	function openPanel(name) {
		root.classList.add(CLASSES.open);

		clearActive(triggers);
		clearActive(panels);

		const trigger = triggers.find((el) => el.dataset.navTrigger === name);
		const panel = panels.find((el) => el.dataset.navMega === name);

		setActive(trigger);
		setActive(panel);
	}

	function closePanel() {
		root.classList.remove(CLASSES.open);
		clearActive(triggers);
		clearActive(panels);
	}

	triggers.forEach((trigger) => {
		const panelName = trigger.dataset.navTrigger;

		trigger.addEventListener("mouseenter", () => openPanel(panelName));
		trigger.addEventListener("focus", () => openPanel(panelName));
	});

	root.addEventListener("mouseleave", closePanel);

	document.addEventListener("keydown", (event) => {
		if (event.key === "Escape") closePanel();
	});
}

let navInitialized = false;

export function initNav() {
	if (navInitialized) return;
	navInitialized = true;

	const root = document.querySelector(SELECTORS.component);
	logMobileNav("initNav", {
		rootFound: Boolean(root),
	});
	if (!root) return;

	initDesktopNav(root);
	initDesktopMega(root);
	initMobileNav(root);
	initNavScrollState(root);
}
