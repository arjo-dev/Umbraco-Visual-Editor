import type { UmbControllerHost } from '@umbraco-cms/backoffice/controller-api';
import {
	UmbDocumentTypeDetailRepository,
	type UmbDocumentTypeDetailModel,
} from '@umbraco-cms/backoffice/document-type';

/** What `composedTypes` needs of a content type: the types it composes, or inherits from. */
export interface ComposingType {
	compositions: Array<{ contentType: { unique: string } }>;
}

/**
 * The type `unique` and the types it composes, that one first, each type only once: compositions can be shared, and
 * a cycle would never return. Types that don't load are left out.
 */
export async function composedTypes<T extends ComposingType>(
	unique: string,
	load: (unique: string) => Promise<T | undefined>,
): Promise<T[]> {
	const seen = new Set<string>();
	const walk = async (key: string): Promise<T[]> => {
		if (seen.has(key)) return [];
		seen.add(key);
		const type = await load(key);
		if (!type) return [];
		const composed = await Promise.all(type.compositions.map((c) => walk(c.contentType.unique)));
		return [type, ...composed.flat()];
	};
	return walk(unique);
}

/**
 * A block's element type with its compositions merged in, as the document workspace's structure does for the
 * document: `requestByUnique` brings only the type's own `properties` and `containers`, so a type whose properties
 * all come from compositions (Clean's row settings types, say) would look as if it had none. Containers keep their
 * own ids; `pageSettings` merges them by name, as the Content tab does.
 */
export async function requestElementType(
	host: UmbControllerHost,
	unique: string,
): Promise<UmbDocumentTypeDetailModel | undefined> {
	const repository = new UmbDocumentTypeDetailRepository(host);
	const types = await composedTypes<UmbDocumentTypeDetailModel>(
		unique,
		async (key) => (await repository.requestByUnique(key)).data ?? undefined,
	);
	const [type] = types;
	if (!type) return undefined;
	return {
		...type,
		properties: types.flatMap((t) => t.properties),
		containers: types.flatMap((t) => t.containers),
	};
}
