import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { initStructuredData } from "./structured-data.js";

const GENERATED_SELECTOR = 'script[data-structured-data-generated="true"]';

function renderPage(markup) {
	document.body.innerHTML = markup;
	document.head.querySelectorAll(GENERATED_SELECTOR).forEach((script) => {
		script.remove();
	});
}

function parseGeneratedScript(type) {
	const script = document.head.querySelector(
		`${GENERATED_SELECTOR}[data-structured-data-type="${type}"]`,
	);

	expect(script).toBeTruthy();

	return JSON.parse(script.textContent || "{}");
}

describe("initStructuredData", () => {
	beforeEach(() => {
		renderPage("");
	});

	afterEach(() => {
		renderPage("");
	});

	it("builds FAQPage JSON-LD from the FAQ collection list", () => {
		renderPage(`
			<section data-faq-split="component" data-structured-data="faq" class="faq">
				<div data-faq-split="source" class="faq_list-cols">
					<div data-schema="faq-item" data-faq-split="item" class="faq-item">
						<div data-accordion="trigger" class="faq-item_header">
							<h3 data-schema="faq-question" class="faq-item_title">How do I get my valuables back once I repay the loan?</h3>
						</div>
						<div data-accordion="content" class="faq_content-wrap">
							<div class="faq_content">
								<div data-schema="faq-answer" class="text-rich-text w-richtext">
									<p>Once your loan has been repaid in full, you can collect your items from our London showroom or use our free insured courier return.</p>
								</div>
							</div>
						</div>
					</div>
					<div data-schema="faq-item" data-faq-split="item" class="faq-item">
						<div data-accordion="trigger" class="faq-item_header">
							<h3 data-schema="faq-question" class="faq-item_title">Is your courier service to and from Leicester insured?</h3>
						</div>
						<div data-accordion="content" class="faq_content-wrap">
							<div class="faq_content">
								<div data-schema="faq-answer" class="text-rich-text w-richtext">
									<p>Yes, all items sent to us are fully insured up to £20,000 while in transit and stored with us.</p>
								</div>
							</div>
						</div>
					</div>
				</div>
			</section>
		`);

		const scripts = initStructuredData();
		const schema = parseGeneratedScript("faq");

		expect(scripts).toHaveLength(1);
		expect(schema["@context"]).toBe("https://schema.org");
		expect(schema["@type"]).toBe("FAQPage");
		expect(schema.mainEntity).toHaveLength(2);
		expect(schema.mainEntity[0]).toMatchObject({
			"@type": "Question",
			name: "How do I get my valuables back once I repay the loan?",
			acceptedAnswer: {
				"@type": "Answer",
			},
		});
		expect(schema.mainEntity[0].acceptedAnswer.text).toContain("London showroom");
	});

	it("replaces generated scripts when run again", () => {
		renderPage(`
			<section data-faq-split="component" data-structured-data="faq" class="faq">
				<div data-faq-split="source" class="faq_list-cols">
					<div data-schema="faq-item" data-faq-split="item" class="faq-item">
						<div data-accordion="trigger" class="faq-item_header">
							<h3 data-schema="faq-question" class="faq-item_title">Question one?</h3>
						</div>
						<div data-accordion="content" class="faq_content-wrap">
							<div class="faq_content">
								<div data-schema="faq-answer" class="text-rich-text w-richtext">
									<p>Answer one.</p>
								</div>
							</div>
						</div>
					</div>
				</div>
			</section>
		`);

		initStructuredData();
		initStructuredData();

		expect(document.head.querySelectorAll(GENERATED_SELECTOR)).toHaveLength(1);
		expect(parseGeneratedScript("faq").mainEntity).toHaveLength(1);
	});
});
