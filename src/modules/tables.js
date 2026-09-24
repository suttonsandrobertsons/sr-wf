const SELECTORS = {
	component: "[data-table]",
	desktopTable: "table",
	headerCells: "thead th",
	bodyRows: "tbody tr",
	tableCells: "th, td",
};

const CLASSES = {
	mobileCards: "comparison-table_cards",
	mobileCard: "comparison-table_card",
	mobileCardHeading: "comparison-table_card_heading",
	mobileCardRows: "comparison-table_card_rows",
	mobileCardRow: "comparison-table_card_row",
	mobileCardLabel: "comparison-table_card_label",
	mobileCardValue: "comparison-table_card_value",
	mobileCardValueBold: "is-bold",
	highlighted: "is-highlight",
};

const ATTRIBUTES = {
	desktopTable: "data-table-desktop",
	mobileCards: "data-table-mobile",
	bound: "data-table-bound",
	ariaHidden: "aria-hidden",
	boldValues: "data-table-bold-values",
	highlightHeader: "data-table-highlight-header",
	alignFirstColumn: "data-table-align-first-column",
	highlightColumn: "data-table-highlight-col",
	generatedHighlight: "data-table-generated-highlight",
	generatedWrapper: "data-table-generated-wrapper",
};

const CLEANUP_KEY = "__comparisonTableCleanup";
const STYLE_ID = "sr-table-overrides";
const ALIGN_FIRST_COLUMN_VALUES = new Set(["center", "left"]);

export function initTables() {
	ensureTableStyles();

	document.querySelectorAll(SELECTORS.component).forEach((source) => {
		if (isTableInsideTableComponent(source)) return;

		const component = normaliseTableComponent(source);
		const table = component.querySelector(SELECTORS.desktopTable);
		if (!table) {
			console.warn("[tables] No table found inside table component.", component);
			return;
		}

		if (typeof component[CLEANUP_KEY] === "function") {
			component[CLEANUP_KEY]();
		}

		try {
			applyTableOverrides(component, table);

			if (component.getAttribute("data-table") !== "responsive") return;

			const data = parseComparisonTable(table);
			const boldValues = component.getAttribute(ATTRIBUTES.boldValues) === "true";
			const mobileCards = buildMobileCards(data, { boldValues });

			table.setAttribute(ATTRIBUTES.desktopTable, "");
			component.appendChild(mobileCards);
			component.setAttribute(ATTRIBUTES.bound, "true");

			component[CLEANUP_KEY] = function cleanup() {
				mobileCards.remove();
				table.removeAttribute(ATTRIBUTES.desktopTable);
				component.removeAttribute(ATTRIBUTES.bound);
			};
		} catch (error) {
			console.warn("[tables]", error);
		}
	});
}

function isTableInsideTableComponent(element) {
	return (
		element.matches(SELECTORS.desktopTable) &&
		Boolean(element.parentElement?.closest(SELECTORS.component))
	);
}

function normaliseTableComponent(component) {
	if (
		!component.matches(SELECTORS.desktopTable) ||
		component.getAttribute("data-table") !== "responsive"
	) {
		return component;
	}

	const wrapper = document.createElement("div");

	Array.from(component.attributes).forEach((attribute) => {
		if (!isTableConfigurationAttribute(attribute.name)) return;

		wrapper.setAttribute(attribute.name, attribute.value);

		if (attribute.name === "data-table") {
			component.removeAttribute(attribute.name);
		}
	});

	wrapper.setAttribute(ATTRIBUTES.generatedWrapper, "");
	component.before(wrapper);
	wrapper.appendChild(component);

	return wrapper;
}

function isTableConfigurationAttribute(attributeName) {
	return attributeName === "data-table" || attributeName.startsWith("data-table-");
}

function ensureTableStyles() {
	if (document.getElementById(STYLE_ID)) return;

	const style = document.createElement("style");
	style.id = STYLE_ID;
	style.textContent = `
		[data-table][${ATTRIBUTES.highlightHeader}="true"] :where(thead) {
			background-color: var(--_theme---table--border);
		}

		[data-table][${ATTRIBUTES.alignFirstColumn}="left"] :where(thead th:first-child, tbody th:first-child) {
			text-align: left;
		}

		[data-table][${ATTRIBUTES.alignFirstColumn}="center"] :where(thead th:first-child, tbody th:first-child) {
			text-align: center;
		}

		[data-table] :where(.${CLASSES.highlighted}) {
			background-color: var(--_theme---table--border);
		}
	`;

	document.head.appendChild(style);
}

function applyTableOverrides(component, table) {
	normaliseHighlightHeader(component);
	normaliseAlignFirstColumn(component);
	applyHighlightColumn(component, table);
}

function normaliseHighlightHeader(component) {
	const value = component.getAttribute(ATTRIBUTES.highlightHeader);

	if (isTruthyOverride(value)) {
		component.setAttribute(ATTRIBUTES.highlightHeader, "true");
	}
}

function normaliseAlignFirstColumn(component) {
	const value = normaliseAttributeValue(component.getAttribute(ATTRIBUTES.alignFirstColumn));

	if (ALIGN_FIRST_COLUMN_VALUES.has(value)) {
		component.setAttribute(ATTRIBUTES.alignFirstColumn, value);
	}
}

function applyHighlightColumn(component, table) {
	clearGeneratedHighlights(table);

	const columnIndex = parsePositiveInteger(component.getAttribute(ATTRIBUTES.highlightColumn));
	if (!columnIndex) return;

	table
		.querySelectorAll(`thead tr > :nth-child(${columnIndex}), tbody tr > :nth-child(${columnIndex})`)
		.forEach((cell) => {
			cell.classList.add(CLASSES.highlighted);
			cell.setAttribute(ATTRIBUTES.generatedHighlight, "");
		});
}

function clearGeneratedHighlights(table) {
	table.querySelectorAll(`[${ATTRIBUTES.generatedHighlight}]`).forEach((cell) => {
		cell.classList.remove(CLASSES.highlighted);
		cell.removeAttribute(ATTRIBUTES.generatedHighlight);
	});
}

function isTruthyOverride(value) {
	const normalisedValue = normaliseAttributeValue(value);

	return Boolean(normalisedValue) && !["false", "0", "no", "none"].includes(normalisedValue);
}

function normaliseAttributeValue(value) {
	return String(value || "")
		.trim()
		.toLowerCase();
}

function parsePositiveInteger(value) {
	const number = parseInt(value, 10);

	return Number.isInteger(number) && number > 0 ? number : null;
}

function parseComparisonTable(table) {
	const headerCells = Array.from(table.querySelectorAll(SELECTORS.headerCells));

	if (!headerCells.length) {
		throw new Error("Comparison table requires header cells inside <thead>.");
	}

	const columns = headerCells.map((cell) => {
		return {
			label: getCellText(cell),
			html: cell.innerHTML.trim(),
			isHighlighted: cell.classList.contains(CLASSES.highlighted),
		};
	});

	const bodyRows = Array.from(table.querySelectorAll(SELECTORS.bodyRows));

	if (!bodyRows.length) {
		throw new Error("Comparison table requires at least one row inside <tbody>.");
	}

	const rows = bodyRows.map((row, rowIndex) => {
		const cells = Array.from(row.children).filter((cell) => cell.matches(SELECTORS.tableCells));

		if (cells.length !== columns.length) {
			throw new Error(
				`Row ${rowIndex + 1} has ${cells.length} cell(s), but the table header has ${columns.length} column(s).`,
			);
		}

		return {
			heading: cells[0].innerHTML.trim(),
			cells: cells.slice(1).map((cell, index) => {
				const column = columns[index + 1];

				return {
					label: column.html,
					value: cell.innerHTML.trim(),
					isHighlighted: cell.classList.contains(CLASSES.highlighted) || column.isHighlighted,
				};
			}),
		};
	});

	return {
		columns,
		rows,
	};
}

function buildMobileCards(data, options = {}) {
	const { boldValues = false } = options;
	const wrapper = document.createElement("div");

	wrapper.className = CLASSES.mobileCards;
	wrapper.setAttribute(ATTRIBUTES.mobileCards, "");

	data.rows.forEach((row) => {
		const card = document.createElement("article");
		card.className = CLASSES.mobileCard;

		const heading = document.createElement("h3");
		heading.className = CLASSES.mobileCardHeading;
		heading.innerHTML = row.heading;

		const rows = document.createElement("div");
		rows.className = CLASSES.mobileCardRows;

		row.cells.forEach((cell) => {
			const item = document.createElement("div");
			item.className = CLASSES.mobileCardRow;

			if (cell.isHighlighted) {
				item.classList.add(CLASSES.highlighted);
			}

			const valueClasses = boldValues
				? `${CLASSES.mobileCardValue} ${CLASSES.mobileCardValueBold}`
				: CLASSES.mobileCardValue;

			item.innerHTML = `
				<div class="${CLASSES.mobileCardLabel}">${cell.label}</div>
				<div class="${valueClasses}">${cell.value}</div>
			`;

			rows.appendChild(item);
		});

		card.append(heading, rows);
		wrapper.appendChild(card);
	});

	return wrapper;
}

function getCellText(cell) {
	return cell.textContent.replace(/\s+/g, " ").trim();
}
