import { menuUnderline } from "./tab-underline.js";
import { revealOverflowItem } from "./overflow-drag.js";

const selectors = {
	component: '[data-tab-element="component"]',
	tabs: '[data-tab-element="tabs"]',
	template: '[data-tab-element="tab-template"]',
	panel: '[data-tab-element="panel"]',
	label: '[data-tab-element="label"]',
	tab: '[data-tab-element="tab"]',
	tabText: ".tabs_tabs-item-text",
	carousel: ".panel-carousel",
	carouselButton: ".panel-carousel_btn",
	carouselList: ".panel-carousel_list",
	carouselSlide: ".panel-carousel_item",
};

const cleanupKey = "__tabsCleanup";
const instanceKey = "__tabsInstance";
const componentStateAttribute = "data-component-state";
let componentCount = 0;

function qsa(root, selector) {
	return Array.from(root.querySelectorAll(selector));
}

function isScope(value) {
	return Boolean(value) && typeof value.querySelectorAll === "function";
}

function getComponents(scope = document) {
	if (!scope) return [];

	const components = [];

	if (typeof scope.matches === "function" && scope.matches(selectors.component)) {
		components.push(scope);
	}

	if (typeof scope.querySelectorAll === "function") {
		components.push(...scope.querySelectorAll(selectors.component));
	}

	return components;
}

function getScopedElements(root, selector) {
	return qsa(root, selector).filter((element) => element.closest(selectors.component) === root);
}

function getPanelElements(panel, selector) {
	const component = panel.closest(selectors.component);
	return qsa(panel, selector).filter((element) =>
		element.closest(selectors.panel) === panel &&
		element.closest(selectors.component) === component,
	);
}

function getTabLabel(panel, index) {
	const text = getPanelElements(panel, selectors.label)[0]
		?.textContent?.trim();
	if (text) return text;

	const label = panel.getAttribute("data-tab-text");

	if (label?.trim()) {
		return label.trim();
	}

	return `Tab ${index + 1}`;
}

function buildTabFromTemplate(template) {
	const tab = template.cloneNode(true);

	tab.hidden = false;
	tab.removeAttribute("hidden");
	tab.removeAttribute("aria-hidden");
	tab.removeAttribute("inert");
	tab.removeAttribute("id");

	qsa(tab, "[id]").forEach((element) => {
		element.removeAttribute("id");
	});

	if (tab.style.display === "none") {
		tab.style.display = "";
	}

	tab.setAttribute("data-tab-element", "tab");

	return tab;
}

function setTabLabel(tab, label) {
	tab.dataset.text = label;

	const textElement = tab.querySelector(selectors.tabText);

	if (textElement) {
		textElement.textContent = label;
		return;
	}

	tab.textContent = label;
}

function clearExistingTabs(tabsRoot, template) {
	Array.from(tabsRoot.children).forEach((child) => {
		if (child === template) return;

		if (child.matches(selectors.tab) || child.getAttribute("role") === "tab") {
			child.remove();
		}
	});
}

function ensurePanelId(panel, componentId, panelIndex, usedIds) {
	const fallbackId = `tabs-panel-${componentId}-${panelIndex + 1}`;
	const currentId = panel.id?.trim();
	const isDuplicate = currentId && usedIds.has(currentId);
	const panelId = currentId && !isDuplicate ? currentId : fallbackId;

	panel.id = panelId;
	usedIds.add(panelId);

	return panelId;
}

function setElementDisplayVisibility(element, isVisible) {
	if (!element) return;

	element.style.display = isVisible ? "" : "none";
	element.setAttribute("aria-hidden", isVisible ? "false" : "true");
	element.removeAttribute("hidden");
}

function hidePanel(panel, withTransition, isCurrent, onError) {
	if (!panel) return;

	if (typeof gsap !== "undefined") {
		gsap.killTweensOf(panel);
	}

	if (!withTransition || typeof gsap === "undefined") {
		setElementDisplayVisibility(panel, false);

		if (typeof gsap !== "undefined") {
			gsap.set(panel, { clearProps: "opacity,visibility" });
		}

		return;
	}

	gsap.to(panel, {
		autoAlpha: 0,
		duration: 0.2,
		ease: "power1.out",
		onComplete: () => {
			if (!isCurrent()) return;
			try {
				setElementDisplayVisibility(panel, false);
				gsap.set(panel, { clearProps: "opacity,visibility" });
			} catch (error) {
				onError(error);
			}
		},
	});
}

function showPanel(panel, withTransition) {
	if (!panel) return;

	if (typeof gsap !== "undefined") {
		gsap.killTweensOf(panel);
	}

	setElementDisplayVisibility(panel, true);

	if (!withTransition || typeof gsap === "undefined") {
		if (typeof gsap !== "undefined") {
			gsap.set(panel, { clearProps: "opacity,visibility" });
		}

		return;
	}

	gsap.fromTo(
		panel,
		{ autoAlpha: 0 },
		{
			autoAlpha: 1,
			duration: 0.25,
			ease: "power1.out",
			clearProps: "opacity,visibility",
		},
	);
}

function getTabIndex(tabs, eventTarget) {
	const tab = eventTarget.closest(selectors.tab);

	if (!tab) return -1;

	return tabs.indexOf(tab);
}

function updateUnderline(tabsRoot, activeTab, withTransition, isCurrent, onError) {
	requestAnimationFrame(() => {
		if (!isCurrent()) return;
		try {
			menuUnderline(tabsRoot, activeTab, undefined, undefined, "", withTransition);
		} catch (error) {
			onError(error);
		}
	});
}

function setFallbackState(component) {
	component.classList.add("is-fallback");
	component.setAttribute(componentStateAttribute, "fallback");
	component.setAttribute("aria-busy", "false");
}

// Restore only properties owned by tabs; keep authored styles and content.
function captureElement(element, attributes, styles = [], classes = []) {
	const originalAttributes = attributes.map((name) => [name, element.getAttribute(name)]);
	const originalStyles = styles.map((name) => [
		name, element.style.getPropertyValue(name), element.style.getPropertyPriority(name),
	]);
	const originalClasses = classes.map((name) => [name, element.classList.contains(name)]);
	return () => {
		originalAttributes.forEach(([name, value]) => {
			if (value === null) element.removeAttribute(name);
			else element.setAttribute(name, value);
		});
		originalStyles.forEach(([name, value, priority]) => {
			if (value) element.style.setProperty(name, value, priority);
			else element.style.removeProperty(name);
		});
		originalClasses.forEach(([name, present]) => element.classList.toggle(name, present));
	};
}

function setCarouselButtonState(button, isInactive) {
	if (!button) return;

	button.classList.toggle("is-inactive", isInactive);
	button.disabled = isInactive;
	button.setAttribute("aria-disabled", isInactive ? "true" : "false");
}

function setCarouselControlsState(prevButton, nextButton, index, totalSlides) {
	const isAtStart = index <= 0;
	const isAtEnd = index >= totalSlides - 1;

	setCarouselButtonState(prevButton, isAtStart);
	setCarouselButtonState(nextButton, isAtEnd);
}

function setSlideVisibility(slide, isVisible) {
	if (!slide) return;

	slide.classList.toggle("is-active", isVisible);
	slide.style.display = isVisible ? "" : "none";
	slide.style.opacity = isVisible ? "1" : "0";
	slide.style.visibility = isVisible ? "visible" : "hidden";
	slide.setAttribute("aria-hidden", isVisible ? "false" : "true");
	slide.removeAttribute("hidden");
}

function createPanelCarousel(panel, onError) {
	if (!panel) return null;

	const carousel = getPanelElements(panel, selectors.carousel)[0];

	if (!carousel) return null;

	const inCarousel = (selector) => getPanelElements(panel, selector)
		.filter((element) => element.closest(selectors.carousel) === carousel);
	const list = inCarousel(selectors.carouselList)[0];

	if (!list) return null;

	const slides = inCarousel(selectors.carouselSlide)
		.filter((element) => element.closest(selectors.carouselList) === list);

	if (!slides.length) return null;

	const buttons = inCarousel(selectors.carouselButton);
	const prevButton = buttons.find((button) => button.classList.contains("is-prev")) || null;
	const nextButton = buttons.find((button) => !button.classList.contains("is-prev")) || null;

	let activeSlideIndex = 0;
	let isCurrent = true;

	function guard(callback) {
		return () => {
			if (!isCurrent) return;
			try { callback(); } catch (error) { onError(error); }
		};
	}

	slides.forEach((slide, index) => {
		setSlideVisibility(slide, index === 0);
	});

	setCarouselControlsState(prevButton, nextButton, activeSlideIndex, slides.length);

	function setActiveSlide(nextIndex, options = {}) {
		if (!isCurrent) return;
		try {
			const { withTransition = true } = options;
			const boundedIndex = Math.max(0, Math.min(nextIndex, slides.length - 1));

			if (boundedIndex === activeSlideIndex) {
				setCarouselControlsState(prevButton, nextButton, activeSlideIndex, slides.length);
				return;
			}

			const previousSlide = slides[activeSlideIndex];
			const nextSlide = slides[boundedIndex];

			activeSlideIndex = boundedIndex;
			setCarouselControlsState(prevButton, nextButton, activeSlideIndex, slides.length);

			if (typeof gsap !== "undefined") {
				gsap.killTweensOf(previousSlide);
				gsap.killTweensOf(nextSlide);
			}

			if (!withTransition || typeof gsap === "undefined") {
				setSlideVisibility(previousSlide, false);
				setSlideVisibility(nextSlide, true);
				return;
			}

			setElementDisplayVisibility(nextSlide, true);
			nextSlide.classList.add("is-active");

			gsap.set(nextSlide, { autoAlpha: 0 });

			gsap.to(previousSlide, {
				autoAlpha: 0,
				duration: 0.22,
				ease: "power1.out",
				onComplete: guard(() => {
					setSlideVisibility(previousSlide, false);
				}),
			});

			gsap.to(nextSlide, {
				autoAlpha: 1,
				duration: 0.28,
				ease: "power1.out",
				onComplete: guard(() => {
					nextSlide.style.opacity = "1";
					nextSlide.style.visibility = "visible";
				}),
			});
		} catch (error) {
			onError(error);
		}
	}

	function onCarouselButtonClick(event) {
		const button = event.target.closest(selectors.carouselButton);

		if (!buttons.includes(button)) return;

		event.preventDefault();

		if (button.classList.contains("is-prev")) {
			setActiveSlide(activeSlideIndex - 1);
			return;
		}

		setActiveSlide(activeSlideIndex + 1);
	}

	carousel.addEventListener("click", onCarouselButtonClick);

	return {
		panel,
		carousel,
		slides,
		setActiveSlide,
		destroy: () => {
			isCurrent = false;
			carousel.removeEventListener("click", onCarouselButtonClick);

			if (typeof gsap !== "undefined") {
				slides.forEach((slide) => gsap.killTweensOf(slide));
			}
		},
	};
}

function createTabs(component) {
	if (!component) return null;
	if (component[instanceKey]) return component[instanceKey];

	if (window.sr?.tabStartup?.canEnhance() === false) {
		setFallbackState(component);
		return null;
	}

	const panels = getScopedElements(component, selectors.panel);
	const template = getScopedElements(component, selectors.template)[0] || null;
	const tabsRoot = getScopedElements(component, selectors.tabs)[0] || null;

	if (!panels.length || !template || !tabsRoot || template.parentElement !== tabsRoot || template.tagName !== "BUTTON") {
		setFallbackState(component);
		return null;
	}

	const componentId = ++componentCount;
	const tabs = [];
	const usedPanelIds = new Set();
	const panelCarousels = [];
	const slides = getScopedElements(component, selectors.carouselSlide);
	const restore = [
		captureElement(tabsRoot, ["role", "aria-hidden", "hidden"], ["display", "--tabs--highlight-w", "--tabs--highlight-l"]),
		captureElement(template, ["hidden", "aria-hidden", "inert", "tabindex"], ["display"]),
		...panels.map((panel) => captureElement(panel, ["id", "role", "aria-labelledby", "aria-hidden", "hidden"], ["display", "opacity", "visibility"], ["is-active"])),
		...slides.map((slide) => captureElement(slide, ["aria-hidden", "hidden"], ["display", "opacity", "visibility"], ["is-active"])),
		...getScopedElements(component, selectors.carouselButton).map((button) => captureElement(button, ["disabled", "aria-disabled"], [], ["is-inactive"])),
	];
	const removeListeners = [];
	let isCurrent = true;
	let activeIndex = 0;

	function cleanup() {
		if (!isCurrent) return;
		isCurrent = false;
		removeListeners.forEach((remove) => remove());
		panelCarousels.forEach((instance) => {
			try { instance.destroy(); } catch (error) { console.error("[tabs] Carousel cleanup failed", error); }
		});
		if (typeof gsap !== "undefined") {
			[...panels, ...slides].forEach((element) => {
				try { gsap.killTweensOf(element); } catch (error) { console.error("[tabs] Tween cleanup failed", error); }
			});
		}
		tabs.forEach((tab) => tab.remove());
		restore.forEach((restoreElement) => restoreElement());
		component[cleanupKey] = null;
		component[instanceKey] = null;
		setFallbackState(component);
	}

	function fail(error) {
		cleanup();
		console.error("[tabs] Using stacked fallback", component, error);
	}

	try {
		component[cleanupKey] = cleanup;
		component.classList.remove("is-fallback");
		component.setAttribute(componentStateAttribute, "loading");
		component.setAttribute("aria-busy", "true");
		panels.forEach((panel) => {
			const carousel = createPanelCarousel(panel, fail);
			if (carousel) panelCarousels.push(carousel);
		});

		tabsRoot.setAttribute("role", "tablist");

		if (template) {
			template.hidden = true;
			template.setAttribute("aria-hidden", "true");
			template.setAttribute("inert", "");
			template.tabIndex = -1;
			template.style.display = "none";
		}

		clearExistingTabs(tabsRoot, template);

		panels.forEach((panel, index) => {
			const tab = buildTabFromTemplate(template);
			const label = getTabLabel(panel, index);
			const panelId = ensurePanelId(panel, componentId, index, usedPanelIds);
			const tabId = `tabs-tab-${componentId}-${index + 1}`;
			const isActive = index === 0;

			setTabLabel(tab, label);
			tab.type = "button";
			tab.id = tabId;
			tab.setAttribute("role", "tab");
			tab.setAttribute("aria-controls", panelId);
			tab.setAttribute("aria-selected", isActive ? "true" : "false");
			tab.tabIndex = isActive ? 0 : -1;
			tab.classList.toggle("is-active", isActive);

			panel.setAttribute("role", "tabpanel");
			panel.setAttribute("aria-labelledby", tabId);
			panel.classList.toggle("is-active", isActive);
			setElementDisplayVisibility(panel, isActive);

			tabsRoot.append(tab);
			tabs.push(tab);
		});

		setElementDisplayVisibility(tabsRoot, tabs.length > 1);

		function setActiveTab(nextIndex, options = {}) {
			if (!isCurrent) return;
			try {
				const { withTransition = true, focusTab = false } = options;
				const nextTab = tabs[nextIndex];
				const nextPanel = panels[nextIndex];

				if (!nextTab || !nextPanel) return;

				const previousIndex = activeIndex;
				const previousPanel = panels[previousIndex];
				const previousTab = tabs[previousIndex];

				activeIndex = nextIndex;

				tabs.forEach((tab, index) => {
					const isActive = index === nextIndex;

					tab.classList.toggle("is-active", isActive);
					tab.setAttribute("aria-selected", isActive ? "true" : "false");
					tab.tabIndex = isActive ? 0 : -1;
				});

				panels.forEach((panel, index) => {
					const isActive = index === nextIndex;
					const isPrevious = index === previousIndex;

					panel.classList.toggle("is-active", isActive);

					if (isActive) {
						setElementDisplayVisibility(panel, true);
						return;
					}

					if (!isPrevious || !withTransition || previousIndex === nextIndex) {
						setElementDisplayVisibility(panel, false);
					}
				});

				if (previousPanel && previousPanel !== nextPanel) {
					hidePanel(previousPanel, withTransition, () => isCurrent, fail);
				}

				showPanel(nextPanel, previousTab !== nextTab ? withTransition : false);

				if (focusTab) {
					nextTab.focus({ preventScroll: true });
					revealOverflowItem(nextTab);
				}

				updateUnderline(tabsRoot, nextTab, previousTab !== nextTab ? withTransition : false, () => isCurrent, fail);
			} catch (error) {
				fail(error);
			}
		}

		function onClick(event) {
			const tabIndex = getTabIndex(tabs, event.target);

			if (tabIndex < 0) return;

			event.preventDefault();
			setActiveTab(tabIndex);
		}

		function onKeydown(event) {
			const currentIndex = getTabIndex(tabs, event.target);

			if (currentIndex < 0) return;

			let nextIndex = currentIndex;

			switch (event.key) {
				case "ArrowRight":
				case "ArrowDown":
					nextIndex = (currentIndex + 1) % tabs.length;
					break;
				case "ArrowLeft":
				case "ArrowUp":
					nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
					break;
				case "Home":
					nextIndex = 0;
					break;
				case "End":
					nextIndex = tabs.length - 1;
					break;
				default:
					return;
			}

			event.preventDefault();
			setActiveTab(nextIndex, {
				focusTab: true,
			});
		}

		function onResize() {
			updateUnderline(tabsRoot, tabs[activeIndex], false, () => isCurrent, fail);
		}

		tabsRoot.addEventListener("click", onClick);
		removeListeners.push(() => tabsRoot.removeEventListener("click", onClick));
		tabsRoot.addEventListener("keydown", onKeydown);
		removeListeners.push(() => tabsRoot.removeEventListener("keydown", onKeydown));
		window.addEventListener("resize", onResize);
		removeListeners.push(() => window.removeEventListener("resize", onResize));

		setActiveTab(0, {
			withTransition: false,
		});

		if (isCurrent) {
			component.setAttribute(componentStateAttribute, "ready");
			component.setAttribute("aria-busy", "false");
		} else return null;

		const instance = {
			component,
			tabsRoot,
			panels,
			tabs,
			panelCarousels,
			setActiveTab,
			destroy: cleanup,
		};
		component[instanceKey] = instance;
		return instance;
	} catch (error) {
		fail(error);
		return null;
	}
}

export function initTabs(scope = document) {
	const root = isScope(scope) ? scope : document;
	const instances = getComponents(root).map((component) => {
		try { return createTabs(component); }
		catch (error) {
			setFallbackState(component);
			console.error("[tabs] Using stacked fallback", component, error);
			return null;
		}
	}).filter(Boolean);

	if (instances.length) {
		// Rebuilt tab lists can change the tab-strip width, so ask the overflow
		// drag module (exposed on the shared window.sr namespace) to re-measure.
		const refreshOverflowDrag = window.sr?.functions?.initOverflowDrag;

		if (typeof refreshOverflowDrag === "function") {
			requestAnimationFrame(() => {
				refreshOverflowDrag();
			});
		}
	}

	return instances;
}
