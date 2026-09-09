import { initCopyrightYear } from "./src/modules/copyright.js";
import { initAccordions } from "./src/modules/accordions.js";
import { initNav } from "./src/modules/nav.js";
import {
	initCarousels as initSplideCarousels,
	destroyCarousels as destroySplideCarousels,
	reInitCarousels as reInitSplideCarousels,
	getCarouselInstances as getSplideCarouselInstances,
} from "./src/modules/carousels/splide.js";
import { initOverflowDrag } from "./src/modules/overflow-drag.js";
import { initForms, destroySelects } from "./src/modules/forms/index.js";
import { initQaUpload } from "./src/modules/forms/qa-upload.js";
import { initQuoteSheet } from "./src/modules/forms/quote-sheet.js";
// import "./src/modules/forms/dev.js"; // dev-only form logging/table — keep off outside local dev
import { initProcess } from "./src/modules/process.js";
import { initSectionNav } from "./src/modules/section-nav.js";
import { initTabs } from "./src/modules/tabs.js";
import { initLoadMore } from "./src/modules/load-more.js";
import { initTables } from "./src/modules/tables.js";
import { initFaq } from "./src/modules/faq.js";
import {
	initStructuredData,
	registerStructuredDataType,
} from "./src/modules/structured-data.js";
import { BREAKPOINT_PX, BREAKPOINT_QUERIES } from "./src/utils/breakpoints.js";
import { initGoldTrend } from "./src/modules/gold-trend.js";
import { initHistoryTimeline } from "./src/modules/history-timeline.js";
import { initMaps } from "./src/modules/map.js";
import {
	initAllResourcesFilters,
	getAllResourcesFiltersInstance,
} from "./src/modules/all-resources-filters.js";
import {
	initContactWidget,
	getContactWidgetInstances,
} from "./src/modules/contact-widget.js";
import { initA11yAnchors } from "./src/modules/a11y-anchors.js";

const sr = (window.sr = window.sr || {});
sr.functions = sr.functions || {};
sr.defs = sr.defs || {};

sr.defs.breakpoints = BREAKPOINT_PX;
sr.defs.breakpointQueries = BREAKPOINT_QUERIES;

sr.functions.initCopyrightYear = initCopyrightYear;
sr.functions.initAccordions = initAccordions;
sr.functions.initNav = initNav;
sr.functions.initCarousels = initSplideCarousels;
sr.functions.destroyCarousels = destroySplideCarousels;
sr.functions.reInitCarousels = reInitSplideCarousels;
sr.functions.getCarouselInstances = getSplideCarouselInstances;
sr.functions.initSplideCarousels = initSplideCarousels;
sr.functions.destroySplideCarousels = destroySplideCarousels;
sr.functions.reInitSplideCarousels = reInitSplideCarousels;
sr.functions.getSplideCarouselInstances = getSplideCarouselInstances;
sr.functions.initOverflowDrag = initOverflowDrag;
sr.functions.initForms = initForms;
sr.functions.destroySelects = destroySelects;
sr.functions.initProcess = initProcess;
sr.functions.initSectionNav = initSectionNav;
sr.functions.initTabs = initTabs;
sr.functions.initLoadMore = initLoadMore;
sr.functions.initTables = initTables;
sr.functions.initFaq = initFaq;
sr.functions.initStructuredData = initStructuredData;
sr.functions.registerStructuredDataType = registerStructuredDataType;
sr.functions.initGoldTrend = initGoldTrend;
sr.functions.initHistoryTimeline = initHistoryTimeline;
sr.functions.initMaps = initMaps;
sr.functions.initAllResourcesFilters = initAllResourcesFilters;
sr.functions.getAllResourcesFiltersInstance = getAllResourcesFiltersInstance;
sr.functions.initContactWidget = initContactWidget;
sr.functions.getContactWidgetInstances = getContactWidgetInstances;
sr.functions.initA11yAnchors = initA11yAnchors;
sr.functions.initQaUpload = initQaUpload;
sr.functions.initQuoteSheet = initQuoteSheet;

// Priority: critical
initNav();
initSectionNav();
initForms();
initQaUpload();

// Priority: high
initTabs();
initOverflowDrag();
initSplideCarousels();
initAccordions();
initLoadMore();
initTables();
initFaq();
initStructuredData();
initGoldTrend();
initQuoteSheet();
initAllResourcesFilters();
initHistoryTimeline();
initContactWidget();

// Priority: low
initProcess();
initCopyrightYear();
initA11yAnchors();

document.documentElement.classList.add("sr-ready");
