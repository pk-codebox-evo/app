import { EventedListenersMap } from 'dojo-compose/mixins/createEvented';
import { assign } from 'dojo-core/lang';
import Promise from 'dojo-shim/Promise';

import {
	ActionDefinition,
	ActionFactory,
	ActionLike,
	CombinedRegistry,
	CustomElementDefinition,
	ItemDefinition,
	RegistryProvider,
	StoreDefinition,
	StoreFactory,
	StoreLike,
	WidgetDefinition,
	WidgetFactory,
	WidgetLike
} from '../createApp';
import { ResolveMid } from './moduleResolver';
import resolveListenersMap from './resolveListenersMap';

function resolveStore(registry: CombinedRegistry, definition: ActionDefinition | WidgetDefinition): void | StoreLike | Promise<StoreLike> {
	const { stateFrom } = definition;
	if (!stateFrom) {
		return null;
	}

	if (typeof stateFrom !== 'string') {
		return stateFrom;
	}

	return registry.getStore(<string> stateFrom);
}

type Factory = ActionFactory | StoreFactory | WidgetFactory;
type Instance = ActionLike | StoreLike | WidgetLike;
type FactoryTypes = 'action' | 'customElement' | 'store' | 'widget';
const errorStrings: { [type: string]: string } = {
	action: 'an action',
	customElement: 'a widget',
	store: 'a store',
	widget: 'a widget'
};

function isInstance(value: any): value is Instance {
	return value && typeof value === 'object';
}

/**
 * Resolve a factory for an action, custom element, store or widget.
 *
 * Custom element definitions must have a `factory` field. Other definitions have either `instance` or `factory`
 * fields. These may be module identifiers. If necessary resolve the module identifier, then if an instance was
 * defined create a wrapper function that can act as a factory for that instance.
 *
 * @param type What type of factory needs to be resolved
 * @param definition Definition of the action, store or widget that is resolved
 * @param resolveMid Function to asynchronously resolve a module identifier
 * @return A promise for the factory. Rejects if the resolved module does not export an appropriate default
 */
function resolveFactory(type: 'action', definition: ActionDefinition, resolveMid: ResolveMid): Promise<ActionFactory>;
function resolveFactory(type: 'customElement', definition: CustomElementDefinition, resolveMid: ResolveMid): Promise<WidgetFactory>;
function resolveFactory(type: 'store', definition: StoreDefinition, resolveMid: ResolveMid): Promise<StoreFactory>;
function resolveFactory(type: 'widget', definition: WidgetDefinition, resolveMid: ResolveMid): Promise<WidgetFactory>;
function resolveFactory(type: FactoryTypes, definition: CustomElementDefinition | ItemDefinition<Factory, Instance>, resolveMid: ResolveMid): Promise<Factory>;
function resolveFactory(type: FactoryTypes, definition: CustomElementDefinition | ItemDefinition<Factory, Instance>, resolveMid: ResolveMid): Promise<Factory> {
	const { factory } = definition;
	const { instance = null } = (<ItemDefinition<Factory, Instance>> definition);

	if (typeof factory === 'function') {
		return Promise.resolve(factory);
	}
	else if (isInstance(instance)) {
		// <any> hammer since TypeScript can't resolve match the correct overloaded Instance type with the correct
		// Factory return value.
		const factory: Factory = () => <any> instance;
		return Promise.resolve(factory);
	}
	else {
		return new Promise((resolve, reject) => {
			if (instance) {
				resolveMid<Instance>(instance).then((defaultExport) => {
					if (!defaultExport || typeof defaultExport !== 'object') {
						reject(new Error(`Could not resolve '${instance}' to ${errorStrings[type]} instance`));
					}
					else {
						resolve(() => defaultExport);
					}
				}).catch(reject);
			}
			else {
				resolveMid<Factory>(factory).then((defaultExport) => {
					if (typeof defaultExport !== 'function') {
						reject(new Error(`Could not resolve '${factory}' to ${errorStrings[type]} factory function`));
					}
					else {
						resolve(defaultExport);
					}
				}).catch(reject);
			}
		});
	}
}

export function makeActionFactory(definition: ActionDefinition, resolveMid: ResolveMid): ActionFactory {
	if (!('factory' in definition || 'instance' in definition)) {
		throw new TypeError('Action definitions must specify either the factory or instance option');
	}
	if ('instance' in definition && 'stateFrom' in definition) {
		throw new TypeError('Cannot specify stateFrom option when action definition points directly at an instance');
	}

	return (registry: CombinedRegistry) => {
		return Promise.all<any>([
			resolveFactory('action', definition, resolveMid).then((factory) => {
				return factory(registry);
			}),
			resolveStore(registry, definition)
		]).then((values) => {
			let action: ActionLike;
			let store: StoreLike;
			[action, store] = values;

			if (store) {
				// No options are passed to the factory, since the do() implementation cannot be specified in
				// action definitions. This means the state observation has to be done after the action is created.
				action.own(action.observeState(definition.id, store));
			}

			return action;
		});
	};
}

export function makeCustomElementFactory(definition: CustomElementDefinition, resolveMid: ResolveMid): WidgetFactory {
	let promise: Promise<void>;
	let factory: WidgetFactory;
	return (options: Object) => {
		if (factory) {
			return factory(options);
		}

		if (!promise) {
			// Memoize the factory resolution.
			promise = resolveFactory('customElement', definition, resolveMid).then((result) => {
				factory = result;
				promise = null;
			});
		}

		return promise.then(() => {
			return factory(options);
		});
	};
}

export function makeStoreFactory(definition: StoreDefinition, resolveMid: ResolveMid): StoreFactory {
	if (!('factory' in definition || 'instance' in definition)) {
		throw new TypeError('Store definitions must specify either the factory or instance option');
	}
	if ('instance' in definition && 'options' in definition) {
		throw new TypeError('Cannot specify options when store definition points directly at an instance');
	}

	const options = assign({}, definition.options);

	return () => {
		return resolveFactory('store', definition, resolveMid).then((factory) => {
			return factory(options);
		});
	};
}

export function makeWidgetFactory(definition: WidgetDefinition, resolveMid: ResolveMid, registry: CombinedRegistry): WidgetFactory {
	if (!('factory' in definition || 'instance' in definition)) {
		throw new TypeError('Widget definitions must specify either the factory or instance option');
	}
	if ('instance' in definition) {
		if ('listeners' in definition) {
			throw new TypeError('Cannot specify listeners option when widget definition points directly at an instance');
		}
		if ('stateFrom' in definition) {
			throw new TypeError('Cannot specify stateFrom option when widget definition points directly at an instance');
		}
		if ('options' in definition) {
			throw new TypeError('Cannot specify options when widget definition points directly at an instance');
		}
	}

	const { options: rawOptions } = definition;
	if (rawOptions) {
		if ('id' in rawOptions || 'listeners' in rawOptions || 'stateFrom' in rawOptions) {
			throw new TypeError('id, listeners and stateFrom options should be in the widget definition itself, not its options value');
		}
		if ('registryProvider' in rawOptions) {
			throw new TypeError('registryProvider option must not be specified');
		}
	}

	interface BaseOptions {
		registryProvider: RegistryProvider;
		stateFrom?: StoreLike;
	}

	return ({ registryProvider, stateFrom: defaultStore }: BaseOptions) => {
		interface Options extends BaseOptions {
			id: string;
			listeners?: EventedListenersMap;
		}

		const options: Options = assign({
			id: definition.id,
			registryProvider
		}, rawOptions);

		return Promise.all<any>([
			resolveFactory('widget', definition, resolveMid),
			resolveListenersMap(registry, definition.listeners),
			resolveStore(registry, definition)
		]).then(([_factory, _listeners, _store]) => {
			const factory = <WidgetFactory> _factory;
			const listeners = <EventedListenersMap> _listeners;
			const store = <StoreLike> _store || defaultStore;

			if (listeners) {
				options.listeners = listeners;
			}
			if (store) {
				options.stateFrom = store;
			}

			return factory(options);
		});
	};
}
