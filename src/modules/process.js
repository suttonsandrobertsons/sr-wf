export function initProcess() {
	const processSections = document.querySelectorAll(".process");

	if (!processSections.length) return;

	processSections.forEach((process) => {
		const items = gsap.utils.toArray(".process_item", process);
		const trigger = process.querySelector(".process_item-list") || process;

		if (!items.length) return;

		// Every item gets a connecting line, including the last: dropping it would
		// leave the final number with nothing to animate in on.
		const lines = items;

		gsap.set(items, { "--process--number-opacity": 0 });
		gsap.set(lines, { "--process--line-scale": 0 });
		gsap.set(items[0], { "--process--number-opacity": 1 });

		const timeline = gsap.timeline({
			defaults: {
				ease: "none",
			},
			scrollTrigger: {
				trigger: trigger,
				start: "top 50%",
				end: "top 25%",
				scrub: true,
				anticipatePin: 1,
				invalidateOnRefresh: true,
			},
		});

		lines.forEach((item, index) => {
			const nextItem = items[index + 1];

			timeline.to(item, {
				"--process--line-scale": 1,
				duration: 1,
			});

			timeline.to(nextItem, {
				"--process--number-opacity": 1,
				duration: 0.01,
			});
		});
	});
}
