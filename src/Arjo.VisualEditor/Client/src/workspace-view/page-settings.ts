/**
 * Page settings (#22): the document properties that aren't shown on the page (SEO fields, "hide from navigation",
 * settings, or simply empty), grouped as on the Content tab: by tab, then group. Containers from the document type
 * and its compositions are merged by name, as the Content tab does.
 */

export interface ContainerModel {
	id: string;
	parent: { id: string } | null;
	name: string;
	type: string; // 'Tab' | 'Group'
	sortOrder: number;
}

export interface PropertyModel {
	alias: string;
	sortOrder: number;
	container?: { id: string } | null;
}

export interface PageSettingsGroup {
	/** Group name; null for properties directly on a tab (or on no tab at all). */
	name: string | null;
	aliases: string[];
}

export interface PageSettingsTab {
	/** Tab name; null for groups outside any tab. */
	name: string | null;
	groups: PageSettingsGroup[];
}

interface Ordered<T> {
	sortOrder: number;
	value: T;
}

const byOrder = <T>(a: Ordered<T>, b: Ordered<T>) => a.sortOrder - b.sortOrder;

/**
 * Groups the properties not in `visibleAliases` by tab and group. Empty tabs and groups are left out; groups outside
 * any tab come first, as on the Content tab.
 */
export function pageSettings(
	containers: readonly ContainerModel[],
	properties: readonly PropertyModel[],
	visibleAliases: ReadonlySet<string>,
): PageSettingsTab[] {
	const byId = new Map(containers.map((c) => [c.id, c]));
	// Tab name -> its sort order and its groups (group name -> properties). Merged by name across compositions.
	const tabs = new Map<string | null, { sortOrder: number; groups: Map<string | null, Ordered<PropertyModel>[]> }>();

	const tabOf = (name: string | null, sortOrder: number) => {
		let tab = tabs.get(name);
		if (!tab) tabs.set(name, (tab = { sortOrder, groups: new Map() }));
		tab.sortOrder = Math.min(tab.sortOrder, sortOrder);
		return tab;
	};
	const groupOrder = new Map<string, number>();

	for (const property of properties) {
		if (visibleAliases.has(property.alias)) continue;
		const container = property.container ? byId.get(property.container.id) : undefined;

		let tabName: string | null = null;
		let tabSort = -1;
		let groupName: string | null = null;
		let groupSort = -1;
		if (container?.type === 'Tab') {
			tabName = container.name;
			tabSort = container.sortOrder;
		} else if (container) {
			groupName = container.name;
			groupSort = container.sortOrder;
			const parent = container.parent ? byId.get(container.parent.id) : undefined;
			if (parent) {
				tabName = parent.name;
				tabSort = parent.sortOrder;
			}
		}

		const tab = tabOf(tabName, tabSort);
		let group = tab.groups.get(groupName);
		if (!group) tab.groups.set(groupName, (group = []));
		const key = `${tabName}\u0000${groupName}`;
		groupOrder.set(key, Math.min(groupOrder.get(key) ?? groupSort, groupSort));
		group.push({ sortOrder: property.sortOrder, value: property });
	}

	return [...tabs.entries()]
		.map(([name, tab]) => ({ sortOrder: tab.sortOrder, value: { name, groups: tab.groups } }))
		.sort(byOrder)
		.map(({ value: { name, groups } }) => ({
			name,
			groups: [...groups.entries()]
				.map(([groupName, props]) => ({
					sortOrder: groupOrder.get(`${name}\u0000${groupName}`) ?? -1,
					value: { name: groupName, aliases: [...props].sort(byOrder).map((p) => p.value.alias) },
				}))
				.sort(byOrder)
				.map((g) => g.value),
		}));
}
