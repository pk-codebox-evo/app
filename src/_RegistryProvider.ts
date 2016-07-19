import { ComposeFactory } from 'dojo-compose/compose';
import Promise from 'dojo-shim/Promise';
import { Child } from 'dojo-widgets/mixins/interfaces';

import {
	ActionLike,
	CombinedRegistry,
	StoreLike,
	WidgetLike
} from './createApp';

/**
 * Registry to (asynchronously) get instances by their ID.
 */
export interface Registry<T> {
	/**
	 * Asynchronously get an instance by its ID.
	 *
	 * @param id Identifier for the instance that is to be retrieved
	 * @return A promise for the instance. The promise rejects if no instance was found.
	 */
	get(id: string): Promise<T>;

	/**
	 * Look up the identifier for which the given value has been registered.
	 *
	 * Throws if the value hasn't been registered.
	 *
	 * @param value The value
	 * @return The identifier
	 */
	identify(value: T): string;
}

/**
 * Registry to (asynchronously) get widget instances by their ID, as well as create new instances that are then added
 * to the registry.
 */
export interface WidgetRegistry<T extends Child> extends Registry<T> {
	/**
	 * Create a new instance and add it to the registry.
	 *
	 * @param factory Factory to create the new instance
	 * @param options Options to be passed to the factory. Automatically extended with the `registryProvider` option,
	 *   and the `stateFrom` option if an `id` was present and the application factory has a default store.
	 * @return A promise for a tuple containing the ID of the created widget, and the widget instance itself.
	 */
	create<U extends T, O>(factory: ComposeFactory<U, O>, options?: O): Promise<[string, U]>;
}

/**
 * Provides access to read-only registries for actions, stores and widgets.
 */
export default class RegistryProvider {
	private actionRegistry: Registry<ActionLike>;
	private storeRegistry: Registry<StoreLike>;
	private widgetRegistry: WidgetRegistry<WidgetLike>;

	private combinedRegistry: CombinedRegistry;
	constructor(combinedRegistry: CombinedRegistry) {
		this.combinedRegistry = combinedRegistry;
	}

	/**
	 * Get an action, store or widget registry.
	 *
	 * @param type The type of registry that is required.
	 * @return The registry.
	 */
	get(type: 'actions'): Registry<ActionLike>;
	get(type: 'stores'): Registry<StoreLike>;
	get(type: 'widgets'): WidgetRegistry<WidgetLike>;
	get(type: string): Registry<any>;
	get(type: string): Registry<any> {
		switch (type) {
			case 'actions':
				return this.actionRegistry || (this.actionRegistry = {
					get: this.combinedRegistry.getAction,
					identify: this.combinedRegistry.identifyAction
				});
			case 'stores':
				return this.storeRegistry || (this.storeRegistry = {
					get: this.combinedRegistry.getStore,
					identify: this.combinedRegistry.identifyStore
				});
			case 'widgets':
				return this.widgetRegistry || (this.widgetRegistry = {
					create: this.combinedRegistry.createWidget,
					get: this.combinedRegistry.getWidget,
					identify: this.combinedRegistry.identifyWidget
				});
			default:
				throw new Error(`No such store: ${type}`);
		}
	}
}
