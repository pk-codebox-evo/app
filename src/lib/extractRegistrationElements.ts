import { remove } from 'dojo-dom/dom';
import { from as arrayFrom } from 'dojo-shim/array';
import Promise from 'dojo-shim/Promise';

import {
	ActionDefinition,
	ActionLike,
	Definitions
} from '../createApp';
import { RESOLVE_CONTENTS, ResolveMid } from './moduleResolver';
import parseJsonAttribute from './parseJsonAttribute';

interface BaseTask {
	element: Element;
}

interface JsonObject {
	[key: string]: any;
}

interface ActionTask extends BaseTask {
	as: string;
	config?: JsonObject;
	factory?: string;
	from?: string;
	importName: string;
	options?: JsonObject;
	type: 'action';
}

interface MultipleActionsTask extends BaseTask {
	from: string;
	config?: JsonObject;
	type: 'multiple-actions';
}

interface StoreTask extends BaseTask {
	factory: string;
	id: string;
	options?: JsonObject;
	type: 'store';
}

type Task = ActionTask | MultipleActionsTask | StoreTask;

const parsers = Object.create(null, {
	'app-action': {
		value(element: Element): ActionTask {
			let as = element.getAttribute('data-as');
			const configJson = element.getAttribute('data-config');
			const factory = element.getAttribute('data-factory');
			const from = element.getAttribute('data-from');
			const importName = element.getAttribute('data-import');
			const optionsJson = element.getAttribute('data-options');

			if (factory && !as) {
				throw new Error('app-action requires data-as attribute if data-factory is given');
			}
			if (!factory && !from) {
				throw new Error('app-action requires data-from attribute if data-factory is not given');
			}
			if (!factory && optionsJson) {
				throw new Error('data-options cannot be used with app-action if data-factory is given');
			}

			if (from && !as) {
				if (importName) {
					as = importName;
				}
				else {
					as = from.split('/').pop();
				}
			}

			if (!as) {
				throw new Error(`Could not determine ID for app-action (from=${from} and import=${importName})`);
			}

			const config = configJson ? parseJsonAttribute<JsonObject>('data-config', configJson) : null;
			const options = optionsJson ? parseJsonAttribute<JsonObject>('data-options', optionsJson) : null;
			if (options && 'stateFrom' in options && typeof options['stateFrom'] !== 'string') {
				throw new Error('stateFrom option for app-action must be a string');
			}

			return {
				as,
				config,
				element,
				factory,
				from,
				importName,
				options,
				type: 'action'
			};
		}
	},

	'app-actions': {
		value(element: Element): MultipleActionsTask {
			const from = element.getAttribute('data-from');
			const configJson = element.getAttribute('data-config');

			if (!from) {
				throw new Error('app-actions requires data-from attribute');
			}

			const config = configJson ? parseJsonAttribute<JsonObject>('data-config', configJson) : null;

			return {
				element,
				config,
				from,
				type: 'multiple-actions'
			};
		}
	},

	'app-store': {
		value(element: Element): StoreTask {
			const factory = element.getAttribute('data-factory');
			const id = element.getAttribute('id');
			const optionsJson = element.getAttribute('data-options');

			if (!factory) {
				throw new Error('app-store requires data-factory attribute');
			}
			if (!id) {
				throw new Error('app-store requires id attribute');
			}

			const options = optionsJson ? parseJsonAttribute<JsonObject>('data-options', optionsJson) : null;

			return {
				factory,
				id,
				element,
				options,
				type: 'store'
			};
		}
	}
});

function getRegistrationTasks(root: Element): Task[] {
	const allElements: Element[] = arrayFrom(root.getElementsByTagName('*'));
	allElements.unshift(root); // Be inclusive!

	const tasks: Task[] = [];
	for (const element of allElements) {
		let name: string;

		const tagName = element.tagName.toLowerCase();
		if (parsers[tagName]) {
			name = tagName;
		}
		else {
			const attrIs = (element.getAttribute('is') || '').toLowerCase();
			if (parsers[attrIs]) {
				name = attrIs;
			}
		}

		if (name) {
			tasks.push(parsers[name](element));
		}
	}

	return tasks;
}

function createActionDefinition(resolveMid: ResolveMid, {
	as: id,
	config,
	factory,
	from,
	importName,
	options
}: ActionTask): ActionDefinition {
	const definition: ActionDefinition = {
		id,
		factory() {
			let promise: Promise<ActionLike>;
			if (factory) {
				promise = resolveMid<(options?: Object) => ActionLike>(factory).then((factory) => {
					// Assumes factory can be called with an options object that does not provide a do()
					// function.
					return options ? factory(options) : factory();
				});
			}
			else {
				promise = resolveMid<ActionLike>(from, importName || 'default');
			}

			if (config) {
				// FIXME: configure() will be called *again* with the registry. This should somehow
				// be combined, resulting in a single call.
				return Promise.all<any>([
					promise,
					promise.then((action) => action.configure(config))
				]).then(([action]) => <ActionLike> action);
			}

			return promise;
		}
	};

	if (options && 'stateFrom' in options) {
		definition.stateFrom = <string> options['stateFrom'];
		delete options['stateFrom'];
	}

	return definition;
}

function loadMultipleActions(resolveMid: ResolveMid, {
	from,
	config
}: MultipleActionsTask): Promise<ActionDefinition[]> {
	return resolveMid<{ [member: string]: ActionLike }>(from, RESOLVE_CONTENTS).then((contents) => {
		const actions = Object.keys(contents).map((member) => {
			return {
				id: member,
				instance: contents[member]
			};
		});

		if (config) {
			return Promise.all(actions.map(({ instance }) => {
				// FIXME: configure() will be called *again* with the registry. This should somehow be combined,
				// resulting in a single call.
				return instance.configure(config);
			})).then(() => actions);
		}

		return actions;
	});
}

export default function extractRegistrationElements(resolveMid: ResolveMid, root: Element): Promise<Definitions> {
	return new Promise((resolve, reject) => {
		const definitions: Definitions = {
			actions: [],
			stores: []
		};
		const promises: Promise<void>[] = [];

		for (const task of getRegistrationTasks(root)) {
			switch (task.type) {
				case 'action':
					definitions.actions.push(createActionDefinition(resolveMid, <ActionTask> task));
					break;

				case 'multiple-actions': {
					const promise = loadMultipleActions(resolveMid, <MultipleActionsTask> task).then((actions) => {
						definitions.actions.push(...actions);
					});
					promises.push(promise);
					break;
				}

				case 'store': {
					const { factory, id, options } = <StoreTask> task;
					definitions.stores.push({ factory, id, options });
					break;
				}
			}

			remove(task.element);
		}

		Promise.all(promises)
			.then(() => resolve(definitions))
			.catch(reject);
	});
}
